/**
 * 菜单运行时校验（真实 Electron 菜单，跨平台，无需渲染层交互）。
 *
 * 静态检查只能证明「快捷键字符串写得对」，这里进一步证明：
 * 1. 构建产物在当前平台真的注册了应用菜单与平台专属快捷键（含隐藏项）；
 * 2. 每个自定义菜单项的 click 都派发且只派发一条 `menu:action`，动作与源码声明一致。
 *
 * 说明：Electron 原生菜单快捷键由框架按 accelerator 分发，webContents.sendInputEvent
 * 注入的按键不会经过原生菜单（实测 Cmd+Z 无反应），因此 OS 级按键手感仍需真机；
 * 本测试覆盖的是应用侧可控的完整链路，并在 CI 的 Windows runner 上实际跑一遍。
 *
 * 运行：npm run test:menu-runtime --workspace @ai-md-editor/desktop（需先 npm run build）
 */
const { app, BrowserWindow, Menu } = require('electron');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const ROOT = join(__dirname, '../../..');

// 独立且每次清空的 userData，避免读写真实配置或残留上次运行的偏好
const PROFILE_DIR = join(tmpdir(), 'md-note-menu-runtime-profile');
rmSync(PROFILE_DIR, { recursive: true, force: true });
mkdirSync(PROFILE_DIR, { recursive: true });
app.setPath('userData', PROFILE_DIR);

/** 断言结果收集 */
const results = [];
function check(name, passed, detail = '') {
  results.push({ name, passed });
  console.log(`${passed ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** 等待条件成立（轮询，超时抛错） */
async function waitFor(fn, { timeout = 20000, interval = 100, label = '条件' } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error(`等待超时：${label}`);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/** 从 shared 源码读 MenuActions 常量值（主进程产物没有导出它） */
const sharedSrc = readFileSync(join(ROOT, 'packages/shared/src/index.ts'), 'utf-8');
const actionBlock = sharedSrc
  .slice(sharedSrc.indexOf('export const MenuActions = {'))
  .split('} as const;')[0];
const actionByName = new Map();
for (const match of actionBlock.matchAll(/([A-Za-z][\w]*):\s*'([^']+)'/g)) {
  actionByName.set(match[1], match[2]);
}

/** 从菜单源码读 `item('标签', MenuActions.X)` 的标签 → 动作映射 */
const menuSrc = readFileSync(join(ROOT, 'apps/desktop/src/main/menu.ts'), 'utf-8');
const labelToAction = new Map();
for (const match of menuSrc.matchAll(/item\(\s*'([^']+)'\s*,\s*MenuActions\.([A-Za-z][\w]*)/g)) {
  labelToAction.set(match[1], actionByName.get(match[2]));
}

// 启动真实主进程：注册 IPC、构建原生菜单并创建窗口
require(join(__dirname, '../out/main/index.js'));

/** 递归收集菜单项（含隐藏项与子菜单项） */
function collectItems(menu) {
  const list = [];
  const walk = (submenu) => {
    for (const item of submenu.items) {
      list.push(item);
      if (item.submenu) walk(item.submenu);
    }
  };
  walk(menu);
  return list;
}

/** 各平台必须注册的关键快捷键（TODO 里逐条列出的那些） */
function requiredAccelerators(platform) {
  const common = [
    'CommandOrControl+Z',
    'Shift+CommandOrControl+Z',
    'CommandOrControl+Y',
    'CommandOrControl+M'
  ];
  return platform === 'win32'
    ? [...common, 'Alt+Up', 'Alt+Down', 'F11', 'Alt+Shift+K', 'Ctrl+Alt+S', 'Ctrl+Alt+B', 'Ctrl+Alt+C', 'Ctrl+Alt+1']
    : [...common, 'Ctrl+Up', 'Ctrl+Down', 'Ctrl+Command+F', 'Ctrl+Shift+K', 'Ctrl+Command+S', 'Ctrl+Command+B', 'Ctrl+Command+C', 'Ctrl+Command+1'];
}

async function runTests() {
  await waitFor(
    () => Menu.getApplicationMenu() && BrowserWindow.getAllWindows().length > 0,
    { label: '应用菜单与窗口就绪' }
  );

  const menu = Menu.getApplicationMenu();
  const items = collectItems(menu);
  const labels = new Set(items.map((item) => item.label));
  check(
    '应用菜单包含文件/编辑/段落/格式/显示/帮助六组',
    ['文件', '编辑', '段落', '格式', '显示', '帮助'].every((label) => labels.has(label)),
    `菜单项共 ${items.length} 个`
  );

  const accelerators = new Set(items.map((item) => item.accelerator).filter(Boolean));
  const platform = process.platform;
  const required = requiredAccelerators(platform);
  const missing = required.filter((acc) => !accelerators.has(acc));
  check(
    `${platform === 'win32' ? 'Windows' : 'macOS'} 关键快捷键全部注册`,
    missing.length === 0,
    missing.length > 0 ? `缺失：${missing.join(', ')}` : `${required.length} 项，含隐藏项与平台差异键`
  );

  // 拦截 send 且不转发：既能捕获派发结果，又不会让渲染层真的执行动作
  const win = BrowserWindow.getAllWindows()[0];
  const originalSend = win.webContents.send;
  const sent = [];
  win.webContents.send = (...args) => {
    sent.push(args);
  };

  let clicked = 0;
  const mismatches = [];
  try {
    for (const item of items) {
      const expected = labelToAction.get(item.label);
      // 顶层「段落」等分组项也有默认 click（空实现）且标签可能与子项重名，跳过容器
      if (!expected || item.role || item.submenu || typeof item.click !== 'function') continue;
      sent.length = 0;
      item.click();
      clicked += 1;
      const messages = sent.filter(([channel]) => channel === 'menu:action');
      if (messages.length !== 1 || messages[0][1]?.action !== expected) {
        mismatches.push(`${item.label}: 期望 ${expected}，实际 ${JSON.stringify(messages)}`);
      }
    }
  } finally {
    win.webContents.send = originalSend;
  }
  check(
    '自定义菜单项点击派发正确的动作',
    mismatches.length === 0 && clicked >= 40,
    mismatches.length > 0 ? mismatches.slice(0, 3).join('; ') : `验证 ${clicked} 项，1 项 1 条 menu:action`
  );
}

app.whenReady().then(async () => {
  let failed = false;
  try {
    await runTests();
  } catch (error) {
    failed = true;
    console.error('菜单运行时校验异常:', error);
  }
  const passed = results.filter((result) => result.passed).length;
  console.log(`\n结果：${passed}/${results.length} 通过`);
  if (results.some((result) => !result.passed)) failed = true;
  app.exit(failed ? 1 : 0);
});

/**
 * 端到端自动化测试（真实 Electron 主进程 + preload + 渲染层）。
 *
 * 覆盖 TODO.md 里「需要真实环境手工验证」的条目：
 * - 表格菜单项按光标上下文置灰
 * - 表头行删除（WYSIWYG 与源码模式）
 * - 缩放档位与状态栏百分比
 * - 复制为纯文本 / Markdown / HTML 代码
 * - 全屏 / 最小化
 * - 深层目录下「在文件树中显示」逐级展开
 * - 源码模式撤销栈的连续键入合并
 *
 * 运行（必须关掉内嵌 Node 模式与 NODE_OPTIONS 注入）：
 *   env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \
 *     ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
 *     --no-sandbox --disable-gpu apps/desktop/test/e2e.cjs
 * 或用 npm 脚本：npm run test:e2e
 */
const { app, BrowserWindow, Menu, clipboard, dialog } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

// 启动真实主进程（注册 IPC / 原生菜单 / 创建窗口）
require('../out/main/index.js');

/** 断言结果收集 */
const results = [];
function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  const mark = passed ? '✓' : '✗';
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** 等待条件成立（轮询，超时抛错） */
async function waitFor(fn, { timeout = 15000, interval = 120, label = '条件' } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error(`等待超时：${label}`);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/** 主窗口 */
function getWindow() {
  return BrowserWindow.getAllWindows()[0] ?? null;
}

/** 在渲染层执行脚本 */
function exec(code) {
  const win = getWindow();
  if (!win) throw new Error('窗口不存在');
  return win.webContents.executeJavaScript(code, true);
}

/** 向渲染层派发原生菜单动作（与真实菜单点击走同一条 IPC） */
function menuAction(action, payload) {
  const win = getWindow();
  win.webContents.send('menu:action', payload === undefined ? { action } : { action, payload });
}

/** 在菜单树里按文案查找菜单项 */
function findMenuLabel(menu, label) {
  for (const item of menu.items) {
    if (item.label === label) return item;
    if (item.submenu) {
      const found = findMenuLabel(item.submenu, label);
      if (found) return found;
    }
  }
  return null;
}

/** 等待指定文案的菜单项出现并返回 enabled 状态 */
async function menuItemEnabled(label) {
  const started = Date.now();
  for (;;) {
    const menu = Menu.getApplicationMenu();
    const item = menu ? findMenuLabel(menu, label) : null;
    if (item) return item.enabled;
    if (Date.now() - started > 8000) return null;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** 在渲染层用原生 setter 修改 textarea 的值并触发 React onChange */
const SET_TEXTAREA = `
void (window.__setSource = (value, caret) => {
  const ta = document.querySelector('.source-editor');
  if (!ta) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, value);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  const pos = caret === undefined ? value.length : caret;
  ta.focus();
  ta.setSelectionRange(pos, pos);
  ta.dispatchEvent(new Event('select', { bubbles: true }));
  return true;
})
`;

/** 读取源码模式 textarea 的内容 */
const READ_SOURCE = `(() => {
  const ta = document.querySelector('.source-editor');
  return ta ? ta.value : null;
})()`;

/** 点击元素中心（模拟真实鼠标输入，ProseMirror 会据此移动选区） */
async function clickSelector(selector, index = 0) {
  const point = await exec(`(() => {
    const nodes = document.querySelectorAll(${JSON.stringify(selector)});
    const el = nodes[${index}];
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  if (!point) throw new Error(`找不到可点击元素：${selector}[${index}]`);
  const win = getWindow();
  win.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 250));
}

/** 切换到源码模式（已经是源码模式则跳过） */
async function ensureSourceMode() {
  const isSource = await exec(`Boolean(document.querySelector('.source-editor'))`);
  if (!isSource) {
    menuAction('view:toggle-mode');
    await waitFor(() => exec(`Boolean(document.querySelector('.source-editor'))`), { label: '进入源码模式' });
  }
  await exec(SET_TEXTAREA);
}

/** 切换到 WYSIWYG 模式（已经是则跳过） */
async function ensureWysiwygMode() {
  const isSource = await exec(`Boolean(document.querySelector('.source-editor'))`);
  if (isSource) {
    menuAction('view:toggle-mode');
    await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror'))`), { label: '进入所见即所得模式' });
  }
  // 等编辑器异步初始化完成（Shiki 高亮器加载）
  await waitFor(
    () => exec(`Boolean(document.querySelector('.ProseMirror table, .ProseMirror p'))`),
    { label: '编辑器挂载' }
  );
}

/** 表格 Markdown 测试数据 */
const TABLE_DOC = `| 表头 A | 表头 B |
| --- | --- |
| 单元格 a1 | 单元格 b1 |
| 单元格 a2 | 单元格 b2 |
`;

/** 归一化表格文本：忽略单元格对齐补齐造成的多余空格与分隔线长短 */
function normalizeTable(text) {
  return String(text)
    .trim()
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' ').replace(/-{2,}/g, '---'))
    .join('\n');
}

/**
 * 主流程。
 */
async function runTests() {
  // ===== 0. 等待窗口与第一版编辑器 =====
  const win = await waitFor(() => getWindow(), { label: '窗口创建' });
  await waitFor(() => exec(`Boolean(document.querySelector('.app'))`), { label: 'React 挂载' });
  check('窗口与渲染层启动', true, `windowSize=${win.getContentSize().join('x')}`);

  // ===== 1. 表格上下文置灰 =====
  // 初始文档没有表格，此时表格菜单项应当置灰
  await new Promise((resolve) => setTimeout(resolve, 800));
  const notInTable = await menuItemEnabled('在下方插入行');
  check('光标不在表格时表格菜单项置灰', notInTable === false, `enabled=${notInTable}`);

  menuAction('view:toggle-mode');
  await waitFor(() => exec(`Boolean(document.querySelector('.source-editor'))`), { label: '源码模式' });
  await exec(SET_TEXTAREA);
  await exec(`window.__setSource(${JSON.stringify(TABLE_DOC)}, 0)`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await ensureWysiwygMode();

  // 等表格渲染完成（编辑器是异步创建的）
  await waitFor(
    () => exec(`Boolean(document.querySelector('.ProseMirror table td'))`),
    { label: '表格渲染', timeout: 20000 }
  );

  // 光标落到数据单元格
  await clickSelector('.ProseMirror table td', 0);
  const inBody = await menuItemEnabled('删除当前表格行');
  check('光标在数据行时表格菜单项可用', inBody === true, `enabled=${inBody}`);

  // 光标落到表头单元格
  await clickSelector('.ProseMirror table th', 0);
  const headerItem = await waitFor(
    () => {
      const menu = Menu.getApplicationMenu();
      const item = menu ? findMenuLabel(menu, '删除当前表格行（表头）') : null;
      return item ? item.enabled : null;
    },
    { label: '表头菜单项文案' }
  );
  check('光标在表头时菜单项改为「删除当前表格行（表头）」', headerItem === true, `enabled=${headerItem}`);

  // ===== 2. 表头行删除（表头被删，首个数据行升级为表头） =====
  menuAction('format:table-delete-row');
  await new Promise((resolve) => setTimeout(resolve, 400));
  menuAction('view:toggle-mode');
  await waitFor(() => exec(`Boolean(document.querySelector('.source-editor'))`), { label: '源码模式' });
  const afterHeaderDelete = await exec(READ_SOURCE);
  const expectedTable = `| 单元格 a1 | 单元格 b1 |
| --- | --- |
| 单元格 a2 | 单元格 b2 |`;
  check(
    '删除表头行后表格仍合法（首个数据行成为表头）',
    normalizeTable(afterHeaderDelete) === normalizeTable(expectedTable),
    JSON.stringify(String(afterHeaderDelete))
  );

  // 数据行删除仍正常
  await exec(`window.__setSource(${JSON.stringify(TABLE_DOC)}, 0)`);
  await ensureWysiwygMode();
  await clickSelector('.ProseMirror table td', 0);
  menuAction('format:table-delete-row');
  await new Promise((resolve) => setTimeout(resolve, 300));
  menuAction('view:toggle-mode');
  await waitFor(() => exec(`Boolean(document.querySelector('.source-editor'))`), { label: '源码模式' });
  const afterBodyDelete = await exec(READ_SOURCE);
  check(
    '删除数据行正常',
    !String(afterBodyDelete).includes('单元格 a1') && String(afterBodyDelete).includes('单元格 a2'),
    JSON.stringify(String(afterBodyDelete))
  );

  // 只有表头的表格：删行等于删整表，不能留下非法表格
  const HEADER_ONLY = '| 只有表头 |\n| --- |\n';
  await exec(`window.__setSource(${JSON.stringify(HEADER_ONLY)}, 0)`);
  await ensureWysiwygMode();
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror table th'))`), { label: '单行表格渲染' });
  await clickSelector('.ProseMirror table th', 0);
  menuAction('format:table-delete-row');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const tableGone = await exec(`Boolean(document.querySelector('.ProseMirror table'))`);
  check('只有表头的表格删除后整表移除', tableGone === false, `hasTable=${tableGone}`);

  // ===== 3. 源码模式表格操作 =====
  await ensureSourceMode();
  // 「在下方插入行」在表头时应插到分隔行之后（否则会破坏表格结构）
  await exec(`window.__setSource(${JSON.stringify(TABLE_DOC)}, 3)`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  menuAction('format:table-add-row');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const sourceRowsAdded = String(await exec(READ_SOURCE));
  check(
    '源码模式在表头下方插行时插入到分隔行之后',
    normalizeTable(sourceRowsAdded).split('\n')[1] === '| --- | --- |' && sourceRowsAdded.trim().split('\n').length === 5,
    JSON.stringify(sourceRowsAdded)
  );

  await exec(`window.__setSource(${JSON.stringify(TABLE_DOC)}, 3)`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const sourceHeaderEnabled = await menuItemEnabled('删除当前表格行（表头）');
  check('源码模式光标在表头时同样上报上下文', sourceHeaderEnabled === true, `enabled=${sourceHeaderEnabled}`);

  menuAction('format:table-delete-row');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const sourceHeaderDeleted = await exec(READ_SOURCE);
  check(
    '源码模式删除表头行（分隔行下移）',
    normalizeTable(sourceHeaderDeleted) === normalizeTable(expectedTable),
    JSON.stringify(String(sourceHeaderDeleted))
  );

  // 源码模式删列：光标放在第 2 列（"| 表头 A |" 之后）
  await exec(`window.__setSource(${JSON.stringify(TABLE_DOC)}, 10)`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  menuAction('format:table-delete-col');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const sourceColDeleted = String(await exec(READ_SOURCE));
  const pipeCounts = sourceColDeleted.trim().split('\n').map((line) => (line.match(/\|/g) ?? []).length);
  check(
    '源码模式删除指定列（整表列数一致）',
    pipeCounts.every((count) => count === 2) && !sourceColDeleted.includes('表头 B'),
    JSON.stringify(sourceColDeleted)
  );

  // ===== 4. 源码撤销栈：连续键入合并 =====
  // 先停顿超过合并窗口，模拟一段新的输入
  await new Promise((resolve) => setTimeout(resolve, 800));
  const beforeBurst = String(await exec(READ_SOURCE));
  await exec(`window.__setSource('原始内容', 4)`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  await exec(`window.__setSource('原始内容1', 5)`);
  await exec(`window.__setSource('原始内容12', 6)`);
  await exec(`window.__setSource('原始内容123', 7)`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  menuAction('edit:undo');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const afterUndo = await exec(READ_SOURCE);
  // 一次输入只产生一条记录：撤销应回到输入前，而不是回到「原始内容12」
  check('连续键入合并为一条撤销记录', afterUndo === beforeBurst, JSON.stringify(afterUndo));
  menuAction('edit:redo');
  await new Promise((resolve) => setTimeout(resolve, 250));
  const afterRedo = await exec(READ_SOURCE);
  check('重做恢复合并后的内容', afterRedo === '原始内容123', JSON.stringify(afterRedo));

  await ensureWysiwygMode();

  // ===== 5. 缩放 =====
  menuAction('view:zoom-in');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const factor = win.webContents.getZoomFactor();
  const statusText = await exec(`document.querySelector('.statusbar').textContent`);
  check('放大到 110%', Math.abs(factor - 1.1) < 0.01, `zoomFactor=${factor}`);
  check('状态栏显示当前缩放比例', String(statusText).includes('110%'), String(statusText));
  menuAction('view:zoom-reset');
  await new Promise((resolve) => setTimeout(resolve, 300));
  check('恢复实际大小 100%', Math.abs(win.webContents.getZoomFactor() - 1) < 0.01, `${win.webContents.getZoomFactor()}`);

  // ===== 6. 复制三种格式 =====
  menuAction('view:toggle-mode');
  await waitFor(() => exec(`Boolean(document.querySelector('.source-editor'))`), { label: '源码模式' });
  const COPY_DOC = '# 标题\n\n正文 **加粗** 与 [链接](https://example.com)\n';
  await exec(`window.__setSource(${JSON.stringify(COPY_DOC)}, 0)`);
  await new Promise((resolve) => setTimeout(resolve, 200));

  menuAction('edit:copy-plain');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const plain = await clipboard.readText();
  check('复制为纯文本（剥离标记）', plain.includes('标题') && !plain.includes('#') && plain.includes('加粗'), JSON.stringify(plain));

  menuAction('edit:copy-markdown');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const markdown = await clipboard.readText();
  check('复制为 Markdown（保留原文）', markdown.trim() === COPY_DOC.trim(), JSON.stringify(markdown));

  menuAction('edit:copy-html');
  await new Promise((resolve) => setTimeout(resolve, 400));
  const html = await clipboard.readText();
  check('复制为 HTML 代码（带标签的源码文本）', html.includes('<h1') && html.includes('<strong>'), JSON.stringify(html.slice(0, 80)));

  // ===== 6.5 打印：替换掉会阻塞的对话框，只验证 IPC 链路是否走到打印 =====
  let printed = false;
  const originalPrint = win.webContents.print.bind(win.webContents);
  win.webContents.print = () => {
    printed = true;
  };
  menuAction('file:print');
  await new Promise((resolve) => setTimeout(resolve, 500));
  win.webContents.print = originalPrint;
  check('文件 → 打印触发主进程打印', printed === true, `printed=${printed}`);

  // ===== 7. 全屏 / 最小化 =====
  menuAction('view:toggle-fullscreen');
  // macOS 全屏有系统动画，isFullScreen 需要等动画结束后才为 true
  const enteredFullScreen = await waitFor(
    async () => win.isFullScreen() === true,
    { timeout: 8000, label: '进入全屏' }
  ).catch(() => false);
  check('进入全屏', enteredFullScreen === true, `isFullScreen=${win.isFullScreen()} visible=${win.isVisible()}`);
  menuAction('view:toggle-fullscreen');
  const leftFullScreen = await waitFor(
    async () => win.isFullScreen() === false,
    { timeout: 8000, label: '退出全屏' }
  ).catch(() => false);
  check('退出全屏', leftFullScreen === true, `isFullScreen=${win.isFullScreen()}`);

  menuAction('view:minimize-window');
  const minimized = await waitFor(
    async () => win.isMinimized() === true,
    { timeout: 8000, label: '最小化' }
  ).catch(() => false);
  check('最小化窗口', minimized === true, `isMinimized=${win.isMinimized()}`);
  win.restore();
  await new Promise((resolve) => setTimeout(resolve, 500));

  // ===== 8. 深层目录：在文件树中定位 =====
  const root = join(tmpdir(), `md-note-e2e-${Date.now()}`);
  const deepDir = join(root, 'a', 'b', 'c');
  mkdirSync(deepDir, { recursive: true });
  const deepFile = join(deepDir, 'deep.md');
  writeFileSync(deepFile, '# 深层文件\n', 'utf-8');

  // 让「打开文件夹」对话框直接返回测试根目录
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
  await exec(`document.querySelector('.filetree-open-btn').click()`);
  await waitFor(
    () => exec(`Boolean(document.querySelector('.tree-dir'))`),
    { label: '文件树根目录渲染' }
  );

  win.webContents.send('open-file', deepFile);
  const activeTitle = await waitFor(
    () =>
      exec(`(() => {
        const el = document.querySelector('.tree-file-active');
        return el ? el.getAttribute('title') : null;
      })()`),
    { label: '文件树高亮深层文件', timeout: 20000 }
  );
  const expandedDirs = await exec(`document.querySelectorAll('.tree-dir').length`);
  const openTabName = await exec(`document.querySelector('.tab-active .tab-name').textContent`);
  check('深层目录逐级展开并高亮目标文件', activeTitle === deepFile, `active=${activeTitle}`);
  check('逐级展开三级目录', Number(expandedDirs) >= 3, `nodeCount=${expandedDirs}`);
  check('深层文件已作为标签打开', openTabName === 'deep.md', `tab=${openTabName}`);
}

// ===== 启动 =====
app.whenReady().then(async () => {
  let failed = false;
  try {
    await runTests();
  } catch (error) {
    failed = true;
    console.error('测试执行异常:', error);
  }
  const passed = results.filter((r) => r.passed).length;
  console.log(`\n结果：${passed}/${results.length} 通过`);
  if (results.some((r) => !r.passed)) failed = true;
  setTimeout(() => app.exit(failed ? 1 : 0), 200);
});

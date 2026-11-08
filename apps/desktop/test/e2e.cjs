/**
 * 端到端自动化测试（真实 Electron 主进程 + preload + 渲染层）。
 *
 * 覆盖需要真实运行环境才能验证的条目：
 * - 表格菜单项按光标上下文置灰
 * - 表头行删除（WYSIWYG 与源码模式）
 * - 缩放档位与状态栏百分比
 * - 复制为纯文本 / Markdown / HTML 代码
 * - 全屏 / 最小化
 * - 深层目录下「在文件树中显示」逐级展开
 * - 图片存到文档同级 img/ 目录、Markdown 保持相对路径、编辑器内正常显示、粘贴链路
 * - 设置持久化（主题 / 工具栏 / 缩放重启后恢复）与窗口尺寸记忆
 * - 源码模式撤销栈的连续键入合并
 * - 编码识别（GBK 读入、保存转 UTF-8）、外部修改提示与重新加载
 * - 关闭前的未保存汇总与立即写盘、会话恢复
 * - 文件树键盘导航（条目为按钮 + 方向键移动焦点）
 * - 主题按钮单击切换、段落菜单无 YAML 项、文件树 ⋮ 菜单（新建文件落盘）
 * - 侧栏搜索：区分大小写 / 全单词 / 正则表达式开关与点击结果跳转
 *
 * 运行：npm test（test/run-e2e.cjs 会自动剔除 ELECTRON_RUN_AS_NODE / NODE_OPTIONS 注入）
 * 单独跑：npm run test:e2e --workspace @ai-md-editor/desktop
 */
const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain } = require('electron');
const { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

// 独立的 userData 目录：既不污染真实配置，也能预置设置验证「启动恢复」。
// 每次跑前清空：Chromium 会把页面缩放记在 profile 的 Preferences 里，
// 残留的 125% 会让「放大到 110%」错位，也会让鼠标点击坐标因缩放而偏移。
const PROFILE_DIR = join(tmpdir(), 'md-note-e2e-profile');
rmSync(PROFILE_DIR, { recursive: true, force: true });
mkdirSync(PROFILE_DIR, { recursive: true });
app.setPath('userData', PROFILE_DIR);
writeFileSync(
  join(PROFILE_DIR, 'settings.json'),
  `${JSON.stringify(
    {
      themeId: 'light',
      sidebarOpen: true,
      sidebarPanel: 'files',
      tabbarVisible: true,
      toolbarVisible: true,
      zoomPercent: 100,
      windowBounds: null
    },
    null,
    2
  )}\n`,
  'utf-8'
);

// 启动真实主进程（注册 IPC / 原生菜单 / 创建窗口）
require('../out/main/index.js');

/** 断言结果收集 */
const results = [];
function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  const mark = passed ? '✓' : '✗';
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** 环境不满足时跳过（计入通过，但单独统计） */
const skips = [];
function skip(name, reason) {
  skips.push(name);
  results.push({ name, passed: true, detail: reason });
  console.log(`⊘ ${name} — 跳过：${reason}`);
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

/** 在指定窗口里执行脚本 */
function execIn(win, code) {
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

/** 当前应用菜单里是否存在指定文案的菜单项 */
function menuHasLabel(label) {
  const menu = Menu.getApplicationMenu();
  return menu ? findMenuLabel(menu, label) !== null : false;
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

/**
 * 静默移动光标：只调用 setSelectionRange，不派发 select / keyup / click。
 * 用于验证程序化定位光标时表格上下文仍会刷新。
 */
const SET_CARET_SILENT = `
void (window.__setCaretSilent = (pos) => {
  const ta = document.querySelector('.source-editor');
  if (!ta) return false;
  ta.focus();
  ta.setSelectionRange(pos, pos);
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
  // 等编辑器异步初始化完成（Shiki 高亮器加载）；注意只有标题的文档没有 <p>
  await waitFor(
    () =>
      exec(
        `Boolean(document.querySelector('.ProseMirror :is(h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,table,pre,hr)'))`
      ),
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

  // 表头删除语义不直观：macOS 用悬停说明，其它平台至少保证菜单文案明确标注「表头」
  const headerTipItem = findMenuLabel(Menu.getApplicationMenu(), '删除当前表格行（表头）');
  const headerTip = headerTipItem?.toolTip ?? '';
  check(
    '表头删除菜单项明确说明语义',
    process.platform === 'darwin' ? headerTip.includes('首个数据行') : headerTipItem !== null,
    process.platform === 'darwin' ? headerTip : '非 macOS 以「（表头）」文案为准'
  );

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

  // 程序化 setSelectionRange 不派发任何事件，表格菜单上下文也必须跟着刷新
  await exec(SET_CARET_SILENT);
  await exec(`window.__setSource(${JSON.stringify(TABLE_DOC)}, 3)`);
  await waitFor(() => menuHasLabel('删除当前表格行（表头）'), { label: '光标在表头的菜单文案' });
  const bodyOffset = TABLE_DOC.indexOf('单元格 a1');
  await exec(`window.__setCaretSilent(${bodyOffset})`);
  const silentBody = await waitFor(
    () => menuHasLabel('删除当前表格行') && !menuHasLabel('删除当前表格行（表头）'),
    { label: '静默定位到数据行后菜单刷新', timeout: 5000 }
  ).catch(() => false);
  check('程序化定位光标到数据行后表格菜单刷新', silentBody === true, `menuRefreshed=${silentBody}`);
  await exec(`window.__setCaretSilent(3)`);
  const silentHeader = await waitFor(
    () => menuHasLabel('删除当前表格行（表头）'),
    { label: '静默定位回表头后菜单刷新', timeout: 5000 }
  ).catch(() => false);
  check('程序化定位光标回表头后菜单文案恢复', silentHeader === true, `menuRefreshed=${silentHeader}`);

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

  // 无障碍：条目必须是真正的按钮（Enter/Space 天然可用），且方向键能在树内移动焦点
  const treeKeyboard = await exec(`(() => {
    const items = [...document.querySelectorAll('.tree-item')];
    if (items.length < 2) return { ok: false, reason: 'items<2' };
    items[0].focus();
    const firstFocused = document.activeElement === items[0];
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    const movedToSecond = document.activeElement === items[1];
    return { ok: items[0].tagName === 'BUTTON' && firstFocused && movedToSecond, tag: items[0].tagName, firstFocused, movedToSecond };
  })()`);
  check('文件树条目为按钮且方向键可导航', treeKeyboard.ok === true, JSON.stringify(treeKeyboard));

  // ===== 9. 图片：存到文档同级 img/、相对引用、编辑器内正常显示 =====
  await ensureWysiwygMode();
  const imgDir = join(root, 'img');
  mkdirSync(imgDir, { recursive: true });
  // 1×1 透明 PNG
  writeFileSync(
    join(imgDir, 'a.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  );
  const imgDoc = join(root, 'img-test.md');
  writeFileSync(imgDoc, '# 图片\n\n![图片](img/a.png)\n', 'utf-8');

  win.webContents.send('open-file', imgDoc);
  const imgState = await waitFor(
    () =>
      exec(`(() => {
        const img = document.querySelector('.ProseMirror img:not(.ProseMirror-separator)');
        if (!img) return null;
        if (!img.src || img.naturalWidth === 0) return null;
        return JSON.stringify({ src: img.src, attr: img.getAttribute('src'), width: img.naturalWidth });
      })()`),
    { label: '图片加载', timeout: 20000 }
  );
  const parsed = JSON.parse(imgState);
  check(
    '相对图片路径解析为文件地址并成功加载',
    parsed.src.startsWith('file://') && parsed.src.endsWith('/img/a.png') && parsed.width > 0,
    parsed.src
  );

  // 保存回写仍是相对路径
  await ensureSourceMode();
  const imgSource = String(await exec(READ_SOURCE));
  check('Markdown 文本保持相对路径', imgSource.includes('![图片](img/a.png)'), JSON.stringify(imgSource));

  // 未保存文档（无路径）时保存图片应明确报错，而不是写到进程目录
  const noPathResult = await exec(
    `window.api.saveImage({ data: new Uint8Array([137,80,78,71]), extension: 'png', docPath: '' })`
  );
  check('未保存文档时拒绝保存图片并给出原因', Boolean(noPathResult.error), JSON.stringify(noPathResult.error));

  // 已有路径：图片落到同级 img/ 目录并返回相对路径
  const saved = await exec(
    `window.api.saveImage({ data: new Uint8Array([137,80,78,71]), extension: 'png', docPath: ${JSON.stringify(imgDoc)} })`
  );
  const savedFile = saved.relativePath ? join(root, saved.relativePath) : '';
  check(
    '图片保存到文档同级 img/ 目录',
    Boolean(saved.relativePath && saved.relativePath.startsWith('img/')) && existsSync(savedFile),
    `${saved.relativePath}`
  );

  // 端到端粘贴：合成带图片的 paste 事件，走真实的粘贴链路
  const pasteResult = await exec(`(() => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'paste.png', { type: 'image/png' });
    const ta = document.querySelector('.source-editor');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    // 模拟真实的 paste 事件：只依赖 clipboardData.items 这一条 DOM 契约
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { items: [{ type: 'image/png', getAsFile: () => file }] }
    });
    window.dispatchEvent(event);
    return 'sent:' + file.size;
  })()`);
  // 文档里本来就有一张图，必须等「第二张」出现，否则会读到插入前的旧内容
  const countImages = (text) =>
    [...text.matchAll(/!\[图片\]\((img\/[^)]+)\)/g)].map((match) => match[1]);
  const pastedMarkdown = await waitFor(
    async () => {
      const text = String(await exec(READ_SOURCE));
      return countImages(text).length >= 2 ? text : null;
    },
    { label: '粘贴后插入图片语法', timeout: 20000 }
  );
  const pastedNames = countImages(pastedMarkdown);
  const pastedName = pastedNames[pastedNames.length - 1];
  check(
    '粘贴图片：插入新的 img/ 相对路径且文件已落盘',
    pastedNames.length === 2 && pastedName !== 'img/a.png' && existsSync(join(root, pastedName)),
    `${pastedName}（事件项=${pasteResult}，图片数量=${pastedNames.length}）`
  );
  // 拖拽能力依赖的两个 IPC：路径类型判断、磁盘图片复制
  const dirStat = await exec(`window.api.statPath(${JSON.stringify(root)})`);
  const fileStat = await exec(`window.api.statPath(${JSON.stringify(imgDoc)})`);
  check('statPath 能区分文件夹与文件', dirStat.isDirectory === true && fileStat.isFile === true, JSON.stringify({ dirStat, fileStat }));

  const copied = await exec(
    `window.api.saveImageFromPath({ docPath: ${JSON.stringify(imgDoc)}, sourcePath: ${JSON.stringify(join(imgDir, 'a.png'))} })`
  );
  check(
    '拖拽图片：复制到同级 img/ 目录',
    Boolean(copied.relativePath && copied.relativePath.startsWith('img/')) && existsSync(join(root, copied.relativePath)),
    `${copied.relativePath}`
  );

  // 非图片后缀不能混进生成的文件名，必须回退到 .png
  const oddImage = join(root, 'photo.weirdext');
  writeFileSync(oddImage, 'fake-image-binary');
  const fallback = await exec(
    `window.api.saveImageFromPath({ docPath: ${JSON.stringify(imgDoc)}, sourcePath: ${JSON.stringify(oddImage)} })`
  );
  check(
    '未知扩展名的图片回退为 png',
    Boolean(fallback.relativePath && /^img\/[^/]+\.png$/.test(fallback.relativePath)) &&
      existsSync(join(root, fallback.relativePath)),
    `${fallback.relativePath}`
  );

  // 切到另一个文档再切回来，图片应仍然按当前文档目录重新解析
  await ensureWysiwygMode();
  win.webContents.send('open-file', deepFile);
  await new Promise((resolve) => setTimeout(resolve, 800));
  await exec(`[...document.querySelectorAll('.tab')].find((t) => t.textContent.includes('img-test.md'))?.click()`);
  const imgAfterSwitch = await waitFor(
    () =>
      exec(`(() => {
        const img = document.querySelector('.ProseMirror img:not(.ProseMirror-separator)');
        return img && img.naturalWidth > 0 ? img.getAttribute('src') : null;
      })()`),
    { label: '切换标签后图片加载', timeout: 20000 }
  );
  check(
    '切换标签后图片仍按文档目录解析',
    String(imgAfterSwitch).startsWith('file://') && String(imgAfterSwitch).endsWith('/img/a.png'),
    String(imgAfterSwitch)
  );

  // ===== 10. 设置持久化：偏好与窗口尺寸写入 userData，新窗口读取后恢复 =====
  // 通过菜单切换侧栏，验证界面变化会落盘
  menuAction('view:toggle-sidebar');
  await new Promise((resolve) => setTimeout(resolve, 900));
  let savedSettings = JSON.parse(readFileSync(join(PROFILE_DIR, 'settings.json'), 'utf-8'));
  check('侧栏开关变化写入设置文件', savedSettings.sidebarOpen === false, `sidebarOpen=${savedSettings.sidebarOpen}`);
  menuAction('view:toggle-sidebar');
  await new Promise((resolve) => setTimeout(resolve, 900));

  // 窗口尺寸同样被记住。CI runner 的屏幕工作区可能比请求值小，系统会自动裁剪 bounds
  // （实测 macOS runner 把 1000×700 裁成 1000×684），所以与窗口实际 bounds 比对。
  win.setBounds({ x: 60, y: 60, width: 1000, height: 700 });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const actualBounds = win.getBounds();
  savedSettings = JSON.parse(readFileSync(join(PROFILE_DIR, 'settings.json'), 'utf-8'));
  const savedBounds = savedSettings.windowBounds;
  check(
    '窗口尺寸写入设置文件',
    Boolean(savedBounds) &&
      savedBounds.width === actualBounds.width &&
      savedBounds.height === actualBounds.height &&
      Math.abs(savedBounds.width - 1000) <= 20 &&
      Math.abs(savedBounds.height - 700) <= 40,
    `saved=${JSON.stringify(savedBounds)} actual=${JSON.stringify(actualBounds)}`
  );

  // 写入一份「非默认」偏好，再开新窗口，验证渲染层启动时会读取并应用
  await exec(`window.api.updateSettings({ themeId: 'dark', toolbarVisible: false, zoomPercent: 125 })`);
  const before = BrowserWindow.getAllWindows().length;
  menuAction('file:new-window');
  const second = await waitFor(
    () => BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && candidate !== win) ?? null,
    { label: '新窗口创建', timeout: 20000 }
  );
  await waitFor(() => execIn(second, `Boolean(document.querySelector('.app'))`), { label: '新窗口渲染', timeout: 20000 });
  await new Promise((resolve) => setTimeout(resolve, 800));
  const restored = await execIn(
    second,
    `JSON.stringify({
      theme: document.documentElement.getAttribute('data-theme'),
      toolbar: Boolean(document.querySelector('.toolbar')),
      status: document.querySelector('.statusbar').textContent
    })`
  );
  const restoredState = JSON.parse(restored);
  check('新窗口恢复深色主题', restoredState.theme === 'dark', restoredState.theme);
  check('新窗口恢复工具栏隐藏', restoredState.toolbar === false, `toolbar=${restoredState.toolbar}`);
  check(
    '新窗口恢复缩放 125%',
    Math.abs(second.webContents.getZoomFactor() - 1.25) < 0.01 && String(restoredState.status).includes('125%'),
    `zoomFactor=${second.webContents.getZoomFactor()} status=${restoredState.status}`
  );
  second.close();
  // 关闭前会做一次「未保存确认」，是异步流程，等窗口真正消失而不是固定 sleep
  await waitFor(() => BrowserWindow.getAllWindows().length === before, {
    timeout: 8000,
    label: '新窗口关闭'
  }).catch(() => undefined);
  check('新窗口可正常关闭', BrowserWindow.getAllWindows().length === before, `windows=${BrowserWindow.getAllWindows().length}`);

  // ===== 10.4 工具栏占位布局：固定在编辑区下方，不与内容滚动区重叠 =====
  const layout = await exec(
    `JSON.stringify((() => {
      const toolbar = document.querySelector('.toolbar');
      if (!toolbar) return null;
      const bar = toolbar.getBoundingClientRect();
      const scroll = document.querySelector('.editor-scroll').getBoundingClientRect();
      const wrap = document.querySelector('.editor-wrap').getBoundingClientRect();
      return { noOverlap: bar.top >= scroll.bottom - 1, insideWrap: bar.bottom <= wrap.bottom + 1, barTop: Math.round(bar.top) };
    })())`
  );
  const layoutState = JSON.parse(layout);
  check(
    '工具栏不与编辑内容区重叠',
    layoutState !== null && layoutState.noOverlap && layoutState.insideWrap,
    JSON.stringify(layoutState)
  );

  // ===== 10.5 自动保存：已切走的后台标签也要落盘 =====
  // 只保存「当前标签」时，敲完立刻切标签/新建标签会丢掉写盘（计时器被清且不再重排）
  const autoDir = join(tmpdir(), 'md-note-e2e-autosave');
  mkdirSync(autoDir, { recursive: true });
  const autoPath = join(autoDir, 'auto.md');
  writeFileSync(autoPath, '# 初始标题\n\n原始内容\n', 'utf-8');
  menuAction('file:open-recent-path', autoPath);
  await waitFor(
    () => exec(`document.querySelector('.tab-active .tab-name')?.textContent === 'auto.md'`),
    { label: '打开自动保存用例文档', timeout: 20000 }
  );
  await ensureSourceMode();
  await exec(SET_TEXTAREA);
  await exec(`window.__setSource('# 初始标题\\n\\n改过的内容\\n')`);
  // 立刻新建标签，让刚改过的标签变成后台标签
  menuAction('file:new-tab');
  await waitFor(() => exec(`document.querySelector('.tab-active .tab-name')?.textContent === '未命名.md'`), {
    label: '切到新标签',
    timeout: 8000
  });
  await new Promise((resolve) => setTimeout(resolve, 2600));
  const autoSaved = readFileSync(autoPath, 'utf-8');
  check('后台标签在 1.5s 防抖后自动保存', autoSaved.includes('改过的内容'), JSON.stringify(autoSaved));

  // ===== 11. 编码识别：GBK 文档按原编码读入，保存后转为 UTF-8 =====
  const encDir = join(tmpdir(), 'md-note-e2e-encoding');
  mkdirSync(encDir, { recursive: true });
  const gbkPath = join(encDir, 'gbk.md');
  // 「你好，世界」的 GBK 字节：不是合法 UTF-8，读取时必须回退到 GBK
  writeFileSync(gbkPath, Buffer.from([0xc4, 0xe3, 0xba, 0xc3, 0xa3, 0xac, 0xca, 0xc0, 0xbd, 0xe7]));
  menuAction('file:open-recent-path', gbkPath);
  await waitFor(() => exec(`document.querySelector('.tab-active .tab-name')?.textContent === 'gbk.md'`), {
    label: '打开 GBK 文档',
    timeout: 20000
  });
  await ensureSourceMode();
  const gbkText = await exec(`document.querySelector('.source-editor').value`);
  const gbkStatus = await exec(`document.querySelector('.statusbar').textContent`);
  check('GBK 文档解码正确', String(gbkText).includes('你好，世界'), JSON.stringify(gbkText));
  check('状态栏显示 GBK 编码', String(gbkStatus).includes('GBK'), String(gbkStatus));

  // 保存后统一转成 UTF-8，状态栏与标签编码同步更新
  menuAction('file:save');
  const savedAsUtf8 = await waitFor(
    () => {
      try {
        const text = readFileSync(gbkPath, 'utf-8');
        return text.includes('你好，世界') ? text : null;
      } catch {
        return null;
      }
    },
    { label: 'GBK 文档转存 UTF-8', timeout: 8000 }
  ).catch(() => null);
  check('保存后文档按 UTF-8 重写', savedAsUtf8 !== null, String(savedAsUtf8));
  await waitFor(() => exec(`document.querySelector('.statusbar').textContent.includes('UTF-8')`), {
    label: '状态栏编码更新',
    timeout: 8000
  }).catch(() => undefined);
  const encStatusAfterSave = await exec(`document.querySelector('.statusbar').textContent`);
  check('保存后状态栏编码变为 UTF-8', String(encStatusAfterSave).includes('UTF-8'), String(encStatusAfterSave));

  // ===== 12. 外部修改：提示可在不丢改动的前提下重新加载 =====
  const extPath = join(encDir, 'external.md');
  writeFileSync(extPath, '# 外部\n\n原始内容\n', 'utf-8');
  menuAction('file:open-recent-path', extPath);
  await waitFor(() => exec(`document.querySelector('.tab-active .tab-name')?.textContent === 'external.md'`), {
    label: '打开外部修改用例文档',
    timeout: 20000
  });
  // 等渲染层把 fs.watch 注册上，否则本次写入会被漏掉
  await new Promise((resolve) => setTimeout(resolve, 600));
  writeFileSync(extPath, '# 外部\n\n被别的程序改了\n', 'utf-8');
  const changedNotice = await waitFor(
    async () => {
      const text = await exec(`document.querySelector('.statusbar-notice')?.textContent ?? ''`);
      return String(text).includes('外部程序修改') ? String(text) : null;
    },
    { label: '外部修改提示', timeout: 10000 }
  ).catch(() => '');
  check('文件被外部修改时给出状态栏提示', changedNotice.includes('外部程序修改'), changedNotice);
  check('提示里带重新加载动作', changedNotice.includes('重新加载'), changedNotice);

  await exec(`document.querySelector('.statusbar-notice-action')?.click()`);
  const reloaded = await waitFor(
    () => exec(`document.querySelector('.source-editor').value.includes('被别的程序改了')`),
    { label: '点击重新加载后内容更新', timeout: 10000 }
  ).catch(() => false);
  check('点击重新加载后读到新内容', reloaded === true, `reloaded=${reloaded}`);

  // ===== 13. 关闭前：未保存汇总 + 立即写盘 =====
  await exec(`window.__setSource('# 外部\\n\\n关闭前写入\\n')`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const summary = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 3000);
    ipcMain.once('app:unsaved-reply', (_event, payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
    win.webContents.send('app:unsaved-ask');
  });
  check(
    '关闭前能拿到未保存文档汇总',
    Boolean(summary) && typeof summary.untitledCount === 'number' && summary.dirtyCount >= 1,
    JSON.stringify(summary)
  );

  win.webContents.send('app:flush-before-close');
  const flushed = await waitFor(
    () => (readFileSync(extPath, 'utf-8').includes('关闭前写入') ? true : false),
    { label: '退出前写盘', timeout: 8000 }
  ).catch(() => false);
  check('退出前立即写盘生效', flushed === true, `flushed=${flushed}`);

  // ===== 14. 会话恢复：新窗口重新打开上次的文档 =====
  await exec(
    `window.api.updateSettings({ restoreSession: true, lastSession: { paths: [${JSON.stringify(extPath)}], activePath: ${JSON.stringify(extPath)} } })`
  );
  const beforeRestore = BrowserWindow.getAllWindows().length;
  menuAction('file:new-window');
  const restoredWin = await waitFor(
    () => BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && candidate !== win) ?? null,
    { label: '会话恢复窗口创建', timeout: 20000 }
  );
  const restoredTab = await waitFor(
    () =>
      execIn(restoredWin, `document.querySelector('.tab .tab-name')?.textContent ?? ''`).then((name) =>
        name === 'external.md' ? name : null
      ),
    { label: '恢复上次打开的标签', timeout: 20000 }
  ).catch(() => '');
  check('会话恢复重新打开上次的文档', restoredTab === 'external.md', `tab=${restoredTab}`);
  const restoreNotice = await execIn(
    restoredWin,
    `document.querySelector('.statusbar-notice')?.textContent ?? ''`
  );
  check('会话恢复给出提示', String(restoreNotice).includes('已恢复'), String(restoreNotice));
  restoredWin.close();
  await waitFor(() => BrowserWindow.getAllWindows().length === beforeRestore, {
    timeout: 8000,
    label: '会话恢复窗口关闭'
  }).catch(() => undefined);
  check('会话恢复窗口可正常关闭', BrowserWindow.getAllWindows().length === beforeRestore);

  // ===== 15. 主题一键切换 / YAML 菜单项移除 / 文件树 ⋮ 菜单 / 侧栏搜索 =====

  // 前面的编码测试打开过别的目录的文档，先把文件树根目录切回测试根目录
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
  await exec(`document.querySelector('.filetree-open-btn').click()`);
  await waitFor(() => exec(`Boolean(document.querySelector('.tree-dir'))`), {
    label: '重新打开测试根目录'
  });

  // 主题按钮单击直接在浅色/深色之间切换
  const themeBefore = await exec(`document.documentElement.getAttribute('data-theme')`);
  await exec(`document.querySelector('.tabbar-actions button').click()`);
  const themeAfterOnce = await waitFor(
    () => exec(`document.documentElement.getAttribute('data-theme')`).then((v) => (v !== themeBefore ? v : null)),
    { label: '主题单击切换' }
  ).catch(() => null);
  check('主题按钮单击即切换主题', themeAfterOnce !== null, `${themeBefore} -> ${themeAfterOnce}`);
  await exec(`document.querySelector('.tabbar-actions button').click()`);
  const themeBack = await waitFor(
    () => exec(`document.documentElement.getAttribute('data-theme')`).then((v) => (v === themeBefore ? v : null)),
    { label: '主题再切回来' }
  ).catch(() => null);
  check('主题按钮再次单击切回原主题', themeBack === themeBefore, `theme=${themeBack}`);

  // 段落菜单不再包含 YAML Front Matter
  const appMenu = Menu.getApplicationMenu();
  const yamlItems = [];
  const walkMenu = (items) => {
    for (const menuItem of items) {
      if (menuItem.label && /yaml/i.test(menuItem.label)) yamlItems.push(menuItem.label);
      if (menuItem.submenu) walkMenu(menuItem.submenu.items);
    }
  };
  if (appMenu) walkMenu(appMenu.items);
  check('段落菜单已移除 YAML Front Matter', yamlItems.length === 0, JSON.stringify(yamlItems));

  // 文件树 ⋮ 菜单：展开后包含 5 项，新建文件会落盘并打开
  await exec(`document.querySelector('.filetree-more-btn').click()`);
  await waitFor(() => exec(`Boolean(document.querySelector('.filetree-menu'))`), { label: '⋮ 菜单弹出' });
  const menuItems = await exec(`[...document.querySelectorAll('.filetree-menu-item')].map((el) => el.textContent)`);
  const menuOk =
    menuItems.includes('新建文件') &&
    menuItems.includes('重命名当前文件…') &&
    menuItems.includes('搜索') &&
    menuItems.some((label) => /Finder|资源管理器/.test(label)) &&
    menuItems.includes('打开文件夹…') &&
    menuItems.includes('刷新');
  check('⋮ 菜单包含六项操作', menuOk === true, JSON.stringify(menuItems));
  const revealLabel = menuItems.find((label) => /Finder|资源管理器/.test(label));
  check('显示项按平台命名', /Finder|资源管理器/.test(String(revealLabel)) && !/YAML/.test(String(revealLabel)), revealLabel);
  await exec(`[...document.querySelectorAll('.filetree-menu-item')].find((el) => el.textContent === '新建文件').click()`);
  // 新建文件先弹命名对话框（input 预填「未命名.md」并全选），输入名字回车即创建
  const renameDialogTitle = await waitFor(
    () => exec(`document.querySelector('.rename-dialog .rename-title')?.textContent ?? ''`).then((t) => (t ? t : null)),
    { label: '新建文件弹出命名对话框', timeout: 8000 }
  ).catch(() => null);
  const prefilledName = await exec(`document.querySelector('.rename-dialog .rename-input')?.value ?? ''`);
  check('新建文件先命名（预填未命名.md）', renameDialogTitle === '新建文件' && prefilledName === '未命名.md', `title=${renameDialogTitle} value=${prefilledName}`);
  await exec(`(() => {
    const input = document.querySelector('.rename-dialog .rename-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '纪要-测试');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  const newFileOnDisk = await waitFor(
    () => (existsSync(join(root, '纪要-测试.md')) ? true : null),
    { label: '新建文件按输入名落盘', timeout: 10000 }
  ).catch(() => null);
  const newFileTab = await waitFor(
    () => exec(`document.querySelector('.tab-active .tab-name')?.textContent ?? ''`).then((t) => (t === '纪要-测试.md' ? t : null)),
    { label: '新建文件打开为活动标签', timeout: 10000 }
  ).catch(() => null);
  check('新建文件按输入名落盘并打开', newFileOnDisk === true && newFileTab === '纪要-测试.md', `tab=${newFileTab} disk=${newFileOnDisk}`);

  // 双击标签打开重命名对话框（该文件已有路径，直接改名）
  await exec(`document.querySelector('.tab-active').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  const tabRenameTitle = await waitFor(
    () => exec(`document.querySelector('.rename-dialog .rename-title')?.textContent ?? ''`).then((t) => (t === '重新命名' ? t : null)),
    { label: '双击标签弹出重命名', timeout: 8000 }
  ).catch(() => null);
  check('双击标签可重命名', tabRenameTitle === '重新命名', String(tabRenameTitle));
  await exec(`document.querySelector('.rename-dialog .rename-input') && (() => {
    const input = document.querySelector('.rename-dialog .rename-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '纪要-改名');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  const renamedTab = await waitFor(
    () => exec(`document.querySelector('.tab-active .tab-name')?.textContent ?? ''`).then((t) => (t === '纪要-改名.md' ? t : null)),
    { label: '标签名已更新', timeout: 8000 }
  ).catch(() => null);
  const renamedOnDisk = existsSync(join(root, '纪要-改名.md')) && !existsSync(join(root, '纪要-测试.md'));
  check('重命名同步磁盘文件名', renamedTab === '纪要-改名.md' && renamedOnDisk, `tab=${renamedTab} disk=${renamedOnDisk}`);

  // 侧栏搜索：区分大小写 / 全单词 / 正则表达式三个开关都生效
  writeFileSync(
    join(root, 'searchable.md'),
    '# 搜索样例\n\nMAIL 里含 AI 但不是独立单词\n\n这里说的是 AI 智能体\n\nApple 是大写开头\n\nbanana 是水果\n',
    'utf-8'
  );
  await exec(`document.querySelector('.sidebar-search-btn').click()`);
  await waitFor(() => exec(`Boolean(document.querySelector('.search-input'))`), { label: '搜索面板打开' });
  // 三个选项开关必须和输入框同一行、位于其右侧（不占额外纵向空间）
  const searchLayout = await exec(`JSON.stringify((() => {
    const input = document.querySelector('.search-input').getBoundingClientRect();
    const opts = [...document.querySelectorAll('.search-option')].map((el) => el.getBoundingClientRect());
    if (opts.length !== 3) return { ok: false, reason: 'options=' + opts.length };
    const center = (r) => (r.top + r.bottom) / 2;
    const sameRow = opts.every((r) => Math.abs(center(r) - center(input)) < 8);
    const rightOfInput = opts.every((r) => r.left >= input.right - 2);
    return { ok: sameRow && rightOfInput, sameRow, rightOfInput, count: opts.length };
  })())`);
  check('搜索选项与输入框同行且位于右侧', JSON.parse(searchLayout).ok === true, searchLayout);
  const typeSearch = (value) =>
    exec(`(() => {
      const input = document.querySelector('.search-input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  // 默认不区分大小写：apple 能同时命中 Apple
  await typeSearch('apple');
  const caseInsensitiveHit = await waitFor(
    () =>
      exec(`document.querySelector('.search-hit')?.textContent ?? ''`).then((hit) => (hit === 'Apple' ? hit : null)),
    { label: '不区分大小写命中 Apple', timeout: 8000 }
  ).catch(() => null);
  check('默认不区分大小写', caseInsensitiveHit === 'Apple', String(caseInsensitiveHit));
  // 打开「区分大小写」：apple 不再命中 Apple
  await exec(`document.querySelector('.search-option').click()`);
  const caseSensitiveProbe = await waitFor(
    () =>
      exec(
        `(() => {
          const n = document.querySelectorAll('.search-match').length;
          const status = document.querySelector('.search-status')?.textContent ?? '';
          const cls = document.querySelector('.search-option')?.className ?? '';
          const q = document.querySelector('.search-input')?.value ?? '';
          return n + '|' + status + '|' + cls + '|' + q;
        })()`
      ).then((s) => (s.startsWith('0|') ? s : null)),
    { label: '区分大小写后无匹配', timeout: 8000 }
  ).catch(() => 'timeout');
  check('区分大小写开关生效', typeof caseSensitiveProbe === 'string' && caseSensitiveProbe.startsWith('0|'), String(caseSensitiveProbe));
  await exec(`document.querySelector('.search-option').click()`);
  // 全单词：AI 不命中 MAIL，只命中两处独立单词
  await typeSearch('AI');
  await exec(`[...document.querySelectorAll('.search-option')][1].click()`);
  const wholeWordHits = await waitFor(
    () =>
      exec(`[...document.querySelectorAll('.search-hit')].map((el) => el.textContent).join(',')`).then((hits) =>
        hits === 'AI,AI' ? hits : null
      ),
    { label: '全单词只命中独立的 AI', timeout: 8000 }
  ).catch(() => null);
  check('全单词开关生效（AI 不命中 MAIL）', wholeWordHits === 'AI,AI', String(wholeWordHits));
  await exec(`[...document.querySelectorAll('.search-option')][1].click()`);
  // 正则：b[an]+a? 之类；用 b[ao]na 匹配 banana
  await typeSearch('b[ao]na');
  await exec(`[...document.querySelectorAll('.search-option')][2].click()`);
  const regexHit = await waitFor(
    () => exec(`document.querySelector('.search-hit')?.textContent ?? ''`).then((hit) =>
      /^b[ao]na$/.test(hit) ? hit : null
    ),
    { label: '正则匹配 banana', timeout: 8000 }
  ).catch(() => null);
  check('正则表达式开关生效', regexHit !== null, String(regexHit));
  // 点击匹配行：打开对应文件
  const matchFileName = await exec(
    `document.querySelector('.search-file-name')?.childNodes[0]?.textContent?.trim() ?? ''`
  );
  await exec(`document.querySelector('.search-match').click()`);
  const jumpedTab = await waitFor(
    () => exec(`document.querySelector('.tab-active .tab-name')?.textContent ?? ''`).then((name) =>
      name === matchFileName ? name : null
    ),
    { label: '搜索结果打开文件', timeout: 15000 }
  ).catch(() => null);
  check('点击搜索结果打开对应文件', jumpedTab !== null, `file=${matchFileName} tab=${jumpedTab}`);
  await exec(`document.querySelector('.search-close')?.click()`);

  // ===== 11. 全屏 / 最小化（放在最后：窗口状态变化可能影响后续渲染） =====
  app.focus({ steal: true });
  win.show();
  win.focus();
  await new Promise((resolve) => setTimeout(resolve, 600));

  // macOS 只有在应用可激活时才允许改窗口状态；无 GUI 会话的沙箱里窗口无法获得焦点
  const activatable = win.isFocused() || BrowserWindow.getFocusedWindow() !== null;
  if (!activatable) {
    skip('进入全屏 / 退出全屏', '当前会话窗口无法激活，系统拒绝切换全屏');
    skip('最小化窗口', '当前会话窗口无法激活，系统拒绝最小化');
  } else {
    menuAction('view:toggle-fullscreen');
    // macOS 全屏有系统动画，isFullScreen 需要等动画结束后才为 true
    const enteredFullScreen = await waitFor(
      async () => win.isFullScreen() === true,
      { timeout: 8000, label: '进入全屏' }
    ).catch(() => false);
    check('进入全屏', enteredFullScreen === true, `isFullScreen=${win.isFullScreen()}`);

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
  }

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
  const skippedText = skips.length > 0 ? `（其中跳过 ${skips.length} 项）` : '';
  console.log(`\n结果：${passed}/${results.length} 通过${skippedText}`);
  if (results.some((r) => !r.passed)) failed = true;
  setTimeout(() => app.exit(failed ? 1 : 0), 200);
});

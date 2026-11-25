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
const { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

// 独立的 userData 目录：既不污染真实配置，也能预置设置验证「启动恢复」。
// 每次跑前清空：Chromium 会把页面缩放记在 profile 的 Preferences 里，
// 残留的 125% 会让「放大到 110%」错位，也会让鼠标点击坐标因缩放而偏移。
const PROFILE_DIR = join(tmpdir(), 'md-note-e2e-profile');
rmSync(PROFILE_DIR, { recursive: true, force: true });
mkdirSync(PROFILE_DIR, { recursive: true });
app.setPath('userData', PROFILE_DIR);
// 日志也写到临时目录：真实运行写系统日志目录，测试不能污染用户的日志
const LOG_DIR = join(PROFILE_DIR, 'logs');
mkdirSync(LOG_DIR, { recursive: true });
app.setPath('logs', LOG_DIR);
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

/** 给受控 input 赋值并触发 input 事件（React 受控组件只认原生 setter） */
async function setControlValue(selector, value) {
  await exec(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
}

/** 按屏幕坐标点击（用于箭头这类小目标，或需要先真实移动鼠标再点的场景） */
async function clickPoint(point) {
  const win = getWindow();
  win.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 250));
}

/** 把鼠标移到指定坐标（不按键），用于验证「悬停不做任何事」 */
async function hoverPoint(point) {
  const win = getWindow();
  win.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
  await new Promise((resolve) => setTimeout(resolve, 400));
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

/** 把文档重置成指定 Markdown（源码模式写入 → 切回 WYSIWYG），避免用例间残留状态互相干扰 */
async function resetDoc(markdown) {
  await ensureSourceMode();
  await exec(`window.__setSource(${JSON.stringify(markdown)}, 0)`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await ensureWysiwygMode();
  await new Promise((resolve) => setTimeout(resolve, 150));
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
 * 复现 Finder「打开方式」的时序：就绪前收到 open-file。
 * 真实场景里 macOS 在 app ready 之前就派发 open-file，此时不能创建 BrowserWindow，
 * 主进程必须把路径排队、就绪后再打开（回归 0.14.28 的「Cannot create BrowserWindow」报错）。
 * 这段是顶层同步代码，先于文件末尾的 whenReady → runTests 执行，app.isReady() 此时为 false。
 */
const QUEUED_FILE = join(PROFILE_DIR, 'open-file-queued.md');
writeFileSync(QUEUED_FILE, '# 就绪前排队打开\n\n这一行来自启动前派发的 open-file。\n', 'utf-8');
app.emit('open-file', { preventDefault() {} }, QUEUED_FILE);
check(
  '就绪前收到 open-file 时主进程不报错（路径排队）',
  !app.isReady(),
  `isReady=${app.isReady()}`
);

/**
 * 主流程。
 */
async function runTests() {
  // ===== 0. 等待窗口与第一版编辑器 =====
  const win = await waitFor(() => getWindow(), { label: '窗口创建' });
  await waitFor(() => exec(`Boolean(document.querySelector('.app'))`), { label: 'React 挂载' });
  check('窗口与渲染层启动', true, `windowSize=${win.getContentSize().join('x')}`);

  // ===== 0.5 就绪前排队的 open-file 在启动后自动打开 =====
  const queuedTab = await waitFor(
    () =>
      exec(`document.querySelector('.tab-active .tab-name')?.textContent ?? ''`).then((name) =>
        name === 'open-file-queued.md' ? name : null
      ),
    { label: '排队文件打开为活动标签', timeout: 10000 }
  ).catch(() => null);
  check('就绪前收到的 open-file 在应用就绪后排队打开', queuedTab === 'open-file-queued.md', `tab=${queuedTab}`);
  // 关掉这个标签还原现场（文件在磁盘上且未改动，直接关闭不会弹确认）
  await exec(`document.querySelector('.tab-active .tab-close')?.click()`);
  await waitFor(
    () =>
      exec(`document.querySelector('.tab-active .tab-name')?.textContent ?? ''`).then((name) =>
        name !== 'open-file-queued.md' ? name : null
      ),
    { label: '排队文件标签关闭' }
  );
  rmSync(QUEUED_FILE, { force: true });

  // ===== 1. 表格操作与菜单结构 =====
  // 段落菜单里的整组表格子菜单已移除（插入表格走工具栏），先确认没有残留项
  await new Promise((resolve) => setTimeout(resolve, 800));
  check(
    '段落菜单不再提供表格子菜单',
    !menuHasLabel('插入 3×3 表格') && !menuHasLabel('在下方插入行') && !menuHasLabel('删除整个表格'),
    '表格相关项已从原生菜单移除'
  );

  menuAction('view:toggle-mode');
  await waitFor(() => exec(`Boolean(document.querySelector('.source-editor'))`), { label: '源码模式' });

  // 源码模式的 textarea 必须撑满编辑区：它曾经沿用 WYSIWYG 的 min-height: 60vh
  // 加容器 96px 底部呼吸留白，内容下方会空出近三分之一屏（实测 667px 里空 182px）。
  const sourceLayout = await exec(`(() => {
    const ta = document.querySelector('.source-editor');
    const inner = ta && ta.closest('.editor-inner');
    const scroll = ta && ta.closest('.editor-scroll');
    if (!ta || !inner || !scroll) return null;
    const ir = inner.getBoundingClientRect();
    const tr = ta.getBoundingClientRect();
    const sr = scroll.getBoundingClientRect();
    return {
      fillRatio: Number((tr.height / sr.height).toFixed(3)),
      gapBelow: Math.round(ir.bottom - tr.bottom),
      overflowBelow: Math.round(sr.bottom - ir.bottom),
      padBottom: getComputedStyle(inner).paddingBottom
    };
  })()`);
  check(
    '源码模式编辑器撑满编辑区，内容下方无多余留白',
    Boolean(sourceLayout) &&
      sourceLayout.fillRatio > 0.9 &&
      sourceLayout.gapBelow <= 32 &&
      sourceLayout.overflowBelow <= 1,
    JSON.stringify(sourceLayout)
  );

  await exec(SET_TEXTAREA);
  await exec(`window.__setSource(${JSON.stringify(TABLE_DOC)}, 0)`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await ensureWysiwygMode();

  // 等表格渲染完成（编辑器是异步创建的）
  await waitFor(
    () => exec(`Boolean(document.querySelector('.ProseMirror table td'))`),
    { label: '表格渲染', timeout: 20000 }
  );

  // 光标落到数据单元格（后续删除行用例需要这个落点）
  await clickSelector('.ProseMirror table td', 0);
  const bodyFocused = await exec(`document.activeElement?.closest('.ProseMirror') !== null`);
  check('光标可落在数据单元格', bodyFocused === true, `focused=${bodyFocused}`);

  // 光标落到表头单元格：整表仍可正常定位，删行语义由下面的动作断言保证
  await clickSelector('.ProseMirror table th', 0);
  const headerFocused = await exec(`document.activeElement?.closest('.ProseMirror') !== null`);
  check('光标可落在表头单元格', headerFocused === true, `focused=${headerFocused}`);

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

  // 程序化 setSelectionRange 不派发任何事件，表格命令仍要按光标所在行生效
  await exec(SET_CARET_SILENT);
  await exec(`window.__setSource(${JSON.stringify(TABLE_DOC)}, 3)`);
  const bodyOffset = TABLE_DOC.indexOf('单元格 a1');
  await exec(`window.__setCaretSilent(${bodyOffset})`);
  menuAction('format:table-delete-row');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const silentBodyDelete = String(await exec(READ_SOURCE));
  check(
    '程序化定位光标到数据行后删行仍生效',
    !silentBodyDelete.includes('单元格 a1') && silentBodyDelete.includes('单元格 a2'),
    JSON.stringify(silentBodyDelete)
  );

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

  // 工具栏行列网格在源码模式也要按所选行列插入（旧实现写死 3 列 3 行）
  await exec(`window.__setSource('', 0)`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  await exec(`(() => {
    const btn = [...document.querySelectorAll('.toolbar .tb-btn')].find((b) => b.title === '表格（点击选择行列）');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await waitFor(() => exec(`Boolean(document.querySelector('.tb-table-pick'))`), {
    label: '源码模式表格网格展开'
  });
  await exec(`document.querySelector('.tb-table-pick-cell[aria-label="2 行 4 列"]')?.click()`);
  await new Promise((resolve) => setTimeout(resolve, 350));
  const sourcePickedTable = String((await exec(READ_SOURCE)) ?? '').trim();
  const pickedLines = sourcePickedTable.split('\n');
  const pickedPipes = pickedLines.map((line) => (line.match(/\|/g) ?? []).length);
  check(
    '源码模式按表格网格选择插入 2 行 × 4 列',
    pickedLines.length === 3 && pickedPipes.every((count) => count === 5),
    JSON.stringify(sourcePickedTable)
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
  // 设置写入是 300ms 防抖 + 异步落盘，固定 sleep 在机器负载高时会读到上一次的值；
  // 改成轮询文件直到目标值出现，断言强度不变，只消除时序偶发。
  const waitForSetting = (predicate, label) =>
    waitFor(
      async () => {
        try {
          const settings = JSON.parse(readFileSync(join(PROFILE_DIR, 'settings.json'), 'utf-8'));
          return predicate(settings) ? settings : null;
        } catch {
          return null;
        }
      },
      { label, timeout: 8000, interval: 150 }
    );

  // 通过菜单切换侧栏，验证界面变化会落盘
  menuAction('view:toggle-sidebar');
  const sidebarSettings = await waitForSetting((s) => s.sidebarOpen === false, '侧栏开关落盘').catch(() => null);
  check('侧栏开关变化写入设置文件', sidebarSettings?.sidebarOpen === false, `sidebarOpen=${sidebarSettings?.sidebarOpen}`);
  menuAction('view:toggle-sidebar');
  await waitForSetting((s) => s.sidebarOpen === true, '侧栏恢复落盘').catch(() => null);

  // 窗口尺寸同样被记住。CI runner 的屏幕工作区可能比请求值小，系统会自动裁剪 bounds
  // （实测 macOS runner 把 1000×700 裁成 1000×684），所以与窗口实际 bounds 比对。
  // 无 GUI 会话里系统可能直接拒绝改尺寸，此时不硬判，按环境限制跳过。
  win.setBounds({ x: 60, y: 60, width: 1000, height: 700 });
  const boundsApplied = await waitFor(
    async () => {
      const b = win.getBounds();
      return Math.abs(b.width - 1000) <= 20 && Math.abs(b.height - 700) <= 40;
    },
    { label: '窗口尺寸生效', timeout: 5000, interval: 150 }
  ).catch(() => false);
  if (!boundsApplied) {
    skip('窗口尺寸写入设置文件', '当前会话系统不允许修改窗口尺寸');
  } else {
    const actualBounds = win.getBounds();
    const boundsSettings = await waitForSetting(
      (s) => Boolean(s.windowBounds) &&
        s.windowBounds.width === actualBounds.width &&
        s.windowBounds.height === actualBounds.height,
      '窗口尺寸落盘'
    ).catch(() => null);
    const savedBounds = boundsSettings?.windowBounds;
    check(
      '窗口尺寸写入设置文件',
      Boolean(savedBounds) &&
        Math.abs(savedBounds.width - 1000) <= 20 &&
        Math.abs(savedBounds.height - 700) <= 40,
      `saved=${JSON.stringify(savedBounds)} actual=${JSON.stringify(actualBounds)}`
    );
  }

  // 写入一份「非默认」偏好，再开新窗口，验证渲染层启动时会读取并应用
  // themeMode 是权威字段，themeId 只是给旧版本读的镜像
  await exec(
    `window.api.updateSettings({ themeMode: 'dark', themeId: 'dark', toolbarVisible: false, zoomPercent: 125 })`
  );
  const before = BrowserWindow.getAllWindows().length;
  menuAction('file:new-window');
  const second = await waitFor(
    () => BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && candidate !== win) ?? null,
    { label: '新窗口创建', timeout: 20000 }
  );
  await waitFor(() => execIn(second, `Boolean(document.querySelector('.app'))`), { label: '新窗口渲染', timeout: 20000 });
  await new Promise((resolve) => setTimeout(resolve, 800));

  // 新窗口必须相对已有窗口层叠偏移：否则两个窗口完全重合，用户以为「新建窗口没反应」
  const primaryBounds = win.getBounds();
  const secondBounds = second.getBounds();
  if (secondBounds.width === 0 || primaryBounds.width === 0) {
    skip('新窗口相对主窗口层叠偏移', '当前会话拿不到可靠的窗口 bounds');
  } else {
    const samePlace =
      Math.abs(secondBounds.x - primaryBounds.x) < 8 && Math.abs(secondBounds.y - primaryBounds.y) < 8;
    check(
      '新窗口相对主窗口层叠偏移',
      !samePlace,
      `primary=${primaryBounds.x},${primaryBounds.y} second=${secondBounds.x},${secondBounds.y}`
    );
  }

  // 窗口标题要与当前标签名一致（多窗口 / Mission Control 里才分得清）
  const secondTabName = await execIn(
    second,
    `document.querySelector('.tab-active .tab-name')?.textContent ?? ''`
  );
  const secondTitle = second.getTitle();
  check(
    '新窗口标题显示当前文档名',
    typeof secondTabName === 'string' && secondTabName.length > 0 && secondTitle === secondTabName,
    `title="${secondTitle}" tab="${secondTabName}"`
  );

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

  // 主窗口的 zoomPercent 被本用例改成了 125%，必须恢复：
  // getBoundingClientRect 返回 CSS 像素而 sendInputEvent 走 DIP 坐标，
  // 缩放残留会让后续所有坐标注入（如任务列表方框点击）错位 25%
  menuAction('view:zoom-reset');
  await waitFor(() => Math.abs(win.webContents.getZoomFactor() - 1) < 0.01, {
    timeout: 8000,
    label: '主窗口缩放恢复 100%'
  });
  await exec(`window.api.updateSettings({ zoomPercent: 100 })`);

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

  // ===== 12.1 本地有改动时外部修改：暂停自动保存，不能静默覆盖 =====
  await exec(`window.__setSource('# 外部\\n\\n本地改动\\n')`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  writeFileSync(extPath, '# 外部\n\n又改了\n', 'utf-8');
  const conflictNotice = await waitFor(
    async () => {
      const text = await exec(`document.querySelector('.statusbar-notice')?.textContent ?? ''`);
      return String(text).includes('已暂停自动保存') ? String(text) : null;
    },
    { label: '外部冲突暂停保存提示', timeout: 10000 }
  ).catch(() => '');
  check('本地有改动时外部修改会暂停自动保存', conflictNotice.includes('已暂停自动保存'), conflictNotice);
  const conflictStatus = await exec(`document.querySelector('.statusbar-save')?.textContent ?? ''`);
  check('状态栏标记外部已修改', String(conflictStatus).includes('外部已修改'), String(conflictStatus));

  // 等过自动保存的防抖窗口，磁盘必须仍是外部版本（没被静默覆盖）
  await new Promise((resolve) => setTimeout(resolve, 2300));
  const diskAfterConflict = readFileSync(extPath, 'utf-8');
  check(
    '自动保存不会覆盖外部版本',
    diskAfterConflict.includes('又改了') && !diskAfterConflict.includes('本地改动'),
    JSON.stringify(diskAfterConflict)
  );

  // 用户显式保存：以编辑器内容为准覆盖磁盘
  menuAction('file:save');
  const forcedSave = await waitFor(
    () => (readFileSync(extPath, 'utf-8').includes('本地改动') ? true : false),
    { label: '显式保存覆盖外部版本', timeout: 8000 }
  ).catch(() => false);
  check('显式保存以编辑器内容为准', forcedSave === true, JSON.stringify(readFileSync(extPath, 'utf-8')));

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

  // 退出前写盘：主进程发带 requestId 的请求，渲染层必须回包写盘结果
  const flushReply = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 12000);
    ipcMain.once('app:flush-reply', (_event, payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
    win.webContents.send('app:flush-before-close', { requestId: 'e2e-flush-1' });
  });
  check(
    '退出前写盘回包带 requestId 且无失败项',
    Boolean(flushReply) &&
      flushReply.requestId === 'e2e-flush-1' &&
      Array.isArray(flushReply.failures) &&
      flushReply.failures.length === 0,
    JSON.stringify(flushReply)
  );
  const flushed = await waitFor(
    () => (readFileSync(extPath, 'utf-8').includes('关闭前写入') ? true : false),
    { label: '退出前写盘', timeout: 8000 }
  ).catch(() => false);
  check('退出前立即写盘生效', flushed === true, `flushed=${flushed}`);

  // ===== 13.1 关闭标签必须等写盘完成；原子写入不残留临时文件 =====
  await ensureSourceMode();
  await exec(`window.__setSource('# 外部\\n\\n关标签前的改动\\n')`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  menuAction('file:close-tab');
  const closedWrote = await waitFor(
    () => (readFileSync(extPath, 'utf-8').includes('关标签前的改动') ? true : false),
    { label: '关闭标签时写盘', timeout: 8000 }
  ).catch(() => false);
  check('关闭标签前会等待写盘完成', closedWrote === true, JSON.stringify(readFileSync(extPath, 'utf-8')));
  const leftoverTemp = readdirSync(encDir).filter((name) => name.endsWith('.tmp'));
  check('原子写入不残留临时文件', leftoverTemp.length === 0, JSON.stringify(leftoverTemp));

  // ===== 14. 会话恢复：新窗口重新打开上次的文档 =====
  // 渲染层的会话上报带 500ms 防抖（见 useTabs），必须等它落地再注入。
  // 否则那个排队中的定时器会用主窗口真实的多标签会话覆盖我们写进去的
  // lastSession，新窗口就恢复成「主窗口那几个标签」而不是期望的单个文档
  // ——本地时序恰好躲过，CI 上连续两次复现。
  await new Promise((resolve) => setTimeout(resolve, 700));
  const injectedSession = `{ restoreSession: true, lastSession: { paths: [${JSON.stringify(extPath)}], activePath: ${JSON.stringify(extPath)} } }`;
  const expectedPaths = JSON.stringify([extPath]);
  let sessionApplied = '';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await exec(`window.api.updateSettings(${injectedSession})`);
    sessionApplied = await exec(
      `window.api.getSettings().then((s) => JSON.stringify(s.lastSession?.paths ?? []))`
    );
    if (sessionApplied === expectedPaths) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  check('会话注入未被渲染层上报覆盖', sessionApplied === expectedPaths, `paths=${sessionApplied}`);

  const beforeRestore = BrowserWindow.getAllWindows().length;
  menuAction('file:new-window');
  // 超时给到 30s：CI 上多窗口冷启动 + 读盘偶尔吃掉 20s，曾整条流水线因此变红
  const restoredWin = await waitFor(
    () => BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && candidate !== win) ?? null,
    { label: '会话恢复窗口创建', timeout: 30000 }
  );
  const restoredTab = await waitFor(
    () =>
      execIn(restoredWin, `document.querySelector('.tab .tab-name')?.textContent ?? ''`).then((name) =>
        name === 'external.md' ? name : null
      ),
    { label: '恢复上次打开的标签', timeout: 30000 }
  ).catch(async () => {
    // 超时别再只留一个空字符串，把新窗口的实际状态带出来，下次抖动可直接定位
    const diag = await execIn(
      restoredWin,
      `JSON.stringify({ tabs: document.querySelectorAll('.tab').length,
         first: document.querySelector('.tab .tab-name')?.textContent ?? '',
         body: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 100) })`
    ).catch(() => 'diag-unavailable');
    return `timeout:${diag}`;
  });
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

  // 主题按钮在「浅色 → 深色 → 跟随系统」之间循环（预置设置是浅色）
  const themeButtonTitle = () => exec(`document.querySelector('.tabbar-actions button').title`);
  const titleAtStart = await themeButtonTitle();
  check('主题按钮提示当前为浅色', titleAtStart.includes('主题：浅色'), titleAtStart);

  await exec(`document.querySelector('.tabbar-actions button').click()`);
  const darkState = await waitFor(
    () =>
      Promise.all([exec(`document.documentElement.getAttribute('data-theme')`), themeButtonTitle()]).then(
        ([theme, title]) => (title.includes('主题：深色') ? `${theme}|${title}` : null)
      ),
    { label: '切换到深色' }
  ).catch(() => null);
  check('主题按钮第一次点击切到深色', darkState !== null && darkState.startsWith('dark|'), String(darkState));

  await exec(`document.querySelector('.tabbar-actions button').click()`);
  const systemTitle = await waitFor(
    () => themeButtonTitle().then((title) => (title.includes('主题：跟随系统') ? title : null)),
    { label: '切换到跟随系统' }
  ).catch(() => null);
  // 跟随系统时实际主题必须与系统外观一致
  const systemThemeOk = await exec(
    `(() => { const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      return document.documentElement.getAttribute('data-theme') === (dark ? 'dark' : 'light'); })()`
  );
  check('主题按钮第二次点击切到跟随系统且外观与系统一致', systemTitle !== null && systemThemeOk === true, `${systemTitle} match=${systemThemeOk}`);

  await exec(`document.querySelector('.tabbar-actions button').click()`);
  const backTitle = await waitFor(
    () => themeButtonTitle().then((title) => (title.includes('主题：浅色') ? title : null)),
    { label: '循环回浅色' }
  ).catch(() => null);
  const themeBack = await exec(`document.documentElement.getAttribute('data-theme')`);
  check('主题按钮第三次点击循环回浅色', backTitle !== null && themeBack === 'light', `${backTitle} theme=${themeBack}`);

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
    menuItems.includes('重命名当前文档…') &&
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

  // 改名后侧栏文件树必须跟着更新，否则树里还挂着旧文件名（看起来像没改名）
  const treeAfterRename = await waitFor(
    () =>
      exec(
        `JSON.stringify([...document.querySelectorAll('.tree-name')].map((el) => el.textContent))`
      ).then((json) => {
        const names = JSON.parse(String(json));
        return names.includes('纪要-改名.md') && !names.includes('纪要-测试.md') ? names : null;
      }),
    { label: '文件树同步新文件名', timeout: 8000 }
  ).catch(() => null);
  check('重命名后文件树同步', Array.isArray(treeAfterRename), JSON.stringify(treeAfterRename));

  // 同名文件已存在时不能覆盖，要提示失败并保留原文件
  writeFileSync(join(root, '已存在.md'), '# 已存在\n', 'utf-8');
  await exec(`document.querySelector('.filetree-more-btn').click()`);
  await waitFor(() => exec(`Boolean(document.querySelector('.filetree-menu'))`), { label: '⋮ 菜单再次弹出' });
  await exec(`[...document.querySelectorAll('.filetree-menu-item')].find((el) => el.textContent === '刷新').click()`);
  await waitFor(
    () => exec(`[...document.querySelectorAll('.tree-name')].some((el) => el.textContent === '已存在.md')`),
    { label: '刷新后出现已存在.md', timeout: 8000 }
  );
  await exec(`document.querySelector('.tab-active').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await waitFor(() => exec(`Boolean(document.querySelector('.rename-dialog .rename-input'))`), { label: '重命名对话框弹出' });
  await exec(`(() => {
    const input = document.querySelector('.rename-dialog .rename-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '已存在.md');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  const collisionNotice = await waitFor(
    () => exec(`document.querySelector('.statusbar-notice')?.textContent ?? ''`).then((t) => (/重命名失败/.test(t) ? t : null)),
    { label: '重名提示', timeout: 8000 }
  ).catch(() => null);
  const collisionSafe =
    existsSync(join(root, '纪要-改名.md')) &&
    existsSync(join(root, '已存在.md')) &&
    readFileSync(join(root, '已存在.md'), 'utf-8').includes('已存在');
  const dialogKept = await exec(`Boolean(document.querySelector('.rename-dialog .rename-input'))`);
  check(
    '重名不被覆盖且给出提示',
    Boolean(collisionNotice) && collisionSafe && dialogKept === true,
    `notice=${collisionNotice} safe=${collisionSafe} dialog=${dialogKept}`
  );
  await exec(`document.querySelector('.rename-dialog .rename-actions .dialog-btn')?.click()`);
  await waitFor(() => exec(`!document.querySelector('.rename-dialog')`), { label: '取消关闭对话框', timeout: 8000 });

  // 输入法拼字过程中按 Enter 只是「上屏候选词」，不能当成确认提交（否则中文名会改出半截拼音）
  await exec(`document.querySelector('.tab-active').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await waitFor(() => exec(`Boolean(document.querySelector('.rename-dialog .rename-input'))`), {
    label: '重命名对话框弹出（IME 用例）',
    timeout: 8000
  });
  await exec(`(() => {
    const input = document.querySelector('.rename-dialog .rename-input');
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'jiyao');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true }));
    return true;
  })()`);
  const imeStillOpen = await exec(`Boolean(document.querySelector('.rename-dialog .rename-input'))`);
  const imeNoRename = existsSync(join(root, '纪要-改名.md')) && !existsSync(join(root, 'jiyao.md'));
  check('拼字中的回车不提交改名', imeStillOpen === true && imeNoRename, `open=${imeStillOpen} untouched=${imeNoRename}`);
  await exec(`(() => {
    const input = document.querySelector('.rename-dialog .rename-input');
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '纪要-输入法');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  const imeRenamed = await waitFor(
    () => exec(`document.querySelector('.tab-active .tab-name')?.textContent ?? ''`).then((t) => (t === '纪要-输入法.md' ? t : null)),
    { label: '上屏后回车正常改名', timeout: 8000 }
  ).catch(() => null);
  check('上屏后回车正常改名', imeRenamed === '纪要-输入法.md', String(imeRenamed));

  // 未落盘的「未命名」标签：双击改名直接改标签名，不再弹「另存为」打断用户
  await exec(`document.querySelector('.tab-new').click()`);
  await waitFor(
    () => exec(`document.querySelector('.tab-active .tab-name')?.textContent === '未命名.md'`),
    { label: '新建空白标签', timeout: 8000 }
  );
  await exec(`document.querySelector('.tab-active').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await waitFor(() => exec(`Boolean(document.querySelector('.rename-dialog .rename-input'))`), {
    label: '未命名标签弹出重命名',
    timeout: 8000
  });
  const untitledPrefill = await exec(`document.querySelector('.rename-dialog .rename-input').value`);
  await exec(`(() => {
    const input = document.querySelector('.rename-dialog .rename-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '草稿笔记');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  const untitledRenamed = await waitFor(
    () => exec(`document.querySelector('.tab-active .tab-name')?.textContent ?? ''`).then((t) => (t === '草稿笔记' ? t : null)),
    { label: '未命名标签改名生效', timeout: 8000 }
  ).catch(() => null);
  check(
    '未保存标签可直接改标签名',
    untitledRenamed === '草稿笔记' && untitledPrefill === '未命名.md',
    `name=${untitledRenamed} prefill=${untitledPrefill}`
  );

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

  // 搜索必须覆盖 .txt / .markdown：文件树认这三种扩展名，搜索只认 .md 就会出现「树里有、搜不到」
  writeFileSync(join(root, '扩展名.txt'), '跨扩展名关键词 出现在 txt\n', 'utf-8');
  writeFileSync(join(root, '扩展名.markdown'), '# 附录\n\n跨扩展名关键词 出现在 markdown\n', 'utf-8');
  await exec(`[...document.querySelectorAll('.search-option')][2].click()`); // 关掉正则，按字面量搜
  await typeSearch('跨扩展名关键词');
  const extHits = await waitFor(
    () =>
      exec(
        `JSON.stringify([...document.querySelectorAll('.search-file-name')].map((el) => el.textContent))`
      ).then((json) => {
        const names = JSON.parse(String(json));
        return names.some((n) => n.includes('扩展名.txt')) && names.some((n) => n.includes('扩展名.markdown'))
          ? names
          : null;
      }),
    { label: '搜索覆盖 txt / markdown', timeout: 8000 }
  ).catch(() => null);
  check('搜索覆盖 .txt 与 .markdown', Array.isArray(extHits), JSON.stringify(extHits));

  // 缩进行跳转：源码模式必须按原始列号定位，否则光标会偏到缩进之前
  writeFileSync(join(root, '缩进样例.md'), '# 缩进\n\n  - 缩进关键词在这里\n', 'utf-8');
  await ensureSourceMode();
  await typeSearch('缩进关键词');
  // 等防抖搜索回包并确认结果就是这条新查询（否则会点到上一个关键词的旧结果）
  await waitFor(
    () =>
      exec(
        `[...document.querySelectorAll('.search-file-name')].some((el) => el.textContent.includes('缩进样例.md'))`
      ),
    { label: '缩进行搜索结果', timeout: 8000 }
  );
  await exec(`document.querySelector('.search-match').click()`);
  await waitFor(() => exec(`document.querySelector('.tab-active .tab-name')?.textContent === '缩进样例.md'`), {
    label: '打开缩进样例',
    timeout: 15000
  });
  const caretHit = await waitFor(
    () =>
      exec(`(() => {
        const ta = document.querySelector('.source-editor');
        if (!ta) return null;
        const start = ta.selectionStart;
        return ta.value.slice(start, start + 5) === '缩进关键词' ? start : null;
      })()`),
    { label: '源码模式定位到匹配处', timeout: 8000 }
  ).catch(() => null);
  check('源码模式按原始列号定位缩进行', caretHit !== null, `caret=${caretHit}`);
  await ensureWysiwygMode();
  await exec(`document.querySelector('.search-close')?.click()`);

  // ===== 10.1 导出：本地图片内联（换目录打开也不裂图）、标题不带 .md =====
  mkdirSync(join(root, 'img'), { recursive: true });
  // 只需要能被 base64 编码，不要求是合法 PNG
  writeFileSync(join(root, 'img', 'export.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  writeFileSync(join(root, '导出样例.md'), '# 导出\n\n![图](img/export.png)\n\n正文\n', 'utf-8');
  // 新写的文件要先刷新文件树才在列表里，再从树里点开（与真实操作一致）
  await exec(`document.querySelector('.filetree-more-btn').click()`);
  await waitFor(() => exec(`Boolean(document.querySelector('.filetree-menu'))`), { label: '⋮ 菜单弹出（导出用例）' });
  await exec(`[...document.querySelectorAll('.filetree-menu-item')].find((el) => el.textContent === '刷新').click()`);
  await waitFor(
    () => exec(`[...document.querySelectorAll('.tree-name')].some((el) => el.textContent === '导出样例.md')`),
    { label: '文件树出现导出样例', timeout: 8000 }
  );
  await exec(
    `[...document.querySelectorAll('.tree-item.tree-file')].find((el) => el.textContent === '导出样例.md').click()`
  );
  await waitFor(
    () => exec(`document.querySelector('.tab-active .tab-name')?.textContent === '导出样例.md'`),
    { label: '打开导出样例', timeout: 15000 }
  );
  const htmlOut = join(root, '导出样例.html');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: htmlOut });
  menuAction('file:export-html');
  const exportedHtml = await waitFor(
    () => (existsSync(htmlOut) ? readFileSync(htmlOut, 'utf-8') : null),
    { label: '导出 HTML 落盘', timeout: 15000 }
  ).catch(() => null);
  check(
    '导出 HTML 把本地图片内联为 data URI',
    typeof exportedHtml === 'string' && exportedHtml.includes('src="data:image/png;base64,'),
    String(exportedHtml).slice(0, 80)
  );
  check(
    '导出标题去掉 .md 后缀',
    typeof exportedHtml === 'string' && exportedHtml.includes('<title>导出样例</title>'),
    String(exportedHtml).match(/<title>[^<]*<\/title>/)?.[0] ?? ''
  );

  // ===== 10.2 斜杠菜单：输入「/」弹出快速插入，过滤 / 点击 / 键盘确认 / 最近使用 =====
  // 前面的用例可能让窗口失焦：鼠标注入不一定会带回焦点，blur 会把菜单关掉，
  // 每次键入前都显式把焦点还给编辑器。
  const focusEditor = () =>
    exec(
      `(() => { const el = document.querySelector('.ProseMirror'); if (!el) return false; el.focus(); return true; })()`
    );

  writeFileSync(join(root, '斜杠.md'), '# 斜杠\n\n第一段正文\n', 'utf-8');
  await exec(`document.querySelector('.filetree-more-btn').click()`);
  await waitFor(() => exec(`Boolean(document.querySelector('.filetree-menu'))`), {
    label: '⋮ 菜单弹出（斜杠用例）'
  });
  await exec(`[...document.querySelectorAll('.filetree-menu-item')].find((el) => el.textContent === '刷新').click()`);
  await waitFor(
    () => exec(`[...document.querySelectorAll('.tree-name')].some((el) => el.textContent === '斜杠.md')`),
    { label: '文件树出现斜杠样例', timeout: 8000 }
  );
  await exec(
    `[...document.querySelectorAll('.tree-item.tree-file')].find((el) => el.textContent === '斜杠.md').click()`
  );
  await waitFor(() => exec(`document.querySelector('.tab-active .tab-name')?.textContent === '斜杠.md'`), {
    label: '打开斜杠样例',
    timeout: 15000
  });
  await ensureWysiwygMode();

  // 光标放进正文段落，输入「/」→ 菜单弹出且条目齐全（13 格式 + 4 插入）
  await clickSelector('.ProseMirror p', 0);
  await focusEditor();
  win.webContents.insertText('/');
  await waitFor(() => exec(`Boolean(document.querySelector('.slash-menu'))`), { label: '斜杠菜单弹出' });
  const gridCount = await exec(`document.querySelectorAll('.slash-grid-item').length`);
  const listCount = await exec(`document.querySelectorAll('.slash-list .slash-item').length`);
  check('斜杠菜单默认条目齐全', gridCount === 13 && listCount === 4, `grid=${gridCount} list=${listCount}`);

  // 表格的行列网格是「点行尾的 › 才展开」：悬停不做任何事（悬停展开会让网格跟着指针闪，
  // 格子几乎点不中），展开后也不会因为鼠标移开而收回，要点箭头或按 Esc 才收起。
  const subShown = () =>
    exec(`(() => {
      const sub = document.querySelector('.slash-sub');
      return Boolean(sub) && getComputedStyle(sub).display !== 'none';
    })()`);
  const slashPoints = JSON.parse(
    await exec(`(() => {
      const find = (kw) =>
        [...document.querySelectorAll('.slash-item, .slash-grid-item')].find((el) => (el.textContent ?? '').includes(kw));
      const center = (el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      };
      const table = find('表格');
      const image = find('图片');
      const arrow = table && table.querySelector('.slash-item-arrow');
      return JSON.stringify({
        table: table ? center(table) : null,
        image: image ? center(image) : null,
        arrow: arrow ? center(arrow) : null
      });
    })()`)
  );

  if (slashPoints.table && slashPoints.arrow) {
    // 1) 悬停「表格」：网格不能自己弹出来
    await hoverPoint(slashPoints.table);
    check('悬停表格条目不展开行列网格', (await subShown()) === false, `shown=${await subShown()}`);

    // 2) 点行尾的 › 才展开
    await clickPoint(slashPoints.arrow);
    const openedByArrow = await waitFor(subShown, { label: '点箭头展开行列网格', timeout: 6000 }).catch(() => false);
    check('点击表格行的 › 展开行列网格', openedByArrow === true, `shown=${openedByArrow}`);

    const geom = await exec(`(() => {
      const sub = document.querySelector('.slash-sub').getBoundingClientRect();
      const menu = document.querySelector('.slash-menu').getBoundingClientRect();
      // 右侧放不下会翻到菜单左边，两种都算合格：只要两者水平方向不重叠
      const noOverlap = sub.right <= menu.left || sub.left >= menu.right;
      return JSON.stringify({
        subLeft: Math.round(sub.left),
        subRight: Math.round(sub.right),
        menuLeft: Math.round(menu.left),
        menuRight: Math.round(menu.right),
        noOverlap
      });
    })()`);
    check('行列网格贴在菜单外侧，不遮挡菜单条目', JSON.parse(geom).noOverlap === true, geom);

    // 3) 悬停到别的条目：网格保持展开，不跟着鼠标闪
    if (slashPoints.image) {
      await hoverPoint(slashPoints.image);
      check('悬停其他条目时网格保持展开', (await subShown()) === true);
    } else {
      skip('悬停其他条目时网格保持展开', '菜单里找不到图片条目');
    }

    // 4) 再点一次 › 收起
    await clickPoint(slashPoints.arrow);
    const closedByArrow = await waitFor(async () => (await subShown()) === false, {
      label: '再点箭头收起行列网格',
      timeout: 6000
    }).catch(() => false);
    check('再次点击 › 收起行列网格', closedByArrow === true);
  } else {
    skip('点击表格行的 › 展开行列网格', '菜单里找不到表格条目或箭头');
  }

  // 键盘路径：输入「/格」过滤到表格一项，Enter 展开二级行列网格，再按行列调整后确认
  // 先把文档重置干净：上面那组点击会在正文里留下「/」，用例之间不能互相带状态
  await resetDoc('正文一段\n');
  await clickSelector('.ProseMirror p', 0);
  await focusEditor();
  win.webContents.insertText('/格');
  await waitFor(() => exec(`document.querySelectorAll('.slash-item').length === 1`), { label: '过滤到表格一项' });
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await waitFor(() => exec(`Boolean(document.querySelector('.slash-sub')) && document.querySelector('.slash-sub').style.display !== 'none'`), {
    label: '二级行列网格展开'
  });
  const subLabel = await exec(`document.querySelector('.slash-sub-label')?.textContent ?? ''`);
  check('二级网格默认 3 行 × 3 列', subLabel.includes('3 行 × 3 列'), subLabel);
  // 方向键调整：↓ 加一行、→ 加一列 → 4 行 × 4 列
  for (const key of ['Down', 'Right']) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key });
  }
  await waitFor(() => exec(`(document.querySelector('.slash-sub-label')?.textContent ?? '').includes('4 行 × 4 列')`), {
    label: '方向键调整行列'
  });
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror table td'))`), { label: '表格已插入' });
  const tableCols = await exec(`document.querySelectorAll('.ProseMirror table tr')[0]?.children.length ?? 0`);
  const tableRows = await exec(`document.querySelectorAll('.ProseMirror table tr').length`);
  check('按选中的 4×4 插入表格', tableCols === 4 && tableRows === 4, `cols=${tableCols} rows=${tableRows}`);

  // 鼠标路径：输入「/」点击表格条目展开二级网格，点 2 行 × 5 列的格子插入
  await resetDoc('正文一段\n');
  await clickSelector('.ProseMirror p', 0);
  await focusEditor();
  win.webContents.insertText('/');
  await waitFor(() => exec(`Boolean(document.querySelector('.slash-menu')) && document.querySelector('.slash-menu').style.display !== 'none'`), {
    label: '菜单再次弹出'
  });
  await exec(
    `[...document.querySelectorAll('.slash-item')].find((el) => el.textContent.includes('表格'))?.click()`
  );
  await waitFor(() => exec(`document.querySelector('.slash-sub')?.style.display !== 'none'`), {
    label: '点击表格展开二级网格'
  });
  await exec(`document.querySelector('.slash-sub-cell[data-sub-r="2"][data-sub-c="5"]').click()`);
  await waitFor(
    () =>
      exec(
        `[...document.querySelectorAll('.ProseMirror table')].some((t) => t.querySelector('tr')?.children.length === 5)`
      ),
    { label: '第二张表格已插入' }
  );
  // 插入位置跟随光标（可能在 4×4 表之前），按「5 列」规格找到新表再验证行数
  const table2Rows = await exec(
    `[...document.querySelectorAll('.ProseMirror table')].find((t) => t.querySelector('tr')?.children.length === 5)?.querySelectorAll('tr').length ?? 0`
  );
  check('点击格子按 2 行 × 5 列插入表格', table2Rows === 2, `rows=${table2Rows}`);

  // ===== 10.3 链接二级表单：填「文本」与「链接地址」后插入 [文本](地址) =====
  writeFileSync(join(root, '链接.md'), '# 链接\n\n一段正文\n', 'utf-8');
  await exec(`document.querySelector('.filetree-more-btn').click()`);
  await waitFor(() => exec(`Boolean(document.querySelector('.filetree-menu'))`), {
    label: '⋮ 菜单弹出（链接用例）'
  });
  await exec(`[...document.querySelectorAll('.filetree-menu-item')].find((el) => el.textContent === '刷新').click()`);
  await waitFor(
    () => exec(`[...document.querySelectorAll('.tree-name')].some((el) => el.textContent === '链接.md')`),
    { label: '文件树出现链接样例', timeout: 8000 }
  );
  await exec(
    `[...document.querySelectorAll('.tree-item.tree-file')].find((el) => el.textContent === '链接.md').click()`
  );
  await waitFor(() => exec(`document.querySelector('.tab-active .tab-name')?.textContent === '链接.md'`), {
    label: '打开链接样例',
    timeout: 15000
  });
  await ensureWysiwygMode();

  // 鼠标路径：过滤「/链」点击展开表单，填完点「确定」
  await clickSelector('.ProseMirror p', 0);
  await focusEditor();
  win.webContents.insertText('/链');
  await waitFor(() => exec(`document.querySelectorAll('.slash-item').length === 1`), { label: '过滤到链接一项' });
  await exec(`document.querySelector('.slash-menu .slash-item').click()`);
  await waitFor(
    () => exec(`Boolean(document.querySelector('.slash-form')) && document.querySelector('.slash-form').style.display !== 'none'`),
    { label: '链接表单展开' }
  );
  await exec(`(() => {
    const setValue = (selector, value) => {
      const input = document.querySelector(selector);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setValue('[data-form="text"]', '点击这里');
    setValue('[data-form="url"]', 'https://example.com/docs');
    return true;
  })()`);
  await exec(`document.querySelector('.slash-form-submit').click()`);
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror a'))`), { label: '链接已插入' });
  const linkHref = await exec(`document.querySelector('.ProseMirror a')?.getAttribute('href') ?? ''`);
  const linkText = await exec(`document.querySelector('.ProseMirror a')?.textContent ?? ''`);
  check('链接文本与地址正确', linkHref === 'https://example.com/docs' && linkText === '点击这里', `href=${linkHref} text=${linkText}`);
  const afterLink = await exec(`document.querySelector('.ProseMirror p')?.textContent ?? ''`);
  check('链接确认后斜杠与过滤词被清除', !afterLink.includes('/') && !afterLink.includes('链'), afterLink);

  // 键盘路径：点段落末尾 → 输入「/链」→ Enter 展开表单（焦点落「文本」框）→
  // Tab 切到地址框 → Enter 确认
  const endPoint = await exec(`(() => {
    const p = [...document.querySelectorAll('.ProseMirror > p')].pop();
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: Math.round(Math.max(r.left + 8, r.right - 12)), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!endPoint) throw new Error('找不到顶层段落');
  win.webContents.sendInputEvent({ type: 'mouseDown', x: endPoint.x, y: endPoint.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: endPoint.x, y: endPoint.y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 250));
  await focusEditor();
  win.webContents.insertText('/链');
  await waitFor(() => exec(`document.querySelectorAll('.slash-item').length === 1`), { label: '再次过滤到链接一项' });
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await waitFor(
    () => exec(`Boolean(document.querySelector('.slash-form')) && document.querySelector('.slash-form').style.display !== 'none'`),
    { label: '键盘展开链接表单' }
  );
  await waitFor(() => exec(`document.activeElement?.getAttribute('data-form') === 'text'`), {
    label: '焦点落在文本输入框'
  });
  win.webContents.insertText('键盘链接');
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  await waitFor(() => exec(`document.activeElement?.getAttribute('data-form') === 'url'`), { label: 'Tab 切到地址框' });
  // 受控 input 用原生 setter + input 事件直接写值：insertText 之后 Chromium 偶尔把焦点
  // 挪走，URL 会落进编辑器，空地址提交被拦下（这条用例偶发失败的真实原因）。
  // 键盘路径已由上面的 /链 → Enter → Tab 断言覆盖，这里只保证表单状态确定。
  await setControlValue('.slash-form [data-form="url"]', 'https://kbd.example.com');
  await waitFor(() => exec(`document.querySelector('.slash-form [data-form="url"]')?.value === 'https://kbd.example.com'`), {
    label: '地址已填入表单',
    timeout: 5000
  });
  // 回车前把焦点按回地址框，避免 Enter 落到编辑器上、表单不提交。
  await exec(`(() => { const el = document.querySelector('[data-form="url"]'); if (!el) return false; el.focus(); return document.activeElement === el; })()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await waitFor(
    () => exec(`[...document.querySelectorAll('.ProseMirror a')].some((a) => a.getAttribute('href') === 'https://kbd.example.com')`),
    { label: '键盘路径链接已插入', timeout: 8000 }
  );
  check('键盘路径链接确认成功', true);

  // ⌘+点击打开链接：E2E 脚本与主进程同进程，直接替换 shell.openExternal 收集调用
  // （主进程 handler 里 import 的 shell 与这里 require 到的是同一对象，属性替换生效）
  const { shell } = require('electron');
  const realOpenExternal = shell.openExternal;
  const openedUrls = [];
  shell.openExternal = async (url) => {
    openedUrls.push(url);
  };
  // 两条链接的 DOM 顺序不保证与插入顺序一致（行内片段插入会拆/并段落），
  // 点击目标按文本精确匹配，别用「第一个 a」
  const targetLink = await exec(`(() => {
    const a = [...document.querySelectorAll('.ProseMirror a')].find(
      (el) => el.textContent === '点击这里' && el.getAttribute('href') === 'https://example.com/docs'
    );
    if (!a) return null;
    const r = a.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!targetLink) throw new Error('找不到目标链接「点击这里」');
  // 普通单击：不打开，只定位光标
  win.webContents.sendInputEvent({ type: 'mouseDown', x: targetLink.x, y: targetLink.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: targetLink.x, y: targetLink.y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 400));
  check('普通单击不打开链接（保留光标定位）', openedUrls.length === 0, JSON.stringify(openedUrls));
  // 悬停提示：对目标链接派发冒泡 mouseover 后应带上「⌘ 点击打开链接」的 title
  await exec(`(() => {
    const a = [...document.querySelectorAll('.ProseMirror a')].find((el) => el.textContent === '点击这里');
    a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return a.title;
  })()`);
  const linkTitle = await exec(
    `[...document.querySelectorAll('.ProseMirror a')].find((el) => el.textContent === '点击这里')?.title ?? ''`
  );
  check('悬停链接出现打开方式提示', linkTitle.includes('点击打开链接'), linkTitle);
  // ⌘+点击：交给系统浏览器（这里是被替换后的收集器）
  win.webContents.sendInputEvent({
    type: 'mouseDown', x: targetLink.x, y: targetLink.y, button: 'left', clickCount: 1, modifiers: ['meta']
  });
  win.webContents.sendInputEvent({
    type: 'mouseUp', x: targetLink.x, y: targetLink.y, button: 'left', clickCount: 1, modifiers: ['meta']
  });
  await new Promise((resolve) => setTimeout(resolve, 400));
  check(
    '⌘+点击用系统浏览器打开链接',
    openedUrls.includes('https://example.com/docs'),
    JSON.stringify(openedUrls)
  );
  // 恢复真实实现，避免影响其他用例
  shell.openExternal = realOpenExternal;

  // ===== 10.4 最近使用：表格与链接确认后记入 localStorage，新文档置顶展示 =====
  // 单独开新文档验证：前面的表格用例会把首个段落吞进单元格，
  // 单元格里「/」前一字符是数字（列 1）按设计不触发，锚点不可靠。
  writeFileSync(join(root, '最近.md'), '# 最近\n\n一段正文\n', 'utf-8');
  await exec(`document.querySelector('.filetree-more-btn').click()`);
  await waitFor(() => exec(`Boolean(document.querySelector('.filetree-menu'))`), {
    label: '⋮ 菜单弹出（最近使用用例）'
  });
  await exec(`[...document.querySelectorAll('.filetree-menu-item')].find((el) => el.textContent === '刷新').click()`);
  await waitFor(
    () => exec(`[...document.querySelectorAll('.tree-name')].some((el) => el.textContent === '最近.md')`),
    { label: '文件树出现最近样例', timeout: 8000 }
  );
  await exec(
    `[...document.querySelectorAll('.tree-item.tree-file')].find((el) => el.textContent === '最近.md').click()`
  );
  await waitFor(() => exec(`document.querySelector('.tab-active .tab-name')?.textContent === '最近.md'`), {
    label: '打开最近样例',
    timeout: 15000
  });
  await ensureWysiwygMode();
  await clickSelector('.ProseMirror p', 0);
  await focusEditor();
  win.webContents.insertText('/');
  await waitFor(() => exec(`Boolean(document.querySelector('.slash-chip'))`), { label: '最近使用出现' }).catch(
    async (err) => {
      const dbg = await exec(
        `(() => {
          const menu = document.querySelector('.slash-menu');
          return {
            menuExists: Boolean(menu),
            display: menu ? menu.style.display : null,
            section: menu ? menu.textContent.slice(0, 60) : null,
            chips: document.querySelectorAll('.slash-chip').length,
            recents: localStorage.getItem('mdnote-slash-recents'),
            active: document.activeElement ? document.activeElement.className : null,
            paragraphs: document.querySelectorAll('.ProseMirror p').length
          };
        })()`
      );
      throw new Error(`${err.message}｜诊断：${JSON.stringify(dbg)}`);
    }
  );
  const chipCount = await exec(`document.querySelectorAll('.slash-chip').length`);
  check('最近使用记录表格与链接', chipCount >= 2, `chips=${chipCount}`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await waitFor(() => exec(`!document.querySelector('.slash-menu') || document.querySelector('.slash-menu').style.display === 'none'`), {
    label: 'Esc 关闭菜单'
  });
  check('斜杠菜单 Esc 可关闭', true);

  // ===== 10.5 任务列表：复选框渲染与点击勾选（视觉由 CSS 自绘，交互走 taskListPlugin） =====
  writeFileSync(join(root, '清单.md'), '# 清单\n\n- [ ] 待办一\n- [x] 已办\n- 普通项\n', 'utf-8');
  await exec(`document.querySelector('.filetree-more-btn').click()`);
  await waitFor(() => exec(`Boolean(document.querySelector('.filetree-menu'))`), {
    label: '⋮ 菜单弹出（任务列表用例）'
  });
  await exec(`[...document.querySelectorAll('.filetree-menu-item')].find((el) => el.textContent === '刷新').click()`);
  await waitFor(
    () => exec(`[...document.querySelectorAll('.tree-name')].some((el) => el.textContent === '清单.md')`),
    { label: '文件树出现清单', timeout: 8000 }
  );
  await exec(
    `[...document.querySelectorAll('.tree-item.tree-file')].find((el) => el.textContent === '清单.md').click()`
  );
  await waitFor(() => exec(`document.querySelector('.tab-active .tab-name')?.textContent === '清单.md'`), {
    label: '打开清单',
    timeout: 15000
  });
  await ensureWysiwygMode();
  const taskCount = await exec(`document.querySelectorAll('.ProseMirror li[data-item-type="task"]').length`);
  const plainCount = await exec(`document.querySelectorAll('.ProseMirror li:not([data-item-type])').length`);
  check('任务项与普通项可区分', taskCount === 2 && plainCount === 1, `task=${taskCount} plain=${plainCount}`);

  // 点击未完成项左侧方框 → 切换为已完成
  const boxPoint = await exec(`(() => {
    const li = document.querySelector('.ProseMirror li[data-item-type="task"]');
    const r = li.getBoundingClientRect();
    return { x: Math.round(r.left + 8), y: Math.round(r.top + Math.min(13, r.height / 2)) };
  })()`);
  win.webContents.sendInputEvent({ type: 'mouseDown', x: boxPoint.x, y: boxPoint.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: boxPoint.x, y: boxPoint.y, button: 'left', clickCount: 1 });
  await waitFor(
    () => exec(`document.querySelector('.ProseMirror li[data-item-type="task"]')?.dataset.checked === 'true'`),
    { label: '方框点击勾选', timeout: 8000 }
  );
  check('点击复选框切换完成状态', true);

  // ===== 10.6 文档末尾的表格：下方能点进去输入，且能整表删除 =====
  // 放在全屏/最小化用例之前：那段会改变窗口激活状态，键盘注入会失效。
  await ensureSourceMode();
  await exec(SET_TEXTAREA);
  await exec(`window.__setSource(${JSON.stringify('# 末尾表格\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n')}, 0)`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await ensureWysiwygMode();
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror table td'))`), {
    label: '末尾表格渲染',
    timeout: 20000
  });
  // 表格是文档最后一个节点时，ProseMirror 后面没有可放光标的位置；
  // 编辑器应自动补一个空段落作为落点，点它就能直接输入。
  const trailingTag = await exec(
    `document.querySelector('.ProseMirror')?.lastElementChild?.tagName?.toLowerCase() ?? ''`
  );
  check('文档末尾表格后自动补出可输入段落', trailingTag === 'p', `lastTag=${trailingTag}`);

  // 末尾空段落可能落在滚动区之外，先滚到中间再点击，避免坐标落到视口外
  await exec(`(() => {
    const p = document.querySelector('.ProseMirror')?.lastElementChild;
    if (!p) return false;
    p.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await clickSelector('.ProseMirror > p:last-child', 0);
  await focusEditor();
  win.webContents.insertText('表格下方的文字');
  const typedState = await exec(`(() => {
    const pm = document.querySelector('.ProseMirror');
    const last = pm?.lastElementChild;
    return JSON.stringify({
      lastTag: last?.tagName?.toLowerCase() ?? '',
      lastText: last?.textContent ?? '',
      inTable: [...document.querySelectorAll('.ProseMirror table')].some((t) =>
        t.textContent.includes('表格下方的文字')
      ),
      active: document.activeElement?.className ?? document.activeElement?.tagName ?? ''
    });
  })()`);
  check('点击表格下方空白即可输入内容', typedState.includes('"inTable":false') && typedState.includes('表格下方的文字'), typedState);

  await clickSelector('.ProseMirror table td', 0);
  menuAction('format:table-delete');
  await waitFor(() => exec(`!document.querySelector('.ProseMirror table')`), { label: '整表已删除' });
  const afterDeleteTable = await exec(`document.querySelector('.ProseMirror')?.textContent ?? ''`);
  check('删除整表后下方段落内容保留', afterDeleteTable.includes('表格下方的文字'), afterDeleteTable);

  // ===== 10.7 文档末尾的代码块：下方同样能点进去写正文 =====
  // 代码块内部能放光标，但它是封闭块，Enter 换不出普通段落，点下方也没有落点，
  // 所以和表格一样要自动补一个空段落。
  await ensureSourceMode();
  await exec(SET_TEXTAREA);
  await exec(`window.__setSource(${JSON.stringify('# 末尾代码块\n\n```js\nconst a = 1;\n```\n')}, 0)`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await ensureWysiwygMode();
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror pre'))`), {
    label: '末尾代码块渲染',
    timeout: 20000
  });
  const codeTrailingTag = await exec(
    `document.querySelector('.ProseMirror')?.lastElementChild?.tagName?.toLowerCase() ?? ''`
  );
  check('文档末尾代码块后自动补出可输入段落', codeTrailingTag === 'p', `lastTag=${codeTrailingTag}`);

  await exec(`(() => {
    const p = document.querySelector('.ProseMirror')?.lastElementChild;
    if (!p) return false;
    p.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await clickSelector('.ProseMirror > p:last-child', 0);
  await focusEditor();
  win.webContents.insertText('代码块下方的文字');
  const codeTypedState = await exec(`(() => {
    const pm = document.querySelector('.ProseMirror');
    const last = pm?.lastElementChild;
    return JSON.stringify({
      lastTag: last?.tagName?.toLowerCase() ?? '',
      lastText: last?.textContent ?? '',
      inPre: [...document.querySelectorAll('.ProseMirror pre')].some((n) =>
        n.textContent.includes('代码块下方的文字')
      )
    });
  })()`);
  check(
    '点击代码块下方空白即可输入内容',
    codeTypedState.includes('"lastTag":"p"') &&
      codeTypedState.includes('代码块下方的文字') &&
      codeTypedState.includes('"inPre":false'),
    codeTypedState
  );

  // 真实操作路径：把末尾段落转成代码块（菜单「代码块」）后，下方仍要有可输入区域
  await ensureSourceMode();
  await exec(SET_TEXTAREA);
  await exec(`window.__setSource(${JSON.stringify('# 转换代码块\n\n最后一段\n')}, 0)`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await ensureWysiwygMode();
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror > p:last-child'))`), {
    label: '转换前段落渲染',
    timeout: 20000
  });
  await clickSelector('.ProseMirror > p:last-child', 0);
  await focusEditor();
  menuAction('format:code-block');
  const converted = await waitFor(
    () =>
      exec(`(() => {
        const pm = document.querySelector('.ProseMirror');
        const last = pm?.lastElementChild;
        return Boolean(pm?.querySelector('pre')) && last?.tagName?.toLowerCase() === 'p';
      })()`),
    { label: '转换为代码块后补出段落', timeout: 10000 }
  );
  check('末尾段落转成代码块后仍自动补出可输入段落', converted === true, `converted=${converted}`);

  // ===== 10.7b 表格 / 代码块同行末尾点击落光标并回车换行 =====
  // 这些块占满整行，点「同行最后面」（行末右侧空白）时 ProseMirror 默认把光标
  // 解析进块内部——表格落进单元格、代码块落进代码文本，回车只在块内换行。
  // 现在点行末空白处应把光标放到块后，回车在块后新建正文段落；
  // 而点块内文字仍要能正常编辑（不能一刀切把所有点击都挪到块后）。
  await resetDoc('# 行末换行\n\n' +
    '![红块](img/a.png)\n\n图片后正文\n\n' +
    '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n表格后正文\n\n' +
    '---\n\n分割线后正文\n\n' +
    '```js\nconst a = 1;\n```\n\n代码后正文\n');
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror table') && document.querySelector('.ProseMirror pre') && document.querySelector('.ProseMirror hr'))`), {
    label: '行末换行用例渲染', timeout: 20000
  });
  const pressReturn = () => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  };
  // 先滚动让目标块进入视口中部再取坐标，避免长文档里块在视口外导致点击落空
  const scrollIntoView = (selector) => exec(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    return true;
  })()`);
  // 返回某个块「最后一行右侧空白」的点击坐标：x 取块右缘内 2px、y 取块底部内 6px
  const lineEndPoint = (selector) => exec(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.right - 2), y: Math.round(r.bottom - 6) };
  })()`);
  // 量间隙光标与目标元素的位置关系：竖线要贴目标右缘、底边对齐目标底部
  const caretVs = (expr) => exec(`(() => {
    const gap = document.querySelector('.ProseMirror-gapcursor');
    const target = ${expr};
    if (!gap || !target) return null;
    const g = gap.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    return {
      gapTop: Math.round(g.top), gapBottom: Math.round(g.bottom), gapRight: Math.round(g.right),
      blockTop: Math.round(b.top), blockBottom: Math.round(b.bottom), blockRight: Math.round(b.right)
    };
  })()`);
  const caretGeometry = (blockSelector) => caretVs(`document.querySelector(${JSON.stringify(blockSelector)})`);
  // 真实图片元素：ProseMirror 会插入 class=ProseMirror-separator 的零宽 img，必须排除
  const REAL_IMG = `[...document.querySelectorAll('.ProseMirror img')].find((el) => !el.classList.contains('ProseMirror-separator'))`;

  // 代码块：点行末空白 → 回车应在块后新建段落，代码内容不变
  {
    await scrollIntoView('.ProseMirror pre'); await new Promise((r) => setTimeout(r, 200));
    const point = await lineEndPoint('.ProseMirror pre');
    if (!point) throw new Error('代码块行末坐标不存在');
    await clickPoint(point);
    await focusEditor();
    // 点击后应出现间隙光标竖线，且竖线要落在块右缘、块的高度范围内（不是块下方的下一行）
    const caret = await caretGeometry('.ProseMirror pre');
    check(
      '代码块行末光标竖线贴块右缘且落在块内',
      caret !== null &&
        Math.abs(caret.gapRight - caret.blockRight) <= 6 &&
        caret.gapBottom <= caret.blockBottom + 4 &&
        caret.gapTop >= caret.blockTop - 4,
      JSON.stringify(caret)
    );
    const beforePre = await exec(`document.querySelector('.ProseMirror pre')?.textContent ?? ''`);
    const beforePCount = await exec(`document.querySelectorAll('.ProseMirror > p').length`);
    pressReturn();
    await waitFor(
      () => exec(`document.querySelectorAll('.ProseMirror > p').length > ${beforePCount}`),
      { label: '代码块行末回车在块后建段落' }
    );
    const codeState = await exec(`(() => ({
      pre: document.querySelector('.ProseMirror pre')?.textContent ?? '',
      p: document.querySelectorAll('.ProseMirror > p').length
    }))()`);
    check('代码块同行末尾点击回车在块后换行', codeState.p === beforePCount + 1 && codeState.pre === beforePre,
      `点击(${point.x},${point.y}) p:${beforePCount}->${codeState.p} pre="${codeState.pre}"`);
    menuAction('edit:undo');
    await waitFor(() => exec(`document.querySelectorAll('.ProseMirror > p').length === ${beforePCount}`), { label: '撤销块后换行' });
  }

  // 表格：点行末空白 → 回车应在表格后新建段落，表格行数不变
  {
    await scrollIntoView('.ProseMirror table'); await new Promise((r) => setTimeout(r, 200));
    const point = await lineEndPoint('.ProseMirror table');
    if (!point) throw new Error('表格行末坐标不存在');
    await clickPoint(point);
    await focusEditor();
    const caret = await caretGeometry('.ProseMirror table');
    check(
      '表格行末光标竖线贴块右缘且落在块内',
      caret !== null &&
        Math.abs(caret.gapRight - caret.blockRight) <= 6 &&
        caret.gapBottom <= caret.blockBottom + 4 &&
        caret.gapTop >= caret.blockTop - 4,
      JSON.stringify(caret)
    );
    const beforeRows = await exec(`document.querySelectorAll('.ProseMirror table tr').length`);
    const beforePCount = await exec(`document.querySelectorAll('.ProseMirror > p').length`);
    pressReturn();
    await waitFor(
      () => exec(`document.querySelectorAll('.ProseMirror > p').length > ${beforePCount}`),
      { label: '表格行末回车在表后建段落' }
    );
    const tableState = await exec(`(() => ({
      rows: document.querySelectorAll('.ProseMirror table tr').length,
      p: document.querySelectorAll('.ProseMirror > p').length
    }))()`);
    check('表格同行末尾点击回车在表后换行', tableState.p === beforePCount + 1 && tableState.rows === beforeRows,
      `点击(${point.x},${point.y}) p:${beforePCount}->${tableState.p} rows:${beforeRows}->${tableState.rows}`);
    menuAction('edit:undo');
    await waitFor(() => exec(`document.querySelectorAll('.ProseMirror > p').length === ${beforePCount}`), { label: '撤销表后换行' });
  }

  // 图片：点图片右缘的同行空白 → 竖线贴图片右缘，回车在图片段落后新建段落
  {
    await scrollIntoView('.ProseMirror p'); await new Promise((r) => setTimeout(r, 200));
    // 1x1 测试图看不出右缘，临时给个尺寸模拟真实图片（撤销会重建 DOM，每次点击前都重新给）
    const sizeImg = () => exec(`(() => {
      const img = ${REAL_IMG};
      if (!img) return null;
      img.style.width = '200px';
      img.style.height = '120px';
      const r = img.getBoundingClientRect();
      return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) };
    })()`);
    await sizeImg();
    await new Promise((r) => setTimeout(r, 150));
    const rect = await sizeImg();
    if (!rect) throw new Error('图片元素不存在');
    await clickPoint({ x: rect.r + 2, y: Math.round((rect.t + rect.b) / 2) });
    await focusEditor();
    const caret = await caretVs(REAL_IMG);
    check(
      '图片同行末尾光标竖线贴图片右缘且落在图片内',
      caret !== null && Math.abs(caret.gapRight - caret.blockRight) <= 6 && Math.abs(caret.gapBottom - caret.blockBottom) <= 8,
      JSON.stringify(caret)
    );
    const beforePCount = await exec(`document.querySelectorAll('.ProseMirror > p').length`);
    pressReturn();
    await waitFor(
      () => exec(`document.querySelectorAll('.ProseMirror > p').length > ${beforePCount}`),
      { label: '图片同行末尾回车换行' }
    );
    check('图片同行末尾点击回车在图片后换行', (await exec(`document.querySelectorAll('.ProseMirror > p').length`)) === beforePCount + 1);
    menuAction('edit:undo');
    await waitFor(() => exec(`document.querySelectorAll('.ProseMirror > p').length === ${beforePCount}`), { label: '撤销图片后换行' });
  }

  // 分割线：点右缘 → 竖线贴横线右端，回车在分割线后新建段落，分割线数量不变
  {
    await scrollIntoView('.ProseMirror hr'); await new Promise((r) => setTimeout(r, 200));
    const point = await exec(`(() => {
      const hr = document.querySelector('.ProseMirror hr');
      if (!hr) return null;
      const r = hr.getBoundingClientRect();
      return { x: Math.round(r.right - 3), y: Math.round(r.top + 1) };
    })()`);
    if (!point) throw new Error('分割线坐标不存在');
    await clickPoint(point);
    await focusEditor();
    const caret = await caretGeometry('.ProseMirror hr');
    check(
      '分割线行末光标竖线贴横线右端',
      caret !== null && Math.abs(caret.gapRight - caret.blockRight) <= 6 && Math.abs(caret.gapBottom - caret.blockBottom) <= 6,
      JSON.stringify(caret)
    );
    const beforePCount = await exec(`document.querySelectorAll('.ProseMirror > p').length`);
    const beforeHr = await exec(`document.querySelectorAll('.ProseMirror hr').length`);
    pressReturn();
    await waitFor(
      () => exec(`document.querySelectorAll('.ProseMirror > p').length > ${beforePCount}`),
      { label: '分割线行末回车在分割线后建段落' }
    );
    const hrState = await exec(`(() => ({
      p: document.querySelectorAll('.ProseMirror > p').length,
      hr: document.querySelectorAll('.ProseMirror hr').length
    }))()`);
    check('分割线行末点击回车在分割线后换行', hrState.p === beforePCount + 1 && hrState.hr === beforeHr,
      `p:${beforePCount}->${hrState.p} hr:${beforeHr}->${hrState.hr}`);
    menuAction('edit:undo');
    await waitFor(() => exec(`document.querySelectorAll('.ProseMirror > p').length === ${beforePCount}`), { label: '撤销分割线后换行' });
  }

  // 边界：点代码块内文字仍应落进代码里编辑，不能被行末逻辑一刀切挪到块后
  {
    await scrollIntoView('.ProseMirror pre'); await new Promise((r) => setTimeout(r, 200));
    const point = await exec(`(() => {
      const pre = document.querySelector('.ProseMirror pre');
      if (!pre) return null;
      const r = pre.getBoundingClientRect();
      return { x: Math.round(r.left + 24), y: Math.round(r.top + 15) };
    })()`);
    if (!point) throw new Error('代码块内文字坐标不存在');
    await clickPoint(point);
    await focusEditor();
    const beforePre = await exec(`document.querySelector('.ProseMirror pre')?.textContent ?? ''`);
    await exec(`(() => { document.querySelector('.ProseMirror')?.focus(); return true; })()`);
    win.webContents.insertText('XYZ');
    await waitFor(() => exec(`(document.querySelector('.ProseMirror pre')?.textContent ?? '').includes('XYZ')`), { label: '代码块内文字可编辑' });
    const afterPre = await exec(`document.querySelector('.ProseMirror pre')?.textContent ?? ''`);
    check('点击代码块内文字仍可编辑（行末逻辑不误伤块内）', afterPre !== beforePre && afterPre.includes('XYZ'), afterPre);
    menuAction('edit:undo');
    await waitFor(() => exec(`(document.querySelector('.ProseMirror pre')?.textContent ?? '') === ${JSON.stringify(beforePre)}`), { label: '撤销块内编辑' });
  }

  // ===== 10.8 列表项开头按退格：去掉当前编号变段落，而不是并进上一行 =====
  // 旧行为是把「2. 第二项」的文字并到第一项后面（光标跳到上一行），
  // 列表在文档开头时更是删不动、也没法在最前面写新内容。
  const pressKey = (keyCode) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };

  /** 点进第 index 个列表项并回到行首 */
  const caretToListItem = async (index) => {
    await clickSelector('.ProseMirror li p', index);
    await focusEditor();
    pressKey('Home');
    await new Promise((resolve) => setTimeout(resolve, 150));
  };

  const readBlocks = () =>
    exec(`(() => {
      const pm = document.querySelector('.ProseMirror');
      if (!pm) return '[]';
      const top = [...pm.children].map((el) => {
        const tag = el.tagName.toLowerCase();
        const out = { tag, text: (el.textContent ?? '').slice(0, 30) };
        if (tag === 'ol' || tag === 'ul') {
          out.start = el.getAttribute('start');
          out.items = [...el.children].map((li) => (li.textContent ?? '').slice(0, 30));
        }
        return out;
      });
      return JSON.stringify(top);
    })()`);

  await ensureSourceMode();
  await exec(SET_TEXTAREA);
  await exec(`window.__setSource(${JSON.stringify('1. 第一项\n2. 第二项\n3. 第三项\n')}, 0)`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await ensureWysiwygMode();
  await waitFor(() => exec(`document.querySelectorAll('.ProseMirror li').length === 3`), {
    label: '三项有序列表渲染',
    timeout: 20000
  });

  await caretToListItem(1);
  pressKey('Backspace');
  await waitFor(() => exec(`document.querySelectorAll('.ProseMirror > ol').length === 2`), {
    label: '第 2 项摘出列表',
    timeout: 8000
  });
  const afterSecond = await readBlocks();
  check(
    '第 2 项开头退格：本项变普通段落，不并入上一项',
    afterSecond.includes('"text":"第二项"') && afterSecond.includes('"text":"第一项"'),
    afterSecond
  );
  check(
    '剩下的一项编号续号（restart 3）',
    afterSecond.includes('"start":"3"') && afterSecond.includes('第三项'),
    afterSecond
  );

  await ensureSourceMode();
  await exec(SET_TEXTAREA);
  await exec(`window.__setSource(${JSON.stringify('1. 第一项\n2. 第二项\n3. 第三项\n')}, 0)`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await ensureWysiwygMode();
  await waitFor(() => exec(`document.querySelectorAll('.ProseMirror li').length === 3`), {
    label: '列表还原',
    timeout: 20000
  });
  await caretToListItem(0);
  pressKey('Backspace');
  await waitFor(() => exec(`document.querySelector('.ProseMirror')?.firstElementChild?.tagName?.toLowerCase() === 'p'`), {
    label: '第 1 项摘出列表',
    timeout: 8000
  });
  const afterFirst = await readBlocks();
  check(
    '第 1 项开头退格：列表最前面出现可输入的普通段落',
    afterFirst.startsWith('[{"tag":"p","text":"第一项"}') && afterFirst.includes('"start":"2"'),
    afterFirst
  );
  // 新段落已在文档最前面，直接输入应该写进这个段落
  win.webContents.insertText('新增一行');
  await waitFor(
    () => exec(`(document.querySelector('.ProseMirror')?.firstElementChild?.textContent ?? '').includes('新增一行')`),
    { label: '最前面可输入新内容' }
  );
  check('退回最前面后可以直接输入新内容', true);

  // 空列表项按退格：列表消失，只留一个空段落（不能留下两个空段落）
  await ensureSourceMode();
  await exec(SET_TEXTAREA);
  await exec(`window.__setSource(${JSON.stringify('开头段落\n\n1. \n')}, 0)`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await ensureWysiwygMode();
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror ol li'))`), {
    label: '空列表渲染',
    timeout: 20000
  });
  await caretToListItem(0);
  pressKey('Backspace');
  await waitFor(() => exec(`!document.querySelector('.ProseMirror ol')`), {
    label: '空列表已退出',
    timeout: 8000
  });
  const emptyBlocks = await exec(
    `document.querySelectorAll('.ProseMirror > *').length + '|' + [...document.querySelectorAll('.ProseMirror > *')].map((el) => el.tagName.toLowerCase()).join(',')`
  );
  check('空列表项退格后不留多余空段落', emptyBlocks === '2|p,p', emptyBlocks);

  // ===== 10.10 公式：点击就地编辑 TeX，不再只显示一个蓝色选中框 =====
  console.log('调试-编辑器实例：', await exec(`JSON.stringify({ pm: document.querySelectorAll('.ProseMirror').length, inner: document.querySelectorAll('.editor-inner').length, src: document.querySelectorAll('.source-editor').length })`));
  await ensureSourceMode();
  await exec(SET_TEXTAREA);
  await exec(`window.__setSource(${JSON.stringify('$$\nE = mc^2\n$$\n\n行内 $a^2$ 公式\n')}, 0)`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await ensureWysiwygMode();
  await waitFor(() => exec(`Boolean(document.querySelector('.md-math-block .katex'))`), {
    label: '块级公式渲染',
    timeout: 20000
  });

  const mathInitial = await exec(`(() => {
    const block = document.querySelector('.md-math-block');
    const inline = document.querySelector('.md-math-inline');
    return JSON.stringify({
      blockKatex: Boolean(block && block.querySelector('.katex')),
      inlineKatex: Boolean(inline && inline.querySelector('.katex')),
      outline: block ? getComputedStyle(block).outlineStyle : '',
      editing: Boolean(document.querySelector('.md-math-input:not([style*="display: none"])'))
    });
  })()`);
  check(
    '公式渲染为 KaTeX 且没有选中描边',
    mathInitial.includes('"blockKatex":true') &&
      mathInitial.includes('"inlineKatex":true') &&
      mathInitial.includes('"outline":"none"') &&
      mathInitial.includes('"editing":false'),
    mathInitial
  );

  // 点击块级公式 → 进入编辑，文本框带出原始 TeX
  await clickSelector('.md-math-block', 0);
  const openedTex = await waitFor(
    () =>
      exec(`(() => {
        const input = document.querySelector('.md-math-block .md-math-input');
        if (!input || input.style.display === 'none') return false;
        return input.value;
      })()`),
    { label: '公式进入编辑', timeout: 8000 }
  );
  check('点击公式可进入编辑并带出原始 TeX', openedTex === 'E = mc^2', String(openedTex));
  await waitFor(() => exec(`document.activeElement?.className === 'md-math-input'`), {
    label: '公式文本框获得焦点',
    timeout: 5000
  });

  // 编辑态底部的工具条：左侧帮助文档链接，右侧「确定」提示
  const footerInfo = await exec(`(() => {
    const footer = document.querySelector('.md-math-block .md-math-footer');
    if (!footer || footer.style.display === 'none') return null;
    return JSON.stringify({
      text: footer.textContent ?? '',
      help: Boolean(footer.querySelector('.md-math-help')),
      confirm: Boolean(footer.querySelector('.md-math-confirm'))
    });
  })()`);
  check(
    '公式编辑框底部有帮助文档与确定提示',
    Boolean(footerInfo) &&
      footerInfo.includes('查看帮助文档') &&
      footerInfo.includes('Enter') &&
      footerInfo.includes('"help":true') &&
      footerInfo.includes('"confirm":true'),
    String(footerInfo)
  );

  // 帮助文档链接走系统浏览器打开（替换主进程 shell.openExternal 收集）
  const realOpenForMath = shell.openExternal;
  const mathHelpUrls = [];
  shell.openExternal = async (url) => {
    mathHelpUrls.push(url);
  };
  await exec(`document.querySelector('.md-math-block .md-math-help')?.click()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  check(
    '公式帮助文档链接打开 katex.org',
    mathHelpUrls.some((url) => url.includes('katex.org')),
    JSON.stringify(mathHelpUrls)
  );
  shell.openExternal = realOpenForMath;

  // 改写后点「确定」提交（不依赖失焦）
  await exec(`(() => {
    const input = document.querySelector('.md-math-block .md-math-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, 'x^2 + y^2 = z^2');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await exec(`document.querySelector('.md-math-block .md-math-confirm')?.click()`);
  await waitFor(() => exec(`(document.querySelector('.md-math-block')?.textContent ?? '').includes('x2+y2=z2')`), {
    label: '公式已重新渲染',
    timeout: 8000
  });
  const afterCommit = await exec(`(() => {
    const block = document.querySelector('.md-math-block');
    return JSON.stringify({
      katex: Boolean(block && block.querySelector('.katex')),
      editing: Boolean(document.querySelector('.md-math-input:not([style*="display: none"])')),
      nodeSelected: Boolean(document.querySelector('.ProseMirror-selectednode'))
    });
  })()`);
  check(
    '提交后重新渲染且不残留编辑框 / 选中框',
    afterCommit.includes('"katex":true') &&
      afterCommit.includes('"editing":false') &&
      afterCommit.includes('"nodeSelected":false'),
    afterCommit
  );

  // 编辑器内容回落到 React 状态是 200ms 防抖 + 一次渲染，读源码用轮询而不是死等
  const expectMarkdown = async (needle, label) => {
    await ensureSourceMode();
    let md = '';
    try {
      await waitFor(
        async () => {
          md = String(await exec(READ_SOURCE));
          return md.includes(needle);
        },
        { label, timeout: 8000, interval: 200 }
      );
    } catch {
      md = String(await exec(READ_SOURCE));
    }
    await ensureWysiwygMode();
    return md;
  };

  const mathSource = await expectMarkdown('x^2 + y^2 = z^2', '块级公式写回 Markdown');
  check('块级公式改动写回 Markdown', mathSource.includes('x^2 + y^2 = z^2'), mathSource.slice(0, 60));

  // 行内公式同样可编辑
  await clickSelector('.md-math-inline', 0);
  const inlineTex = await waitFor(
    () =>
      exec(`(() => {
        const input = document.querySelector('.md-math-inline .md-math-input');
        if (!input || input.style.display === 'none') return false;
        return input.value;
      })()`),
    { label: '行内公式进入编辑', timeout: 8000 }
  );
  check('行内公式同样可点击编辑', inlineTex === 'a^2', String(inlineTex));
  await waitFor(() => exec(`document.activeElement?.className === 'md-math-input'`), {
    label: '行内公式文本框获得焦点',
    timeout: 5000
  });
  await exec(`(() => {
    const input = document.querySelector('.md-math-inline .md-math-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, 'n+1');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // 行内公式是单行框：回车即提交（不依赖失焦，避免窗口焦点抖动影响用例）
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  await waitFor(() => exec(`(document.querySelector('.md-math-inline')?.textContent ?? '').includes('n+1n+1')`), {
    label: '行内公式已重新渲染',
    timeout: 8000
  });
  const inlineSource = await expectMarkdown('$n+1$', '行内公式写回 Markdown');
  check('行内公式改动写回 Markdown', inlineSource.includes('$n+1$'), inlineSource.slice(0, 60));
  // 提交时若回车事件漏到编辑器键位链，baseKeymap 的 splitBlock 会把段落从公式后面切开，
  // 源码变成「行内 $n+1$」+ 空行 + 「&#x20;公式」。这里连段落完整性一起断言。
  check(
    '行内公式提交不切开段落',
    inlineSource.includes('行内 $n+1$ 公式') && !inlineSource.includes('&#x20;'),
    JSON.stringify(inlineSource)
  );

  // 从斜杠菜单插入公式后应直接进入编辑，插完就能敲 TeX
  await ensureSourceMode();
  await exec(SET_TEXTAREA);
  await exec(`window.__setSource(${JSON.stringify('正文一段\n')}, 0)`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await ensureWysiwygMode();
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror p'))`), {
    label: '段落渲染',
    timeout: 20000
  });
  await clickSelector('.ProseMirror p', 0);
  await focusEditor();
  win.webContents.insertText('/公式');
  await waitFor(() => exec(`document.querySelectorAll('.slash-item').length === 1`), {
    label: '过滤到公式一项',
    timeout: 8000
  });
  pressKey('Enter');
  const autoOpen = await waitFor(
    () =>
      exec(`(() => {
        const input = document.querySelector('.md-math-block .md-math-input');
        if (!input || input.style.display === 'none') return false;
        return input.value;
      })()`),
    { label: '插入后自动进入编辑', timeout: 8000 }
  );
  check('从菜单插入公式后直接进入编辑', String(autoOpen).length > 0, String(autoOpen));
  // 全选状态直接输入即替换占位内容（等 enter() 的异步聚焦落定后再敲）
  await waitFor(() => exec(`document.activeElement?.className === 'md-math-input'`), {
    label: '公式文本框获得焦点',
    timeout: 5000
  });
  win.webContents.insertText('\\frac{1}{2}');
  await waitFor(
    () => exec(`(document.querySelector('.md-math-block .md-math-input')?.value ?? '').includes('frac')`),
    { label: 'TeX 已键入', timeout: 5000 }
  );
  // 用 ⌘+Enter 提交：不依赖失焦（自动化里焦点会被窗口抢走，blur 时有时无）
  await exec(`(() => {
    const input = document.querySelector('.md-math-block .md-math-input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
    return true;
  })()`);
  await waitFor(() => exec(`(document.querySelector('.md-math-block')?.textContent ?? '').includes('frac')`), {
    label: '插入的公式已渲染',
    timeout: 8000
  });
  const insertSource = await expectMarkdown('\\frac{1}{2}', '插入后输入的公式写回 Markdown');
  check('插入后直接输入的 TeX 被保存', insertSource.includes('\\frac{1}{2}'), insertSource.slice(0, 60));

  // ===== 10.11 块级公式：左对齐；作为最后一块时下方要能接着写 =====
  await resetDoc('正文一段\n\n$$\nE = mc^2\n$$\n');
  await waitFor(() => exec(`Boolean(document.querySelector('.md-math-block .katex'))`), {
    label: '公式渲染（排版用例）',
    timeout: 20000
  });
  const mathLayout = await exec(`(() => {
    const disp = document.querySelector('.md-math-block .katex-display');
    // .katex 是块级、宽度等于整行，量它看不出对齐；量真正的字形盒子
    const atom = document.querySelector('.md-math-block .katex-html .mord');
    const para = document.querySelector('.ProseMirror p');
    const blocks = [...document.querySelector('.ProseMirror').children];
    const tail = blocks[blocks.length - 1];
    return JSON.stringify({
      align: disp ? getComputedStyle(disp).textAlign : '',
      atomLeft: atom ? Math.round(atom.getBoundingClientRect().left) : null,
      paraLeft: para ? Math.round(para.getBoundingClientRect().left) : null,
      tailIsParagraph: Boolean(tail && tail.tagName === 'P')
    });
  })()`);
  const ml = JSON.parse(mathLayout);
  check(
    '块级公式左对齐，与正文同一条左边线',
    ml.align === 'left' && ml.atomLeft !== null && Math.abs(ml.atomLeft - ml.paraLeft) <= 2,
    mathLayout
  );
  check('公式作为最后一块时末尾补出可输入段落', ml.tailIsParagraph === true, mathLayout);

  const belowPoint = JSON.parse(
    await exec(`(() => {
      const r = document.querySelector('.md-math-block').getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + 20), y: Math.round(r.bottom + 14) });
    })()`)
  );
  await clickPoint(belowPoint);
  win.webContents.insertText('公式后面的文字');
  const tailSource = await expectMarkdown('公式后面的文字', '公式下方可继续输入');
  check(
    '点公式下方能继续写正文',
    tailSource.includes('$$\nE = mc^2\n$$\n\n公式后面的文字'),
    JSON.stringify(tailSource)
  );


  // ===== 10.12 查找 / 替换 =====
  await resetDoc('苹果 香蕉 苹果\n\n橘子 苹果\n');
  menuAction('edit:replace');
  await waitFor(() => exec(`Boolean(document.querySelector('[data-find-input="query"]'))`), {
    label: '查找栏打开'
  });
  const barShape = await exec(`(() => {
    return JSON.stringify({
      replaceInput: Boolean(document.querySelector('[data-find-input="replace"]')),
      actions: [...document.querySelectorAll('[data-find-action]')].map((el) => el.textContent),
      label: document.querySelector('.find-label')?.textContent ?? ''
    });
  })()`);
  const bs = JSON.parse(barShape);
  check(
    '查找栏带替换行与替换 / 全部替换按钮',
    bs.replaceInput === true && bs.actions.includes('替换') && bs.actions.includes('全部替换') && bs.label === '查找',
    barShape
  );

  // 命中高亮：只盖住匹配文字，不能是整段选区（这里曾是「回车后一大片高亮」的现场）
  await setControlValue('[data-find-input="query"]', '苹果');
  const hitInfo = await waitFor(
    () =>
      exec(`(() => {
        const hits = [...document.querySelectorAll('.md-find-hit')];
        if (hits.length === 0) return '';
        const sel = document.getSelection();
        return JSON.stringify({
          hits: hits.length,
          texts: hits.map((el) => el.textContent),
          activeHits: document.querySelectorAll('.md-find-hit-active').length,
          selectionLength: sel ? sel.toString().length : 0,
          count: document.querySelector('.find-count')?.textContent ?? ''
        });
      })()`),
    { label: '命中高亮出现', timeout: 8000 }
  );
  const hi = JSON.parse(hitInfo);
  check(
    '命中只高亮匹配文字，不产生整段选区',
    hi.hits === 3 && hi.texts.every((text) => text === '苹果') && hi.selectionLength === 0,
    hitInfo
  );
  check('命中计数与高亮数量一致', hi.count === '1/3' && hi.activeHits === 1, hitInfo);

  // 回车 = 下一个：结果不能消失，焦点留在查找框
  await exec(`document.querySelector('[data-find-input="query"]')?.focus()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  const afterEnter = await waitFor(
    () =>
      exec(`(() => {
        const count = document.querySelector('.find-count')?.textContent ?? '';
        if (count !== '2/3') return '';
        return JSON.stringify({
          count,
          hits: document.querySelectorAll('.md-find-hit').length,
          focus: document.activeElement?.getAttribute('data-find-input') ?? ''
        });
      })()`),
    { label: '回车跳到下一处', timeout: 6000 }
  ).catch(() => '');
  check('回车跳到下一处且结果不消失', String(afterEnter).includes('"count":"2/3"'), String(afterEnter));
  check('跳转后焦点仍在查找框', String(afterEnter).includes('"focus":"query"'), String(afterEnter));

  // 替换当前
  await setControlValue('[data-find-input="replace"]', '梨');
  await exec(`document.querySelector('[data-find-action="replace"]')?.click()`);
  const replacedOne = await waitFor(
    () => exec(`((document.querySelector('.ProseMirror')?.textContent ?? '').match(/苹果/g) ?? []).length === 2`),
    { label: '替换一处' }
  ).catch(() => false);
  check('替换当前命中生效', replacedOne === true, `剩余苹果=${await exec(`((document.querySelector('.ProseMirror')?.textContent ?? '').match(/苹果/g) ?? []).length`)}`);

  // 全部替换
  await exec(`document.querySelector('[data-find-action="replace-all"]')?.click()`);
  const replacedAll = await waitFor(
    () => exec(`!(document.querySelector('.ProseMirror')?.textContent ?? '').includes('苹果')`),
    { label: '全部替换' }
  ).catch(() => false);
  check('全部替换生效', replacedAll === true);

  // 关闭查找栏后高亮要清掉
  await exec(`document.querySelector('.find-close')?.click()`);
  await waitFor(() => exec(`!document.querySelector('.find-bar')`), { label: '查找栏关闭' });
  check(
    '关闭查找栏后高亮全部清除',
    (await exec(`document.querySelectorAll('.md-find-hit').length`)) === 0
  );
  const replacedSource = await expectMarkdown('梨', '替换结果写回文档');
  check(
    '替换结果写回 Markdown',
    replacedSource.includes('梨 香蕉 梨') && replacedSource.includes('橘子 梨'),
    JSON.stringify(replacedSource)
  );

  // 源码模式：同一套查找替换走 Markdown 原文偏移
  await ensureSourceMode();
  menuAction('edit:replace');
  await waitFor(() => exec(`Boolean(document.querySelector('[data-find-input="query"]'))`), {
    label: '源码模式查找栏打开'
  });
  await setControlValue('[data-find-input="query"]', '香蕉');
  const sourceCount = await waitFor(
    () => exec(`document.querySelector('.find-count')?.textContent ?? ''`),
    { label: '源码模式命中计数' }
  );
  check('源码模式能查到命中', sourceCount === '1/1', String(sourceCount));
  await setControlValue('[data-find-input="replace"]', '芒果');
  await exec(`document.querySelector('[data-find-action="replace"]')?.click()`);
  const sourceReplaced = await waitFor(
    () => exec(`(document.querySelector('.source-editor')?.value ?? '').includes('芒果')`),
    { label: '源码模式替换生效' }
  ).catch(() => false);
  check('源码模式替换生效', sourceReplaced === true, String(await exec(`document.querySelector('.source-editor')?.value ?? ''`)));
  await exec(`document.querySelector('.find-close')?.click()`);
  await ensureWysiwygMode();

  // 回车跳转必须真把正文滚到可见：焦点停在查找框时，
  // ProseMirror 自带的 scrollIntoView 会被跳过（计数在变、正文不动）
  const longFiller = Array.from({ length: 80 }, (_, i) => `第 ${i + 1} 段填充文字`).join('\n\n');
  await resetDoc(`脚本开头\n\n${longFiller}\n\n脚本中间\n\n${longFiller}\n\n脚本结尾\n`);
  await exec(`document.querySelector('.editor-scroll').scrollTop = 0`);
  menuAction('edit:find');
  await waitFor(() => exec(`Boolean(document.querySelector('[data-find-input="query"]'))`), {
    label: '长文档查找栏打开'
  });
  await setControlValue('[data-find-input="query"]', '脚本');
  await waitFor(() => exec(`document.querySelectorAll('.md-find-hit').length === 3`), {
    label: '长文档三处命中'
  });
  const scrollBefore = Number(await exec(`document.querySelector('.editor-scroll').scrollTop`));
  await exec(`document.querySelector('[data-find-input="query"]')?.focus()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await waitFor(() => exec(`document.querySelector('.find-count')?.textContent === '2/3'`), {
    label: '长文档跳转到第二处'
  });
  const scrolled = await waitFor(
    () => exec(`document.querySelector('.editor-scroll').scrollTop > ${scrollBefore} + 100`),
    { label: '回车跳转真实滚动正文', timeout: 5000 }
  ).catch(() => false);
  const scrollAfter = Number(await exec(`document.querySelector('.editor-scroll').scrollTop`));
  check('回车跳转会真实滚动正文', scrolled === true, `滚动前=${scrollBefore} 滚动后=${scrollAfter}`);
  const activeVisible = await waitFor(
    () =>
      exec(`(() => {
        const scroller = document.querySelector('.editor-scroll');
        const active = document.querySelector('.md-find-hit-active');
        if (!scroller || !active) return false;
        const a = active.getBoundingClientRect();
        const s = scroller.getBoundingClientRect();
        return a.top >= s.top - 2 && a.bottom <= s.bottom + 2;
      })()`),
    { label: '跳转后当前命中进入视口', timeout: 5000 }
  ).catch(() => false);
  check('跳转后当前命中进入可视区域', activeVisible === true, String(activeVisible));
  await exec(`document.querySelector('.find-close')?.click()`);
  await waitFor(() => exec(`!document.querySelector('.find-bar')`), { label: '长文档查找栏关闭' });

  // ===== 10.13 底部工具栏：与斜杠菜单对齐（图片走文件选择器、链接走表单、块级功能平铺） =====
  // 旧行为：链接 / 图片按钮只插「链接文字」「图片」占位文本，「更多」浮层里还重复放一个代码块。
  const toolbarTitles = JSON.parse(
    await exec(`JSON.stringify([...document.querySelectorAll('.toolbar .tb-btn')].map((b) => b.title))`)
  );
  check(
    '工具栏平铺有序列表 / 任务列表 / 表格 / 公式 / 分割线',
    toolbarTitles.some((t) => t === '有序列表') &&
      toolbarTitles.some((t) => t === '任务列表') &&
      toolbarTitles.some((t) => t.startsWith('表格')) &&
      toolbarTitles.some((t) => t === '公式') &&
      toolbarTitles.some((t) => t === '分割线'),
    toolbarTitles.join(' | ')
  );
  check(
    '工具栏不再有「更多」浮层，代码入口只保留一个代码块按钮',
    !toolbarTitles.includes('更多') &&
      toolbarTitles.filter((t) => t === '代码块').length === 1 &&
      !toolbarTitles.includes('行内代码'),
    toolbarTitles.join(' | ')
  );
  check(
    '原生菜单不再提供图片占位入口',
    !menuHasLabel('插入图片占位') && menuHasLabel('插入图片…'),
    '图像子菜单已合并为「插入图片…」'
  );
  const toolbarFits = JSON.parse(
    await exec(`(() => {
      const bar = document.querySelector('.toolbar').getBoundingClientRect();
      const btns = [...document.querySelectorAll('.toolbar .tb-btn')];
      return JSON.stringify({
        count: btns.length,
        overflow: btns.some((b) => {
          const r = b.getBoundingClientRect();
          return r.right > bar.right + 1 || r.left < bar.left - 1;
        })
      });
    })()`)
  );
  check('新增按钮后工具栏不溢出编辑区', toolbarFits.overflow === false, JSON.stringify(toolbarFits));

  // 段落下拉只放块级文本类型；引用 / 代码块与工具栏、斜杠菜单、原生菜单重复，已删除
  await exec(`document.querySelector('.tb-dd-btn').click()`);
  const paraItems = JSON.parse(
    await exec(`JSON.stringify([...document.querySelectorAll('.tb-menu-item')].map((el) => el.textContent))`)
  );
  check(
    '段落下拉不再重复「引用」「代码块」，只保留正文与标题',
    !paraItems.includes('引用') && !paraItems.includes('代码块') &&
      paraItems.includes('正文') && paraItems.includes('标题 4'),
    paraItems.join('|')
  );
  await exec(`document.querySelector('.tb-dd-btn').click()`);

  /** 按 title 点工具栏按钮（title 是稳定标识，不依赖按钮顺序） */
  const clickToolbar = (title) =>
    exec(`(() => {
      const btn = [...document.querySelectorAll('.toolbar .tb-btn')].find((b) => b.title === ${JSON.stringify(title)});
      if (!btn) return false;
      btn.click();
      return true;
    })()`);

  /** 把光标放进最后一段正文，块级命令才有落点 */
  const caretToLastParagraph = async () => {
    await clickSelector('.ProseMirror > p:last-child');
    await focusEditor();
  };

  // 工具栏「代码块」按钮：空选区点击即把当前段落转成可见代码块，末尾仍补出可输入段落
  await resetDoc('工具栏代码块\n');
  await caretToLastParagraph();
  check('工具栏代码块按钮存在且可点', (await clickToolbar('代码块')) === true);
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror pre'))`), {
    label: '工具栏插入代码块',
    timeout: 12000
  });
  const toolbarCodeLastTag = await exec(
    `document.querySelector('.ProseMirror')?.lastElementChild?.tagName?.toLowerCase() ?? ''`
  );
  check('工具栏代码块按钮插入可见代码块', true);
  check('工具栏代码块后仍补出可输入段落', toolbarCodeLastTag === 'p', `lastTag=${toolbarCodeLastTag}`);

  // 原生菜单「行内代码」：预设命令在空选区返回 false，旧实现点完输入也不带代码样式
  await resetDoc('行内代码测试\n');
  await caretToLastParagraph();
  menuAction('format:code');
  await new Promise((resolve) => setTimeout(resolve, 250));
  win.webContents.insertText('abc');
  await waitFor(
    () => exec(`[...document.querySelectorAll('.ProseMirror code')].some((el) => el.textContent.includes('abc'))`),
    { label: '空选区行内代码生效', timeout: 10000 }
  );
  const inlineCodes = await exec(
    `JSON.stringify([...document.querySelectorAll('.ProseMirror code')].map((el) => el.textContent))`
  );
  check('原生菜单行内代码在空选区下可用（输入即带代码样式）', String(inlineCodes).includes('abc'), String(inlineCodes));

  // 表格：点按钮先弹行列网格（与斜杠菜单一致），不再默认插 3×3
  await resetDoc('工具栏表格\n');
  await caretToLastParagraph();
  const docBeforePick = String(await exec(`document.querySelector('.ProseMirror')?.innerHTML ?? ''`));
  check('表格按钮存在且可点', (await clickToolbar('表格（点击选择行列）')) === true);
  await waitFor(() => exec(`Boolean(document.querySelector('.tb-table-pick'))`), {
    label: '工具栏表格行列网格展开'
  });
  const pickCells = Number(await exec(`document.querySelectorAll('.tb-table-pick-cell').length`));
  check('表格网格为 8 列 × 6 行', pickCells === 48, `cells=${pickCells}`);
  // 只点开网格不能插入任何东西（旧行为是直接插一张 3×3）
  const docAfterPickOpen = String(await exec(`document.querySelector('.ProseMirror')?.innerHTML ?? ''`));
  check(
    '打开行列网格本身不插入表格',
    docAfterPickOpen === docBeforePick && !docAfterPickOpen.includes('<table'),
    `hasTable=${docAfterPickOpen.includes('<table')}`
  );
  // 悬停到「2 行 5 列」：高亮区域与底部文案同步
  await exec(`(() => {
    const cell = document.querySelector('.tb-table-pick-cell[aria-label="2 行 5 列"]');
    if (!cell) return false;
    cell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    return true;
  })()`);
  const pickLabel = await waitFor(
    () =>
      exec(`document.querySelector('.tb-table-pick-label')?.textContent`)
        .then((v) => (v === '2 行 × 5 列' ? v : null)),
    { label: '表格网格文案跟随悬停' }
  ).catch(() => null);
  check('滑过网格时显示所选行列', pickLabel === '2 行 × 5 列', `label=${pickLabel}`);
  await exec(`document.querySelector('.tb-table-pick-cell[aria-label="2 行 5 列"]')?.click()`);
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror table'))`), {
    label: '工具栏按所选行列插入表格',
    timeout: 12000
  });
  const tbShape = JSON.parse(
    await exec(`(() => {
      const table = document.querySelector('.ProseMirror table');
      return JSON.stringify({
        rows: table.querySelectorAll('tr').length,
        cols: table.querySelectorAll('tr:first-child th, tr:first-child td').length,
        pickOpen: Boolean(document.querySelector('.tb-table-pick'))
      });
    })()`)
  );
  check(
    '工具栏按网格选择插入 2 行 × 5 列并收起网格',
    tbShape.rows === 2 && tbShape.cols === 5 && tbShape.pickOpen === false,
    JSON.stringify(tbShape)
  );

  // 公式：块级公式片段应渲染成 KaTeX，而不是一串源码文本
  await resetDoc('工具栏公式\n');
  await caretToLastParagraph();
  await clickToolbar('公式');
  await waitFor(() => exec(`Boolean(document.querySelector('.md-math-block .katex'))`), {
    label: '工具栏插入公式',
    timeout: 15000
  });
  check('工具栏公式按钮插入块级公式', true);

  // 任务列表 / 有序列表：光标所在段落转成对应列表
  await resetDoc('工具栏任务\n');
  await caretToLastParagraph();
  await clickToolbar('任务列表');
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror li[data-item-type="task"]'))`), {
    label: '工具栏插入任务列表',
    timeout: 12000
  });
  check('工具栏任务列表按钮生效', true);

  await resetDoc('工具栏有序\n');
  await caretToLastParagraph();
  await clickToolbar('有序列表');
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror ol'))`), {
    label: '工具栏插入有序列表',
    timeout: 12000
  });
  check('工具栏有序列表按钮生效', true);

  // 链接：弹表单，填入文本与地址后插入真实链接（不再是「链接文字」占位）
  await resetDoc('工具栏链接\n');
  await caretToLastParagraph();
  await clickToolbar('链接 (Cmd/Ctrl+K)');
  await waitFor(() => exec(`Boolean(document.querySelector('.tb-link-form'))`), {
    label: '工具栏链接表单展开'
  });
  await setControlValue('.tb-link-form [data-form="text"]', '工具栏链接');
  await setControlValue('.tb-link-form [data-form="url"]', 'https://example.com/toolbar');
  const linkSubmitEnabled = await exec(`document.querySelector('.tb-link-form .slash-form-submit')?.disabled === false`);
  check('链接地址填写后确定按钮可用', linkSubmitEnabled === true);
  await exec(`document.querySelector('.tb-link-form .slash-form-submit').click()`);
  await waitFor(
    () => exec(`[...document.querySelectorAll('.ProseMirror a')].some((a) => a.getAttribute('href') === 'https://example.com/toolbar')`),
    { label: '工具栏插入真实链接', timeout: 12000 }
  );
  const toolbarLinkText = String(
    await exec(`(() => {
      const a = [...document.querySelectorAll('.ProseMirror a')].find((x) => x.getAttribute('href') === 'https://example.com/toolbar');
      return a ? a.textContent : '';
    })()`)
  );
  check('工具栏链接文本与地址正确', toolbarLinkText === '工具栏链接', toolbarLinkText);
  const linkMarkdown = await expectMarkdown('https://example.com/toolbar', '工具栏链接写回 Markdown');
  check('工具栏链接不再插入占位地址', !linkMarkdown.includes('](url)'), linkMarkdown.slice(0, 90));

  // 菜单「超链接」(Cmd/Ctrl+K)：复用同一个工具栏表单
  menuAction('format:insert-link');
  await waitFor(() => exec(`Boolean(document.querySelector('.tb-link-form'))`), {
    label: '菜单超链接复用工具栏表单'
  });
  check('菜单「超链接」打开同一个链接表单', true);
  await clickToolbar('链接 (Cmd/Ctrl+K)'); // 再点一次收起，避免影响后续用例

  // 图片：点按钮应调起系统文件选择器，而不是插入 ![图片](url) 占位
  await resetDoc('工具栏图片\n');
  await caretToLastParagraph();
  const prevShowOpenDialog = dialog.showOpenDialog;
  let imageDialogCalls = 0;
  dialog.showOpenDialog = async () => {
    imageDialogCalls += 1;
    return { canceled: true, filePaths: [] };
  };
  const beforeImage = String(await exec(`document.querySelector('.ProseMirror')?.textContent ?? ''`));
  await clickToolbar('图片（选择本地文件）');
  await waitFor(() => imageDialogCalls >= 1, { label: '图片按钮调起文件选择器', timeout: 10000 }).catch(() => false);
  dialog.showOpenDialog = prevShowOpenDialog;
  await new Promise((resolve) => setTimeout(resolve, 300));
  const afterImage = String(await exec(`document.querySelector('.ProseMirror')?.textContent ?? ''`));
  check('工具栏图片按钮走文件选择器', imageDialogCalls === 1, `调用 ${imageDialogCalls} 次`);
  check('取消选择后不插入图片占位符', afterImage === beforeImage, JSON.stringify(afterImage));

  // ===== 10.14 任务列表末尾连按两次回车：回到正文，而不是留一个无序列表项 =====
  await resetDoc('- [ ] 第一件事\n- [ ] 第二件事\n');
  await waitFor(
    () => exec(`document.querySelectorAll('.ProseMirror li[data-item-type="task"]').length === 2`),
    { label: '任务列表渲染（回车用例）', timeout: 20000 }
  );
  /** 点进最后一个列表项并把光标推到行尾 */
  const caretToLastItem = async () => {
    await clickSelector('.ProseMirror li:last-child p');
    await focusEditor();
    pressKey('End');
    await new Promise((resolve) => setTimeout(resolve, 150));
  };
  await caretToLastItem();
  pressKey('Return'); // 第一次：拆出一个空的未完成任务项
  await new Promise((resolve) => setTimeout(resolve, 300));
  await caretToLastItem();
  pressKey('Return'); // 第二次：应退出列表、落到列表后的正文段落
  await waitFor(
    () => exec(`(() => {
      const pm = document.querySelector('.ProseMirror');
      if (!pm) return false;
      const tail = pm.lastElementChild;
      return Boolean(tail && tail.tagName.toLowerCase() === 'p' &&
        document.querySelectorAll('.ProseMirror li:not([data-item-type])').length === 0);
    })()`),
    { label: '两次回车后退出为正文段落', timeout: 12000 }
  );
  check('任务列表两次回车不再留下无序列表项', true);
  await focusEditor();
  win.webContents.insertText('回车后直接写字');
  const taskExitMd = await expectMarkdown('回车后直接写字', '回车后正文写回 Markdown');
  check(
    '两次回车后可直接写正文且不留空任务项',
    taskExitMd.includes('- [ ] 第一件事') &&
      taskExitMd.includes('回车后直接写字') &&
      !taskExitMd.includes('- [ ] <br />') &&
      !taskExitMd.includes('\n- <br />'),
    JSON.stringify(taskExitMd.slice(0, 120))
  );

  // ===== 10.15 菜单精简：编辑 / 显示 / 段落三组不再提供已移除的功能 =====
  check('编辑菜单不再有「插入换行符」', !menuHasLabel('插入换行符'));
  check('显示菜单不再有「打字机模式」', !menuHasLabel('打字机模式'));
  check(
    '段落菜单整组表格子菜单已移除',
    !menuHasLabel('表格') && !menuHasLabel('插入 3×3 表格') && !menuHasLabel('删除整个表格')
  );
  // 系统往「编辑」菜单自动追加的三项不在模板里，只能靠系统默认项开关关闭：
  // JS 侧的 Menu 对象看不到它们，这里校验开关确实写入了。
  if (process.platform === 'darwin') {
    const { systemPreferences } = require('electron');
    const disabledKeys = [
      'NSDisabledDictationMenuItem',
      'NSDisabledCharacterPaletteMenuItem',
      'NSDisabledAutoFillMenuItem'
    ];
    check(
      '已关闭系统自动追加的听写 / 表情 / 自动填充菜单项',
      disabledKeys.every((key) => systemPreferences.getUserDefault(key, 'boolean') === true),
      disabledKeys.join(',')
    );
  }

  // ===== 10.16 警告框：插入后选中「内容」占位，直接打字不会把标记挤成正文 =====
  await resetDoc('警告框测试\n');
  await caretToLastParagraph();
  const calloutTitles = JSON.parse(
    await exec(`JSON.stringify([...document.querySelectorAll('.toolbar .tb-btn')].map((b) => b.title))`)
  );
  check('工具栏新增警告框按钮', calloutTitles.includes('警告框'), calloutTitles.join(' | '));
  const calloutOpened = await exec(`(() => {
    const btn = [...document.querySelectorAll('.toolbar .tb-btn')].find((b) => b.title === '警告框');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  const calloutItems = JSON.parse(
    await exec(`JSON.stringify([...document.querySelectorAll('.tb-menu-item')].map((el) => el.textContent))`)
  );
  check(
    '警告框下拉提供 5 种类型',
    calloutOpened === true && calloutItems.length === 5 &&
      calloutItems.some((t) => t.includes('NOTE')) && calloutItems.some((t) => t.includes('CAUTION')),
    calloutItems.join('|')
  );
  await exec(`[...document.querySelectorAll('.tb-menu-item')].find((el) => el.textContent.includes('NOTE'))?.click()`);
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror blockquote.callout-note'))`), {
    label: '工具栏插入警告框',
    timeout: 12000
  });
  const calloutSelection = String(await exec(`window.getSelection()?.toString() ?? ''`));
  check('警告框插入后选中「内容」占位文字', calloutSelection === '内容', JSON.stringify(calloutSelection));
  win.webContents.insertText('77');
  await waitFor(
    () => exec(`document.querySelector('.ProseMirror blockquote')?.textContent.includes('77')`),
    { label: '警告框内直接输入', timeout: 10000 }
  );
  const calloutMd = await expectMarkdown('77', '警告框写回 Markdown');
  check(
    '直接输入的文字不再跑到 [!NOTE] 标记前面',
    calloutMd.indexOf('[!NOTE]') >= 0 &&
      calloutMd.indexOf('[!NOTE]') < calloutMd.indexOf('77') &&
      !calloutMd.includes('77[!NOTE]') &&
      !calloutMd.includes('内容'),
    JSON.stringify(calloutMd.slice(0, 120))
  );
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror blockquote.callout-note'))`), {
    label: '输入后警告框装饰仍生效'
  });
  check('输入后警告框仍按装饰渲染（未退化成普通引用）', true);

  // ===== 10.17 左下角分区线：侧栏底栏与编辑区工具栏的顶边严格对齐 =====
  await exec(`[...document.querySelectorAll('.sidebar-tab')].find((b) => b.textContent.includes('文件'))?.click()`);
  await waitFor(() => exec(`Boolean(document.querySelector('.filetree-footer'))`), { label: '文件面板底栏' });
  const divider = JSON.parse(
    await exec(`(() => {
      const footer = document.querySelector('.filetree-footer');
      const toolbar = document.querySelector('.toolbar');
      if (!footer || !toolbar) return JSON.stringify({ missing: true });
      const a = footer.getBoundingClientRect();
      const b = toolbar.getBoundingClientRect();
      return JSON.stringify({
        footerTop: a.top, toolbarTop: b.top, delta: Math.abs(a.top - b.top),
        footerHeight: a.height, toolbarHeight: b.height
      });
    })()`)
  );
  check('侧栏底栏与工具栏的分区线对齐', divider.delta <= 1, JSON.stringify(divider));

  // ===== 10.18 大纲拖动：标题连同整节内容一起搬到指定位置 =====
  const dragDoc = [
    '# 第一章',
    '正文一',
    '',
    '## 1.1',
    '小节内容',
    '',
    '### 1.1.1',
    '细节 A',
    '',
    '### 1.1.2',
    '细节 B',
    '',
    '## 1.2',
    '小节二',
    '',
    '# 第二章',
    '正文二',
    ''
  ].join('\n');
  await exec(`[...document.querySelectorAll('.sidebar-tab')].find((b) => b.textContent.includes('大纲'))?.click()`);
  await resetDoc(dragDoc);
  await waitFor(() => exec(`document.querySelectorAll('.outline-item').length === 6`), {
    label: '大纲 6 条标题',
    timeout: 12000
  });
  const dragStarted = await exec(`(() => {
    const items = [...document.querySelectorAll('.outline-item')];
    if (items.length !== 6) return false;
    const dt = new DataTransfer();
    window.__outlineDt = dt;
    window.__outlineFrom = items[3];
    window.__outlineTo = items[0];
    window.__outlineFrom.dispatchEvent(
      new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })
    );
    return true;
  })()`);
  check('大纲条目可拖动（dragstart 派发成功）', dragStarted === true);
  await new Promise((resolve) => setTimeout(resolve, 120));
  await exec(`(() => {
    const dt = window.__outlineDt;
    const to = window.__outlineTo;
    const from = window.__outlineFrom;
    const r = to.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 5, clientY: r.top + 2 };
    to.dispatchEvent(new DragEvent('dragover', opts));
    to.dispatchEvent(new DragEvent('drop', opts));
    from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    return true;
  })()`);
  const dragMd = await expectMarkdown('### 1.1.2', '大纲拖动写回 Markdown');
  check(
    '拖动最后一个三级标题把整节搬到文档最前',
    dragMd.indexOf('### 1.1.2') >= 0 &&
      dragMd.indexOf('### 1.1.2') < dragMd.indexOf('# 第一章') &&
      dragMd.indexOf('细节 B') > dragMd.indexOf('### 1.1.2') &&
      dragMd.indexOf('细节 B') < dragMd.indexOf('# 第一章'),
    JSON.stringify(dragMd.slice(0, 140))
  );
  check(
    '拖动后原章节内容不丢失',
    dragMd.includes('### 1.1.1') && dragMd.includes('细节 A') && dragMd.includes('## 1.2') && dragMd.includes('正文二'),
    JSON.stringify(dragMd.slice(0, 140))
  );

  // ===== 10.19 表格行列手柄：点选整行 / 整列后浮出增删工具条 =====
  // 表格后补一段正文：光标落在表外时手柄应隐藏
  const TABLE_HANDLE_DOC =
    '| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n\n表格下方的正文段落。\n';
  await resetDoc(TABLE_HANDLE_DOC);
  await waitFor(() => exec(`document.querySelectorAll('.md-table-col-handle').length === 3`), {
    label: '表格列手柄出现',
    timeout: 15000
  });

  /** 手柄 / 角手柄当前是否可见 */
  const handlesVisibility = () =>
    exec(`(() => {
      const bar = document.querySelector('.md-table-col-bar');
      const rowBar = document.querySelector('.md-table-row-bar');
      const corner = document.querySelector('.md-table-block .md-table-corner');
      if (!bar || !rowBar || !corner) return 'missing';
      const visible = (el) => getComputedStyle(el).visibility === 'visible';
      return JSON.stringify({
        col: visible(bar),
        row: visible(rowBar),
        corner: visible(corner),
        blockClass: document.querySelector('.md-table-block')?.className ?? null,
        blockCount: document.querySelectorAll('.md-table-block').length,
        barCount: document.querySelectorAll('.md-table-col-bar').length,
        hovered: document.querySelector('.md-table-block:hover') !== null,
        pmFocused: document.activeElement?.classList.contains('ProseMirror') === true
      });
    })()`);
  /** 读取表格形状与手柄 / 工具条状态 */
  const tableShape = async () =>
    JSON.parse(
      await exec(`(() => {
        const table = document.querySelector('.ProseMirror table');
        return JSON.stringify({
          rows: table ? table.rows.length : 0,
          cols: table && table.rows[0] ? table.rows[0].cells.length : 0,
          colHandles: document.querySelectorAll('.md-table-col-handle').length,
          rowHandles: document.querySelectorAll('.md-table-row-handle').length,
          selectedCells: document.querySelectorAll('.selectedCell').length,
          toolbarVisible: Boolean(document.querySelector('.md-table-toolbar:not([hidden])'))
        });
      })()`)
    );
  const clickTableHandle = (axis, index) =>
    exec(`(() => {
      const el = document.querySelector('.md-table-${axis}-handle[data-index="${index}"]');
      if (!el) return false;
      el.click();
      return true;
    })()`);
  const clickTableAction = (action) =>
    exec(`(() => {
      const el = document.querySelector('.md-table-toolbar:not([hidden]) .md-table-tool-btn[data-table-action="${action}"]');
      if (!el || el.disabled) return false;
      el.click();
      return true;
    })()`);
  const waitToolbar = () =>
    waitFor(() => exec(`Boolean(document.querySelector('.md-table-toolbar:not([hidden])'))`), {
      label: '表格增删工具条展开'
    });
  const waitCols = (count) =>
    waitFor(() => exec(`document.querySelector('.ProseMirror table')?.rows[0]?.cells.length === ${count}`), {
      label: `列数变为 ${count}`
    });
  const waitRows = (count) =>
    waitFor(() => exec(`document.querySelector('.ProseMirror table')?.rows.length === ${count}`), {
      label: `行数变为 ${count}`
    });

  let shape = await tableShape();
  check(
    '表格渲染出 3 列 / 3 行手柄',
    shape.colHandles === 3 && shape.rowHandles === 3 && shape.rows === 3 && shape.cols === 3,
    JSON.stringify(shape)
  );
  check('未选中时增删工具条保持隐藏', shape.toolbarVisible === false, JSON.stringify(shape));

  // 光标在表外（正文段落）时手柄默认隐藏，不干扰阅读（真实鼠标点击才会移动选区）
  await clickSelector('.ProseMirror > p:last-of-type');
  const hiddenState = JSON.parse(await handlesVisibility());
  check(
    '光标不在表格内时手柄与角手柄默认隐藏',
    hiddenState.col === false && hiddenState.row === false && hiddenState.corner === false,
    JSON.stringify(hiddenState)
  );
  // 鼠标悬停到表格上（或选中行列）时手柄浮现：手柄只是「就近操作」入口，不常驻。
  // 注意：E2E 窗口不一定获得真实 hover 状态，这里断言更关键的「有选区就保持显示」，
  // 悬停路径由 CSS `:hover` 提供，属于纯样式行为。
  await clickTableHandle('col', 0);
  await waitToolbar();
  const awayPoint = await exec(`(() => {
    const p = document.querySelector('.ProseMirror > p:last-of-type');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: Math.round(r.left + 5), y: Math.round(r.top + 5) };
  })()`);
  if (awayPoint) win.webContents.sendInputEvent({ type: 'mouseMove', x: awayPoint.x, y: awayPoint.y });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const keepState = JSON.parse(await handlesVisibility());
  check(
    '选中整列后鼠标移开手柄仍保持显示',
    keepState.col === true && keepState.row === true && keepState.corner === true,
    JSON.stringify(keepState)
  );

  // 整表选中时左上角不能有缺口：角手柄自己收左上圆角，紧邻的第一列 / 第一行手柄必须保持直角，
  // 两者交界要严丝合缝（之前第一列手柄也带了左上圆角，实色手柄带上露出一块白色小缺口）
  const cornerSeam = JSON.parse(
    await exec(`(() => {
      const corner = document.querySelector('.md-table-block .md-table-corner');
      const firstCol = document.querySelector('.md-table-col-bar .md-table-col-handle');
      const firstRow = document.querySelector('.md-table-row-bar .md-table-row-handle');
      if (!corner || !firstCol || !firstRow) return JSON.stringify({ missing: true });
      const c = corner.getBoundingClientRect();
      const col = firstCol.getBoundingClientRect();
      const row = firstRow.getBoundingClientRect();
      return JSON.stringify({
        cornerRadius: getComputedStyle(corner).borderTopLeftRadius,
        colRadius: getComputedStyle(firstCol).borderTopLeftRadius,
        rowRadius: getComputedStyle(firstRow).borderTopLeftRadius,
        seamX: Math.round((col.left - c.right) * 10) / 10,
        seamY: Math.round((row.top - c.bottom) * 10) / 10
      });
    })()`)
  );
  check(
    '整表选中时左上角无缺口（角手柄收圆角、第一列手柄直角且无缝）',
    cornerSeam.missing !== true &&
      cornerSeam.cornerRadius === '4px' &&
      cornerSeam.colRadius === '0px' &&
      cornerSeam.rowRadius === '0px' &&
      Math.abs(cornerSeam.seamX) <= 1 &&
      Math.abs(cornerSeam.seamY) <= 1,
    JSON.stringify(cornerSeam)
  );

  check('可点击第 1 列手柄', (await clickTableHandle('col', 0)) === true);
  await waitToolbar();
  shape = await tableShape();
  check('点列手柄选中整列并浮出增删工具条', shape.selectedCells === 3 && shape.toolbarVisible, JSON.stringify(shape));
  const selectedHandle = await exec(
    `document.querySelector('.md-table-col-handle[data-index="0"]')?.classList.contains('is-selected') === true`
  );
  check('被选中的列手柄高亮', selectedHandle === true);

  // 列选中：插入图标必须是左右方向，且不出现「删除整张表」
  const colToolbar = JSON.parse(
    await exec(`(() => {
      const toolbar = document.querySelector('.md-table-toolbar:not([hidden])');
      const btn = (action) => toolbar?.querySelector('.md-table-tool-btn[data-table-action="' + action + '"]');
      const before = btn('insertBefore');
      const after = btn('insertAfter');
      const removeTable = btn('removeTable');
      const table = document.querySelector('.ProseMirror table');
      const tRect = table.getBoundingClientRect();
      const barRect = toolbar.getBoundingClientRect();
      return JSON.stringify({
        beforeIcon: before ? before.innerHTML : '',
        afterIcon: after ? after.innerHTML : '',
        removeTableHidden: !removeTable || getComputedStyle(removeTable).display === 'none',
        removeTableDisabled: !removeTable || removeTable.disabled === true,
        toolbarCoversTable: barRect.bottom > tRect.top + 1 && barRect.top < tRect.bottom,
        buttons: toolbar ? toolbar.querySelectorAll('.md-table-tool-btn:not([hidden])').length : 0
      });
    })()`)
  );
  check(
    '列选中的插入图标为左右方向',
    colToolbar.beforeIcon.includes('M5 4v16') && colToolbar.afterIcon.includes('M19 4v16'),
    colToolbar.beforeIcon.slice(0, 60)
  );
  check(
    '列选中工具条只有插左 / 插右 / 删除三键',
    colToolbar.buttons === 3,
    String(colToolbar.buttons)
  );
  check('列选中不显示「删除整张表」', colToolbar.removeTableHidden === true, JSON.stringify(colToolbar));
  check('工具条浮在表格上方、不遮挡表格', colToolbar.toolbarCoversTable === false, JSON.stringify(colToolbar));

  check('工具条可在右侧插入一列', (await clickTableAction('insertAfter')) === true);
  await waitCols(4);
  shape = await tableShape();
  check(
    '插列后手柄同步、整格选区收回普通光标',
    shape.cols === 4 && shape.colHandles === 4 && shape.selectedCells === 0 && !shape.toolbarVisible,
    JSON.stringify(shape)
  );

  await clickTableHandle('col', 1);
  await waitToolbar();
  check('工具条可在左侧插入一列', (await clickTableAction('insertBefore')) === true);
  await waitCols(5);
  check('左插后共 5 列且手柄同步', (await tableShape()).colHandles === 5);

  await clickTableHandle('col', 1);
  await waitToolbar();
  check('工具条可删除一列', (await clickTableAction('remove')) === true);
  await waitCols(4);
  check('删列后表格仍有 4 列', (await tableShape()).cols === 4);

  await clickTableHandle('row', 1);
  await waitToolbar();
  shape = await tableShape();
  check('点行手柄选中整行', shape.selectedCells === 4 && shape.toolbarVisible, JSON.stringify(shape));
  const rowIcons = JSON.parse(
    await exec(`(() => {
      const toolbar = document.querySelector('.md-table-toolbar:not([hidden])');
      const btn = (action) => toolbar?.querySelector('.md-table-tool-btn[data-table-action="' + action + '"]');
      const removeTable = btn('removeTable');
      return JSON.stringify({
        beforeIcon: btn('insertBefore')?.innerHTML ?? '',
        afterIcon: btn('insertAfter')?.innerHTML ?? '',
        removeTableHidden: !removeTable || getComputedStyle(removeTable).display === 'none'
      });
    })()`)
  );
  check(
    '行选中的插入图标为上下方向',
    rowIcons.beforeIcon.includes('M4 5h16') && rowIcons.afterIcon.includes('M4 19h16'),
    rowIcons.beforeIcon.slice(0, 60)
  );
  check('行选中不显示「删除整张表」', rowIcons.removeTableHidden === true, JSON.stringify(rowIcons));
  check('工具条可在下方插入一行', (await clickTableAction('insertAfter')) === true);
  await waitRows(4);
  check('插行后行手柄同步为 4', (await tableShape()).rowHandles === 4);

  await clickTableHandle('row', 0);
  await waitToolbar();
  const headerBeforeDisabled = await exec(
    `document.querySelector('.md-table-toolbar:not([hidden]) .md-table-tool-btn[data-table-action="insertBefore"]')?.disabled === true`
  );
  check('表头行禁用「在上方插入行」', headerBeforeDisabled === true);
  check('表头行可删除（首个数据行升级为表头）', (await clickTableAction('remove')) === true);
  await waitRows(3);
  check('删除表头行后表格仍合法', (await tableShape()).rows === 3);

  const handleMd = await expectMarkdown('| a1', '表格手柄操作写回 Markdown');
  const rawRows = handleMd.split('\n').filter((line) => line.trim().startsWith('|'));
  const barCount = (rawRows[0]?.match(/\|/g) ?? []).length;
  check(
    '增行删列写回 Markdown，表格各行仍是相同列数',
    rawRows.length >= 4 && barCount >= 5 && rawRows.every((line) => (line.match(/\|/g) ?? []).length === barCount),
    rawRows.join(' / ')
  );

  // 精简原生菜单后，「删除整个表格」由左上角角手柄 + 工具条提供，不能丢
  const cornerClicked = await exec(`(() => {
    const el = document.querySelector('.md-table-block .md-table-corner');
    if (!el) return false;
    el.click();
    return true;
  })()`);
  check('可点击左上角角手柄', cornerClicked === true);
  await waitToolbar();
  shape = await tableShape();
  check(
    '角手柄选中整张表（全部单元格高亮）',
    shape.selectedCells === 12 && shape.toolbarVisible,
    JSON.stringify(shape)
  );
  const cornerSelected = await exec(
    `document.querySelector('.md-table-block .md-table-corner')?.classList.contains('is-selected') === true`
  );
  check('角手柄本身高亮', cornerSelected === true);
  const wholeToolbar = await exec(`(() => {
    const btn = (action) => document.querySelector('.md-table-toolbar:not([hidden]) .md-table-tool-btn[data-table-action="' + action + '"]');
    return JSON.stringify({
      insertBeforeDisabled: btn('insertBefore')?.disabled === true,
      removeDisabled: btn('remove')?.disabled === true,
      removeTableEnabled: btn('removeTable') && btn('removeTable').disabled === false
    });
  })()`);
  const wholeToolbarState = JSON.parse(wholeToolbar);
  check(
    '整表选中时工具条只保留「删除整张表」',
    wholeToolbarState.insertBeforeDisabled && wholeToolbarState.removeDisabled && wholeToolbarState.removeTableEnabled,
    wholeToolbar
  );
  check('工具条提供「删除整张表」', (await clickTableAction('removeTable')) === true);
  await waitFor(() => exec(`!document.querySelector('.ProseMirror table')`), { label: '整张表被删除' });
  const tableHandlesGone = await exec(
    `document.querySelectorAll('.md-table-handle').length === 0 && !document.querySelector('.md-table-toolbar:not([hidden])')`
  );
  check('删除整张表后手柄与工具条一并收起', tableHandlesGone === true);

  // ===== 10.20 新建文档默认空白（不再预置示例文章），空文档有占位提示 =====
  menuAction('file:new-tab');
  await waitFor(() => exec(`document.querySelector('.tab-active .tab-name')?.textContent === '未命名.md'`), {
    label: '新建标签', timeout: 8000
  });
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror'))`), { label: '新标签编辑器', timeout: 8000 });
  const blankState = JSON.parse(await exec(`(() => {
    const pm = document.querySelector('.ProseMirror');
    const p = pm?.querySelector('p');
    const before = p ? getComputedStyle(p, '::before').content : '';
    return JSON.stringify({ text: pm ? pm.textContent.trim() : '(no editor)', placeholder: before });
  })()`));
  check('新建文档默认为空白', blankState.text === '', `text=${blankState.text.slice(0, 40)}`);
  check(
    '空文档显示占位提示',
    blankState.placeholder.includes('输入正文'),
    `placeholder=${blankState.placeholder}`
  );
  // 帮助菜单按需打开示例，不占用新建文档的空白默认值。
  menuAction('help:markdown-example');
  await waitFor(
    () => exec("document.querySelector('.tab-active .tab-name')?.textContent === 'Markdown 语法示例.md'"),
    { label: '帮助菜单打开 Markdown 示例', timeout: 8000 }
  );
  await ensureSourceMode();
  const helpExample = String(await exec("document.querySelector('.source-editor')?.value ?? ''"));
  check('帮助示例覆盖常用 Markdown 写法', helpExample.includes('**粗体**') && helpExample.includes('- [ ] 未完成任务') && helpExample.includes('x = \\frac{1}{2}'));
  await ensureWysiwygMode();
  const helpExampleClean = await exec("!document.querySelector('.tab-active .tab-dirty')");
  check('帮助示例初次打开保持未修改状态', helpExampleClean === true);
  await exec("window.__helpConfirm = window.confirm; window.confirm = () => true; document.querySelector('.tab-active .tab-close')?.click(); window.confirm = window.__helpConfirm; delete window.__helpConfirm");
  await waitFor(
    () => exec("document.querySelector('.tab-active .tab-name')?.textContent !== 'Markdown 语法示例.md'"),
    { label: '关闭 Markdown 示例标签', timeout: 8000 }
  );

  // 关掉这个干净的空白标签，回到之前的文档
  await exec(`document.querySelector('.tab-active .tab-close')?.click()`);
  await waitFor(
    () => exec(`document.querySelector('.tab-active .tab-name')?.textContent !== '未命名.md'`),
    { label: '关闭空白标签', timeout: 8000 }
  );

  // ===== 10.21 同名标签显示父目录副标题 =====
  const dupA = join(root, 'dup-a');
  const dupB = join(root, 'dup-b');
  mkdirSync(dupA, { recursive: true });
  mkdirSync(dupB, { recursive: true });
  writeFileSync(join(dupA, 'note.md'), '# A 目录的笔记\n', 'utf-8');
  writeFileSync(join(dupB, 'note.md'), '# B 目录的笔记\n', 'utf-8');
  menuAction('file:open-recent-path', join(dupA, 'note.md'));
  await waitFor(
    () => exec(`[...document.querySelectorAll('.tab .tab-name')].some((el) => el.textContent === 'note.md')`),
    { label: '打开第一个同名文件', timeout: 8000 }
  );
  check('单个文件名不显示多余父目录副标题', await exec("document.querySelectorAll('.tab-dir').length === 0") === true);
  menuAction('file:open-recent-path', join(dupB, 'note.md'));
  await waitFor(
    () =>
      exec(
        `[...document.querySelectorAll('.tab .tab-name')].filter((el) => el.textContent === 'note.md').length === 2`
      ),
    { label: '两个同名标签并存', timeout: 8000 }
  );
  const dupDirs = JSON.parse(
    await exec(`JSON.stringify([...document.querySelectorAll('.tab .tab-dir')].map((el) => el.textContent))`)
  );
  check(
    '同名标签显示父目录副标题',
    dupDirs.includes('dup-a/') && dupDirs.includes('dup-b/'),
    JSON.stringify(dupDirs)
  );
  // 关掉两个同名标签（磁盘文件且未改动，不会弹确认）
  for (let i = 0; i < 2; i += 1) {
    await exec(`(() => {
      const tab = [...document.querySelectorAll('.tab')].find((el) => el.querySelector('.tab-name')?.textContent === 'note.md');
      tab?.querySelector('.tab-close')?.click();
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  await waitFor(
    () =>
      exec(
        `[...document.querySelectorAll('.tab .tab-name')].every((el) => el.textContent !== 'note.md')`
      ),
    { label: '同名标签已关闭', timeout: 8000 }
  );

  // ===== 10.22 文件夹搜索：可取消 + 超上限有截断提示 =====
  // 大目录用于「取消」：文件足够多，搜索不会瞬间结束
  const bigDir = join(root, 'search-big');
  mkdirSync(bigDir, { recursive: true });
  for (let i = 0; i < 400; i += 1) {
    writeFileSync(join(bigDir, `big-${String(i).padStart(3, '0')}.md`), `# 文件 ${i}\n\n${'内容行\n'.repeat(100)}`, 'utf-8');
  }
  // IPC 层取消：发出搜索立刻取消，回包必须带 cancelled 标记而不是跑完
  const cancelResult = await exec(`(async () => {
    const promise = window.api.searchFolder({
      root: ${JSON.stringify(bigDir)},
      query: '内容行',
      caseSensitive: false, wholeWord: false, regex: false,
      requestId: 'e2e-cancel-1'
    });
    window.api.cancelSearch('e2e-cancel-1');
    return JSON.stringify(await promise);
  })()`);
  check('搜索可被中途取消（IPC 层）', JSON.parse(cancelResult).cancelled === true, cancelResult.slice(0, 80));
  // 截断提示：超过 50 个文件命中时必须告诉用户结果不完整
  const truncDir = join(root, 'search-trunc');
  mkdirSync(truncDir, { recursive: true });
  for (let i = 0; i < 60; i += 1) {
    writeFileSync(join(truncDir, `t-${String(i).padStart(2, '0')}.md`), `# 截断样例 ${i}\n\n这里有 截断关键词\n`, 'utf-8');
  }
  const truncResult = JSON.parse(
    await exec(`window.api.searchFolder({
      root: ${JSON.stringify(truncDir)},
      query: '截断关键词',
      caseSensitive: false, wholeWord: false, regex: false
    }).then((r) => JSON.stringify({ files: r.files.length, truncated: r.truncated }))`)
  );
  check(
    '命中超上限时结果带截断标记',
    truncResult.truncated === true && truncResult.files === 50,
    JSON.stringify(truncResult)
  );

  const largeFileDir = join(root, 'search-large-file');
  mkdirSync(largeFileDir, { recursive: true });
  writeFileSync(join(largeFileDir, 'oversized.md'), 'large-marker\n' + 'x'.repeat(2 * 1024 * 1024), 'utf-8');
  const largeFileResult = JSON.parse(
    await exec(`window.api.searchFolder({ root: ${JSON.stringify(largeFileDir)}, query: 'large-marker', caseSensitive: false, wholeWord: false, regex: false }).then(JSON.stringify)`)
  );
  check('跳过超限文件时也提示结果可能不完整', largeFileResult.truncated === true && largeFileResult.files.length === 0);
  if (!(await exec("Boolean(document.querySelector('.sidebar-search-btn')?.getClientRects().length)"))) {
    menuAction('view:toggle-sidebar');
  }
  await waitFor(
    () => exec("Boolean(document.querySelector('.sidebar-search-btn')?.getClientRects().length)"),
    { label: '文件夹搜索按钮可见', timeout: 8000 }
  );
  await exec("document.querySelector('.sidebar-search-btn')?.click()");
  await waitFor(() => exec("Boolean(document.querySelector('.search-input'))"), { label: '搜索截断提示面板', timeout: 8000 });
  await typeSearch('截断关键词');
  const truncNotice = await waitFor(
    () => exec("document.querySelector('.search-truncated')?.textContent ?? ''").then((text) => text.includes('结果可能不完整，已截断') ? text : null),
    { label: '搜索界面显示结果截断提示', timeout: 12000 }
  ).catch(() => null);
  check('搜索界面明确告知结果可能不完整', typeof truncNotice === 'string', String(truncNotice));
  await typeSearch('内容行');
  await waitFor(() => exec("Boolean(document.querySelector('.search-cancel'))"), { label: '搜索取消按钮出现', timeout: 3000 });
  await exec("document.querySelector('.search-cancel')?.click()");
  const cancelledNotice = await waitFor(
    () => exec("document.querySelector('.search-status-row')?.textContent.includes('已取消') === true"),
    { label: '搜索取消状态显示', timeout: 3000 }
  ).catch(() => false);
  check('搜索面板的 × 可取消当前请求', cancelledNotice === true);
  await exec("document.querySelector('.search-close')?.click()");

  // ===== 10.23 检查链接与图片 =====
  const linkImgDir = join(root, 'img');
  mkdirSync(linkImgDir, { recursive: true });
  writeFileSync(join(linkImgDir, 'ok.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47])); // 只要求文件存在
  const linkDocPath = join(root, 'linkcheck.md');
  writeFileSync(
    linkDocPath,
    '# 链接检查\n\n正常 [官网](https://example.com)，坏掉 [空链接]()。\n\n![存在](img/ok.png?raw=1#preview)\n\n![丢失](<img/missing image.png?raw=1#preview>)\n',
    'utf-8'
  );
  menuAction('file:open-recent-path', linkDocPath);
  await waitFor(
    () => exec(`document.querySelector('.tab-active .tab-name')?.textContent === 'linkcheck.md'`),
    { label: '打开链接检查文档', timeout: 8000 }
  );
  menuAction('file:check-doc-links');
  await waitFor(() => exec("Boolean(document.querySelector('.check-doc'))"), { label: '所见即所得检查结果', timeout: 8000 });
  const wysiwygIssueCount = await exec("document.querySelectorAll('.check-doc-item').length");
  const wysiwygStillClean = await exec("!document.querySelector('.tab-active .tab-dirty')");
  check('所见即所得模式只读诊断不修改文档', wysiwygIssueCount === 2 && wysiwygStillClean === true);
  await exec("document.querySelector('.check-doc-close')?.click()");
  await ensureSourceMode();
  menuAction('file:check-doc-links');
  await waitFor(() => exec("Boolean(document.querySelector('.check-doc'))"), { label: '源码模式检查结果', timeout: 8000 });
  const issueSummary = JSON.parse(
    await exec(`JSON.stringify({
      count: document.querySelectorAll('.check-doc-item').length,
      kinds: [...document.querySelectorAll('.check-doc-kind')].map((el) => el.textContent)
    })`)
  );
  check(
    '空链接与失效图片各报一条（忽略有效图片的查询参数）',
    issueSummary.count === 2 && issueSummary.kinds.includes('空链接') && issueSummary.kinds.includes('图片丢失'),
    JSON.stringify(issueSummary)
  );
  check('只读诊断不把干净文档标记为已修改', await exec("!document.querySelector('.tab-active .tab-dirty')") === true);
  // 点击条目跳转到对应行（源码模式选中文本）并关闭对话框
  await exec(`document.querySelector('.check-doc-item')?.click()`);
  const jumped = await waitFor(
    () =>
      exec(`(() => {
        const ta = document.querySelector('.source-editor');
        const gone = !document.querySelector('.check-doc');
        return gone && ta && ta.selectionEnd > ta.selectionStart ? true : null;
      })()`),
    { label: '点击问题跳转并关闭对话框', timeout: 8000 }
  ).catch(() => null);
  check('点击检查结果跳转对应行并关闭对话框', jumped === true, String(jumped));
  // 关掉该标签（有路径且自动保存已覆盖内容，不会弹确认）
  await exec(`document.querySelector('.tab-active .tab-close')?.click()`);
  await waitFor(
    () => exec(`document.querySelector('.tab-active .tab-name')?.textContent !== 'linkcheck.md'`),
    { label: '关闭链接检查标签', timeout: 8000 }
  );

  const untitledBeforeRelativeCheck = await exec("[...document.querySelectorAll('.tab .tab-name')].filter((el) => el.textContent === '未命名.md').length");
  menuAction('file:new-tab');
  await waitFor(() => exec("document.querySelector('.tab-active .tab-name')?.textContent === '未命名.md'"), { label: '新建未保存诊断文档', timeout: 8000 });
  await resetDoc('![尚未保存](img/not-saved.png)');
  menuAction('file:check-doc-links');
  await waitFor(() => exec("Boolean(document.querySelector('.check-doc'))"), { label: '未保存文档图片诊断', timeout: 8000 });
  const uncheckableImageState = JSON.parse(await exec("JSON.stringify({ count: document.querySelectorAll('.check-doc-item').length, note: document.querySelector('.check-doc-note')?.textContent ?? '' })"));
  check('未保存文档的相对图片显示为未检查，不误报丢失', uncheckableImageState.count === 0 && uncheckableImageState.note.includes('1 张相对路径图片尚未检查'), JSON.stringify(uncheckableImageState));
  await exec("document.querySelector('.check-doc-close')?.click()");
  await exec("window.__previousConfirm = window.confirm; window.confirm = () => true; document.querySelector('.tab-active .tab-close')?.click(); window.confirm = window.__previousConfirm; delete window.__previousConfirm");
  await waitFor(() => exec("[...document.querySelectorAll('.tab .tab-name')].filter((el) => el.textContent === '未命名.md').length === " + String(untitledBeforeRelativeCheck)), { label: '关闭未保存诊断标签', timeout: 8000 });

  // ===== 10.24 Markdown 往返保真矩阵：一轮「解析 → 编辑 → 序列化」不改变原文 =====
  // 夹具按编辑器序列化器的归一化形式书写（- 列表、| -- | 分隔线），
  // 目标是恒等往返；任何差异都意味着用户原文被悄悄改写。
  const ROUNDTRIP_DOC = [
    '---',
    'title: 往返测试',
    '---',
    '',
    '# 一级标题',
    '',
    '## 二级标题',
    '',
    '正文段落，含 **加粗**、*斜体*、`行内代码`、~~删除线~~、<u>下划线</u> 与 [链接](https://example.com)。',
    '',
    '![图片](img/pic.png)',
    '',
    '- 无序项一',
    '- 无序项二',
    '  - 嵌套项',
    '',
    '1. 有序项一',
    '2. 有序项二',
    '',
    '- [ ] 未完成任务',
    '- [x] 已完成任务',
    '',
    '> 引用段落',
    '>',
    '> 第二行',
    '',
    '> [!NOTE]',
    '> 提示框内容',
    '',
    '```js',
    'const a = 1;',
    '```',
    '',
    '| 列一 | 列二 |',
    '| -- | -- |',
    '| a  | b  |',
    '',
    '行内公式 $E=mc^2$ 结尾。',
    '',
    '$$',
    'x = \\frac{1}{2}',
    '$$',
    '',
    '[TOC]',
    '',
    '脚注引用[^1]。',
    '',
    '[^1]: 脚注内容',
    '',
    '---',
    '',
    '末尾段落。',
    ''
  ].join('\n');
  const roundtripPath = join(root, 'roundtrip.md');
  writeFileSync(join(root, 'img', 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(roundtripPath, ROUNDTRIP_DOC, 'utf-8');
  menuAction('file:open-recent-path', roundtripPath);
  await waitFor(
    () => exec("document.querySelector('.tab-active .tab-name')?.textContent === 'roundtrip.md'"),
    { label: '从磁盘打开 Markdown 往返夹具', timeout: 8000 }
  );
  await ensureWysiwygMode();
  const caretReady = await exec("(() => { const ps = [...document.querySelectorAll('.ProseMirror p')]; const p = ps.find((item) => item.textContent.includes('末尾段落。')); const editor = document.querySelector('.ProseMirror'); if (!p || !editor) return false; const node = p.lastChild; if (!node || typeof node.textContent !== 'string') return false; editor.focus(); const range = document.createRange(); range.setStart(node, node.textContent.length); range.collapse(true); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return document.activeElement === editor && selection.anchorNode === node; })()");
  check('往返夹具在所见即所得模式打开且光标位于末尾', caretReady === true);
  win.webContents.insertText(' 本轮编辑。');
  await waitFor(
    () => exec("[...document.querySelectorAll('.ProseMirror p')].find((item) => item.textContent.includes('末尾段落。'))?.textContent.includes('本轮编辑。') === true"),
    { label: '往返夹具真实编辑', timeout: 8000 }
  );
  await ensureSourceMode();
  const roundtripOut = await exec("document.querySelector('.source-editor').value");
  const expectedRoundtrip = ROUNDTRIP_DOC.replace('末尾段落。', '末尾段落。 本轮编辑。');
  if (roundtripOut === expectedRoundtrip) {
    check('往返保真：打开、编辑、切源码后完整语法逐字节保留', true);
  } else {
    const a = expectedRoundtrip.split('\n');
    const b = String(roundtripOut).split('\n');
    let first = -1;
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if (a[i] !== b[i]) { first = i; break; }
    }
    check(
      '往返保真：打开、编辑、切源码后完整语法逐字节保留',
      false,
      '首个差异行 ' + (first + 1) + '：期望 ' + JSON.stringify(a[first]) + ' 实际 ' + JSON.stringify(b[first])
    );
  }
  check(
    '往返编辑标记为未保存',
    await exec("Boolean(document.querySelector('.tab-active .tab-dirty'))") === true
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  const matrixHtml = join(root, 'roundtrip.html');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: matrixHtml });
  menuAction('file:export-html');
  const exportedMatrix = await waitFor(
    () => (existsSync(matrixHtml) ? readFileSync(matrixHtml, 'utf-8') : null),
    { label: '往返矩阵导出 HTML', timeout: 15000 }
  ).catch(() => null);
  check(
    '往返导出 HTML 保留标题、粗体、表格与本轮编辑',
    typeof exportedMatrix === 'string' &&
      /<h1(?:\s[^>]*)?>一级标题<\/h1>/.test(exportedMatrix) &&
      exportedMatrix.includes('<strong>加粗</strong>') &&
      exportedMatrix.includes('<table>') &&
      exportedMatrix.includes('本轮编辑。'),
    typeof exportedMatrix === 'string' ? exportedMatrix.slice(0, 120) : String(exportedMatrix)
  );
  await ensureWysiwygMode();

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

  // ===== 12. 窗口标题栏与日志 =====
  // 标题要跟着当前文档走（文件名 + 未保存状态），否则多窗口互相认不出
  await ensureSourceMode();
  await exec(`window.__setSource(${JSON.stringify('# 标题同步用例\n\n这里有一处改动\n')}, 0)`);
  await new Promise((resolve) => setTimeout(resolve, 400));

  const tabState = JSON.parse(
    await exec(
      `JSON.stringify((() => {
        const tab = document.querySelector('.tab-active');
        return {
          name: tab?.querySelector('.tab-name')?.textContent ?? '',
          dirty: Boolean(tab?.querySelector('.tab-dirty'))
        };
      })())`
    )
  );
  const titleSynced = await waitFor(
    async () => {
      const title = win.getTitle();
      return tabState.name && (title === tabState.name || title === `• ${tabState.name}`) ? title : null;
    },
    { timeout: 5000, interval: 100, label: '窗口标题同步' }
  ).catch(() => null);
  check(
    '窗口标题显示当前文档名',
    Boolean(titleSynced) && tabState.name.length > 0,
    `title="${win.getTitle()}" tab="${tabState.name}"`
  );

  if (process.platform === 'darwin') {
    // macOS 用原生「已编辑」小圆点而不是改标题文字
    check(
      'macOS 已编辑状态同步到标题栏',
      win.isDocumentEdited() === tabState.dirty,
      `isDocumentEdited=${win.isDocumentEdited()} dirty=${tabState.dirty}`
    );
  } else {
    check(
      '未保存时标题带 • 前缀',
      tabState.dirty ? win.getTitle().startsWith('• ') : !win.getTitle().startsWith('• '),
      `title="${win.getTitle()}" dirty=${tabState.dirty}`
    );
  }
  await ensureWysiwygMode();

  // 日志落盘：启动与生命周期事件要能在日志文件里查到，用户报问题时才有据可依
  const logFile = join(LOG_DIR, 'main.log');
  const logReady = await waitFor(() => (existsSync(logFile) ? readFileSync(logFile, 'utf-8') : null), {
    timeout: 5000,
    interval: 150,
    label: '主进程日志生成'
  }).catch(() => null);
  check('主进程日志写入日志目录', typeof logReady === 'string' && logReady.includes('应用启动'), `log=${logFile}`);

  // ===== 18. 标签右键菜单 / 恢复关闭的标签 / 自动保存开关 =====
  // 单开一个窗口做破坏性用例（批量关闭），不影响主窗口前面用例留下的标签
  const knownWindowIds = new Set(BrowserWindow.getAllWindows().map((item) => item.id));
  menuAction('file:new-window');
  const ctxWin = await waitFor(
    () =>
      BrowserWindow.getAllWindows().find((item) => !item.isDestroyed() && !knownWindowIds.has(item.id)) ?? null,
    { label: '标签菜单测试窗口', timeout: 20000 }
  );
  const winAction = (target, action, payload) => {
    target.webContents.send('menu:action', payload === undefined ? { action } : { action, payload });
  };
  await waitFor(() => execIn(ctxWin, `Boolean(document.querySelector('.app'))`), {
    label: '标签菜单测试窗口渲染',
    timeout: 20000
  });
  // 等会话把上次的文档恢复完，避免恢复中的标签与右键操作竞争
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const ctxFiles = ['ctx-a.md', 'ctx-b.md', 'ctx-c.md'];
  for (const name of ctxFiles) {
    const filePath = join(root, name);
    writeFileSync(filePath, `# ${name}\n\n正文\n`, 'utf-8');
    winAction(ctxWin, 'file:open-recent-path', filePath);
    await waitFor(
      () => execIn(ctxWin, `[...document.querySelectorAll('.tab-name')].some((el) => el.textContent === ${JSON.stringify(name)})`),
      { label: `打开 ${name}`, timeout: 15000 }
    );
  }

  // 右键中间那个标签：菜单要能弹出并包含批量关闭项
  const contextOpened = await execIn(
    ctxWin,
    `(() => {
      const tab = [...document.querySelectorAll('.tab')].find((el) => el.textContent.includes('ctx-b.md'));
      if (!tab) return false;
      const rect = tab.getBoundingClientRect();
      tab.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: Math.round(rect.left + 10), clientY: Math.round(rect.top + rect.height / 2)
      }));
      return true;
    })()`
  );
  await waitFor(() => execIn(ctxWin, `Boolean(document.querySelector('.tab-context-menu'))`), {
    label: '标签右键菜单弹出'
  }).catch(() => undefined);
  const ctxLabels = await execIn(
    ctxWin,
    `[...document.querySelectorAll('.tab-context-item')].map((el) => el.querySelector('span')?.textContent ?? '')`
  );
  const ctxLabelsOk =
    contextOpened === true &&
    ['关闭', '关闭其他标签', '关闭左侧标签', '关闭右侧标签', '复制文件路径', '复制文件名', '在文件管理器中显示'].every(
      (label) => ctxLabels.includes(label)
    );
  check('标签右键菜单包含批量关闭与复制项', ctxLabelsOk, JSON.stringify(ctxLabels));

  // 关闭其他：只剩被右键的那个，且它成为活动标签
  await execIn(
    ctxWin,
    `[...document.querySelectorAll('.tab-context-item')].find((el) => el.textContent.includes('关闭其他标签')).click()`
  );
  const afterCloseOthers = await waitFor(
    () =>
      execIn(
        ctxWin,
        `(() => {
          const tabs = [...document.querySelectorAll('.tab')];
          return tabs.length === 1 ? tabs[0].querySelector('.tab-name').textContent : null;
        })()`
      ),
    { label: '关闭其他标签', timeout: 15000 }
  ).catch(() => null);
  check('关闭其他标签后只剩被右键的标签', afterCloseOthers === 'ctx-b.md', String(afterCloseOthers));

  // 关闭后能用「重新打开关闭的标签」找回
  winAction(ctxWin, 'file:close-tab');
  await waitFor(() => execIn(ctxWin, `document.querySelectorAll('.tab').length === 1`), {
    label: '关闭 ctx-b 标签',
    timeout: 15000
  });
  winAction(ctxWin, 'file:reopen-closed-tab');
  const reopened = await waitFor(
    () =>
      execIn(
        ctxWin,
        `(() => {
          const names = [...document.querySelectorAll('.tab-name')].map((el) => el.textContent);
          return names.includes('ctx-b.md') ? names.join('|') : null;
        })()`
      ),
    { label: '重新打开关闭的标签', timeout: 15000 }
  ).catch(() => null);
  check('重新打开关闭的标签恢复原文档', typeof reopened === 'string' && reopened.includes('ctx-b.md'), String(reopened));

  // 自动保存开关：关掉后编辑不落盘，恢复后按间隔写盘
  const autoSwitchPath = join(root, 'auto-switch.md');
  writeFileSync(autoSwitchPath, '# 开关\n\n原始内容\n', 'utf-8');
  winAction(ctxWin, 'file:open-recent-path', autoSwitchPath);
  await waitFor(
    () => execIn(ctxWin, `document.querySelector('.tab-active .tab-name')?.textContent === 'auto-switch.md'`),
    { label: '打开自动保存开关用例', timeout: 15000 }
  );
  winAction(ctxWin, 'file:set-auto-save', '0');
  winAction(ctxWin, 'view:toggle-mode');
  await waitFor(() => execIn(ctxWin, `Boolean(document.querySelector('.source-editor'))`), { label: '切到源码模式' });
  await execIn(ctxWin, SET_TEXTAREA);
  await execIn(ctxWin, `window.__setSource('# 开关\\n\\n关闭后不该落盘\\n')`);
  await new Promise((resolve) => setTimeout(resolve, 2400));
  const offDisk = readFileSync(autoSwitchPath, 'utf-8');
  check('关闭自动保存后编辑不写盘', offDisk.includes('原始内容'), JSON.stringify(offDisk));

  winAction(ctxWin, 'file:set-auto-save', '1500');
  const onDisk = await waitFor(
    () => {
      const text = readFileSync(autoSwitchPath, 'utf-8');
      return text.includes('关闭后不该落盘') ? text : null;
    },
    { label: '恢复自动保存后写盘', timeout: 8000 }
  ).catch(() => null);
  check('恢复自动保存后按间隔写盘', onDisk !== null, String(onDisk));

  // 收尾：关掉测试窗口，别让它留在 Dock / 任务栏上
  ctxWin.close();
  await waitFor(() => (ctxWin.isDestroyed() ? true : null), { label: '关闭标签菜单测试窗口', timeout: 15000 });


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

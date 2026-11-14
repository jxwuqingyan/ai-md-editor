/**
 * 表格行列手柄诊断（不进 npm test）：
 * node test/run-e2e.cjs table-handles-debug.cjs
 *
 * 关注：插入 3×3 表格后，列头 / 行首手柄数量、点选后的整格选中与工具条、
 * 「在前 / 在后插入 / 删除」是否真的改变行列数并写回 Markdown。
 */
const { app, BrowserWindow } = require('electron');
const { mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const PROFILE_DIR = join(tmpdir(), 'md-note-e2e-profile');
rmSync(PROFILE_DIR, { recursive: true, force: true });
mkdirSync(PROFILE_DIR, { recursive: true });
app.setPath('userData', PROFILE_DIR);
writeFileSync(
  join(PROFILE_DIR, 'settings.json'),
  JSON.stringify(
    {
      themeId: 'light',
      sidebarOpen: false,
      sidebarPanel: 'outline',
      tabbarVisible: false,
      toolbarVisible: true,
      zoomPercent: 100,
      windowBounds: null
    },
    null,
    2
  ),
  'utf-8'
);
require('../out/main/index.js');

async function waitFor(fn, { timeout = 15000, interval = 120, label = '条件' } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error(`等待超时：${label}`);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

const getWindow = () => BrowserWindow.getAllWindows()[0] ?? null;
const exec = (code) => getWindow().webContents.executeJavaScript(code, true);
const menuAction = (action) => getWindow().webContents.send('menu:action', { action });
const isSource = () => exec(`Boolean(document.querySelector('.source-editor'))`);

async function ensureSource() {
  if (!(await isSource())) {
    menuAction('view:toggle-mode');
    await waitFor(isSource, { label: '进入源码模式' });
  }
}

async function ensureWysiwyg() {
  if (await isSource()) {
    menuAction('view:toggle-mode');
    await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror'))`), { label: '切回 WYSIWYG' });
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function setMarkdown(md) {
  await ensureSource();
  await exec(`(() => {
    const ta = document.querySelector('.source-editor');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(md)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 350));
  await ensureWysiwyg();
}

const state = () =>
  exec(`(() => {
    const table = document.querySelector('.ProseMirror table');
    const block = document.querySelector('.md-table-block');
    const bar = document.querySelector('.md-table-toolbar');
    return JSON.stringify({
      table: Boolean(table),
      rows: table ? table.rows.length : 0,
      cols: table && table.rows[0] ? table.rows[0].cells.length : 0,
      colHandles: document.querySelectorAll('.md-table-col-handle').length,
      rowHandles: document.querySelectorAll('.md-table-row-handle').length,
      selectedCells: document.querySelectorAll('.selectedCell').length,
      toolbarHidden: bar ? bar.hidden : null,
      toolbarButtons: bar ? [...bar.querySelectorAll('button')].map((b) => b.dataset.tableAction + (b.disabled ? '(禁用)' : '')) : [],
      hasSelectionClass: block ? block.classList.contains('md-table-has-selection') : false
    });
  })()`);

const clickHandle = (axis, index) =>
  exec(`(() => {
    const el = document.querySelector('.md-table-${axis}-handle[data-index="${index}"]');
    if (!el) return false;
    el.click();
    return true;
  })()`);

const clickAction = (action) =>
  exec(`(() => {
    const el = document.querySelector('.md-table-tool-btn[data-table-action="${action}"]');
    if (!el || el.disabled) return false;
    el.click();
    return true;
  })()`);

const readMarkdown = async () => {
  await ensureSource();
  const md = await exec(`document.querySelector('.source-editor').value`);
  await ensureWysiwyg();
  return md;
};

const TABLE = '| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n';

setTimeout(() => {
  console.error('诊断超时，强制退出');
  app.exit(2);
}, 90000).unref();

(async () => {
  console.log('诊断开始');
  await waitFor(() => getWindow(), { label: '窗口创建' });
  console.log('窗口已创建');
  await exec(`(() => {
    window.__errs = [];
    window.addEventListener('error', (e) => window.__errs.push('error: ' + e.message + ' @' + e.lineno));
    window.addEventListener('unhandledrejection', (e) => window.__errs.push('reject: ' + String(e.reason)));
    return true;
  })()`);
  try {
    getWindow().show();
    getWindow().focus();
  } catch {}
  await waitFor(() => exec(`Boolean(document.querySelector('.app'))`), { label: 'React 挂载' });
  await new Promise((resolve) => setTimeout(resolve, 700));
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror'))`), { label: '编辑器启动' });
  await setMarkdown(TABLE);
  await waitFor(async () => (await state()).includes('"rows":3'), { label: '表格渲染' });
  console.log('① 初始      ', await state());

  console.log('点第 1 列   ', await clickHandle('col', 0));
  await new Promise((resolve) => setTimeout(resolve, 300));
  console.log('② 选中整列  ', await state());
  console.log('   渲染层异常', await exec(`JSON.stringify(window.__errs)`));
  // 选中态截图：检查列头 / 行首手柄与浮动工具条的实际位置
  const shot = await getWindow().webContents.capturePage();
  mkdirSync('/tmp/md-note-shots', { recursive: true });
  writeFileSync('/tmp/md-note-shots/table-handles.png', shot.toPNG());

  console.log('后插一列    ', await clickAction('insertAfter'));
  await new Promise((resolve) => setTimeout(resolve, 400));
  console.log('③ 插入后    ', await state());

  console.log('点第 2 列   ', await clickHandle('col', 1));
  await new Promise((resolve) => setTimeout(resolve, 250));
  console.log('前插一列    ', await clickAction('insertBefore'));
  await new Promise((resolve) => setTimeout(resolve, 400));
  console.log('④ 前插后    ', await state());

  console.log('点第 2 列   ', await clickHandle('col', 1));
  await new Promise((resolve) => setTimeout(resolve, 250));
  console.log('删除一列    ', await clickAction('remove'));
  await new Promise((resolve) => setTimeout(resolve, 400));
  console.log('⑤ 删除列后  ', await state());

  console.log('点第 2 行   ', await clickHandle('row', 1));
  await new Promise((resolve) => setTimeout(resolve, 250));
  console.log('⑥ 选中整行  ', await state());
  console.log('下插一行    ', await clickAction('insertAfter'));
  await new Promise((resolve) => setTimeout(resolve, 400));
  console.log('⑦ 插入行后  ', await state());

  console.log('点表头行    ', await clickHandle('row', 0));
  await new Promise((resolve) => setTimeout(resolve, 250));
  console.log('⑧ 表头选中  ', await state());
  console.log('删除表头行  ', await clickAction('remove'));
  await new Promise((resolve) => setTimeout(resolve, 400));
  console.log('⑨ 删表头后  ', await state());

  console.log('⑩ Markdown  ', JSON.stringify((await readMarkdown()).slice(0, 220)));
  app.exit(0);
})().catch((err) => {
  console.error('诊断异常：', err);
  app.exit(1);
});

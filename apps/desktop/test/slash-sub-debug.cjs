/**
 * 斜杠菜单「表格」二级行列网格诊断（不进 npm test）：
 * node test/run-e2e.cjs slash-sub-debug.cjs
 *
 * 交互约定：悬停不做任何事；点行尾的 › 才展开网格，再点一次收起；
 * 网格展开后点任意格子按该行列插入表格。
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
      toolbarVisible: false,
      zoomPercent: 100,
      windowBounds: null
    },
    null,
    2
  ),
  'utf-8'
);
require('../out/main/index.js');

const OUT_DIR = '/tmp/md-note-shots';

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

function exec(code) {
  const win = getWindow();
  if (!win) throw new Error('窗口不存在');
  return win.webContents.executeJavaScript(code, true);
}

const menuAction = (action) => getWindow().webContents.send('menu:action', { action });

const click = async (point) => {
  const win = getWindow();
  win.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 250));
};

const hover = async (point) => {
  getWindow().webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
  await new Promise((resolve) => setTimeout(resolve, 400));
};

/** 菜单里「表格」行 / 行尾箭头 / 某个格子的坐标 */
const points = () =>
  exec(`(() => {
    const find = (kw) =>
      [...document.querySelectorAll('.slash-item, .slash-grid-item')].find((el) => (el.textContent ?? '').includes(kw));
    const center = (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    };
    const table = find('表格');
    const arrow = table && table.querySelector('.slash-item-arrow');
    const cell = document.querySelector('.slash-sub-cell[data-sub-r="2"][data-sub-c="5"]');
    return JSON.stringify({
      table: table ? center(table) : null,
      arrow: arrow ? center(arrow) : null,
      cell: cell ? center(cell) : null
    });
  })()`);

const subState = () =>
  exec(`(() => {
    const sub = document.querySelector('.slash-sub');
    if (!sub) return JSON.stringify({ exists: false });
    const shown = getComputedStyle(sub).display !== 'none';
    const r = sub.getBoundingClientRect();
    const menu = document.querySelector('.slash-menu')?.getBoundingClientRect();
    return JSON.stringify({
      exists: true,
      shown,
      label: sub.querySelector('.slash-sub-label')?.textContent ?? '',
      rect: shown ? { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width) } : null,
      noOverlapWithMenu: menu ? r.right <= menu.left || r.left >= menu.right : null
    });
  })()`);

async function openMenu() {
  const p = await exec(`(() => {
    const el = document.querySelector('.ProseMirror p');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) };
  })()`);
  await click(p);
  await exec(`document.querySelector('.ProseMirror')?.focus()`);
  getWindow().webContents.insertText('/');
  await waitFor(() => exec(`Boolean(document.querySelector('.slash-menu'))`), { label: '菜单弹出' });
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  await waitFor(() => getWindow(), { label: '窗口创建' });
  await waitFor(() => exec(`Boolean(document.querySelector('.app'))`), { label: 'React 挂载' });
  await new Promise((resolve) => setTimeout(resolve, 700));

  await menuAction('view:toggle-mode');
  await waitFor(() => exec(`Boolean(document.querySelector('.source-editor'))`), { label: '源码模式' });
  await exec(`(() => {
    const ta = document.querySelector('.source-editor');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '正文一段\\n');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  await menuAction('view:toggle-mode');
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror'))`), { label: '切回 WYSIWYG' });
  await new Promise((resolve) => setTimeout(resolve, 250));

  await openMenu();
  let pt = JSON.parse(await points());
  console.log('菜单已打开；表格行坐标：', pt.table, '箭头坐标：', pt.arrow);

  await exec(`window.__subLog = []`);
  await hover(pt.table);
  console.log('① 悬停表格行后：', await subState(), '（期望 shown=false）');

  await click(pt.arrow);
  console.log('  日志：', await exec(`JSON.stringify(window.__subLog ?? [])`));
  console.log('② 点击箭头后：', await subState(), '（期望 shown=true）');
  { const img = await getWindow().webContents.capturePage(); writeFileSync(join(OUT_DIR, 'slash-sub-open.png'), img.toPNG()); }

  pt = JSON.parse(await points());
  await hover(pt.cell);
  console.log('③ 悬停 2×5 格子后文案：', await exec(`document.querySelector('.slash-sub-label')?.textContent ?? ''`), '（期望 2 行 × 5 列）');

  await click(pt.cell);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const table = await exec(`(() => {
    const t = document.querySelector('.ProseMirror table');
    return t ? t.querySelectorAll('tr').length + ' 行 × ' + t.querySelector('tr').children.length + ' 列' : '未插入';
  })()`);
  console.log('④ 点击格子后插入的表格：', table, '（期望 2 行 × 5 列）');

  // 再验证一次「点箭头展开 → 再点箭头收起」
  await openMenu();
  pt = JSON.parse(await points());
  await click(pt.arrow);
  console.log('⑤ 重新打开菜单点箭头：', await subState(), '（期望 shown=true）');
  await click(pt.arrow);
  console.log('⑥ 再点一次箭头：', await subState(), '（期望 shown=false）');

  const img = await getWindow().webContents.capturePage();
  writeFileSync(join(OUT_DIR, 'slash-sub-debug.png'), img.toPNG());
  console.log('已截图 slash-sub-debug.png');
  app.exit(0);
}

setTimeout(() => {
  console.error('诊断超时，强制退出');
  app.exit(2);
}, 120000).unref();

run().catch((err) => {
  console.error('诊断失败：', err.message);
  app.exit(1);
});

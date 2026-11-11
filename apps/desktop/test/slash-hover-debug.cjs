/**
 * 斜杠菜单二级面板悬停诊断（不进 npm test）：
 * node test/run-e2e.cjs slash-hover-debug.cjs
 *
 * 目的：确认「悬停表格条目」到底有没有把二级行列网格弹出来，
 * 以及鼠标移动事件是否真的落在条目上。
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

function menuAction(action) {
  getWindow().webContents.send('menu:action', { action });
}

async function ensureSource() {
  if (!(await exec(`Boolean(document.querySelector('.source-editor'))`))) {
    menuAction('view:toggle-mode');
    await waitFor(() => exec(`Boolean(document.querySelector('.source-editor'))`), { label: '源码模式' });
  }
}

async function ensureWysiwyg() {
  if (await exec(`Boolean(document.querySelector('.source-editor'))`)) {
    menuAction('view:toggle-mode');
    await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror'))`), { label: 'WYSIWYG' });
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}

const subState = () =>
  exec(`(() => {
    const sub = document.querySelector('.slash-sub');
    const menu = document.querySelector('.slash-menu');
    const item = [...document.querySelectorAll('.slash-item')].find((el) => el.textContent.includes('表格'));
    const r = item ? item.getBoundingClientRect() : null;
    const sr = sub && getComputedStyle(sub).display !== 'none' ? sub.getBoundingClientRect() : null;
    const overlaps = Boolean(
      r && sr && sr.left < r.right && sr.right > r.left && sr.top < r.bottom && sr.bottom > r.top
    );
    const centerInside = Boolean(
      r && sr && r.left + r.width / 2 > sr.left && r.left + r.width / 2 < sr.right &&
        r.top + r.height / 2 > sr.top && r.top + r.height / 2 < sr.bottom
    );
    return JSON.stringify({
      menuDisplay: menu ? getComputedStyle(menu).display : 'no-menu',
      subExists: Boolean(sub),
      subDisplay: sub ? getComputedStyle(sub).display : 'none',
      subRect: sr ? { w: Math.round(sr.width), h: Math.round(sr.height), t: Math.round(sr.top), l: Math.round(sr.left) } : null,
      itemRect: r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) } : null,
      overlapsItem: overlaps,
      subCoversCursor: centerInside
    });
  })()`);

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  await waitFor(() => getWindow(), { label: '窗口创建' });
  await waitFor(() => exec(`Boolean(document.querySelector('.app'))`), { label: 'React 挂载' });
  await new Promise((resolve) => setTimeout(resolve, 700));

  await ensureSource();
  await exec(`(() => {
    const ta = document.querySelector('.source-editor');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '正文一段\\n');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  await ensureWysiwyg();

  // 点进正文、输入「/」打开菜单
  const p = await exec(`(() => {
    const el = document.querySelector('.ProseMirror p');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) };
  })()`);
  const win = getWindow();
  win.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await exec(`document.querySelector('.ProseMirror')?.focus()`);
  win.webContents.insertText('/');
  await waitFor(() => exec(`Boolean(document.querySelector('.slash-menu'))`), { label: '菜单弹出' });

  console.log('打开菜单后：', await subState());

  // 记录菜单收到的鼠标事件，便于确认 sendInputEvent 是否真的派发了
  await exec(`(() => {
    window.__evt = [];
    const menu = document.querySelector('.slash-menu');
    ['mouseover', 'mouseout', 'mouseleave'].forEach((type) =>
      menu.addEventListener(type, (e) => window.__evt.push(type + ':' + (e.target.className || e.target.tagName)))
    );
    return true;
  })()`);

  const rect = JSON.parse(await subState()).itemRect;
  console.log('表格条目位置：', rect);

  // 真实鼠标移动：先移到条目上一行，再移到条目中心
  win.webContents.sendInputEvent({ type: 'mouseMove', x: rect.x, y: Math.max(1, rect.y - rect.h) });
  await new Promise((resolve) => setTimeout(resolve, 200));
  win.webContents.sendInputEvent({ type: 'mouseMove', x: rect.x, y: rect.y });
  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log('悬停表格条目后：', await subState());
  console.log('  事件：', await exec(`JSON.stringify(window.__evt)`));
  console.log('  光标下的元素：', await exec(`(() => { const el = document.elementFromPoint(${rect.x}, ${rect.y}); return el ? el.className || el.tagName : 'none'; })()`));

  // 再悬停到别的条目，确认会收回
  const otherRect = await exec(`(() => {
    const item = [...document.querySelectorAll('.slash-item')].find((el) => !el.textContent.includes('表格'));
    const grid = document.querySelector('.slash-grid-item');
    const el = item ?? grid;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), label: el.textContent.trim().slice(0, 8) });
  })()`);
  if (otherRect) {
    const o = JSON.parse(otherRect);
    console.log('  其他条目坐标：', o);
    console.log('  该点元素：', await exec(`(() => { const el = document.elementFromPoint(${o.x}, ${o.y}); return el ? (el.className || el.tagName) : 'none'; })()`));
    win.webContents.sendInputEvent({ type: 'mouseMove', x: o.x, y: o.y });
    await new Promise((resolve) => setTimeout(resolve, 400));
    console.log(`悬停其他条目（${o.label}）后：`, await subState());
    console.log('  事件：', await exec(`JSON.stringify(window.__evt)`));
  } else {
    console.log('（未找到其他条目）');
  }

  // 移到菜单外，确认网格收起
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 10, y: 10 });
  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log('鼠标移出菜单后：', await subState());

  const img = await win.webContents.capturePage();
  writeFileSync(join(OUT_DIR, 'slash-hover-debug.png'), img.toPNG());
  console.log('已截图 slash-hover-debug.png');
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

/**
 * 斜杠菜单截图脚本（不进 npm test）：
 * node test/run-e2e.cjs shot-slash.cjs
 * 打开文档 → 输入「/」→ 截图（默认态 / 过滤态 / 深色主题），输出到 /tmp/md-note-shots/。
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
  JSON.stringify({ themeId: 'light', sidebarOpen: true, sidebarPanel: 'files', tabbarVisible: true, toolbarVisible: false, zoomPercent: 100, windowBounds: null }, null, 2),
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

function getWindow() {
  return BrowserWindow.getAllWindows()[0] ?? null;
}

function exec(code) {
  const win = getWindow();
  if (!win) throw new Error('窗口不存在');
  return win.webContents.executeJavaScript(code, true);
}

async function shot(name) {
  const img = await getWindow().webContents.capturePage();
  writeFileSync(join(OUT_DIR, name), img.toPNG());
  console.log('已截图', name);
}

async function clickPoint(x, y) {
  const win = getWindow();
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  const win = await waitFor(() => getWindow(), { label: '窗口创建' });
  await waitFor(() => exec(`Boolean(document.querySelector('.app'))`), { label: 'React 挂载' });
  await new Promise((resolve) => setTimeout(resolve, 800));

  const root = '/tmp/md-note-shot-doc';
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, '演示.md'), '# MarkdownNote\n\n跨平台的本地 Markdown 编辑器，所见即所得。输入一个斜杠试试快速插入菜单。\n', 'utf-8');
  const { dialog } = require('electron');
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
  await exec(`document.querySelector('.filetree-open-btn').click()`);
  await waitFor(() => exec(`[...document.querySelectorAll('.tree-name')].some((el) => el.textContent === '演示.md')`), { label: '文件树出现文档' });
  await exec(`[...document.querySelectorAll('.tree-item.tree-file')].find((el) => el.textContent === '演示.md').click()`);
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror p'))`), { label: '编辑器挂载' });

  // 光标移到第二段，输入 /
  const point = await exec(`(() => {
    const p = document.querySelectorAll('.ProseMirror p')[0];
    const rect = p.getBoundingClientRect();
    return { x: Math.round(rect.left + 40), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  await clickPoint(point.x, point.y);
  await exec(`document.querySelector('.ProseMirror').focus()`);
  win.webContents.insertText('/');
  await waitFor(() => exec(`Boolean(document.querySelector('.slash-menu'))`), { label: '菜单弹出' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await shot('slash-1-light.png');

  // 过滤态
  win.webContents.insertText('biao');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await shot('slash-2-filter.png');
  win.webContents.insertText('');

  // 清空过滤（退格 ×4），再过滤到「表格」并回车应用，制造最近使用记录
  for (let i = 0; i < 4; i += 1) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  win.webContents.insertText('格');
  await waitFor(() => exec(`document.querySelectorAll('.slash-item').length === 1`), { label: '过滤到表格' });
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror table'))`), { label: '表格插入' });
  // 再来一次：图片
  const p2 = await exec(`(() => {
    const p = document.querySelectorAll('.ProseMirror p')[0];
    const rect = p.getBoundingClientRect();
    return { x: Math.round(rect.left + 40), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  await clickPoint(p2.x, p2.y);
  await exec(`document.querySelector('.ProseMirror').focus()`);
  win.webContents.insertText('/');
  await waitFor(() => exec(`Boolean(document.querySelector('.slash-chip'))`), { label: '最近使用出现' });
  const dump3 = await exec(
    `(() => {
      const menu = document.querySelector('.slash-menu');
      return { display: menu ? menu.style.display : null, top: menu ? menu.style.top : null, left: menu ? menu.style.left : null, active: document.activeElement ? document.activeElement.className : null, rect: menu ? JSON.parse(JSON.stringify(menu.getBoundingClientRect())) : null };
    })()`
  );
  console.log('shot3 前诊断 =', JSON.stringify(dump3));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const dump3b = await exec(
    `(() => { const menu = document.querySelector('.slash-menu'); return { display: menu ? menu.style.display : null }; })()`
  );
  console.log('shot3 前 300ms 后 =', JSON.stringify(dump3b));
  await shot('slash-3-recents.png');

  // 深色主题
  await exec(`document.querySelector('.ProseMirror').focus()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await exec(`document.querySelector('.tabbar-actions button').click()`);
  await new Promise((resolve) => setTimeout(resolve, 400));
  await clickPoint(p2.x, p2.y);
  await exec(`document.querySelector('.ProseMirror').focus()`);
  win.webContents.insertText('/');
  await waitFor(() => exec(`Boolean(document.querySelector('.slash-menu'))`), { label: '深色菜单弹出' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await shot('slash-4-dark.png');

  console.log('全部截图完成');
  app.exit(0);
}

run().catch((err) => {
  console.error('截图脚本异常:', err.message);
  app.exit(1);
});

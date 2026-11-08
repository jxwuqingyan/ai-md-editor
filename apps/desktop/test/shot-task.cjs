/**
 * 调试用：任务列表视觉与勾选交互（不进 npm test）
 * node test/run-e2e.cjs shot-task.cjs
 */
const { app, BrowserWindow, dialog } = require('electron');
const { mkdirSync, writeFileSync, rmSync, readFileSync } = require('node:fs');
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
const getWindow = () => BrowserWindow.getAllWindows()[0] ?? null;
const exec = (code) => getWindow().webContents.executeJavaScript(code, true);

async function waitFor(fn, { timeout = 15000, interval = 120, label = '条件' } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error(`等待超时：${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}
async function shot(name) {
  const img = await getWindow().webContents.capturePage();
  writeFileSync(join(OUT_DIR, name), img.toPNG());
  console.log('已截图', name);
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  const win = await waitFor(() => getWindow(), { label: '窗口' });
  await waitFor(() => exec(`Boolean(document.querySelector('.app'))`), { label: 'React' });
  await new Promise((r) => setTimeout(r, 800));

  const root = '/tmp/md-note-task-doc';
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, '任务.md'),
    '# 任务清单\n\n- [ ] 未完成的条目\n- [x] 已完成的条目\n- 普通无序条目\n',
    'utf-8'
  );
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
  await exec(`document.querySelector('.filetree-open-btn').click()`);
  await waitFor(() => exec(`[...document.querySelectorAll('.tree-name')].some((e) => e.textContent === '任务.md')`), { label: '树' });
  await exec(`[...document.querySelectorAll('.tree-item.tree-file')].find((e) => e.textContent === '任务.md').click()`);
  await waitFor(() => exec(`document.querySelectorAll('.ProseMirror li').length >= 3`), { label: '编辑器' });
  await new Promise((r) => setTimeout(r, 600));

  const dump = await exec(`(() => {
    const lis = [...document.querySelectorAll('.ProseMirror li')];
    return lis.map((li) => ({ type: li.dataset.itemType ?? null, checked: li.dataset.checked ?? null, text: li.textContent }));
  })()`);
  console.log('列表项 =', JSON.stringify(dump));
  await shot('task-1-light.png');

  // 点击第一项复选框（li 左侧 padding 区域内）
  const point = await exec(`(() => {
    const li = document.querySelector('.ProseMirror li[data-item-type="task"]');
    const r = li.getBoundingClientRect();
    return { x: Math.round(r.left + 8), y: Math.round(r.top + 13) };
  })()`);
  win.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await new Promise((r) => setTimeout(r, 400));
  const afterClick = await exec(`document.querySelector('.ProseMirror li[data-item-type="task"]')?.dataset.checked ?? null`);
  console.log('点击后第一项 checked =', afterClick);
  await shot('task-2-checked.png');

  // 光标放进第一项文字末尾，按 Enter：新条目应保持任务态（未勾选）
  const textPoint = await exec(`(() => {
    const li = document.querySelector('.ProseMirror li[data-item-type="task"]');
    const r = li.querySelector('p').getBoundingClientRect();
    return { x: Math.round(r.left + r.width - 4), y: Math.round(r.top + r.height / 2) };
  })()`);
  win.webContents.sendInputEvent({ type: 'mouseDown', x: textPoint.x, y: textPoint.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: textPoint.x, y: textPoint.y, button: 'left', clickCount: 1 });
  await new Promise((r) => setTimeout(r, 300));
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End' });
  await new Promise((r) => setTimeout(r, 200));
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await new Promise((r) => setTimeout(r, 300));
  const afterEnter = await exec(`(() => {
    const lis = [...document.querySelectorAll('.ProseMirror li')];
    return lis.map((li) => ({ type: li.dataset.itemType ?? null, checked: li.dataset.checked ?? null, text: li.textContent }));
  })()`);
  console.log('Enter 后（insertText 前）列表项 =', JSON.stringify(afterEnter));
  win.webContents.insertText('新回车条目');
  await new Promise((r) => setTimeout(r, 400));
  const lisAfterEnter = await exec(`(() => {
    const lis = [...document.querySelectorAll('.ProseMirror li')];
    return lis.map((li) => ({ type: li.dataset.itemType ?? null, checked: li.dataset.checked ?? null, text: li.textContent }));
  })()`);
  console.log('回车后列表项 =', JSON.stringify(lisAfterEnter));

  // 保存（Cmd+S）后读磁盘，确认序列化为 - [ ] / - [x]
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 's', modifiers: ['meta'] });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 's', modifiers: ['meta'] });
  await waitFor(() => {
    try {
      return readFileSync(join(root, '任务.md'), 'utf-8').includes('新回车条目');
    } catch {
      return false;
    }
  }, { label: '落盘' }).catch(() => null);
  console.log('磁盘内容:', JSON.stringify(readFileSync(join(root, '任务.md'), 'utf-8')));

  app.exit(0);
}

run().catch((err) => {
  console.error('异常:', err.message);
  app.exit(1);
});

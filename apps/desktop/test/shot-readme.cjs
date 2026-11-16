/**
 * README 截图脚本（不进 npm test）：
 * npm run build && node test/run-e2e.cjs shot-readme.cjs
 *
 * 产出 4 张功能截图到 docs/assets/（整窗图为 Retina 2x，细节图按功能区域裁剪）：
 *   readme-hero.png    主界面：文件树 + 富内容文档 + 底部工具栏
 *   readme-slash.png   斜杠快速插入菜单
 *   readme-table.png   表格行列手柄：选中整列 + 浮动工具条
 *   readme-outline.png 大纲面板拖动重排：拖动中条目 + 插入指示线
 */
const { app, BrowserWindow, dialog } = require('electron');
const { mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const PROFILE_DIR = join(tmpdir(), 'md-note-shot-readme-profile');
rmSync(PROFILE_DIR, { recursive: true, force: true });
mkdirSync(PROFILE_DIR, { recursive: true });
app.setPath('userData', PROFILE_DIR);
writeFileSync(
  join(PROFILE_DIR, 'settings.json'),
  JSON.stringify(
    { themeId: 'light', sidebarOpen: true, sidebarPanel: 'files', tabbarVisible: true, toolbarVisible: true, zoomPercent: 100, windowBounds: null },
    null,
    2
  ),
  'utf-8'
);
require('../out/main/index.js');

/** 截图直接写进仓库 docs/assets/ */
const OUT_DIR = join(__dirname, '..', '..', '..', 'docs', 'assets');

const DEMO_DOC = `# 产品周记 · 第 14 期

本周聚焦编辑体验的收尾：表格可以就近管理行列，大纲支持整节搬动。

> [!TIP]
> 在正文输入「/」即可唤起快速插入菜单，支持中文与拼音过滤。

## 本周进展

- [x] 表格行列手柄与角手柄
- [x] 大纲拖动重排章节
- [ ] 发布 0.14.32

## 数据一览

| 指标 | 上周 | 本周 |
| --- | --- | --- |
| 活跃用户 | 1,240 | 1,486 |
| 周留存 | 41% | 45% |
| 崩溃次数 | 3 | 0 |

## 下周计划

继续打磨细节，收敛已知问题。
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getWindow = () => BrowserWindow.getAllWindows()[0] ?? null;
const exec = (code) => getWindow().webContents.executeJavaScript(code, true);

async function waitFor(fn, { timeout = 15000, interval = 120, label = '条件' } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error(`等待超时：${label}`);
    await sleep(interval);
  }
}

/**
 * 截图落盘。
 * @param name 文件名
 * @param rect 可选裁剪区域（CSS 像素，页面坐标系）
 */
async function shot(name, rect) {
  const win = getWindow();
  // 窗口被遮挡时 capturePage 可能拿到旧帧：先提到最前再截
  try {
    win.show();
    win.moveTop();
    win.focus();
  } catch {}
  await sleep(400);
  let img = await win.webContents.capturePage();
  if (rect) {
    const size = img.getSize();
    const scale = size.width / win.getContentSize()[0];
    const box = {
      x: Math.max(0, Math.round(rect.x * scale)),
      y: Math.max(0, Math.round(rect.y * scale)),
      width: Math.round(rect.width * scale),
      height: Math.round(rect.height * scale)
    };
    box.width = Math.min(box.width, size.width - box.x);
    box.height = Math.min(box.height, size.height - box.y);
    img = img.crop(box);
  }
  writeFileSync(join(OUT_DIR, name), img.toPNG());
  console.log('已截图', name, img.getSize());
}

async function clickPoint(x, y) {
  const win = getWindow();
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  await sleep(250);
}

/** 滚动到文档顶部，保证后续点击坐标落在视口内 */
async function scrollTop() {
  await exec(`(() => {
    const box = document.querySelector('.editor-scroll');
    if (box) box.scrollTop = 0;
    return true;
  })()`);
  await sleep(300);
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  const win = await waitFor(() => getWindow(), { label: '窗口创建' });
  try {
    win.show();
    win.focus();
  } catch {}
  await waitFor(() => exec(`Boolean(document.querySelector('.app'))`), { label: 'React 挂载' });
  await sleep(800);

  // 准备演示目录与文档
  const root = join(tmpdir(), 'md-note-readme-root');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'notes'), { recursive: true });
  writeFileSync(join(root, '产品周记.md'), DEMO_DOC, 'utf-8');
  writeFileSync(join(root, 'notes', '会议纪要.md'), '# 周会纪要\n\n- 讨论编辑器的排版细节\n', 'utf-8');
  writeFileSync(join(root, 'notes', 'roadmap.md'), '# Roadmap\n\n| 版本 | 内容 |\n| --- | --- |\n| 0.14 | 表格、大纲 |\n', 'utf-8');

  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
  await exec(`document.querySelector('.filetree-open-btn').click()`);
  await waitFor(() => exec(`[...document.querySelectorAll('.tree-name')].some((el) => el.textContent === '产品周记.md')`), { label: '文件树加载' });
  await exec(`[...document.querySelectorAll('.tree-item.tree-file')].find((el) => el.textContent === '产品周记.md').click()`);
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror table'))`), { label: '编辑器挂载' });
  // 展开 notes 目录，让文件树层次完整
  await exec(`(() => {
    const dir = [...document.querySelectorAll('.tree-item.tree-dir')].find((el) => el.textContent.includes('notes'));
    if (dir) dir.click();
    return true;
  })()`);
  // 关掉启动时的空白未命名标签，只留演示文档
  await exec(`(() => {
    window.confirm = () => true;
    const tab = [...document.querySelectorAll('.tab')].find((el) => el.textContent.includes('未命名.md'));
    tab?.querySelector('.tab-close')?.click();
    return true;
  })()`);
  await sleep(500);
  // 让自动保存把刚打开的文档落盘，清掉标签上的未保存圆点
  await exec(`document.querySelector('.ProseMirror').focus()`);
  await sleep(2000);
  await scrollTop();

  // 1. 主界面（整窗）
  await shot('readme-hero.png');

  // 2. 大纲拖动：先把光标停在标题行（收掉表格工具条），再切到大纲面板模拟拖动
  const heading = await exec(`(() => {
    const el = document.querySelector('.ProseMirror h1');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + 24), y: Math.round(r.top + r.height / 2) };
  })()`);
  await clickPoint(heading.x, heading.y);
  await sleep(200);
  await exec(`[...document.querySelectorAll('.sidebar-tab')].find((el) => el.textContent === '大纲').click()`);
  await waitFor(() => exec(`document.querySelectorAll('.outline-item').length >= 4`), { label: '大纲面板' });
  await sleep(300);
  const outlineRect = await exec(`(() => {
    const items = document.querySelectorAll('.outline-item');
    const from = [...items].find((el) => el.textContent === '数据一览');
    const dt = new DataTransfer();
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    window.__dragData = dt;
    return true;
  })()`);
  // 等 React 把 dragging 状态渲染出来，再派发 dragover（同一 tick 里 dragging 还是 null）
  await sleep(250);
  await exec(`(() => {
    const items = document.querySelectorAll('.outline-item');
    const to = [...items].find((el) => el.textContent === '本周进展');
    const r = to.getBoundingClientRect();
    to.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientY: r.top + r.height / 4, dataTransfer: window.__dragData }));
    return true;
  })()`);
  await sleep(300);
  const outlineCrop = await exec(`(() => {
    const list = document.querySelector('.outline-list').getBoundingClientRect();
    const items = document.querySelectorAll('.outline-item');
    const last = items[items.length - 1].getBoundingClientRect();
    return { x: 0, y: 0, width: Math.round(list.right + 240), height: Math.round(last.bottom + 40) };
  })()`);
  await shot('readme-outline.png', outlineCrop);

  // 3. 斜杠菜单：在首段输入「/」
  await scrollTop();
  const p = await exec(`(() => {
    const el = document.querySelectorAll('.ProseMirror p')[0];
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + 80), y: Math.round(r.top + r.height / 2) };
  })()`);
  await clickPoint(p.x, p.y);
  await exec(`document.querySelector('.ProseMirror').focus()`);
  win.webContents.insertText('/');
  await waitFor(() => exec(`Boolean(document.querySelector('.slash-menu'))`), { label: '斜杠菜单弹出' });
  await sleep(350);
  const menuRect = await exec(`(() => {
    const line = document.querySelectorAll('.ProseMirror p')[0].getBoundingClientRect();
    const menu = document.querySelector('.slash-menu').getBoundingClientRect();
    const left = Math.min(menu.left, line.left) - 32;
    const top = Math.min(menu.top, line.top) - 44;
    return {
      x: Math.round(left),
      y: Math.round(top),
      width: Math.round(menu.right - left + 32),
      height: Math.round(menu.bottom - top + 32)
    };
  })()`);
  await shot('readme-slash.png', menuRect);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  // 把刚输入的「/」删掉，保持文档干净
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
  await sleep(250);

  // 4. 表格手柄：点第 2 列的列手柄（选中态下手柄保持显示）
  await exec(`(() => {
    const handle = document.querySelectorAll('.md-table-col-handle')[1];
    if (handle) handle.click();
    return true;
  })()`);
  await sleep(300);
  await waitFor(() => exec(`document.querySelector('.md-table-toolbar')?.hidden === false`), { label: '表格工具条出现' });
  const tableRect = await exec(`(() => {
    const block = document.querySelector('.md-table-block').getBoundingClientRect();
    const bar = document.querySelector('.md-table-toolbar').getBoundingClientRect();
    const top = Math.min(block.top, bar.top) - 24;
    return {
      x: Math.round(block.left - 36),
      y: Math.round(top),
      width: Math.round(block.width + 72),
      height: Math.round(block.bottom - top + 6)
    };
  })()`);
  await sleep(200);
  await shot('readme-table.png', tableRect);

  console.log('README 截图完成 →', OUT_DIR);
  app.exit(0);
}

setTimeout(() => { console.error('截图超时'); app.exit(2); }, 120000).unref();
run().catch((err) => {
  console.error('截图脚本异常:', err);
  app.exit(1);
});

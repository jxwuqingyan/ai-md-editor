/**
 * 链接 ⌘+点击诊断脚本（不进 npm test）：
 * node test/run-e2e.cjs shot-link-debug.cjs
 * 源码模式写入链接 → 切回 WYSIWYG → ⌘+点击 → 截图 + 打印选区/焦点/高亮元素，输出到 /tmp/md-note-shots/。
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

function menuAction(action) {
  getWindow().webContents.send('menu:action', { action });
}

async function shot(name) {
  const img = await getWindow().webContents.capturePage();
  writeFileSync(join(OUT_DIR, name), img.toPNG());
  console.log('已截图', name);
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  const win = await waitFor(() => getWindow(), { label: '窗口创建' });
  await waitFor(() => exec(`Boolean(document.querySelector('.app'))`), { label: 'React 挂载' });
  await new Promise((resolve) => setTimeout(resolve, 800));

  // 1. 源码模式写入链接语法
  menuAction('view:toggle-mode');
  await waitFor(() => exec(`Boolean(document.querySelector('.source-editor'))`), { label: '进入源码模式' });
  await exec(`(() => {
    const ta = document.querySelector('.source-editor');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '[test](https://example.com)\\n\\n正文一段\\n');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  // 2. 切回 WYSIWYG
  menuAction('view:toggle-mode');
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror a'))`), { label: 'WYSIWYG 链接渲染' });

  // 3. ⌘+点击链接中心
  const pt = await exec(`(() => {
    const r = document.querySelector('.ProseMirror a').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  win.webContents.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: 1, modifiers: ['meta'] });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'left', clickCount: 1, modifiers: ['meta'] });
  await new Promise((resolve) => setTimeout(resolve, 600));

  // 4. 打印选区/焦点/高亮来源
  const diag = await exec(`(() => {
    const sel = document.getSelection();
    const pm = document.querySelector('.ProseMirror');
    const focused = document.activeElement;
    // 找带边框的元素：遍历可见元素看 computedStyle 有边框的
    const bordered = [];
    if (pm) {
      for (const el of pm.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.outlineWidth) > 0) {
          const r = el.getBoundingClientRect();
          bordered.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), border: cs.borderTopWidth, outline: cs.outlineWidth, w: Math.round(r.width) });
        }
      }
    }
    return {
      selRange: sel.rangeCount ? sel.getRangeAt(0).toString() : null,
      selAnchor: sel.anchorNode ? sel.anchorNode.nodeName + ':' + String(sel.anchorNode.textContent ?? '').slice(0, 24) : null,
      activeElement: focused ? focused.tagName + '.' + String(focused.className).slice(0, 60) : null,
      bordered,
      pmClasses: pm ? pm.className : null
    };
  })()`);
  console.log('诊断 =', JSON.stringify(diag, null, 2));
  await shot('link-debug-after-cmdclick.png');
  app.quit();
}

run().catch((err) => {
  console.error('诊断失败：', err.message);
  app.exit(1);
});

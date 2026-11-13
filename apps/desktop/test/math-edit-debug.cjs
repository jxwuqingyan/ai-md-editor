/**
 * 公式就地编辑诊断（不进 npm test）：
 * node test/run-e2e.cjs math-edit-debug.cjs
 *
 * 覆盖：块级 / 行内公式渲染 → 点击进入编辑 → 改 TeX → 失焦提交 → 存回 Markdown。
 * 每步打印 DOM 与源码，便于确认交互是否符合预期。
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

const isSource = () => exec(`Boolean(document.querySelector('.source-editor'))`);

async function ensureSource() {
  if (!(await isSource())) {
    menuAction('view:toggle-mode');
    await waitFor(() => isSource(), { label: '进入源码模式' });
  }
}

async function ensureWysiwyg() {
  if (await isSource()) {
    menuAction('view:toggle-mode');
    await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror'))`), { label: '切回 WYSIWYG' });
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
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
  await new Promise((resolve) => setTimeout(resolve, 300));
  await ensureWysiwyg();
}

const readSource = async () => {
  await ensureSource();
  const md = await exec(`document.querySelector('.source-editor').value`);
  await ensureWysiwyg();
  return md;
};

const state = () =>
  exec(`(() => {
    const block = document.querySelector('.md-math-block');
    const inline = document.querySelector('.md-math-inline');
    const input = document.querySelector('.md-math-input:not([style*="display: none"])');
    const selected = document.querySelector('.ProseMirror-selectednode');
    return JSON.stringify({
      block: Boolean(block),
      blockKatex: Boolean(block && block.querySelector('.katex')),
      blockText: block ? (block.textContent ?? '').slice(0, 40) : '',
      blockOutline: block ? getComputedStyle(block).outlineStyle : '',
      inline: Boolean(inline),
      inlineText: inline ? (inline.textContent ?? '').slice(0, 30) : '',
      editing: Boolean(input),
      inputValue: input ? input.value : '',
      nodeSelected: Boolean(selected),
      selectedClass: selected ? selected.className : ''
    });
  })()`);

async function clickSelector(selector) {
  const pt = await exec(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + Math.min(20, r.width / 2)), y: Math.round(r.top + Math.min(10, r.height / 2)) };
  })()`);
  if (!pt) throw new Error('找不到 ' + selector);
  const win = getWindow();
  win.webContents.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 350));
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  await waitFor(() => getWindow(), { label: '窗口创建' });
  await waitFor(() => exec(`Boolean(document.querySelector('.app'))`), { label: 'React 挂载' });
  await new Promise((resolve) => setTimeout(resolve, 700));

  await setMarkdown('$$\nE = mc^2\n$$\n\n行内 $a^2$ 公式\n');
  await waitFor(() => exec(`Boolean(document.querySelector('.md-math-block'))`), { label: '块级公式渲染' });
  console.log('渲染后：', await state());

  // 点击块级公式 → 应进入编辑
  await clickSelector('.md-math-block');
  console.log('点击块级公式后：', await state());
  await new Promise((resolve) => setTimeout(resolve, 400));
  { const img = await getWindow().webContents.capturePage(); writeFileSync(join(OUT_DIR, 'math-edit-open.png'), img.toPNG()); console.log('已截图 math-edit-open.png'); }

  // 改写 TeX 并失焦提交
  console.log('  焦点：', await exec(`(() => { const a = document.activeElement; return a ? (a.className || a.tagName) : 'none'; })()`));
  await exec(`(() => { window.__err = []; window.addEventListener('error', (e) => window.__err.push(String(e.message))); window.addEventListener('unhandledrejection', (e) => window.__err.push('rej:' + String(e.reason))); return true; })()`);
  await exec(`(() => {
    const input = document.querySelector('.md-math-block .md-math-input');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, 'a^2 + b^2 = c^2');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    window.__blurFired = 0;
    input.addEventListener('blur', () => { window.__blurFired += 1; });
    input.focus();
    input.blur();
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 400));
  console.log('  blur 次数：', await exec(`String(window.__blurFired)`), '错误：', await exec(`JSON.stringify(window.__err)`));
  console.log('提交后：', await state());
  console.log('提交后源码：', JSON.stringify(await readSource()));

  // 行内公式：点开编辑并提交
  await clickSelector('.md-math-inline');
  const inlineEditing = await state();
  console.log('点击行内公式后：', inlineEditing);
  await exec(`(() => {
    const input = document.querySelector('.md-math-inline .md-math-input');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, 'x+1');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.blur();
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 400));
  console.log('行内提交后：', await state());
  console.log('行内提交后源码：', JSON.stringify(await readSource()));

  const img = await getWindow().webContents.capturePage();
  writeFileSync(join(OUT_DIR, 'math-edit-debug.png'), img.toPNG());
  console.log('已截图 math-edit-debug.png');
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

/**
 * 行内公式提交不能改动文档结构（不进 npm test）：
 * node test/run-e2e.cjs math-inline-repro.cjs
 *
 * 覆盖多种提交方式：合成回车（cancelable=false）、真实回车、点击别处失焦、清空后退格。
 * 每种都检查「顶层块数量不变」+「源码里公式与正文仍在一起」。
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
  await new Promise((resolve) => setTimeout(resolve, 350));
  await ensureWysiwyg();
}

const readSource = async () => {
  await ensureSource();
  const md = await exec(`document.querySelector('.source-editor').value`);
  await ensureWysiwyg();
  return md;
};

const blocks = async () =>
  JSON.parse(
    await exec(`(() => {
      const pm = document.querySelector('.ProseMirror');
      return JSON.stringify([...pm.children].map((el) => el.tagName.toLowerCase() + ':' + (el.textContent ?? '').slice(0, 24)));
    })()`)
  );

async function clickSelector(selector, index = 0, ratio = 0) {
  const pt = await exec(`(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = ${ratio} > 0 ? r.left + r.width * ${ratio} : r.left + Math.min(20, r.width / 2);
    return { x: Math.round(x), y: Math.round(r.top + Math.min(10, r.height / 2)) };
  })()`);
  if (!pt) throw new Error('找不到 ' + selector);
  const win = getWindow();
  win.webContents.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 300));
}

const setInlineValue = (tex) =>
  exec(`(() => {
    const input = document.querySelector('.md-math-inline .md-math-input');
    if (!input || input.style.display === 'none') return 'no-input';
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(tex)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    return 'ok';
  })()`);

/** 提交；mode = synth-enter | real-enter | blur-by-click | backspace */
async function submit(mode) {
  if (mode === 'synth-enter') {
    await exec(`(() => {
      const input = document.querySelector('.md-math-inline .md-math-input');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`);
  } else if (mode === 'real-enter') {
    const win = getWindow();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  } else if (mode === 'backspace') {
    await exec(`(() => {
      const input = document.querySelector('.md-math-inline .md-math-input');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      return true;
    })()`);
  } else if (mode === 'blur') {
    // 显式 focus→blur 走失焦提交链路：自动化环境里点别处不一定真的把焦点移出文本框
    await exec(`(() => {
      const input = document.querySelector('.md-math-inline .md-math-input');
      input.focus();
      input.blur();
      return true;
    })()`);
  }
  await new Promise((resolve) => setTimeout(resolve, 600));
}

async function scenario({ name, md, mode, tex, expectBlocks, expectSource }) {
  await setMarkdown(md);
  await waitFor(() => exec(`Boolean(document.querySelector('.md-math-inline'))`), { label: `${name} 渲染` });
  await clickSelector('.md-math-inline', 0);
  await setInlineValue(tex);
  await submit(mode);
  const after = await blocks();
  const src = await readSource();
  const okBlocks = after.length === expectBlocks;
  const okSource = typeof expectSource === 'function' ? expectSource(src) : src.includes(expectSource);
  console.log(`\n=== ${name}（${mode}）===`);
  console.log('  焦点:', await exec(`document.activeElement ? (document.activeElement.className || document.activeElement.tagName) : 'none'`));
  console.log('  块结构:', JSON.stringify(after));
  console.log('  源码:', JSON.stringify(src));
  console.log('  判定:', okBlocks && okSource ? 'OK' : '★ 有问题');
  return okBlocks && okSource;
}

async function run() {
  await waitFor(() => getWindow(), { label: '窗口创建' });
  await waitFor(() => exec(`Boolean(document.querySelector('.app'))`), { label: 'React 挂载' });
  await new Promise((resolve) => setTimeout(resolve, 800));

  const results = [];
  results.push(
    await scenario({
      name: 'A 合成回车提交',
      md: '行内 $a^2$ 公式\n',
      mode: 'synth-enter',
      tex: 'x+1',
      expectBlocks: 1,
      expectSource: (md) => md.trim() === '行内 $x+1$ 公式'
    })
  );
  results.push(
    await scenario({
      name: 'B 真实回车提交',
      md: '行内 $a^2$ 公式\n',
      mode: 'real-enter',
      tex: 'x+1',
      expectBlocks: 1,
      expectSource: (md) => md.trim() === '行内 $x+1$ 公式'
    })
  );
  results.push(
    await scenario({
      name: 'C 失焦提交',
      md: '行内 $a^2$ 公式\n',
      mode: 'blur',
      tex: 'x+1',
      expectBlocks: 1,
      expectSource: (md) => md.trim() === '行内 $x+1$ 公式'
    })
  );
  results.push(
    await scenario({
      name: 'D 段落开头 + 紧跟文字',
      md: '$a^2$公式\n',
      mode: 'synth-enter',
      tex: 'x+1',
      expectBlocks: 1,
      expectSource: (md) => md.trim() === '$x+1$公式'
    })
  );
  results.push(
    await scenario({
      name: 'E 空公式退格删除，正文不动',
      md: '前面 $a^2$ 后面\n',
      mode: 'backspace',
      tex: '',
      expectBlocks: 1,
      expectSource: (md) => md.trim() === '前面  后面'
    })
  );

  console.log(`\n结果：${results.filter(Boolean).length}/${results.length} OK`);
  app.exit(results.every(Boolean) ? 0 : 1);
}

setTimeout(() => {
  console.error('诊断超时，强制退出');
  app.exit(2);
}, 180000).unref();

run().catch((err) => {
  console.error('诊断失败：', err.message);
  app.exit(1);
});

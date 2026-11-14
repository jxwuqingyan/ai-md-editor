/**
 * 块级公式的排版与「后面能不能接着写」诊断（不进 npm test）：
 * node test/run-e2e.cjs math-block-layout.cjs
 *
 * 关注两点：
 * 1) 公式左对齐，不居中（与正文左边线对齐）；
 * 2) 公式是最后一块时，下方要能点进去接着写（末尾补段落），而不是点了没反应。
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

const blocks = () =>
  exec(`(() => {
    const pm = document.querySelector('.ProseMirror');
    return JSON.stringify([...pm.children].map((el) => el.tagName.toLowerCase() + ':' + (el.getAttribute('data-type') || el.textContent.slice(0, 16))));
  })()`);

/** 公式左对齐检查：.katex-display 的 text-align 与左边界 */
const alignInfo = () =>
  exec(`(() => {
    const wrap = document.querySelector('.md-math-block');
    const disp = wrap && wrap.querySelector('.katex-display');
    const para = document.querySelector('.ProseMirror p');
    if (!disp) return JSON.stringify({ ok: false });
    const d = disp.getBoundingClientRect();
    const p = para ? para.getBoundingClientRect() : null;
    // .katex 是块级、宽度等于整行，量它没用；要量真正的字形盒子（.katex-html 里的原子）
    const atoms = [...disp.querySelectorAll('.katex-html .mord')];
    const inner = atoms[0] ?? null;
    const i = inner ? inner.getBoundingClientRect() : null;
    return JSON.stringify({
      textAlign: getComputedStyle(disp).textAlign,
      displayLeft: Math.round(d.left),
      formulaLeft: i ? Math.round(i.left) : null,
      formulaRight: i ? Math.round(i.right) : null,
      displayWidth: Math.round(d.width),
      paraLeft: p ? Math.round(p.left) : null
    });
  })()`);

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  await waitFor(() => getWindow(), { label: '窗口创建' });
  await waitFor(() => exec(`Boolean(document.querySelector('.app'))`), { label: 'React 挂载' });
  await new Promise((resolve) => setTimeout(resolve, 700));

  // 三种「块结尾」的文档：打开后末尾都应有空段落，下面能直接点进去写
  const cases = [
    { name: '块级公式结尾', md: '前面一段正文\n\n$$\nE = mc^2\n$$\n' },
    { name: '代码块结尾', md: '前面一段正文\n\n```js\nconst a = 1;\n```\n' },
    { name: '表格结尾', md: '前面一段正文\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n' }
  ];
  for (const item of cases) {
    await setMarkdown(item.md);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const list = JSON.parse(await blocks());
    const tailIsParagraph = list.length > 1 && list[list.length - 1].startsWith('p:');
    console.log(`① ${item.name}：`, JSON.stringify(list), tailIsParagraph ? '末尾有空段落 ✓' : '★ 末尾缺空段落');
  }

  // 公式场景：对齐 + 点下方能否落光标
  await setMarkdown('前面一段正文\n\n$$\nE = mc^2\n$$\n');
  await waitFor(() => exec(`Boolean(document.querySelector('.md-math-block .katex'))`), { label: '公式渲染' });
  console.log('② 对齐：', await alignInfo(), '（期望 textAlign=left 且 formulaLeft≈paraLeft）');

  const pt = await exec(`(() => {
    const math = document.querySelector('.md-math-block').getBoundingClientRect();
    return JSON.stringify({ x: Math.round(math.left + 40), y: Math.round(math.bottom + 14) });
  })()`);
  const pnt = JSON.parse(pt);
  console.log('③ 点击位置：', pt);
  const win = getWindow();
  win.webContents.sendInputEvent({ type: 'mouseDown', x: pnt.x, y: pnt.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: pnt.x, y: pnt.y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 300));

  win.webContents.insertText('公式后面的文字');
  await new Promise((resolve) => setTimeout(resolve, 500));
  const src = await readSource();
  console.log('④ 输入后源码：', JSON.stringify(src), src.includes('公式后面的文字') && src.indexOf('公式后面的文字') > src.indexOf('E = mc^2') ? '✓ 写在了公式后面' : '★ 位置不对');

  const img = await win.webContents.capturePage();
  writeFileSync(join(OUT_DIR, 'math-block-layout.png'), img.toPNG());
  console.log('已截图 math-block-layout.png');
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

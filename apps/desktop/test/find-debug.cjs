/**
 * 查找功能诊断（不进 npm test）：
 * node test/run-e2e.cjs find-debug.cjs
 *
 * 目的：确认「输入查找内容回车后出现一大片高亮」到底是什么——
 * 是选区跨了很多块，还是整块被加了背景。
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

const DOC = `# MarkdownNote

跨平台的本地 Markdown 编辑器，所见即所得。

## 核心特性

- 输入即渲染（WYSIWYG）
- 克制动效，专注内容
- 现代极简，去 AI 味
- 支持数学公式：$c = \\pm\\sqrt{a^2 + b^2}$

## 技术栈

- Electron + React + TypeScript
- Milkdown（ProseMirror + remark）

> 支持多标签页、打开 .md 文件、Cmd/Ctrl+S 保存。

$$
E = mc^2
$$
`;

const hitInfo = () =>
  exec(`(() => {
    const hits = [...document.querySelectorAll('.md-find-hit')];
    const active = document.querySelectorAll('.md-find-hit-active');
    const sel = document.getSelection();
    return JSON.stringify({
      hits: hits.length,
      activeHits: active.length,
      hitTexts: hits.map((el) => (el.textContent ?? '').slice(0, 20)),
      hitBg: hits[0] ? getComputedStyle(hits[0]).backgroundColor : '',
      selectionLength: sel ? sel.toString().length : 0,
      count: document.querySelector('.find-count')?.textContent ?? ''
    });
  })()`);

const setInput = async (selector, value) => {
  await exec(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 350));
};

const readSource = async () => {
  await ensureSource();
  const md = await exec(`document.querySelector('.source-editor').value`);
  await ensureWysiwyg();
  return md;
};

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  await waitFor(() => getWindow(), { label: '窗口创建' });
  await waitFor(() => exec(`Boolean(document.querySelector('.app'))`), { label: 'React 挂载' });
  await new Promise((resolve) => setTimeout(resolve, 700));

  await setMarkdown(DOC);
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror p'))`), { label: '文档渲染' });
  console.log('文档块数：', await exec(`document.querySelector('.ProseMirror').children.length`));

  // 打开「查找替换」（带替换行）
  menuAction('edit:replace');
  await waitFor(() => exec(`Boolean(document.querySelector('.find-input'))`), { label: '查找栏打开' });
  const bar = await exec(`document.querySelector('.find-bar')?.innerText.replace(/\\n/g, ' | ') ?? '无'`);
  console.log('查找栏内容：', bar);
  console.log('  替换行存在：', await exec(`document.querySelectorAll('[data-find-input]').length === 2`));

  // 输入查询词：应只高亮匹配文字本身，不是一大片选区
  await setInput('[data-find-input="query"]', '内容');
  console.log('① 输入「内容」后：', await hitInfo());
  const win = getWindow();
  { const img = await win.webContents.capturePage(); writeFileSync(join(OUT_DIR, 'find-hits.png'), img.toPNG()); }
  // 命中处放大截图，确认高亮样式（浅底 + 深字，而不是系统选中的反白）
  {
    const rect = JSON.parse(await exec(`(() => {
      const el = document.querySelector('.md-find-hit-active');
      if (!el) return 'null';
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: Math.max(0, Math.round(r.x - 30)), y: Math.max(0, Math.round(r.y - 20)), width: Math.round(r.width + 60), height: Math.round(r.height + 40) });
    })()`) || 'null');
    if (rect) {
      const img = await win.webContents.capturePage(rect);
      writeFileSync(join(OUT_DIR, 'find-hit-zoom.png'), img.toPNG());
      console.log('   命中样式：', await exec(`(() => {
        const el = document.querySelector('.md-find-hit-active');
        const cs = getComputedStyle(el);
        return JSON.stringify({ text: el.textContent, color: cs.color, background: cs.backgroundColor, boxShadow: cs.boxShadow });
      })()`));
    }
  }

  // 回车 = 下一个（先把焦点放回查找框；替换框里按回车是「替换」）
  await exec(`document.querySelector('[data-find-input="query"]')?.focus()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await new Promise((resolve) => setTimeout(resolve, 400));
  console.log('② 回车后：', await hitInfo(), '（焦点应在查找框：' + (await exec(`document.activeElement?.className ?? '无'`)) + '）');

  // 多处命中的视觉检查
  await setInput('[data-find-input="query"]', 'a');
  await new Promise((resolve) => setTimeout(resolve, 400));
  { const img = await win.webContents.capturePage(); writeFileSync(join(OUT_DIR, 'find-multi.png'), img.toPNG()); }
  console.log('②b 多处命中：', await hitInfo());
  await setInput('[data-find-input="query"]', '内容');

  // 替换当前
  await setInput('[data-find-input="replace"]', '内容X');
  await exec(`document.querySelector('[data-find-action="replace"]')?.click()`);
  await new Promise((resolve) => setTimeout(resolve, 600));
  console.log('③ 替换当前后源码：', JSON.stringify((await readSource()).includes('内容X') ? '含 内容X ✓' : '未替换 ✗'));
  console.log('   命中：', await hitInfo());

  // 全部替换（先重新查一遍）
  menuAction('edit:replace');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await setInput('[data-find-input="query"]', 'a');
  console.log('④ 查「a」：', await hitInfo());
  await setInput('[data-find-input="replace"]', 'A');
  await exec(`document.querySelector('[data-find-action="replace-all"]')?.click()`);
  await new Promise((resolve) => setTimeout(resolve, 800));
  const src = await readSource();
  console.log('⑤ 全部替换后：', JSON.stringify(src.slice(0, 120)));
  console.log('   剩余「a」命中：', (src.match(/a/g) ?? []).length, '「A」个数：', (src.match(/A/g) ?? []).length);

  const img = await win.webContents.capturePage();
  writeFileSync(join(OUT_DIR, 'find-debug.png'), img.toPNG());
  console.log('已截图 find-debug.png');
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

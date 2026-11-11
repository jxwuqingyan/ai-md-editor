/**
 * 列表退格行为诊断脚本（不进 npm test）：
 * node test/run-e2e.cjs list-backspace-debug.cjs
 *
 * 目的是先看清「有序列表里按退格」现在的真实行为：
 * - 列表第一项开头按退格（列表位于文档开头 / 不在开头）
 * - 第二项开头按退格（是否会把文字并到上一行）
 * - 空列表项按退格
 * 每步打印 DOM 结构（顶层块 + 列表项文本）与选区，不做断言。
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
  await new Promise((resolve) => setTimeout(resolve, 200));
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

/** 结构快照：顶层块标签 + 文本，列表额外列出每项文本 */
function dump() {
  return exec(`(() => {
    const pm = document.querySelector('.ProseMirror');
    if (!pm) return 'no-pm';
    const top = [...pm.children].map((el) => {
      const tag = el.tagName.toLowerCase();
      const out = { tag, text: (el.textContent ?? '').slice(0, 40) };
      if (tag === 'ol' || tag === 'ul') {
        out.start = el.getAttribute('start');
        out.items = [...el.children].map((li) => ({
          tag: li.tagName.toLowerCase(),
          text: (li.textContent ?? '').slice(0, 40)
        }));
      }
      return out;
    });
    const sel = document.getSelection();
    const anchor = sel && sel.anchorNode ? sel.anchorNode : null;
    let where = '';
    let node = anchor;
    while (node && node !== pm) {
      if (node.nodeType === 1) where = node.tagName.toLowerCase() + (where ? '>' + where : '');
      node = node.parentNode;
    }
    return JSON.stringify({ top, caretPath: where, offset: sel ? sel.anchorOffset : null });
  })()`);
}

/** 点击元素左边缘（贴近行首），再按 Home 确保光标在行首 */
async function caretAtStart(selector, index = 0) {
  const pt = await exec(`(() => {
    const els = document.querySelectorAll(${JSON.stringify(selector)});
    const el = els[${index}];
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: Math.round(rect.left + 3), y: Math.round(rect.top + Math.min(12, rect.height / 2)) };
  })()`);
  if (!pt) throw new Error('找不到目标元素：' + selector);
  const win = getWindow();
  win.webContents.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 150));
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Home' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Home' });
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function pressBackspace(times = 1) {
  const win = getWindow();
  for (let i = 0; i < times; i += 1) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  await waitFor(() => getWindow(), { label: '窗口创建' });
  await waitFor(() => exec(`Boolean(document.querySelector('.app'))`), { label: 'React 挂载' });
  await new Promise((resolve) => setTimeout(resolve, 800));

  const cases = [
    {
      name: 'A 列表在文档开头，光标在第 2 项开头，退格 1 次',
      md: '1. 第一项\n2. 第二项\n3. 第三项\n',
      target: 'li',
      index: 1,
      times: 1
    },
    {
      name: 'B 列表在文档开头，光标在第 1 项开头，退格 1 次',
      md: '1. 第一项\n2. 第二项\n3. 第三项\n',
      target: 'li',
      index: 0,
      times: 1
    },
    {
      name: 'C 列表在文档开头，光标在第 1 项开头，连按 3 次退格',
      md: '1. 第一项\n2. 第二项\n3. 第三项\n',
      target: 'li',
      index: 0,
      times: 3
    },
    {
      name: 'D 列表前有段落，光标在第 1 项开头，退格 1 次',
      md: '开头段落\n\n1. 第一项\n2. 第二项\n',
      target: 'li',
      index: 0,
      times: 1
    },
    {
      name: 'E 单项空列表，退格 1 次',
      md: '开头段落\n\n1. \n',
      target: 'li',
      index: 0,
      times: 1
    },
    {
      name: 'F 无序列表第 2 项开头，退格 1 次',
      md: '- 甲\n- 乙\n- 丙\n',
      target: 'li',
      index: 1,
      times: 1
    },
    {
      name: 'G 嵌套列表内层第 2 项开头，退格 1 次（应保持默认降级缩进）',
      md: '1. 外层\n   1. 内层一\n   2. 内层二\n',
      target: 'li li',
      index: 1,
      times: 1
    },
    {
      name: 'H 从第 3 项连按 3 次退格（应一路往上把列表拆完）',
      md: '1. 一\n2. 二\n3. 三\n',
      target: 'li',
      index: 2,
      times: 3
    },
    {
      name: 'I 用户自己写在列表下方的段落，退格应与上一项合并（默认行为）',
      md: '1. 一\n2. 二\n\n正文段落\n',
      target: '.ProseMirror > p',
      index: 0,
      times: 1
    }
  ];

  for (const c of cases) {
    await setMarkdown(c.md);
    await caretAtStart(c.target, c.index);
    const before = await dump();
    await pressBackspace(c.times);
    const after = await dump();
    console.log(`\n=== ${c.name} ===`);
    console.log('  before:', before);
    console.log('  after :', after);
  }

  // 最后确认序列化后的 Markdown（用源码模式读回）
  await ensureSource();
  const md = await exec(`document.querySelector('.source-editor').value`);
  console.log('\n=== 最终源码 ===\n' + md);
  // 文档是脏的，走正常关闭流程会弹「是否保存」阻塞脚本，直接退出
  app.exit(0);
}

// 兜底：任何步骤卡住都不要让脚本挂死
setTimeout(() => {
  console.error('诊断超时，强制退出');
  app.exit(2);
}, 150000).unref();

run().catch((err) => {
  console.error('诊断失败：', err.message);
  app.exit(1);
});

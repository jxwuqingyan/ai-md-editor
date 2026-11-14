/**
 * 任务列表回车行为诊断（不进 npm test）：
 * node test/run-e2e.cjs task-list-debug.cjs
 *
 * 关注：待办列表最后一项回车（空项再回车）应当变成普通段落，而不是又套一层无序列表。
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

/** 窗口是否有系统焦点：selectionToDOM 只在 view.hasFocus() 时写回 DOM 选区，
 *  无焦点窗口里的 DOM 选区不可信（真实用户场景窗口必然有焦点）。 */
const docHasFocus = () => exec(`document.hasFocus()`);
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

/** 顶层块 + 列表内部结构 */
const outline = () =>
  exec(`(() => {
    const pm = document.querySelector('.ProseMirror');
    const describe = (el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'ul' || tag === 'ol') {
        return tag + '[' + [...el.children].map(describe).join(', ') + ']';
      }
      if (tag === 'li') {
        const box = el.querySelector('input[type="checkbox"]');
        const inner = [...el.children].filter((c) => c.tagName !== 'INPUT' && !c.classList.contains('task-checkbox')).map(describe).join('+');
        return 'li' + (box ? (box.checked ? '(x)' : '( )') : '') + '{' + inner + ':' + (el.textContent ?? '').trim().slice(0, 12) + '}';
      }
      if (tag === 'p') return 'p:' + (el.textContent ?? '').trim().slice(0, 12);
      return tag;
    };
    return JSON.stringify([...pm.children].map(describe));
  })()`);

/** 用真实鼠标点进最后一个列表项（PM 只有认真实点击才会同步内部选区） */
async function clickLastItem() {
  const pt = await exec(`(() => {
    const items = [...document.querySelectorAll('.ProseMirror li')];
    const last = items[items.length - 1];
    if (!last) return null;
    const box = (last.querySelector('p') ?? last).getBoundingClientRect();
    return JSON.stringify({ x: Math.round(box.left + 6), y: Math.round(box.top + box.height / 2) });
  })()`);
  if (!pt) throw new Error('没有列表项');
  const p = JSON.parse(pt);
  const win = getWindow();
  win.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 250));
  // 点进去之后把光标推到行尾（真实按键：End）
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End' });
  await new Promise((resolve) => setTimeout(resolve, 180));
}

async function pressEnter() {
  await exec(`(() => {
    window.__evt = [];
    if (!window.__evtInstalled) {
      window.__evtInstalled = true;
      for (const type of ['keydown', 'beforeinput', 'input']) {
        document.addEventListener(type, (e) => {
          window.__evt.push('capture:' + type + ':' + (e.key ?? e.inputType ?? '') + ':prevented=' + e.defaultPrevented);
        }, true);
        document.addEventListener(type, (e) => {
          window.__evt.push('bubble:' + type + ':' + (e.key ?? e.inputType ?? '') + ':prevented=' + e.defaultPrevented);
        }, false);
      }
    }
    return true;
  })()`);
  const win = getWindow();
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await new Promise((resolve) => setTimeout(resolve, 350));
  console.log('   事件：', await exec(`JSON.stringify(window.__evt ?? [])`), '焦点=', await exec(`document.activeElement?.className || document.activeElement?.tagName || 'none'`));
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  // 抢一次系统焦点：selectionToDOM 只在 view.hasFocus() 时写回 DOM 选区，
  // 无焦点窗口里 DOM 选区验证不可信（真实用户场景窗口必然有焦点）。
  try {
    app.focus({ steal: true });
  } catch {}
  await waitFor(() => getWindow(), { label: '窗口创建' });
  try {
    getWindow().show();
    getWindow().focus();
  } catch {}
  await waitFor(() => exec(`Boolean(document.querySelector('.app'))`), { label: 'React 挂载' });
  await new Promise((resolve) => setTimeout(resolve, 700));

  await setMarkdown('- [ ] 第一件事\n- [ ] 第二件事\n');
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror li'))`), { label: '任务列表渲染' });
  console.log('① 初始结构：', await outline());

  await clickLastItem();
  await pressEnter();
  console.log('② 回车一次：', await outline());
  console.log('   源码：', JSON.stringify(await readSource()));

  await clickLastItem();
  await pressEnter();
  console.log('③ 回车两次：', await outline());
  // 注意：readSource 会切换源码模式销毁编辑器、丢焦点，选区验证必须放在它之前
  console.log('   DOM 选区：', await exec(`(() => {
    const sel = document.getSelection();
    const a = sel && sel.anchorNode;
    return JSON.stringify({ type: sel ? sel.type : 'none', anchor: a ? (a.nodeType === 3 ? 'text:' + a.data : a.nodeName + '.' + a.className) : null, active: document.activeElement?.className ?? 'none', docHasFocus: document.hasFocus() });
  })()`));

  // 切换模式会丢焦点，先按回编辑器再打字，模拟真实用户「回车后继续输入」
  try { app.focus({ steal: true }); } catch {}
  try { getWindow().show(); getWindow().focus(); } catch {}
  await new Promise((resolve) => setTimeout(resolve, 300));
  await exec(`document.querySelector('.ProseMirror')?.focus()`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  console.log('   打字前焦点：', await docHasFocus(), '| active =', await exec(`document.activeElement?.className ?? 'none'`));
  getWindow().webContents.insertText('回车后直接写字');
  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log('④ 直接打字后：', await outline());
  console.log('   源码：', JSON.stringify(await readSource()));

  // 回归：普通无序列表的空项不应被改动
  await setMarkdown('- 甲\n- 乙\n');
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror li'))`), { label: '无序列表渲染' });
  await clickLastItem();
  await pressEnter();
  console.log('⑤ 无序列表回车一次：', await outline(), JSON.stringify(await readSource()));
  console.log('   源码：', JSON.stringify(await readSource()));

  const img = await getWindow().webContents.capturePage();
  writeFileSync(join(OUT_DIR, 'task-list-debug.png'), img.toPNG());
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

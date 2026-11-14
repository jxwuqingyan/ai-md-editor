/**
 * 表格手柄视觉验证（不进 npm test）：node test/run-e2e.cjs table-visual-check.cjs
 * 选中整列后测量手柄与表格的间隙、工具条与表格是否重叠，并截图。
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
      toolbarVisible: true,
      zoomPercent: 100,
      windowBounds: null
    },
    null,
    2
  ),
  'utf-8'
);
require('../out/main/index.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getWindow = () => BrowserWindow.getAllWindows()[0] ?? null;
const exec = (code) => getWindow().webContents.executeJavaScript(code, true);
const menuAction = (action) => getWindow().webContents.send('menu:action', { action });
const isSource = () => exec(`Boolean(document.querySelector('.source-editor'))`);

async function waitFor(fn, { timeout = 15000, interval = 120, label = '条件' } = {}) {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - started > timeout) throw new Error(`等待超时：${label}`);
    await sleep(interval);
  }
}

async function setMarkdown(md) {
  if (!(await isSource())) {
    menuAction('view:toggle-mode');
    await waitFor(isSource, { label: '源码模式' });
  }
  await exec(`(() => {
    const ta = document.querySelector('.source-editor');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(md)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(350);
  if (await isSource()) {
    menuAction('view:toggle-mode');
    await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror'))`), { label: 'WYSIWYG' });
  }
  await sleep(350);
}

/** 测量：手柄带与表格之间的间隙、工具条与表格的几何关系 */
const measure = () =>
  exec(`(() => {
    const table = document.querySelector('.ProseMirror table');
    const block = document.querySelector('.md-table-block');
    const colBar = document.querySelector('.md-table-col-bar');
    const rowBar = document.querySelector('.md-table-row-bar');
    const corner = document.querySelector('.md-table-corner');
    const toolbar = document.querySelector('.md-table-toolbar:not([hidden])');
    const rect = (el) => (el ? el.getBoundingClientRect() : null);
    const t = rect(table);
    const cb = rect(colBar);
    const rb = rect(rowBar);
    const co = rect(corner);
    const tb = rect(toolbar);
    const handles = [...document.querySelectorAll('.md-table-col-handle')].map((el) => rect(el));
    return JSON.stringify({
      tableTop: t.top, tableLeft: t.left,
      colBarTop: cb.top, colBarLeft: cb.left, colBarHeight: cb.height,
      rowBarLeft: rb.left, rowBarTop: rb.top, rowBarWidth: rb.width,
      cornerLeft: co.left, cornerTop: co.top, cornerW: co.width, cornerH: co.height,
      gapColBarToTable: +(t.top - (cb.top + cb.height)).toFixed(2),
      gapRowBarToTable: +(t.left - (rb.left + rb.width)).toFixed(2),
      handleWidths: handles.map((h) => +h.width.toFixed(2)),
      handleHeight: +handles[0].height.toFixed(2),
      handleGapPx: handles.length > 1 ? +(handles[1].left - (handles[0].left + handles[0].width)).toFixed(2) : null,
      toolbar: tb ? { top: tb.top, bottom: tb.bottom, left: tb.left, right: tb.right } : null,
      toolbarOverlapsTable: tb ? tb.bottom > t.top + 1 && tb.top < t.bottom : null,
      toolbarOverlapsColBar: tb && cb ? tb.bottom > cb.top + 1 && tb.top < cb.bottom : null,
      visibleButtons: [...document.querySelectorAll('.md-table-toolbar:not([hidden]) .md-table-tool-btn')]
        .filter((b) => getComputedStyle(b).display !== 'none')
        .map((b) => b.dataset.tableAction)
    });
  })()`);

setTimeout(() => {
  console.error('诊断超时');
  app.exit(2);
}, 90000).unref();

(async () => {
  await waitFor(() => getWindow(), { label: '窗口' });
  try {
    getWindow().show();
    getWindow().focus();
  } catch {}
  await waitFor(() => exec(`Boolean(document.querySelector('.ProseMirror'))`), { label: '编辑器' });
  await setMarkdown('# 简介\n\n| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n');

  // 悬停表格：手柄浮现
  const cell = await exec(`(() => {
    const p = document.querySelector('.ProseMirror table td p');
    const r = p.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  getWindow().webContents.sendInputEvent({ type: 'mouseMove', x: cell.x, y: cell.y });
  await sleep(250);
  console.log('① 悬停表格 ', JSON.stringify(await measure()));

  // 选中第 2 列
  await exec(`document.querySelector('.md-table-col-handle[data-index="1"]').click()`);
  await sleep(300);
  console.log('② 选中整列 ', JSON.stringify(await measure()));
  mkdirSync('/tmp/md-note-shots', { recursive: true });
  writeFileSync('/tmp/md-note-shots/table-col-selected.png', (await getWindow().webContents.capturePage()).toPNG());

  // 选中整张表（角手柄）
  await exec(`document.querySelector('.md-table-corner').click()`);
  await sleep(300);
  console.log('③ 选中整表 ', JSON.stringify(await measure()));
  writeFileSync('/tmp/md-note-shots/table-all-selected.png', (await getWindow().webContents.capturePage()).toPNG());
  app.exit(0);
})().catch((err) => {
  console.error('诊断异常：', err);
  app.exit(1);
});

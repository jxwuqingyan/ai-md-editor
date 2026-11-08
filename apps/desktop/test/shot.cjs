/**
 * 界面截图脚本（仅用于人工看效果，不参与 npm test）。
 *
 * 启动真实主进程 → 打开一个带样例文件的目录 → 打开侧栏搜索并输入关键词 →
 * 用 webContents.capturePage 截取窗口，输出到 /tmp/md-note-shots/。
 * 用法：npm run build && node test/run-e2e.cjs shot.cjs
 */
const { app, BrowserWindow, dialog } = require('electron');
const { mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const PROFILE_DIR = join(tmpdir(), 'md-note-shot-profile');
rmSync(PROFILE_DIR, { recursive: true, force: true });
mkdirSync(PROFILE_DIR, { recursive: true });
app.setPath('userData', PROFILE_DIR);

/** 截图输出目录 */
const OUT_DIR = join(tmpdir(), 'md-note-shots');
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

/** 样例目录 */
const root = join(tmpdir(), 'md-note-shot-root');
rmSync(root, { recursive: true, force: true });
mkdirSync(join(root, 'notes'), { recursive: true });
writeFileSync(
  join(root, 'README.md'),
  '# 项目说明\n\n这是 MarkdownNote 的样例文档。搜索 AI 会命中这一行。\n\n## 安装\n\nnpm install 即可。\n',
  'utf-8'
);
writeFileSync(
  join(root, 'notes', '会议纪要.md'),
  '# 周会纪要\n\n- 讨论 AI 编辑器的排版细节\n- 确认下周三发布\n- 遗留：AI 搜索结果的排序\n',
  'utf-8'
);
writeFileSync(
  join(root, 'notes', 'roadmap.md'),
  '# Roadmap\n\n| 版本 | 内容 |\n|------|------|\n| 0.14 | AI 搜索、重命名 |\n',
  'utf-8'
);

writeFileSync(
  join(PROFILE_DIR, 'settings.json'),
  `${JSON.stringify(
    {
      themeId: 'light',
      sidebarOpen: true,
      sidebarPanel: 'files',
      tabbarVisible: true,
      toolbarVisible: true,
      zoomPercent: 100,
      windowBounds: null
    },
    null,
    2
  )}\n`,
  'utf-8'
);

require('../out/main/index.js');

/** 主窗口 */
function getWindow() {
  return BrowserWindow.getAllWindows()[0] ?? null;
}

/** 渲染层执行脚本 */
function exec(code) {
  const win = getWindow();
  if (!win) throw new Error('窗口不存在');
  return win.webContents.executeJavaScript(code, true);
}

/** 轮询等待 */
async function waitFor(fn, { timeout = 15000, interval = 100, label = '条件' } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error(`等待超时：${label}`);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/** 截图并落盘 */
async function shot(name) {
  const win = getWindow();
  const image = await win.webContents.capturePage();
  const file = join(OUT_DIR, `${name}.png`);
  writeFileSync(file, image.toPNG());
  console.log('已保存', file);
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', () => {
    void (async () => {
      // 等渲染层挂载完成
      await waitFor(() => exec(`Boolean(document.querySelector('.app'))`), { label: '应用挂载' });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      await exec(`document.querySelector('.filetree-open-btn').click()`);
      await waitFor(
        () => exec(`[...document.querySelectorAll('.tree-name')].some((el) => el.textContent === 'README.md')`),
        { label: '文件树加载' }
      );
      // 展开 notes 子目录，让树看起来完整
      await exec(`(() => {
        const dir = [...document.querySelectorAll('.tree-item.tree-dir')].find((el) => el.textContent.includes('notes'));
        if (dir) dir.click();
        return true;
      })()`);
      await new Promise((r) => setTimeout(r, 400));
      await shot('01-files-light');

      // 打开搜索并输入关键词
      await exec(`document.querySelector('.sidebar-search-btn').click()`);
      await waitFor(() => exec(`Boolean(document.querySelector('.search-input'))`), { label: '搜索面板' });
      await exec(`(() => {
        const input = document.querySelector('.search-input');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'AI');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await new Promise((r) => setTimeout(r, 900));
      await shot('02-search-light');

      // 开启区分大小写 + 正则，看开关的激活态
      await exec(`document.querySelectorAll('.search-option')[0].click()`);
      await new Promise((r) => setTimeout(r, 700));
      await shot('03-search-light-option-on');

      // 深色主题
      await exec(`document.querySelector('.theme-toggle, .topbar-theme-btn, .tabbar-actions button')?.click()`);
      await new Promise((r) => setTimeout(r, 600));
      await shot('04-search-dark');

      app.exit(0);
    })().catch((err) => {
      console.error('截图失败：', err);
      app.exit(1);
    });
  });
});

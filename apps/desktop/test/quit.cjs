/**
 * 退出流程回归测试（真实 Electron 主进程）。
 *
 * 要防的 bug：Dock 菜单退出 / Cmd+Q 触发 `app.quit()` → 窗口 close 被
 * 未保存确认流程 `preventDefault()` → Electron 取消整次退出。若确认结束后
 * 只调用 `win.close()`，窗口关掉了但应用仍挂在 Dock 上，用户必须再点一次
 * 才能退出（真实反馈就是「点好几遍才退」）。
 *
 * 断言方式：连续两次 `app.quit()`（模拟用户连点）后，进程必须在数秒内
 * 自然走到 `will-quit`，且第一次 before-quit 被拦、最后一次被放行。
 *
 * 运行：npm run test:quit --workspace @ai-md-editor/desktop
 */
const { app, BrowserWindow } = require('electron');
const { mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const PROFILE_DIR = join(tmpdir(), 'md-note-quit-profile');
rmSync(PROFILE_DIR, { recursive: true, force: true });
mkdirSync(PROFILE_DIR, { recursive: true });
app.setPath('userData', PROFILE_DIR);
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

const results = [];
function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  const mark = passed ? '✓' : '✗';
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForWindow(timeout = 20000) {
  const started = Date.now();
  for (;;) {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) return win;
    if (Date.now() - started > timeout) throw new Error('等待窗口超时');
    await sleep(100);
  }
}

async function waitRendererReady(win, timeout = 20000) {
  if (!win.webContents.isLoading()) return;
  await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  const started = Date.now();
  // 渲染层挂上「未保存汇总 / 立即写盘」监听需要一点时间，等不到就靠超时兜底
  for (;;) {
    const ready = await win.webContents
      .executeJavaScript('document.querySelector(".ProseMirror") !== null')
      .catch(() => false);
    if (ready) return;
    if (Date.now() - started > timeout) return;
    await sleep(100);
  }
}

/** 每次 before-quit 的拦截结果（监听器注册晚于主进程，能读到主进程的 preventDefault 结果） */
const quitEvents = [];
app.on('before-quit', (event) => {
  quitEvents.push({ prevented: event.defaultPrevented, at: Date.now() });
});

let quittingStartedAt = 0;

/** 超时看门狗：窗口关了但进程没退，就是「点一遍退不掉」的老 bug */
const watchdog = setTimeout(() => {
  check('退出在预期时间内完成', false, `超过 12s 仍未退出（before-quit ${quitEvents.length} 次）`);
  app.exit(1);
}, 12000);

// will-quit 说明所有窗口都关完了、退出真正生效：这里拦一下，先输出断言再决定退出码
app.on('will-quit', (event) => {
  event.preventDefault();
  clearTimeout(watchdog);
  const elapsed = Date.now() - quittingStartedAt;
  const first = quitEvents[0];
  const last = quitEvents[quitEvents.length - 1];

  check('退出时先拦下询问未保存内容', Boolean(first && first.prevented === true), `before-quit 第 1 次 prevented=${first ? first.prevented : '未触发'}`);
  check('确认通过后重新发起退出', quitEvents.length >= 2, `共触发 ${quitEvents.length} 次 before-quit`);
  check('再次发起的退出未被拦截', Boolean(last && last.prevented === false), `最后一次 prevented=${last ? last.prevented : '无'}`);
  check('退出在预期时间内完成', elapsed < 10000, `${elapsed}ms`);
  check('窗口全部关闭', BrowserWindow.getAllWindows().length === 0, `剩余 ${BrowserWindow.getAllWindows().length} 个窗口`);

  const passed = results.filter((item) => item.passed).length;
  console.log(`\n结果：${passed}/${results.length} 通过`);
  app.exit(results.some((item) => !item.passed) ? 1 : 0);
});

app.whenReady().then(async () => {
  try {
    const win = await waitForWindow();
    await waitRendererReady(win);
    win.show();
    await sleep(600);

    quittingStartedAt = Date.now();
    // 模拟 Dock 菜单「退出」被连点两次：第二次不能叠出新的对话框 / 新的写盘
    app.quit();
    await sleep(40);
    app.quit();
  } catch (error) {
    clearTimeout(watchdog);
    console.error('测试执行异常:', error);
    app.exit(1);
  }
});

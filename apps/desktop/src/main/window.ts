/**
 * 窗口管理：创建应用窗口、向渲染层派发待打开的文件。
 * 独立成模块，供主入口与 IPC（新建窗口）共同复用，避免循环依赖。
 */
import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  FlushBeforeCloseChannel,
  FlushReplyChannel,
  UnsavedAskChannel,
  UnsavedReplyChannel,
  type FlushBeforeCloseMessage,
  type FlushReplyMessage,
  type UnsavedSummary,
  type WindowDocumentState
} from '@ai-md-editor/shared';
import { getSettings, saveWindowBounds } from './settings';
import { attachWindowGuards } from './crashGuard';

/** 主窗口引用（供 open-file 事件访问） */
let mainWindow: BrowserWindow | null = null;

/** 默认窗口尺寸 */
const DEFAULT_WINDOW_SIZE = { width: 1200, height: 800 };

/** 询问渲染层未保存文档的等待上限（渲染层未响应时按「无未保存内容」处理，不阻塞退出） */
const UNSAVED_REPLY_TIMEOUT_MS = 800;

/** 等待渲染层写盘结果的上限：留足大文件与网络盘写入的时间，但不能无限等 */
const FLUSH_REPLY_TIMEOUT_MS = 15000;

/**
 * 退出 / 关闭的互斥状态。
 *
 * 关键背景：`app.quit()` 会依次关闭所有窗口，只要有一个窗口的 `close` 被
 * `preventDefault()`，整次退出就被**取消**（不会再自动重来）。所以「Dock 退出 /
 * Cmd+Q」必须显式记住「这是一次退出请求」，等确认流程走完再由我们自己重新
 * `app.quit()`，否则窗口关掉了、应用却还挂在 Dock 上，用户得再点一次才退。
 */
/** 用户已发起退出（Dock 菜单退出 / Cmd+Q / 系统关机） */
let quitRequested = false;
/** 退出确认已通过，可以真正退出：此后所有 close 一律放行 */
let quitAllowed = false;
/** 已经在跑退出确认流程，避免连点退出时叠出多个对话框 / 多次写盘 */
let quitFlowRunning = false;
/** 已确认可关闭的窗口，close 事件里直接放行 */
const closableWindows = new WeakSet<BrowserWindow>();
/** 本应用创建的窗口；导出用的隐藏窗口不参与退出确认 */
const appWindows = new Set<BrowserWindow>();
/** 负责持久化窗口位置的那个窗口（首个窗口）；其余窗口只在内存里层叠，不回写设置 */
let boundsOwner: BrowserWindow | null = null;
/** 同一窗口的确认流程只跑一份，重复的关闭请求复用同一结果 */
const confirmTasks = new Map<BrowserWindow, Promise<boolean>>();

/**
 * 向渲染层询问未保存文档数量。
 * 用一次性回复通道实现「主进程发问 → 渲染层同步回答」，比让渲染层主动上报更准确：
 * 关闭动作发生的那一刻的标签状态才是要判断的对象。
 */
function requestUnsavedSummary(win: BrowserWindow): Promise<UnsavedSummary | null> {
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | null = null;
    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      timer = null;
      ipcMain.removeListener(UnsavedReplyChannel, onReply);
    };
    const onReply = (_event: Electron.IpcMainEvent, summary: UnsavedSummary): void => {
      // 多窗口时只认发起询问的那个窗口，避免别的窗口抢先回复
      if (_event.sender !== win.webContents) return;
      cleanup();
      resolve(summary && typeof summary === 'object' ? summary : null);
    };

    if (win.webContents.isDestroyed()) {
      resolve(null);
      return;
    }
    ipcMain.on(UnsavedReplyChannel, onReply);
    timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, UNSAVED_REPLY_TIMEOUT_MS);
    win.webContents.send(UnsavedAskChannel);
  });
}

/**
 * 要求渲染层把所有有路径的改动写盘，并等待真实结果。
 *
 * 带 requestId：多窗口 / 重复请求时按 id 匹配回复，避免串话；
 * 超时返回 null，调用方按「保存未完成」处理，绝不当成保存成功。
 */
function flushBeforeClose(win: BrowserWindow): Promise<FlushReplyMessage | null> {
  const requestId = randomUUID();
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | null = null;
    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      timer = null;
      ipcMain.removeListener(FlushReplyChannel, onReply);
    };
    const onReply = (event: Electron.IpcMainEvent, reply: FlushReplyMessage): void => {
      if (event.sender !== win.webContents) return;
      if (!reply || reply.requestId !== requestId) return;
      cleanup();
      resolve(reply);
    };

    if (win.webContents.isDestroyed()) {
      resolve(null);
      return;
    }
    ipcMain.on(FlushReplyChannel, onReply);
    timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, FLUSH_REPLY_TIMEOUT_MS);
    const message: FlushBeforeCloseMessage = { requestId };
    win.webContents.send(FlushBeforeCloseChannel, message);
  });
}

/**
 * 关闭窗口前的确认流程。
 *
 * - 只有「未落盘（无磁盘路径）且有改动」的文档才拦人：这类内容关掉就真的没了。
 * - 有路径的改动逐份写盘，等渲染层回包确认；写盘失败或超时都会拦下退出，
 *   让用户决定「取消退出」还是「仍要退出」，不再靠固定延时猜写盘是否完成。
 *
 * @returns true 表示可以关闭
 */
async function confirmClose(win: BrowserWindow): Promise<boolean> {
  const summary = await requestUnsavedSummary(win);
  if (summary && summary.untitledCount > 0) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['取消', '仍要退出'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: `有 ${summary.untitledCount} 个文档尚未保存到磁盘`,
      detail: '退出后这些内容会丢失。建议先取消，用「另存为」保存后再退出。'
    });
    if (response !== 1) return false;
  }
  if (win.webContents.isDestroyed()) return true;

  const reply = await flushBeforeClose(win);
  if (reply === null) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['取消', '仍要退出'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: '保存没有在预期时间内完成',
      detail: '为避免丢失改动，建议取消退出，确认文档保存后再关闭。'
    });
    return response === 1;
  }
  if (reply.failures.length > 0) {
    const list = reply.failures
      .slice(0, 6)
      .map((item) => `· ${item.name}：${item.reason}`)
      .join('\n');
    const more = reply.failures.length > 6 ? `\n… 另有 ${reply.failures.length - 6} 个文档` : '';
    const { response } = await dialog.showMessageBox(win, {
      type: 'error',
      buttons: ['取消', '仍要退出'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: `有 ${reply.failures.length} 个文档未能保存到磁盘`,
      detail: `${list}${more}\n\n退出会丢失这些文档未保存的改动。`
    });
    return response === 1;
  }
  return true;
}

/**
 * 同一窗口的关闭确认只跑一次。
 * 「红点关闭」与「Dock 退出」可能几乎同时发生，重入会重复弹框、重复写盘。
 */
function confirmOnce(win: BrowserWindow): Promise<boolean> {
  const running = confirmTasks.get(win);
  if (running) return running;
  const task = confirmClose(win).finally(() => {
    confirmTasks.delete(win);
  });
  confirmTasks.set(win, task);
  return task;
}

/** 还需确认的窗口（导出窗口、已确认关闭的窗口都不算） */
function windowsToConfirm(): BrowserWindow[] {
  return [...appWindows].filter((win) => !win.isDestroyed() && !closableWindows.has(win));
}

/**
 * 走完一个窗口的确认流程后真正关闭它。
 * 任何异常都按「不拦用户」处理，避免卡在关不掉的状态。
 */
function closeAfterConfirm(win: BrowserWindow): void {
  void confirmOnce(win)
    .then((ok) => {
      if (!ok || win.isDestroyed()) return;
      closableWindows.add(win);
      win.close();
    })
    .catch(() => {
      if (win.isDestroyed()) return;
      closableWindows.add(win);
      win.close();
    });
}

/**
 * 退出确认流程：逐个窗口确认，全部通过后重新发起一次 `app.quit()`。
 * 任一步被用户取消就把状态复位，让下次退出重新走一遍。
 */
async function runQuitFlow(): Promise<void> {
  if (quitFlowRunning) return;
  quitFlowRunning = true;
  try {
    for (const win of windowsToConfirm()) {
      if (win.isDestroyed()) continue;
      const ok = await confirmOnce(win);
      if (!ok) {
        quitRequested = false;
        return;
      }
      closableWindows.add(win);
    }
    quitAllowed = true;
    app.quit();
  } finally {
    quitFlowRunning = false;
  }
}

/**
 * 安装退出拦截（主入口在 `app.whenReady()` 之前调用）。
 *
 * 之前没有这层拦截：Dock 退出 → 窗口 close 被拦 → Electron 取消整次退出，
 * 确认流程结束后只关了窗口，应用仍留在 Dock 上，于是「退出要连点好几次」。
 */
export function setupQuitGuard(): void {
  app.on('before-quit', (event) => {
    if (quitAllowed) return;
    // 没有需要确认的窗口（例如红点已经关完了）就正常退出
    if (windowsToConfirm().length === 0) return;
    event.preventDefault();
    quitRequested = true;
    // 确认流程本身出错时不把用户困在退不掉的窗口里
    void runQuitFlow().catch(() => {
      quitAllowed = true;
      app.quit();
    });
  });
}

/**
 * 窗口 close 事件处理：先拦下，确认通过后再关一次。
 *
 * @returns 无（事件对象由调用方持有）
 */
function handleWindowClose(win: BrowserWindow, event: Electron.Event): void {
  if (quitAllowed || closableWindows.has(win)) return;
  event.preventDefault();
  // 退出流程已在跑：由它统一负责关窗与再次退出，这里不再另起一份
  if (quitRequested) return;
  closeAfterConfirm(win);
}

/**
 * 把渲染层的「当前文档」同步到窗口标题栏。
 *
 * - 标题显示文档名，多窗口 / Mission Control / 窗口菜单里能分清谁是谁
 * - macOS 用系统原生的「已编辑」小圆点（标题栏关闭按钮上的点）表示未保存
 * - macOS 还设置代表文件（representedFilename）：标题栏出现文件图标，⌘点击可看路径
 *
 * macOS 有原生小圆点，标题里不再加 `•` 前缀（重复显示很脏）；
 * 其他平台没有这个小圆点，用 `•` 前缀补上「未保存」信息。
 */
export function applyWindowDocumentState(win: BrowserWindow, state: WindowDocumentState): void {
  if (win.isDestroyed()) return;
  const name = (state.name || '').trim() || 'MarkdownNote';
  const dirty = Boolean(state.dirty);
  win.setTitle(dirty && process.platform !== 'darwin' ? `• ${name}` : name);
  if (process.platform === 'darwin') {
    win.setDocumentEdited(dirty);
    win.setRepresentedFilename(state.path ?? '');
  }
}

/**
 * 判断上次保存的窗口位置是否还在某块屏幕内。
 * 显示器拔掉/改分辨率后旧坐标可能完全在屏幕外，此时退回默认居中。
 */
function usableBounds(): { x?: number; y?: number; width: number; height: number } {
  const saved = getSettings().windowBounds;
  if (!saved) return { ...DEFAULT_WINDOW_SIZE };
  const inside = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      saved.x + 80 < area.x + area.width &&
      saved.x + saved.width - 80 > area.x &&
      saved.y >= area.y - 20 &&
      saved.y + 40 < area.y + area.height
    );
  });
  if (!inside) return { ...DEFAULT_WINDOW_SIZE };
  return { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
}

/**
 * 计算新窗口的位置与尺寸。
 *
 * 第一个窗口沿用上次保存的位置；之后新建的窗口在前一个窗口基础上**层叠偏移**，
 * 否则 `⇧⌘N` 建出来的窗口会和已有窗口完全重合，看着像没反应。
 */
function nextWindowBounds(): { x?: number; y?: number; width: number; height: number } {
  const existing = [...appWindows].filter((win) => !win.isDestroyed());
  if (existing.length === 0) return usableBounds();

  const ref = existing[existing.length - 1].getBounds();
  const area = screen.getDisplayMatching(ref).workArea;
  const step = 28;
  let x = ref.x + step;
  let y = ref.y + step;
  // 贴到屏幕右下边时回到工作区左上，继续往右下层叠，不会跑到屏幕外
  if (x + ref.width > area.x + area.width) x = area.x + step * 2;
  if (y + ref.height > area.y + area.height) y = area.y + step * 2;
  return { x, y, width: ref.width, height: ref.height };
}

/**
 * 创建主窗口。
 * 遵循安全基线：contextIsolation 开启、nodeIntegration 关闭、sandbox 开启。
 * 开发环境加载 Vite dev server，生产环境加载打包后的 index.html。
 */
export function createWindow(): void {
  const bounds = nextWindowBounds();
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 720,
    minHeight: 480,
    show: false,
    // macOS 使用屏幕顶部原生菜单；其他平台隐藏窗口内菜单，避免占用编辑区
    autoHideMenuBar: process.platform !== 'darwin',
    title: 'MarkdownNote',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow = win;
  appWindows.add(win);
  // 只有一个窗口负责持久化位置/尺寸：多窗口各自回写会互相覆盖，
  // 下次启动的窗口位置就变成「最后一个被拖动的那个」随机值
  if (!boundsOwner) boundsOwner = win;

  // 窗口就绪后再显示，避免白屏闪烁
  win.on('ready-to-show', () => win.show());

  // 记住窗口尺寸与位置（防抖在 settings 内部处理）
  let boundsTimer: NodeJS.Timeout | null = null;
  const rememberBounds = (): void => {
    if (win !== boundsOwner) return;
    if (win.isDestroyed() || win.isFullScreen() || win.isMinimized() || win.isMaximized()) return;
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!win.isDestroyed()) saveWindowBounds(win.getBounds());
    }, 500);
  };
  win.on('resize', rememberBounds);
  win.on('move', rememberBounds);
  win.on('close', () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    if (win !== boundsOwner) return;
    if (!win.isDestroyed() && !win.isFullScreen() && !win.isMinimized() && !win.isMaximized()) {
      saveWindowBounds(win.getBounds());
    }
  });

  // 关闭前确认：未落盘的文档关掉就真的没了，先问一句。
  // 只有确认通过后才真正关闭（先 preventDefault，再在回调里 close 一次）。
  // 真正的互斥逻辑在 handleWindowClose 里，和「Dock 退出」共用同一套状态。
  win.on('close', (event) => handleWindowClose(win, event));

  // 卡死 / 崩溃兜底（见 crashGuard.ts）
  attachWindowGuards(win);

  win.on('closed', () => {
    appWindows.delete(win);
    confirmTasks.delete(win);
    if (boundsOwner === win) boundsOwner = null;
    if (mainWindow === win) mainWindow = null;
  });

  // 外部链接用系统浏览器打开，不在应用内导航
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/**
 * 应用就绪前收到的待打开文件。
 * Finder「打开方式」/ 拖到 Dock 图标启动时，macOS 的 `open-file` 事件会在
 * `app.whenReady()` 完成**之前**触发，此时不能创建 BrowserWindow，
 * 只能先把路径排队，等入口里调用 flushPendingOpenFiles() 再依次打开。
 */
const pendingOpenFiles: string[] = [];

/** 通知渲染进程打开指定路径的文件（等渲染层就绪后再发送） */
export function openFileInRenderer(filePath: string): void {
  // 应用未就绪时 BrowserWindow 尚不可用，先排队避免抛错
  if (!app.isReady()) {
    if (!pendingOpenFiles.includes(filePath)) pendingOpenFiles.push(filePath);
    return;
  }
  if (!mainWindow && BrowserWindow.getAllWindows().length === 0) createWindow();
  const target = BrowserWindow.getFocusedWindow() ?? mainWindow ?? BrowserWindow.getAllWindows()[0];
  if (!target) return;
  if (target.webContents.isLoading()) {
    target.webContents.once('did-finish-load', () => {
      target.webContents.send('open-file', filePath);
    });
  } else {
    target.webContents.send('open-file', filePath);
  }
}

/** 应用就绪后把积压的待打开文件依次交给渲染层（在主入口创建首个窗口后调用） */
export function flushPendingOpenFiles(): void {
  while (pendingOpenFiles.length > 0) {
    const filePath = pendingOpenFiles.shift();
    if (filePath) openFileInRenderer(filePath);
  }
}

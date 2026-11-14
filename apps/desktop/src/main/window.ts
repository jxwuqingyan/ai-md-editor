/**
 * 窗口管理：创建应用窗口、向渲染层派发待打开的文件。
 * 独立成模块，供主入口与 IPC（新建窗口）共同复用，避免循环依赖。
 */
import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron';
import { join } from 'node:path';
import {
  FlushBeforeCloseChannel,
  UnsavedAskChannel,
  UnsavedReplyChannel,
  type UnsavedSummary
} from '@ai-md-editor/shared';
import { getSettings, saveWindowBounds } from './settings';

/** 主窗口引用（供 open-file 事件访问） */
let mainWindow: BrowserWindow | null = null;

/** 默认窗口尺寸 */
const DEFAULT_WINDOW_SIZE = { width: 1200, height: 800 };

/** 询问渲染层未保存文档的等待上限（渲染层未响应时按「无未保存内容」处理，不阻塞退出） */
const UNSAVED_REPLY_TIMEOUT_MS = 800;

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
 * 关闭窗口前的确认流程。
 *
 * - 只有「未落盘（无磁盘路径）且有改动」的文档才拦人：这类内容关掉就真的没了。
 * - 有路径的改动交给自动保存，这里额外触发一次立即写盘，避免卡在防抖窗口里丢内容。
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
  if (!win.webContents.isDestroyed()) {
    win.webContents.send(FlushBeforeCloseChannel);
    // 给渲染层一点时间把 writeFile 发出去（写盘本身在 IPC 里完成）
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return true;
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
 * 创建主窗口。
 * 遵循安全基线：contextIsolation 开启、nodeIntegration 关闭、sandbox 开启。
 * 开发环境加载 Vite dev server，生产环境加载打包后的 index.html。
 */
export function createWindow(): void {
  const bounds = usableBounds();
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

  // 窗口就绪后再显示，避免白屏闪烁
  win.on('ready-to-show', () => win.show());

  // 记住窗口尺寸与位置（防抖在 settings 内部处理）
  let boundsTimer: NodeJS.Timeout | null = null;
  const rememberBounds = (): void => {
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
    if (!win.isDestroyed() && !win.isFullScreen() && !win.isMinimized() && !win.isMaximized()) {
      saveWindowBounds(win.getBounds());
    }
  });

  // 关闭前确认：未落盘的文档关掉就真的没了，先问一句。
  // 只有确认通过后才真正关闭（先 preventDefault，再在回调里 close 一次）。
  let closeConfirmed = false;
  win.on('close', (event) => {
    if (closeConfirmed) return;
    event.preventDefault();
    void confirmClose(win)
      .then((ok) => {
        if (!ok || win.isDestroyed()) return;
        closeConfirmed = true;
        win.close();
      })
      .catch(() => {
        // 确认流程本身出错时不拦用户退出
        if (!win.isDestroyed()) {
          closeConfirmed = true;
          win.close();
        }
      });
  });

  win.on('closed', () => {
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

/**
 * 窗口管理：创建应用窗口、向渲染层派发待打开的文件。
 * 独立成模块，供主入口与 IPC（新建窗口）共同复用，避免循环依赖。
 */
import { BrowserWindow, screen, shell } from 'electron';
import { join } from 'node:path';
import { getSettings, saveWindowBounds } from './settings';

/** 主窗口引用（供 open-file 事件访问） */
let mainWindow: BrowserWindow | null = null;

/** 默认窗口尺寸 */
const DEFAULT_SIZE = { width: 1200, height: 800 };

/**
 * 判断上次保存的窗口位置是否还在某块屏幕内。
 * 显示器拔掉/改分辨率后旧坐标可能完全在屏幕外，此时退回默认居中。
 */
function usableBounds(): { x?: number; y?: number; width: number; height: number } {
  const saved = getSettings().windowBounds;
  if (!saved) return { ...DEFAULT_SIZE };
  const inside = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      saved.x + 80 < area.x + area.width &&
      saved.x + saved.width - 80 > area.x &&
      saved.y >= area.y - 20 &&
      saved.y + 40 < area.y + area.height
    );
  });
  if (!inside) return { ...DEFAULT_SIZE };
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

/** 通知渲染进程打开指定路径的文件（等渲染层就绪后再发送） */
export function openFileInRenderer(filePath: string): void {
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

import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { is } from '@electron-toolkit/utils';

/**
 * 创建主窗口。
 * 遵循安全基线：contextIsolation 开启、nodeIntegration 关闭、sandbox 开启。
 * 开发环境加载 Vite dev server，生产环境加载打包后的 index.html。
 */
function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    title: 'ai-md-editor',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // 窗口就绪后再显示，避免白屏闪烁
  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  // 外部链接用系统浏览器打开，不在应用内导航
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // 开发环境：加载 dev server（支持热更新）；生产环境：加载本地打包文件
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/**
 * 应用就绪后创建窗口。
 * macOS 特有：点击 dock 图标且无窗口时重新创建窗口。
 */
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 非 macOS：所有窗口关闭后退出应用
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

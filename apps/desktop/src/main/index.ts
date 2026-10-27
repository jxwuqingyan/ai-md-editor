import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { registerIpcHandlers } from './ipc';
import { loadRecent } from './recent';

// 设置应用显示名（macOS 菜单栏 / 关于面板 / 默认窗口标题）
app.setName('MarkdownNote');

/** 主窗口引用（供 open-file 事件访问） */
let mainWindow: BrowserWindow | null = null;

/**
 * 创建主窗口。
 * 遵循安全基线：contextIsolation 开启、nodeIntegration 关闭、sandbox 开启。
 * 开发环境加载 Vite dev server，生产环境加载打包后的 index.html。
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    title: 'MarkdownNote',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // 窗口就绪后再显示，避免白屏闪烁
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // 窗口关闭时置空引用
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外部链接用系统浏览器打开，不在应用内导航
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // 开发环境：加载 dev server（支持热更新）；生产环境：加载本地打包文件
  // 判断依据：dev 模式下 electron-vite 会注入 ELECTRON_RENDERER_URL 环境变量
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/**
 * 通知渲染进程打开指定路径的文件。
 * 渲染层通过 window.api.openPath 读取内容并载入。
 */
function openFileInRenderer(filePath: string): void {
  if (!mainWindow) return;
  // 等渲染进程就绪后再发送（若未就绪，稍后重试）
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('open-file', filePath);
    });
  } else {
    mainWindow.webContents.send('open-file', filePath);
  }
}

/**
 * 应用就绪后创建窗口。
 * macOS 特有：点击 dock 图标且无窗口时重新创建窗口。
 */
app.whenReady().then(async () => {
  // 加载最近文件列表（启动时）
  await loadRecent();

  // 注册文件操作相关 IPC handler
  registerIpcHandlers();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// macOS：拖拽文件到 Dock 图标 / Finder「打开方式」时触发
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  openFileInRenderer(filePath);
});

// Windows/Linux：通过命令行参数打开文件
app.on('second-instance', (_event, argv) => {
  // 取最后一个非 flag 参数作为文件路径
  const filePath = argv.find((arg) => !arg.startsWith('-') && arg !== process.execPath);
  if (filePath) {
    openFileInRenderer(filePath);
  }
});

// 非 macOS：所有窗口关闭后退出应用
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

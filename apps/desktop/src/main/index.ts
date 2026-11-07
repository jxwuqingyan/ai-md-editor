import { app, BrowserWindow } from 'electron';
import { registerIpcHandlers } from './ipc';
import { setupApplicationMenu } from './menu';
import { loadRecent } from './recent';
import { createWindow, openFileInRenderer } from './window';

// 设置应用显示名（macOS 菜单栏 / 关于面板 / 默认窗口标题）
app.setName('MarkdownNote');

/**
 * 应用就绪后创建窗口。
 * macOS 特有：点击 dock 图标且无窗口时重新创建窗口。
 */
app.whenReady().then(async () => {
  // 加载最近文件列表（启动时）
  await loadRecent();

  // 注册文件操作相关 IPC handler
  registerIpcHandlers();
  // 安装原生应用菜单（macOS 位于屏幕顶部，不占窗口高度）
  setupApplicationMenu();

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

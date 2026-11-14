import { app, BrowserWindow, systemPreferences } from 'electron';
import { registerIpcHandlers } from './ipc';
import { setupApplicationMenu } from './menu';
import { loadRecent } from './recent';
import { flushSettings, loadSettings } from './settings';
import { createWindow, flushPendingOpenFiles, openFileInRenderer } from './window';

/**
 * macOS 会往「编辑」菜单自动追加「自动填充 / 开始听写… / 表情与符号」三项，
 * 它们不在菜单模板里，也不是本应用功能。系统只提供未公开的默认项开关来关掉，
 * 且必须在菜单构建之前写入，所以放在主进程入口最顶部。
 */
if (process.platform === 'darwin') {
  for (const key of [
    'NSDisabledDictationMenuItem',
    'NSDisabledCharacterPaletteMenuItem',
    'NSDisabledAutoFillMenuItem'
  ]) {
    try {
      systemPreferences.setUserDefault(key, 'boolean', true);
    } catch {
      // 系统版本不识别该键时忽略，不影响其它菜单项
    }
  }
}

// 设置应用显示名（macOS 菜单栏 / 关于面板 / 默认窗口标题）
app.setName('MarkdownNote');

/**
 * 单实例锁：没有它 `second-instance` 事件永远不会触发，
 * 再启动一次应用（或双击 .md 文件）会另起一个进程，文件也开不到已有窗口里。
 */
const singleInstance = app.requestSingleInstanceLock();

if (!singleInstance) {
  app.quit();
} else {
  /**
   * 应用就绪后创建窗口。
   * macOS 特有：点击 dock 图标且无窗口时重新创建窗口。
   */
  app.whenReady().then(async () => {
    // 先读设置：窗口尺寸、主题、缩放等都依赖它
    loadSettings();
    // 加载最近文件列表（启动时）
    await loadRecent();

    // 注册文件操作相关 IPC handler
    registerIpcHandlers();
    // 安装原生应用菜单（macOS 位于屏幕顶部，不占窗口高度）
    setupApplicationMenu();

    createWindow();

    // 「打开方式」启动时 open-file 在就绪前触发，路径已排队；现在窗口已建，依次打开
    flushPendingOpenFiles();

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

  // Windows/Linux：已有实例时，把命令行里的文件交给它打开
  app.on('second-instance', (_event, argv) => {
    const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (target) {
      if (target.isMinimized()) target.restore();
      target.focus();
    }
    const filePath = argv.find((arg) => !arg.startsWith('-') && arg !== process.execPath && /\.[a-z0-9]+$/i.test(arg));
    if (filePath) openFileInRenderer(filePath);
  });
}

// 退出前把防抖中的设置立即落盘
app.on('will-quit', () => {
  flushSettings();
});

// 非 macOS：所有窗口关闭后退出应用
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

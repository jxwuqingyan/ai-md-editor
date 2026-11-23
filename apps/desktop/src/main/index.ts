import { app, BrowserWindow, systemPreferences } from 'electron';
import { setupCrashGuard } from './crashGuard';
import { registerIpcHandlers } from './ipc';
import { logInfo } from './logger';
import { refreshRecentMenu, setupApplicationMenu } from './menu';
import { loadRecent } from './recent';
import { flushSettings, loadSettings } from './settings';
import { createWindow, flushPendingOpenFiles, openFileInRenderer, setupQuitGuard } from './window';

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
   * 退出拦截必须尽早装：Dock 菜单退出 / Cmd+Q 触发 `before-quit` 时，
   * 窗口的 close 会拦下退出，得由这层把确认结果重新转成一次 `app.quit()`。
   */
  setupQuitGuard();
  // 崩溃兜底要能捕获最早的异常，因此和退出守卫一样尽早安装
  setupCrashGuard();

  /**
   * 应用就绪后创建窗口。
   * macOS 特有：点击 dock 图标且无窗口时重新创建窗口。
   */
  app.whenReady().then(async () => {
    // 先读设置：窗口尺寸、主题、缩放等都依赖它
    loadSettings();

    // 注册文件操作相关 IPC handler
    registerIpcHandlers();
    // 安装原生应用菜单（macOS 位于屏幕顶部，不占窗口高度）
    setupApplicationMenu();

    // 先建窗口：最近文件列表不影响首屏，别让它挡在窗口出现之前
    createWindow();
    logInfo(`应用启动（${process.platform}/${process.arch}，版本 ${app.getVersion()}）`);

    // 最近文件读完后刷新「打开最近文件」子菜单（展开下拉时渲染层也会重新拉取）
    await loadRecent();
    refreshRecentMenu();

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
  logInfo('应用退出');
  flushSettings();
});

// 非 macOS：所有窗口关闭后退出应用
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

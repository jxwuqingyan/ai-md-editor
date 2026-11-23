/**
 * 崩溃与卡死兜底。
 *
 * 之前渲染进程一崩（大文档内存吃紧、GPU 进程被杀、页面里抛未捕获异常卡死），
 * 用户看到的就是一块白屏，既不提示也没法自救，只能强退应用。
 * 这里把三类情况接管起来：
 *
 * 1. `render-process-gone`：渲染进程消失 → 提示并允许重新加载；
 * 2. `unresponsive`：窗口连续无响应 → 提示「继续等待 / 重新加载」；
 * 3. 主进程未捕获异常 / 未处理的 Promise 拒绝 → 至少写进日志，
 *    未捕获异常不再直接终止进程（保住用户还没保存的窗口）。
 *
 * 日志写在 `main/logger.ts`，帮助菜单可打开日志目录。
 */
import { app, BrowserWindow, dialog } from 'electron';
import { logError, logInfo } from './logger';

/** 正在退出时不要再弹崩溃提示（用户已经决定关掉应用了） */
let quitting = false;

/** 一次会话内只弹一次主进程异常提示，避免反复打断 */
let mainProcessNoticeShown = false;

/** 崩溃原因的中文说明（Electron 只给枚举值） */
function reasonText(reason: string): string {
  switch (reason) {
    case 'crashed':
      return '渲染进程崩溃';
    case 'oom':
      return '内存不足被系统回收';
    case 'killed':
      return '渲染进程被系统终止';
    case 'abnormal-exit':
      return '渲染进程异常退出';
    case 'launch-failed':
      return '渲染进程启动失败';
    case 'integrity-failure':
      return '资源完整性校验失败';
    default:
      return `渲染进程退出（${reason}）`;
  }
}

/**
 * 给单个窗口挂「无响应」处理。
 * 必须在创建窗口时逐个挂，因为 `unresponsive` 是窗口级事件。
 */
export function attachWindowGuards(win: BrowserWindow): void {
  win.on('unresponsive', () => {
    if (quitting || win.isDestroyed()) return;
    logError('窗口无响应，等待用户决定');
    void dialog
      .showMessageBox({
        type: 'warning',
        buttons: ['继续等待', '重新加载'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        message: '窗口长时间没有响应',
        detail: '可以继续等待它恢复；如果一直没有反应，重新加载会关闭这个窗口里未保存的改动。'
      })
      .then(({ response }) => {
        if (response !== 1 || win.isDestroyed()) return;
        logInfo('用户选择重新加载无响应窗口');
        win.webContents.reload();
      })
      .catch(() => undefined);
  });
}

/** 安装全局崩溃兜底（主入口在 whenReady 之前调用） */
export function setupCrashGuard(): void {
  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('render-process-gone', (_event, webContents, details) => {
    logError(`渲染进程退出：${details.reason}（exitCode=${details.exitCode}）`);
    if (quitting) return;
    // 窗口可能已被销毁（退出、关闭），拿不到就不再提示
    const target = BrowserWindow.fromWebContents(webContents);
    if (!target || target.isDestroyed()) return;
    // 导出 PDF 用的隐藏窗口崩溃不需要打扰用户，只记日志
    if (!target.isVisible()) return;

    void dialog
      .showMessageBox(target, {
        type: 'error',
        buttons: ['重新加载', '退出应用'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        message: reasonText(String(details.reason)),
        detail: '这个窗口的页面已停止运行，未保存的改动可能已丢失。\n可以重新加载窗口继续使用（详情见日志：帮助 → 打开日志目录）。'
      })
      .then(({ response }) => {
        if (response === 0) {
          logInfo('用户选择重新加载崩溃的窗口');
          if (!webContents.isDestroyed()) webContents.reload();
        } else {
          app.quit();
        }
      })
      .catch(() => undefined);
  });

  // GPU / 网络等辅助进程异常：记日志即可，渲染进程会自行降级
  app.on('child-process-gone', (_event, details) => {
    logError(`辅助进程退出：${details.type} / ${details.reason}（exitCode=${details.exitCode}）`);
  });

  process.on('uncaughtException', (error) => {
    logError('主进程未捕获异常', error);
    if (mainProcessNoticeShown) return;
    mainProcessNoticeShown = true;
    void dialog
      .showMessageBox({
        type: 'error',
        buttons: ['知道了'],
        noLink: true,
        message: '应用遇到内部错误',
        detail: '操作可能没有完成。建议保存文档后重启应用；详细信息已写入日志（帮助 → 打开日志目录）。'
      })
      .catch(() => undefined);
  });

  process.on('unhandledRejection', (reason) => {
    logError('主进程未处理的 Promise 拒绝', reason);
  });
}

/**
 * 打开中的文档外部修改监听。
 *
 * 只监听渲染层显式登记的文件（当前活动标签），不递归、不常驻：
 * - 自身写入（保存/自动保存）在 grace 期内忽略，避免「保存后立刻提示已变更」
 * - 事件按 250ms 去抖，编辑器/其它程序保存时往往连发多个事件
 * - 文件被整体替换（rename）后重建 watcher，否则句柄指向旧 inode 不再触发
 */
import { watch, type FSWatcher } from 'node:fs';
import { BrowserWindow } from 'electron';
import { FileChangedChannel, type FileChangedMessage } from '@ai-md-editor/shared';

/** 自身写入的忽略窗口（毫秒） */
const SELF_WRITE_GRACE_MS = 1500;

/** 事件去抖窗口（毫秒） */
const DEBOUNCE_MS = 250;

interface WatchEntry {
  watcher: FSWatcher;
  timer: NodeJS.Timeout | null;
}

const watchers = new Map<string, WatchEntry>();

/** 各文件最近一次由本应用写入的时间 */
const selfWriteAt = new Map<string, number>();

/** 记录「本应用刚写过这个文件」，用于过滤自身写入触发的事件 */
export function markSelfWrite(filePath: string): void {
  const now = Date.now();
  selfWriteAt.set(filePath, now);
  // 顺手清理过期记录，避免长期运行后 map 无限增长
  if (selfWriteAt.size > 64) {
    for (const [key, at] of selfWriteAt) {
      if (now - at > SELF_WRITE_GRACE_MS * 20) selfWriteAt.delete(key);
    }
  }
}

/** 是否处于自身写入的忽略窗口内 */
function isSelfWrite(filePath: string): boolean {
  const at = selfWriteAt.get(filePath);
  return at !== undefined && Date.now() - at < SELF_WRITE_GRACE_MS;
}

/** 把「文件已变更」广播给所有窗口（渲染层只处理自己打开的那个路径） */
function broadcast(filePath: string): void {
  const message: FileChangedMessage = { path: filePath };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(FileChangedChannel, message);
  }
}

/** 创建底层 watcher（文件被替换后会重新调用） */
function createWatcher(filePath: string): FSWatcher | null {
  try {
    const watcher = watch(filePath, { persistent: false }, (eventType) => {
      const entry = watchers.get(filePath);
      if (!entry) return;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        entry.timer = null;
        if (isSelfWrite(filePath)) return;
        broadcast(filePath);
        // 文件被外部重写/替换（很多编辑器保存走「写临时文件 + rename」）：
        // 原 watcher 盯着旧 inode，必须重建才能继续收到后续变更
        if (eventType === 'rename') {
          try {
            entry.watcher.close();
          } catch {
            // 已关闭，忽略
          }
          const next = createWatcher(filePath);
          if (next) entry.watcher = next;
          else watchers.delete(filePath);
        }
      }, DEBOUNCE_MS);
    });
    // 文件被删除时 watcher 会抛 error，不接住会变成未捕获异常
    watcher.on('error', () => unwatchDocumentFile(filePath));
    return watcher;
  } catch {
    // 文件不存在 / 无权限：静默跳过，不阻塞打开流程
    return null;
  }
}

/** 开始监听某个文档文件（重复调用是幂等的） */
export function watchDocumentFile(filePath: string): void {
  if (!filePath || watchers.has(filePath)) return;
  const watcher = createWatcher(filePath);
  if (!watcher) return;
  watchers.set(filePath, { watcher, timer: null });
}

/** 停止监听某个文档文件 */
export function unwatchDocumentFile(filePath: string): void {
  const entry = watchers.get(filePath);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  try {
    entry.watcher.close();
  } catch {
    // 已关闭，忽略
  }
  watchers.delete(filePath);
  selfWriteAt.delete(filePath);
}

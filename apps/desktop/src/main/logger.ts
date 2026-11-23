/**
 * 主进程日志（落盘）。
 *
 * 打包后的应用没有终端，`console.error` 谁也看不到；用户报「保存失败 / 白屏」
 * 时如果只有前台弹窗，问题基本无法定位。这里把关键事件与异常写到
 * 系统日志目录（macOS：~/Library/Logs/MarkdownNote），并在帮助菜单里提供入口。
 *
 * 设计取舍：
 * - **同步追加**：只在错误 / 生命周期节点写，频率低，同步实现最简单可靠
 *   （异步写在进程崩溃的最后时刻经常来不及 flush）
 * - **单文件 + 轮转**：超过 2MB 时 main.log → main.1.log → main.2.log，
 *   只保留三份，避免长期使用把磁盘写满
 * - **自身绝不抛错**：日志失败不能影响业务（磁盘满、目录不可写时要静默降级）
 */
import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 单个日志文件的上限（超过就轮转） */
const MAX_LOG_BYTES = 2 * 1024 * 1024;

/** 保留的历史文件数量（main.1.log … main.N.log） */
const KEEP_FILES = 2;

/** 已初始化的日志目录；null 表示尚未初始化或初始化失败 */
let logDir: string | null = null;
let logFile: string | null = null;
let initFailed = false;

/** 两位补零 */
function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** 本地时间戳：2026-11-23 21:05:07.123 */
function timeStamp(): string {
  const now = new Date();
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return `${date} ${time}.${pad(now.getMilliseconds(), 3)}`;
}

/** 超过上限时把当前文件依次后移，最老的一份删除 */
function rotateIfNeeded(file: string): void {
  try {
    if (!existsSync(file) || statSync(file).size < MAX_LOG_BYTES) return;
    for (let index = KEEP_FILES; index >= 1; index -= 1) {
      const from = index === 1 ? file : `${file}.${index - 1}`;
      const to = `${file}.${index}`;
      if (!existsSync(from)) continue;
      if (index === KEEP_FILES && existsSync(to)) rmSync(to, { force: true });
      renameSync(from, to);
    }
  } catch {
    // 轮转失败不影响继续写当前文件
  }
}

/** 懒初始化日志目录；失败后不再重试，避免每次写日志都碰一次坏目录 */
function ensureFile(): string | null {
  if (logFile) return logFile;
  if (initFailed) return null;
  try {
    logDir = app.getPath('logs');
    mkdirSync(logDir, { recursive: true });
    logFile = join(logDir, 'main.log');
    rotateIfNeeded(logFile);
    return logFile;
  } catch {
    initFailed = true;
    return null;
  }
}

/** 日志目录路径（供菜单「打开日志目录」使用）；未初始化时返回 null */
export function getLogDir(): string | null {
  ensureFile();
  return logDir;
}

/** 写入一行日志 */
function write(level: string, message: string, error?: unknown): void {
  const file = ensureFile();
  if (!file) return;
  let detail = '';
  if (error !== undefined && error !== null) {
    if (error instanceof Error) {
      detail = `\n${error.stack ?? `${error.name}: ${error.message}`}`;
    } else {
      detail = `\n${String(error)}`;
    }
  }
  const line = `[${timeStamp()}] [${level}] ${message}${detail}\n`;
  try {
    appendFileSync(file, line, 'utf-8');
  } catch {
    // 磁盘满 / 无权限：日志写不进去也不能影响业务
  }
}

/** 普通事件（启动、窗口、导出等） */
export function logInfo(message: string, error?: unknown): void {
  write('info', message, error);
}

/** 异常 / 失败（保存失败、崩溃、未捕获异常） */
export function logError(message: string, error?: unknown): void {
  write('error', message, error);
}

/**
 * 应用设置持久化（userData/settings.json）。
 *
 * 只保存「下次启动仍然希望保持」的偏好：主题、侧栏、标签栏/工具栏可见性、缩放、窗口尺寸。
 * 读取一次后常驻内存，写入按 300ms 防抖，避免拖动窗口时高频落盘。
 */
import { app } from 'electron';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DEFAULT_SETTINGS,
  normalizeAppSettings,
  type AppSettings,
  type WindowBounds
} from '@ai-md-editor/shared';
import { logError } from './logger';

/** 内存中的当前设置 */
let cache: AppSettings = { ...DEFAULT_SETTINGS };

/** 写入防抖定时器 */
let writeTimer: NodeJS.Timeout | null = null;

/** 设置文件路径 */
function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json');
}

/** 启动时读取设置（失败则回到默认值，不阻塞启动） */
export function loadSettings(): AppSettings {
  try {
    const text = readFileSync(settingsFile(), 'utf-8');
    cache = normalizeAppSettings(JSON.parse(text));
  } catch (err) {
    // 首次启动没有文件是正常的；文件损坏时留一条日志，便于解释「偏好被重置」
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logError('读取设置失败，已回退默认值', err);
    }
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache;
}

/** 当前设置（深拷贝，避免调用方误改内部状态） */
export function getSettings(): AppSettings {
  return {
    ...cache,
    windowBounds: cache.windowBounds ? { ...cache.windowBounds } : null,
    lastSession: cache.lastSession
      ? { paths: [...cache.lastSession.paths], activePath: cache.lastSession.activePath }
      : null
  };
}

/**
 * 立即落盘（内部使用）。
 *
 * 用「同目录临时文件 + rename」原子替换：直接 writeFileSync 在崩溃 / 断电时
 * 可能留下被截断的 JSON，下一次启动所有偏好（主题、会话、窗口位置）会被静默重置。
 * 目标被占用（Windows 常见）时退回直接覆盖，保证不至于完全存不下。
 */
function writeNow(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  const file = settingsFile();
  const text = `${JSON.stringify(cache, null, 2)}\n`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, text, 'utf-8');
    try {
      renameSync(temp, file);
    } catch {
      // Windows 上目标被其它进程短暂占用时 rename 会失败，退回直接写
      writeFileSync(file, text, 'utf-8');
      rmSync(temp, { force: true });
    }
  } catch (err) {
    logError('写入设置失败', err);
  }
}

/** 更新部分设置，返回合并后的结果 */
export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  cache = normalizeAppSettings({ ...cache, ...patch });
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(writeNow, 300);
  return getSettings();
}

/** 窗口关闭前把待写入内容立即落盘 */
export function flushSettings(): void {
  if (writeTimer) writeNow();
}

/** 记录窗口尺寸（拖动/缩放时调用，内部防抖） */
export function saveWindowBounds(bounds: WindowBounds): void {
  updateSettings({ windowBounds: bounds });
}

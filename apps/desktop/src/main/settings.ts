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
  type AppSettings,
  type SessionSnapshot,
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

/** 校验会话快照：只保留非空字符串路径，最多 40 个（避免设置文件无限膨胀） */
function normalizeSession(raw: unknown): SessionSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Partial<SessionSnapshot>;
  const paths = Array.isArray(input.paths)
    ? input.paths.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, 40)
    : [];
  if (paths.length === 0) return null;
  const activePath =
    typeof input.activePath === 'string' && paths.includes(input.activePath) ? input.activePath : paths[0];
  return { paths, activePath };
}

/** 校验并规整读取到的设置（避免旧版本/损坏文件带入非法值） */
function normalize(raw: unknown): AppSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const input = raw as Partial<AppSettings>;
  const bounds = input.windowBounds;
  const validBounds =
    bounds &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width >= 400 &&
    bounds.height >= 300
      ? { x: Number(bounds.x) || 0, y: Number(bounds.y) || 0, width: bounds.width, height: bounds.height }
      : null;
  return {
    themeId: input.themeId === 'dark' ? 'dark' : 'light',
    sidebarOpen: typeof input.sidebarOpen === 'boolean' ? input.sidebarOpen : DEFAULT_SETTINGS.sidebarOpen,
    sidebarPanel: input.sidebarPanel === 'outline' ? 'outline' : 'files',
    tabbarVisible: typeof input.tabbarVisible === 'boolean' ? input.tabbarVisible : DEFAULT_SETTINGS.tabbarVisible,
    toolbarVisible: typeof input.toolbarVisible === 'boolean' ? input.toolbarVisible : DEFAULT_SETTINGS.toolbarVisible,
    zoomPercent:
      typeof input.zoomPercent === 'number' && input.zoomPercent >= 50 && input.zoomPercent <= 300
        ? input.zoomPercent
        : DEFAULT_SETTINGS.zoomPercent,
    windowBounds: validBounds,
    restoreSession:
      typeof input.restoreSession === 'boolean' ? input.restoreSession : DEFAULT_SETTINGS.restoreSession,
    lastSession: normalizeSession(input.lastSession)
  };
}

/** 启动时读取设置（失败则回到默认值，不阻塞启动） */
export function loadSettings(): AppSettings {
  try {
    const text = readFileSync(settingsFile(), 'utf-8');
    cache = normalize(JSON.parse(text));
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
  cache = normalize({ ...cache, ...patch });
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

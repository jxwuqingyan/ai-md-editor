/**
 * 应用设置持久化（userData/settings.json）。
 *
 * 只保存「下次启动仍然希望保持」的偏好：主题、侧栏、标签栏/工具栏可见性、缩放、窗口尺寸。
 * 读取一次后常驻内存，写入按 300ms 防抖，避免拖动窗口时高频落盘。
 */
import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_SETTINGS, type AppSettings, type WindowBounds } from '@ai-md-editor/shared';

/** 内存中的当前设置 */
let cache: AppSettings = { ...DEFAULT_SETTINGS };

/** 写入防抖定时器 */
let writeTimer: NodeJS.Timeout | null = null;

/** 设置文件路径 */
function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json');
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
    windowBounds: validBounds
  };
}

/** 启动时读取设置（失败则回到默认值，不阻塞启动） */
export function loadSettings(): AppSettings {
  try {
    const text = readFileSync(settingsFile(), 'utf-8');
    cache = normalize(JSON.parse(text));
  } catch {
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache;
}

/** 当前设置（浅拷贝，避免调用方误改内部状态） */
export function getSettings(): AppSettings {
  return { ...cache, windowBounds: cache.windowBounds ? { ...cache.windowBounds } : null };
}

/** 立即落盘（内部使用） */
function writeNow(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  try {
    const file = settingsFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(cache, null, 2)}\n`, 'utf-8');
  } catch (err) {
    console.error('写入设置失败:', err);
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

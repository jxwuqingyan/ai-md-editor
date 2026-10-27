/**
 * 最近文件管理：内存列表 + userData 目录 JSON 持久化。
 * 最多保留最近 20 条，去重（同路径只保留最新一条）。
 */

import { app } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { RecentFile } from '@ai-md-editor/shared';

/** 最多保留的最近文件条数 */
const MAX_RECENT = 20;

/** 内存中的最近文件列表（按打开时间倒序） */
let recentList: RecentFile[] = [];

/** 最近文件存储文件路径（userData/recent.json） */
function recentFilePath(): string {
  return join(app.getPath('userData'), 'recent.json');
}

/** 从磁盘加载最近文件列表（启动时调用一次） */
export async function loadRecent(): Promise<void> {
  try {
    const raw = await readFile(recentFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as RecentFile[];
    recentList = Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch {
    // 文件不存在或损坏时，从空列表开始
    recentList = [];
  }
}

/** 持久化当前列表到磁盘 */
async function persistRecent(): Promise<void> {
  try {
    const dir = app.getPath('userData');
    await mkdir(dir, { recursive: true });
    await writeFile(recentFilePath(), JSON.stringify(recentList), 'utf-8');
  } catch {
    // 持久化失败不影响功能，静默忽略
  }
}

/** 获取最近文件列表（倒序） */
export function getRecent(): RecentFile[] {
  return [...recentList];
}

/**
 * 添加一条最近文件记录（去重 + 置顶 + 截断）。
 */
export async function addRecent(path: string, name: string): Promise<void> {
  // 去重：移除同路径的旧记录
  recentList = recentList.filter((f) => f.path !== path);
  // 新记录置顶
  recentList.unshift({ path, name, openedAt: Date.now() });
  // 截断到上限
  recentList = recentList.slice(0, MAX_RECENT);
  await persistRecent();
}

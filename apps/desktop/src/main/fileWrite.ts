/**
 * 安全的文件写入与「磁盘版本」跟踪。
 *
 * 两件事：
 * 1. **原子替换**：先写同目录临时文件并 fsync，再 rename 覆盖目标。
 *    直接 `writeFile(path)` 在进程崩溃 / 断电时可能留下被截断的文件；
 *    rename 在 POSIX 与 Windows（MoveFileEx 带 REPLACE_EXISTING）都是原子语义。
 *    目标文件被其它程序占用（Windows 常见 EBUSY/EPERM）时退回直接覆盖写，
 *    保证保存不会因为临时文件的限制而失败。
 *
 * 2. **外部改动检测**：记住每个文件「本应用最后一次读到 / 写成功」时的
 *    修改时间与大小。写入前比对，发现磁盘已被别的程序改过就抛
 *    `EXTERNAL_CHANGED`，让渲染层暂停自动保存并提示用户，
 *    避免把外部的新版本静默覆盖掉。
 */
import { chmod, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { EXTERNAL_CHANGE_ERROR } from '@ai-md-editor/shared';

/** 一次文件状态的快照（够用且便宜的版本标记） */
interface DiskStamp {
  mtimeMs: number;
  size: number;
}

const stamps = new Map<string, DiskStamp>();

/** 记录文件当前状态作为「已知版本」；文件不存在时清掉记录 */
export async function recordDiskStamp(filePath: string): Promise<void> {
  const info = await stat(filePath).catch(() => null);
  if (info && info.isFile()) {
    stamps.set(filePath, { mtimeMs: info.mtimeMs, size: info.size });
  } else {
    stamps.delete(filePath);
  }
}

/** 忘记某个文件的已知版本（重命名 / 关闭监听时用） */
export function forgetDiskStamp(filePath: string): void {
  stamps.delete(filePath);
}

/**
 * 校验磁盘文件是否仍是我们已知的版本。
 * 未知历史（本次运行没有读过 / 写过该文件）不拦，宁可不误伤。
 */
export async function assertDiskUnchanged(filePath: string): Promise<void> {
  const known = stamps.get(filePath);
  if (!known) return;
  const info = await stat(filePath).catch(() => null);
  // 文件被外部删除：允许重新写出，不算冲突
  if (!info || !info.isFile()) return;
  if (info.mtimeMs !== known.mtimeMs || info.size !== known.size) {
    throw new Error(`${EXTERNAL_CHANGE_ERROR}: 文件已被外部程序修改，已暂停写入以免覆盖`);
  }
}

/** 生成同目录下的临时文件名（隐藏文件，避免出现在用户目录列表里） */
function tempPathFor(filePath: string): string {
  const token = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return join(dirname(filePath), `.${basename(filePath)}.${token}.tmp`);
}

/**
 * 原子写入：临时文件 + fsync + rename 替换。
 * 成功后刷新已知版本，供下一次外部改动检测使用。
 */
export async function writeFileAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  const tmp = tempPathFor(filePath);
  // 沿用原文件权限位，避免覆盖后权限被临时文件的默认值改掉
  const mode = await stat(filePath)
    .then((info) => info.mode & 0o777)
    .catch(() => null);
  try {
    const handle = await open(tmp, 'w');
    try {
      await handle.writeFile(data);
      // 落盘后再改名，断电时不会出现「改名完成但内容还在页缓存」的半截文件
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (mode !== null) await chmod(tmp, mode).catch(() => undefined);
    try {
      await rename(tmp, filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // Windows 上目标被其它进程占用时 rename 会失败，退回直接覆盖写
      if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY' || code === 'EXDEV') {
        await writeFile(filePath, data);
        await rm(tmp, { force: true });
      } else {
        throw err;
      }
    }
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
  await recordDiskStamp(filePath);
}

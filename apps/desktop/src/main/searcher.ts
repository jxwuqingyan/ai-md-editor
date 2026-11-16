/**
 * 文件夹内容搜索：递归扫描目录下的 Markdown 文件，按查询条件逐行匹配。
 * 在主进程执行（渲染层不该碰文件系统），结果按文件分组并设上限防卡顿。
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SearchFolderInput, SearchFolderResult, SearchFileResult, SearchMatch } from '@ai-md-editor/shared';
import { decodeBytes } from '@ai-md-editor/shared';

/** 单文件大小上限：超过直接跳过（二进制/超大文件不值得搜） */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** 最多返回的文件数 */
const MAX_FILES = 50;
/** 单个文件最多返回的匹配行数 */
const MAX_MATCHES_PER_FILE = 20;
/** 扫描目录数上限（防超深树） */
const MAX_DIRS = 2000;
/** 扫描总文件数上限 */
const MAX_SCANNED = 5000;

/** 跳过的目录名（依赖/版本库/隐藏目录，以及图片目录） */
const SKIP_DIRS = new Set(['node_modules', '.git', 'img', 'assets']);

/** 参与搜索的文本文件扩展名：必须与文件树（readDir）认的保持一致，否则树里有、搜不到 */
const SEARCHABLE_FILE = /\.(md|markdown|txt)$/i;

/** 扫描到的候选文件 */
interface Candidate {
  path: string;
}

/** 候选文件收集结果，同时说明目录扫描是否触达上限。 */
interface CandidateCollection {
  files: Candidate[];
  truncated: boolean;
  cancelled: boolean;
}

/** 让出事件循环，使取消信号能在大目录与长文档扫描时及时生效。 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** 递归收集目录下的 Markdown 文件（广度优先，受上限保护；可被取消） */
async function collectMarkdownFiles(root: string, signal?: AbortSignal): Promise<CandidateCollection> {
  const files: Candidate[] = [];
  const queue: string[] = [root];
  let dirs = 0;
  let scannedFiles = 0;
  let entriesSinceYield = 0;
  let truncated = false;

  scan: while (queue.length > 0) {
    if (signal?.aborted) return { files, truncated, cancelled: true };
    if (dirs >= MAX_DIRS) {
      truncated = true;
      break;
    }
    const dir = queue.shift() as string;
    dirs += 1;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      truncated = true;
      continue;
    }

    for (const entry of entries) {
      if (signal?.aborted) return { files, truncated, cancelled: true };
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) queue.push(join(dir, entry.name));
      } else if (entry.isFile()) {
        if (scannedFiles >= MAX_SCANNED) {
          truncated = true;
          break scan;
        }
        scannedFiles += 1;
        if (SEARCHABLE_FILE.test(entry.name)) files.push({ path: join(dir, entry.name) });
      }
      entriesSinceYield += 1;
      if (entriesSinceYield >= 128) {
        entriesSinceYield = 0;
        await yieldToEventLoop();
      }
    }
  }
  return { files, truncated, cancelled: false };
}

/**
 * 编译正则：优先带 u 标志（支持 `\p{Han}` 这类 Unicode 语法），
 * 编译失败再退回不带 u（少数老式写法在 u 模式下非法）。都失败返回 null。
 */
function compileRegex(source: string, baseFlags: string): RegExp | null {
  for (const extra of ['u', '']) {
    try {
      return new RegExp(source, `${baseFlags}${extra}`);
    } catch {
      // 换一组标志再试
    }
  }
  return null;
}

/**
 * 构造行内匹配函数：返回「在一行文本里找出全部匹配」的迭代器。
 * 全单词用词边界包裹；普通文本转义后按字面量处理。
 * 非法正则返回 null。独立导出以便单元测试。
 */
export function buildLineMatcher(input: SearchFolderInput): ((line: string) => SearchMatch[]) | null {
  const baseFlags = `g${input.caseSensitive ? '' : 'i'}`;
  let source: string;
  if (input.regex) {
    source = input.query;
    if (!compileRegex(source, baseFlags)) return null; // 非法正则由调用方返回错误
  } else {
    source = input.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  if (input.wholeWord) {
    // 词边界：首尾不能是「字母/数字/下划线」，中文没有词边界概念，只对西文生效；
    // 核心包成第 1 个捕获组，匹配后用它修正列与长度（边界字符会一起被吞进整体匹配）
    source = `(?:^|[^\\p{L}\\p{N}_])(${source})(?=$|[^\\p{L}\\p{N}_])`;
  }
  const re = compileRegex(source, baseFlags);
  if (!re) return null;
  return (line: string): SearchMatch[] => {
    const matches: SearchMatch[] = [];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      // 整词模式的边界字符会一起被吞进整体匹配，用第 1 个捕获组修正为核心位置与长度
      let column = m.index;
      let length = m[0].length;
      const groups = m.slice(1);
      if (groups.length > 0 && input.wholeWord) {
        const core = groups[0];
        const at = m[0].indexOf(core);
        if (at >= 0) {
          column += at;
          length = core.length;
        }
      }
      if (length === 0) {
        re.lastIndex += 1; // 空匹配防死循环
        continue;
      }
      matches.push({ line: 0, column, rawColumn: column, length, text: line.trim() });
      if (matches.length > 3) break; // 多留一处用于判断是否需要显示截断提示
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
    return matches;
  };
}

/** 行号补齐（匹配发生在裁剪前的原始行上）。导出以便单测覆盖列号换算 */
export function finalizeMatches(rawLineMatches: SearchMatch[], lineNo: number, rawLine: string): SearchMatch[] {
  // 展示文本是裁剪首尾空白后的行：column 跟着前移，rawColumn 保留原样供源码模式定位
  const leading = rawLine.length - rawLine.trimStart().length;
  return rawLineMatches.map((m) => ({
    ...m,
    line: lineNo,
    column: Math.max(0, m.rawColumn - leading),
    text: rawLine.trim()
  }));
}

/** 在目录内搜索；signal 可中断目录收集与逐行扫描。 */
export async function searchFolder(input: SearchFolderInput, signal?: AbortSignal): Promise<SearchFolderResult> {
  const query = input.query.trim();
  if (query.length === 0) return { ok: true, files: [], truncated: false, error: null };
  const matcher = buildLineMatcher(input);
  if (!matcher) {
    return { ok: false, files: [], truncated: false, error: '正则表达式无效' };
  }

  const collection = await collectMarkdownFiles(input.root, signal);
  if (collection.cancelled || signal?.aborted) {
    return { ok: true, files: [], truncated: collection.truncated, cancelled: true, error: null };
  }
  const results: SearchFileResult[] = [];
  let truncated = collection.truncated;

  for (const candidate of collection.files) {
    if (signal?.aborted) {
      return { ok: true, files: results, truncated, cancelled: true, error: null };
    }
    let content: string;
    try {
      const info = await stat(candidate.path);
      if (!info.isFile()) {
        truncated = true;
        continue;
      }
      if (info.size > MAX_FILE_BYTES) {
        truncated = true;
        continue;
      }
      if (info.size === 0) continue;
      const bytes = await readFile(candidate.path);
      content = decodeBytes(new Uint8Array(bytes)).text;
    } catch {
      truncated = true;
      continue;
    }

    const lineMatches: SearchMatch[] = [];
    const lines = content.split('\n');
    let linesSinceYield = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (signal?.aborted) {
        return { ok: true, files: results, truncated, cancelled: true, error: null };
      }
      const found = matcher(lines[i]);
      if (found.length > 3) truncated = true;
      lineMatches.push(...finalizeMatches(found.slice(0, 3), i + 1, lines[i]));
      if (lineMatches.length >= MAX_MATCHES_PER_FILE) {
        lineMatches.length = MAX_MATCHES_PER_FILE;
        truncated = true;
        break;
      }
      linesSinceYield += 1;
      if (linesSinceYield >= 128) {
        linesSinceYield = 0;
        await yieldToEventLoop();
      }
    }
    if (lineMatches.length === 0) continue;
    if (results.length >= MAX_FILES) {
      truncated = true;
      break;
    }
    const segments = candidate.path.split(/[\\/]/);
    results.push({
      path: candidate.path,
      name: segments[segments.length - 1],
      matches: lineMatches
    });
  }
  return { ok: true, files: results, truncated, error: null };
}

/**
 * 文本处理纯函数：编码识别、Markdown 简化、相对路径转本地地址。
 *
 * 这里刻意不依赖 Electron / Node / 编辑器运行时：
 * 主进程、渲染层与单元测试都能直接引用，行为保持一致。
 */

/** 读取到的文本编码 */
export type TextEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'gbk';

/** 编码 → 状态栏显示文案 */
export const TEXT_ENCODING_LABELS: Record<TextEncoding, string> = {
  'utf-8': 'UTF-8',
  'utf-8-bom': 'UTF-8 BOM',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  gbk: 'GBK'
};

/** UTF-8 BOM 字节 */
const BOM_UTF8 = [0xef, 0xbb, 0xbf];

/**
 * 把磁盘字节解码成文本，并给出实际使用的编码。
 *
 * 顺序：BOM（UTF-8 / UTF-16）→ 严格 UTF-8 → GBK。
 * 中文环境里最常见的非 UTF-8 文件是 GBK，用严格 UTF-8 解码失败后再退到 GBK，
 * 不会把合法的 UTF-8 文档误判成 GBK。
 */
export function decodeBytes(bytes: Uint8Array): { text: string; encoding: TextEncoding } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      text: new TextDecoder('utf-8').decode(bytes.subarray(3)),
      encoding: 'utf-8-bom'
    };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: new TextDecoder('utf-16le').decode(bytes.subarray(2)),
      encoding: 'utf-16le'
    };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      text: new TextDecoder('utf-16be').decode(bytes.subarray(2)),
      encoding: 'utf-16be'
    };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    try {
      return { text: new TextDecoder('gbk').decode(bytes), encoding: 'gbk' };
    } catch {
      // 极端情况（运行环境不支持 gbk）：按 UTF-8 宽松解码，至少不丢内容
      return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' };
    }
  }
}

/**
 * 写盘用的编码：除保留 UTF-8 BOM 外统一写成 UTF-8。
 *
 * TextEncoder 只支持 UTF-8，GBK / UTF-16 无法原样写回；
 * 统一转成 UTF-8 后内容不会丢失，只是字节编码变了，因此调用方要把标签的编码同步更新。
 */
export function writeEncoding(encoding: TextEncoding): TextEncoding {
  return encoding === 'utf-8-bom' ? 'utf-8-bom' : 'utf-8';
}

/** 把文本编码成字节（写盘用），UTF-8 BOM 会补回 BOM */
export function encodeText(text: string, encoding: TextEncoding): Uint8Array {
  const body = new TextEncoder().encode(text);
  if (encoding !== 'utf-8-bom') return body;
  const result = new Uint8Array(body.length + BOM_UTF8.length);
  result.set(BOM_UTF8, 0);
  result.set(body, BOM_UTF8.length);
  return result;
}

/**
 * 把 Markdown 简化为纯文本（复制为纯文本用，保留段落结构）。
 */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?|```$/g, ''))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/^\s{0,3}(-{3,}|\*{3,})\s*$/gm, '')
    .trim();
}

/** 是否是「需要拼接文档目录」的相对路径（协议地址、协议相对地址、绝对路径都保持原样） */
export function isRelativeImagePath(src: string): boolean {
  if (!src) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return false;
  if (src.startsWith('//') || src.startsWith('/')) return false;
  return true;
}

/**
 * 从 Markdown 图片目标中取出本地路径。
 *
 * 去掉尖括号、查询参数与片段，并解码百分号转义；远程地址与协议相对地址返回 null。
 */
export function localImagePath(target: string): string | null {
  let path = target.trim();
  if (path.startsWith('<') && path.endsWith('>')) path = path.slice(1, -1).trim();
  if (!path || path.startsWith('//')) return null;
  if (/^[A-Za-z]:[\\/]/.test(path)) return decodePath(path);
  if (/^file:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      let local = decodeURIComponent(url.pathname);
      if (/^\/[A-Za-z]:\//.test(local)) local = local.slice(1);
      return local;
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  const suffix = path.search(/[?#]/);
  if (suffix >= 0) path = path.slice(0, suffix);
  return path ? decodePath(path) : null;
}

/** 解码文件路径；遇到不完整百分号编码时保留原文。 */
function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * 把相对图片路径解析成绝对 file:// 地址。
 *
 * @param baseDir 文档所在目录（绝对路径，mac/linux 用 /，Windows 用 \）
 * @param relative Markdown 中写的相对路径
 */
export function toFileUrl(baseDir: string, relative: string): string {
  const cleanBase = baseDir.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  const cleanRel = relative.replace(/^\.\//, '').replace(/\\/g, '/');
  const fullPath = `${cleanBase}/${cleanRel}`;
  // 逐段编码，避免中文/空格导致加载失败；
  // Windows 盘符（C:）不能编码成 C%3A，否则 file:///C%3A/... 不是合法地址。
  const encoded = fullPath
    .split('/')
    .map((segment) => (/^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/');
  return `file://${encoded.startsWith('/') ? '' : '/'}${encoded}`;
}

/** 取路径最后一段作为文件名（同时兼容 / 与 \） */
export function baseNameOf(targetPath: string): string {
  const index = Math.max(targetPath.lastIndexOf('/'), targetPath.lastIndexOf('\\'));
  return index >= 0 ? targetPath.slice(index + 1) : targetPath;
}

/** 取路径的父目录（没有分隔符时返回空串） */
export function dirNameOf(targetPath: string): string {
  const index = Math.max(targetPath.lastIndexOf('/'), targetPath.lastIndexOf('\\'));
  return index > 0 ? targetPath.slice(0, index) : '';
}

/** 文档里的一处链接 / 图片引用（「检查链接与图片」功能的扫描结果） */
export interface DocLinkRef {
  /** 1 起的行号 */
  line: number;
  /** 链接文字或图片替代文本（可能为空） */
  label: string;
  /** 目标地址（空链接为 ''） */
  target: string;
  /** 是否图片（![alt](target)） */
  isImage: boolean;
  /** 所在行原文（首尾裁剪，用于跳转定位） */
  text: string;
  /** label 在裁剪行文本中的起点（跳转用） */
  column: number;
  /** label 在原始行文本中的起点（源码模式定位用） */
  rawColumn: number;
}

/** 文档链接 / 图片扫描结果 */
export interface DocLinkScan {
  /** 空链接（[文字]() / []()）：不依赖文件系统即可确定 */
  emptyTargets: DocLinkRef[];
  /** 本地图片引用：需要调用方逐个检查文件是否存在 */
  localImages: DocLinkRef[];
}

/**
 * 扫描 Markdown 文档里的行内链接与图片。
 *
 * 跳过围栏代码、行内代码与引用式链接定义；支持尖括号包裹的含空格路径和链接标题。
 * 扫描只提供诊断位置，不会改写文档内容。
 */
export function scanDocLinks(markdown: string): DocLinkScan {
  const emptyTargets: DocLinkRef[] = [];
  const localImages: DocLinkRef[] = [];
  const lines = markdown.split('\n');
  let inFence = false;
  const tick = String.fromCharCode(96);
  const fencePattern = new RegExp('^(' + tick.repeat(3) + '|~~~)');
  const inlineCode = new RegExp('(' + tick + '+)(.*?)\\1', 'g');
  const pattern = /(!?)\[([^\]]*)\]\(\s*(?:<([^>]*)>|((?:\\.|[^)\s])+))?(?:\s+["'][^)]*["'])?\s*\)/g;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const trimmedStart = rawLine.trimStart();
    if (fencePattern.test(trimmedStart)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^\s*\[[^\]]+\]:\s*\S+/.test(rawLine)) continue;
    // 用等长空格屏蔽行内代码，保持后续诊断列号不偏移。
    const line = rawLine.replace(inlineCode, (code) => ' '.repeat(code.length));
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      const isImage = match[1] === '!';
      const label = match[2];
      const target = match[3] ?? match[4] ?? '';
      const trimmed = rawLine.trim();
      const rawColumn = label ? rawLine.indexOf(label, match.index) : Math.max(0, match.index);
      const ref: DocLinkRef = {
        line: i + 1,
        label,
        target,
        isImage,
        text: trimmed,
        column: Math.max(0, rawColumn - (rawLine.length - rawLine.trimStart().length)),
        rawColumn
      };
      if (target.trim() === '') {
        emptyTargets.push(ref);
        continue;
      }
      if (isImage && localImagePath(target) !== null) localImages.push(ref);
    }
  }
  return { emptyTargets, localImages };
}

/** 大纲条目的最小信息：解析层产出的 OutlineItem 可直接传入 */
export interface OutlineSectionItem {
  /** 标题层级 1-6 */
  level: number;
  /** 标题在源码中的行号（1 起） */
  line: number;
}

/** 章节重排结果：moved=false 表示目标位置无意义（拖到自己或自己的子章节里） */
export interface OutlineMoveResult {
  text: string;
  moved: boolean;
}

/**
 * 把一个标题连同其下所有子标题与正文整体搬到另一个标题之前 / 之后。
 *
 * 章节范围：从该标题所在行，到下一个「层级不高于它」的标题行之前；没有下一个
 * 同级或更高层级标题时延伸到文档末尾。行号由解析层给出（remark 已排除代码围栏、
 * 引用块里的伪标题），这里只做纯文本行搬运，不改动任何一行的内容。
 *
 * @param outline 按文档顺序排列的大纲条目；fromIndex / toIndex 是数组下标
 * @param position before 插到目标章节第一行之前，after 插到目标章节最后一行之后
 */
export function moveOutlineSection(
  source: string,
  outline: OutlineSectionItem[],
  fromIndex: number,
  toIndex: number,
  position: 'before' | 'after'
): OutlineMoveResult {
  const unchanged: OutlineMoveResult = { text: source, moved: false };
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= outline.length || toIndex >= outline.length) {
    return unchanged;
  }
  if (fromIndex === toIndex) return unchanged;

  const lines = source.split('\n');
  const ranges = outline.map((item, i) => {
    let end = lines.length;
    for (let j = i + 1; j < outline.length; j += 1) {
      if (outline[j].level <= item.level) {
        end = outline[j].line - 1;
        break;
      }
    }
    return { start: Math.max(1, item.line), end: Math.max(item.line, Math.min(end, lines.length)) };
  });

  const fromRange = ranges[fromIndex];
  const toRange = ranges[toIndex];
  const insertAt = position === 'before' ? toRange.start - 1 : toRange.end;
  // 落点在被搬章节内部（含紧邻边界）意味着「原地不动」或「搬进自己的子章节」，都拒绝
  if (insertAt >= fromRange.start - 1 && insertAt <= fromRange.end) return unchanged;

  const block = lines.slice(fromRange.start - 1, fromRange.end);
  const rest = [...lines.slice(0, fromRange.start - 1), ...lines.slice(fromRange.end)];
  const target = insertAt > fromRange.start - 1 ? insertAt - block.length : insertAt;
  rest.splice(target, 0, ...block);

  let text = rest.join('\n');
  // 原文以换行收尾时，别因为搬走了末尾空行而丢掉结尾换行
  if (source.endsWith('\n') && !text.endsWith('\n')) text += '\n';
  return { text, moved: text !== source };
}

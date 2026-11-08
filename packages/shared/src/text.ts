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

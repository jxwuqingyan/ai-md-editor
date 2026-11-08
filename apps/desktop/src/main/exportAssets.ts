/**
 * 导出时处理文档内的本地图片资源。
 *
 * 导出的 HTML/Word 经常被挪到别的目录，Markdown 里的 `img/xxx.png` 是相对文档的路径，
 * 换个位置就全部裂图。这里把能读到的本地图片换成 data URI，让导出文件自包含；
 * 读不到或超过体积上限的保持原样，不阻断导出。
 */
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

/** 单张图片与整篇文档的内联上限（超过就保留相对路径，避免导出文件膨胀） */
const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_INLINE_TOTAL_BYTES = 30 * 1024 * 1024;

/** 按扩展名给出图片 MIME */
export function imageMime(file: string): string {
  const ext = extname(file).slice(1).toLowerCase();
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return `image/${ext || 'png'}`;
}

/**
 * 把 HTML 里的相对路径图片内联成 data URI。
 * @param html 已渲染的 HTML
 * @param docDir 文档所在目录（null 表示文档未落盘，直接原样返回）
 */
export function inlineLocalImages(html: string, docDir: string | null): string {
  if (!docDir) return html;
  let total = 0;
  return html.replace(
    /<img\b([^>]*?)src="([^"]+)"([^>]*?)>/g,
    (match, before: string, src: string, after: string) => {
      // 已是绝对地址或内联数据就不再处理
      if (/^(https?:|data:|file:)/i.test(src)) return match;
      try {
        const relative = decodeURIComponent(src.replace(/^\.\//, '').split(/[?#]/)[0]);
        const file = join(docDir, relative);
        const info = statSync(file);
        if (!info.isFile() || info.size > MAX_INLINE_IMAGE_BYTES) return match;
        if (total + info.size > MAX_INLINE_TOTAL_BYTES) return match;
        total += info.size;
        const data = readFileSync(file).toString('base64');
        return `<img${before}src="data:${imageMime(file)};base64,${data}"${after}>`;
      } catch {
        return match; // 找不到文件就保持原样
      }
    }
  );
}

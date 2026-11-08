/**
 * 图片显示路径解析。
 *
 * Markdown 里图片写的是相对路径（`img/xxx.png`），这样文档连同目录整体拷贝给别人才有意义；
 * 但渲染页的基址是应用的 index.html，相对路径会解析到应用目录下，图片就显示不出来。
 *
 * 这里只改 DOM 上的 `src`（换成绝对 `file://` 地址），Markdown 节点属性保持原样，
 * 因此保存/序列化出来的文本仍然是相对路径。
 */
import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

/** 是否是「需要拼接文档目录」的相对路径（协议地址、协议相对地址、绝对路径都保持原样） */
function isRelative(src: string): boolean {
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

/**
 * 把编辑器内所有相对图片的 src 解析成绝对地址。
 * 原始相对路径记录在 data-md-src 上，避免二次解析时把绝对地址再拼一次。
 */
export function applyImageSources(view: EditorView, baseDir: string): void {
  if (!baseDir) return;
  const images = view.dom.querySelectorAll('img');
  images.forEach((img) => {
    const raw = img.getAttribute('data-md-src') ?? img.getAttribute('src') ?? '';
    if (!isRelative(raw)) return;
    img.setAttribute('data-md-src', raw);
    const absolute = toFileUrl(baseDir, raw);
    if (img.getAttribute('src') !== absolute) img.setAttribute('src', absolute);
  });
}

/**
 * 图片路径解析插件。
 * @param getBaseDir 返回当前文档所在目录（切换标签时由实例更新）
 */
export function imageSourcePlugin(getBaseDir: () => string) {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('markdownNoteImages'),
        view: (view) => {
          applyImageSources(view, getBaseDir());
          return {
            update: (next) => applyImageSources(next, getBaseDir())
          };
        }
      })
  );
}

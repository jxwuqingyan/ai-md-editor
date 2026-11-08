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
import { isRelativeImagePath, toFileUrl } from '@ai-md-editor/shared';

/**
 * 把编辑器内所有相对图片的 src 解析成绝对地址。
 * 原始相对路径记录在 data-md-src 上，避免二次解析时把绝对地址再拼一次。
 */
export function applyImageSources(view: EditorView, baseDir: string): void {
  if (!baseDir) return;
  const images = view.dom.querySelectorAll('img');
  images.forEach((img) => {
    const raw = img.getAttribute('data-md-src') ?? img.getAttribute('src') ?? '';
    if (!isRelativeImagePath(raw)) return;
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

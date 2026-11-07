/**
 * 警告框与目录块的渲染增强（不改 Markdown 文本，只用 ProseMirror 装饰）。
 *
 * - 警告框：GitHub 风格的 `> [!NOTE]` 语法本身只是引用块里的文本，
 *   这里给对应 blockquote 加类名并隐藏源码标记，让它渲染成带色条的提示框；
 * - 目录：`[TOC]` 是常见的目录占位符写法，这里在占位符下方渲染实时的标题列表，
 *   点击可跳转。文本仍然是 `[TOC]`，保证 Markdown 往返不被改写。
 */
import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';

/** 支持的警告框类型 */
const CALLOUT_KINDS = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const;

/** 匹配引用块首行的警告框标记 */
const CALLOUT_MARK = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/;

/** 目录占位符文本 */
const TOC_MARKER = '[TOC]';

/** 标题信息（目录项） */
interface HeadingInfo {
  level: number;
  text: string;
  pos: number;
}

/** 收集文档中的全部标题（按出现顺序） */
function collectHeadings(doc: ProseNode): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      headings.push({
        level: Number(node.attrs['level'] ?? 1),
        text: node.textContent.trim(),
        pos
      });
    }
    return true;
  });
  return headings;
}

/** 点击目录项时把光标定位到对应标题并滚动到可见区域 */
function jumpToHeading(view: EditorView, pos: number): void {
  const target = Math.min(pos + 1, view.state.doc.content.size);
  const selection = TextSelection.near(view.state.doc.resolve(target));
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
  view.focus();
}

/** 构造目录块 DOM（每次文档变化时重建，保证标题实时） */
function buildTocDom(view: EditorView, headings: HeadingInfo[]): HTMLElement {
  const box = document.createElement('div');
  box.className = 'toc-widget';
  box.contentEditable = 'false';

  const title = document.createElement('div');
  title.className = 'toc-widget-title';
  title.textContent = '目录';
  box.appendChild(title);

  if (headings.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'toc-widget-empty';
    empty.textContent = '暂无标题';
    box.appendChild(empty);
    return box;
  }

  for (const heading of headings) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `toc-widget-item toc-level-${heading.level}`;
    item.style.paddingLeft = `${Math.max(0, heading.level - 1) * 14 + 10}px`;
    item.textContent = heading.text || '（无标题文本）';
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      jumpToHeading(view, heading.pos);
    });
    box.appendChild(item);
  }
  return box;
}

/** 警告框渲染插件 */
export const calloutPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey('markdownNoteCallout'),
      props: {
        decorations(state) {
          const decorations: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'blockquote') return true;
            const first = node.firstChild;
            if (!first || first.type.name !== 'paragraph') return true;
            const matched = CALLOUT_MARK.exec(first.textContent);
            if (!matched) return true;
            const kind = matched[1].toLowerCase();
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, { class: `callout callout-${kind}` })
            );
            // 隐藏 `[!NOTE]` 源码标记，用 CSS 的色条与标题替代
            decorations.push(
              Decoration.inline(pos + 2, pos + 2 + matched[0].length, { class: 'callout-marker' })
            );
            return true;
          });
          return DecorationSet.create(state.doc, decorations);
        }
      }
    })
);

/** 目录块渲染插件 */
export const tocPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey('markdownNoteToc'),
      props: {
        decorations(state) {
          const headings = collectHeadings(state.doc);
          const decorations: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'paragraph') return true;
            if (node.textContent.trim() !== TOC_MARKER) return true;
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, { class: 'toc-marker-paragraph' })
            );
            decorations.push(
              Decoration.widget(pos + node.nodeSize, (view) => buildTocDom(view, headings), {
                side: 1,
                key: `toc-${pos}-${headings.length}`
              })
            );
            return true;
          });
          return DecorationSet.create(state.doc, decorations);
        }
      }
    })
);

/** 警告框可用类型（供文档与样式对齐） */
export const calloutKinds = CALLOUT_KINDS;

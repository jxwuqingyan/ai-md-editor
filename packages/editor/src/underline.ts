/**
 * 下划线能力（Typora「格式 → 下划线」）。
 *
 * CommonMark 本身没有下划线语法，Typora 用 `<u>…</u>` 承载。
 * 这里做三件事，让它在 WYSIWYG 下也是真正的行内样式而非字面量标签：
 * 1. remark 转换器：把 remark-parse 生成的两个 html 节点合成一个 `underline` mdast 节点；
 * 2. Milkdown mark schema：解析/序列化该节点，DOM 用 `<u>` 渲染；
 * 3. remark-stringify 自定义 handler：序列化回 `<u>…</u>`，保证 Markdown 往返不丢失。
 */
import { $markSchema, $remark } from '@milkdown/kit/utils';
import type { Root, MarkdownNode } from '@milkdown/kit/transformer';

/** 判断 html 节点是否为 `<u>` 开始标签 */
function isOpenTag(node: MarkdownNode): boolean {
  return node.type === 'html' && typeof node.value === 'string' && /^<u\s*>$/i.test(node.value.trim());
}

/** 判断 html 节点是否为 `</u>` 结束标签 */
function isCloseTag(node: MarkdownNode): boolean {
  return node.type === 'html' && typeof node.value === 'string' && /^<\/u\s*>$/i.test(node.value.trim());
}

/** 递归把成对的 `<u>` / `</u>` html 节点折叠成 underline 节点 */
function foldUnderline(parent: MarkdownNode): void {
  const children = parent.children;
  if (!children) return;
  for (let i = 0; i < children.length; i += 1) {
    const node = children[i];
    if (!node) continue;
    if (isOpenTag(node)) {
      const endIndex = children.findIndex((candidate, index) => index > i && isCloseTag(candidate));
      if (endIndex > i) {
        const wrapper = {
          type: 'underline',
          children: children.slice(i + 1, endIndex)
        } as unknown as MarkdownNode;
        children.splice(i, endIndex - i + 1, wrapper);
        foldUnderline(wrapper);
        continue;
      }
    }
    foldUnderline(node);
  }
}

/** remark 插件：解析阶段把 `<u>` 标签对折叠为 underline 节点 */
export const underlineRemark = $remark('markdownNoteUnderline', () => (tree: Root) => {
  foldUnderline(tree as unknown as MarkdownNode);
});

/** 下划线 mark：DOM 用 `<u>`，Markdown 用 `<u>…</u>` */
export const underlineSchema = $markSchema('underline', () => ({
  parseDOM: [{ tag: 'u' }],
  toDOM: () => ['u', 0] as const,
  parseMarkdown: {
    match: (node) => node.type === 'underline',
    runner: (state, node, markType) => {
      state.openMark(markType);
      if (node.children) state.next(node.children);
      state.closeMark(markType);
    }
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'underline',
    runner: (state, mark) => {
      state.withMark(mark, 'underline');
    }
  }
}));

/** mdast-util-to-markdown 状态机的必要子集（避免直接依赖其内部类型） */
interface StringifyState {
  enter(name: string): () => void;
  createTracker(info: unknown): {
    move(value: string): string;
    current(): { before: string; after: string };
  };
  containerPhrasing(node: unknown, info: unknown): string;
}

/** 把 underline 节点序列化成 `<u>…</u>`（由 stringify.ts 统一注册） */
export function underlineHandler(node: unknown, _parent: unknown, rawState: unknown, _info: unknown): string {
  const state = rawState as StringifyState;
  const exit = state.enter('underline');
  const tracker = state.createTracker(_info);
  let value = tracker.move('<u>');
  value += tracker.move(
    state.containerPhrasing(node, {
      ...(_info as Record<string, unknown>),
      ...tracker.current()
    })
  );
  value += tracker.move('</u>');
  exit();
  return value;
}

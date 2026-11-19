/**
 * 块级元素同行末尾的落光标处理。
 *
 * 图片是 inline 原子节点，同行右侧空白就在段落内，点击后回车本来就能换行；
 * 但表格、代码块这类块级节点会占满整行，点击「同行最后面」（行末右侧空白）时
 * ProseMirror 默认把光标解析到块内部（表格落进单元格、代码块落进代码文本），
 * 回车只在块内换行 / 加行，无法在块后新建正文段落。
 *
 * 这里在 handleClick 阶段用 DOM 几何判断：点击是否落在某个块最后一行右侧空白区
 * （块 boundingRect 内、右边缘附近、垂直方向在块的最后一行）。命中则把光标放到
 * 块后最近的可写位置，回车即可在块后新建正文段落；点块内文字仍走默认编辑逻辑。
 */
import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

/** 需要处理行末点击的块级节点类型（与 DOM 选择器对应） */
const LINE_END_BLOCKS: { type: string; selector: string }[] = [
  { type: 'table', selector: 'table' },
  { type: 'code_block', selector: 'pre' },
  { type: 'math_block', selector: '[data-type="math_block"]' }
];

/** 从文档里收集所有块级节点的「文档位置 + DOM 元素」 */
function collectBlockDom(view: EditorView): { pos: number; size: number; dom: HTMLElement }[] {
  const result: { pos: number; size: number; dom: HTMLElement }[] = [];
  view.state.doc.descendants((node, pos) => {
    if (!LINE_END_BLOCKS.some((b) => b.type === node.type.name)) return true;
    const dom = view.nodeDOM(pos);
    if (dom instanceof HTMLElement) result.push({ pos, size: node.nodeSize, dom });
    return false;
  });
  return result;
}

/**
 * 块行末落光标插件。
 * handleClick 在 ProseMirror 默认处理之前运行，返回 true 表示本插件已处理、不再走默认解析。
 */
export const blockLineEndCaret = $prose(
  () =>
    new Plugin({
      key: new PluginKey('MDNOTE_BLOCK_LINE_END_CARET'),
      props: {
        handleClick(view, _pos, event) {
          if (!view.editable || !(event instanceof MouseEvent)) return false;
          const { clientX, clientY } = event;
          for (const block of collectBlockDom(view)) {
            const rect = block.dom.getBoundingClientRect();
            // 点击必须在块右边缘附近的窄条内（右缘往左 56px 到右缘往外 4px）
            const rightBand = Math.min(56, rect.width * 0.25);
            if (clientX < rect.right - rightBand || clientX > rect.right + 4) continue;
            // 垂直方向必须在块的最后一行区域：用块内最后文本位置的 y 判定，
            // 向下留半行容差以覆盖块底部 padding（那也是「同行最后面」）。
            let lastCoords;
            try {
              lastCoords = view.coordsAtPos(block.pos + block.size - 1);
            } catch {
              continue;
            }
            if (!lastCoords) continue;
            const tolerance = Math.max(8, (lastCoords.bottom - lastCoords.top) * 0.8);
            if (clientY < lastCoords.top - tolerance || clientY > rect.bottom + tolerance) continue;
            // 命中：把光标放到块后最近的可写位置（跳过块落到后面的段落；
            // 块在末尾时由 trailingParagraphPlugin 补出的空段落承接）。
            const after = view.state.doc.resolve(block.pos + block.size);
            view.dispatch(view.state.tr.setSelection(TextSelection.near(after, 1)));
            view.focus();
            return true;
          }
          return false;
        }
      }
    })
);

/**
 * 块级元素同行末尾的「间隙光标」。
 *
 * 图片是 inline 原子节点，同行右侧空白就在段落内，点击后回车本来就能换行；
 * 表格、代码块这类块级节点占满整行时，点击「同行最后面」（行末右侧空白，
 * 甚至块右缘外的 editor-inner）光标会落进块内或跳进下一个块，无法在点击处
 * 看到一条紧贴块右缘的竖线光标。
 *
 * 这里用 document 捕获阶段监听 mousedown（块外点击不属于 view.dom，ProseMirror
 * 的 handleClick 收不到），命中块右缘区域后在块末尾创建 GapCursor；它渲染成一条
 * 竖线紧贴块右缘（样式见 global.css），回车触发 createParagraphNear 在块后建段落。
 */
import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { GapCursor, gapCursor } from '@milkdown/kit/prose/gapcursor';
import type { EditorView } from '@milkdown/kit/prose/view';

/** 需要在其旁侧提供间隙光标的块级节点 */
const GAP_NODE_NAMES = ['table', 'code_block', 'math_block'];

/**
 * 给块级节点补 createGapCursor 标记：GapCursor.valid 要求相邻节点是 atom /
 * isolating / createGapCursor，Milkdown 的表格与代码块默认都不是。
 * 必须在 gapcursor 插件建 view 之前完成，故本插件排在它前面。
 */
export const gapCursorSetup = $prose(
  () =>
    new Plugin({
      key: new PluginKey('MDNOTE_GAP_CURSOR_SETUP'),
      view: (view: EditorView) => {
        for (const name of GAP_NODE_NAMES) {
          const type = view.state.schema.nodes[name];
          if (type) type.spec.createGapCursor = true;
        }
        return {};
      }
    })
);

/** 判断某块是否就是点击命中的块（右缘窄条 + 最后一行高度区） */
function isLineEndHit(dom: HTMLElement, clientX: number, clientY: number): boolean {
  const rect = dom.getBoundingClientRect();
  const band = Math.min(56, rect.width * 0.25);
  if (clientX < rect.right - band || clientX > rect.right + 24) return false;
  if (clientY < rect.top + rect.height * 0.6 - 8 || clientY > rect.bottom + 16) return false;
  return true;
}

/**
 * 块行末落间隙光标：document 捕获 mousedown，命中块右缘后在块末尾建 GapCursor。
 * 返回 true 的 dispatch 会被 ProseMirror 的 gapcursor 插件接管，画出紧贴块右缘的竖线。
 */
export const blockLineEndCaret = $prose(
  () =>
    new Plugin({
      key: new PluginKey('MDNOTE_BLOCK_LINE_END_CARET'),
      view: (view: EditorView) => {
        /** 竖线贴块右缘所需的垂直位移（见 global.css 的 --md-gap-caret-lift） */
        const markLineEndCaret = (blockDom: HTMLElement) => {
          // 先清掉上一轮位移再测量，否则量到的是已上移过的位置，偏移会越算越小
          view.dom.classList.remove('md-gap-at-block-end');
          view.dom.style.setProperty('--md-gap-caret-lift', '0px');
          const gapEl = view.dom.querySelector('.ProseMirror-gapcursor');
          const blockRect = blockDom.getBoundingClientRect();
          let lift = 0;
          if (gapEl) {
            // widget 的静态位置在块下方，上移这段距离让竖线底边贴住块底部
            lift = Math.max(0, Math.round(gapEl.getBoundingClientRect().bottom - blockRect.bottom)) + 2;
          }
          view.dom.style.setProperty('--md-gap-caret-lift', `${lift}px`);
          view.dom.classList.add('md-gap-at-block-end');
        };

        const onMouseDown = (event: MouseEvent) => {
          if (!view.editable) return;
          const { clientX, clientY } = event;
          let blockPos: number | null = null;
          let blockSize = 0;
          let blockDom: HTMLElement | null = null;
          view.state.doc.descendants((node, pos) => {
            if (blockPos !== null || !GAP_NODE_NAMES.includes(node.type.name)) return blockPos === null;
            const dom = view.nodeDOM(pos);
            if (!(dom instanceof HTMLElement) || !isLineEndHit(dom, clientX, clientY)) return true;
            blockPos = pos;
            blockSize = node.nodeSize;
            blockDom = dom;
            return false;
          });
          if (blockPos === null) return;
          const after = view.state.doc.resolve((blockPos as number) + blockSize);
          // 直接在块末尾构造 GapCursor。valid 是 internal API（类型未暴露）；
          // dispatch 后检查实际 selection 是否为 GapCursor，无效则还原、交回默认处理。
          event.preventDefault();
          event.stopPropagation();
          view.dispatch(view.state.tr.setSelection(new GapCursor(after)));
          if (!(view.state.selection instanceof GapCursor)) {
            view.dispatch(view.state.tr.setSelection(TextSelection.near(after, 1)));
          }
          if (blockDom) markLineEndCaret(blockDom as HTMLElement);
          view.focus();
        };
        document.addEventListener('mousedown', onMouseDown, true);
        return {
          update: (v: EditorView) => {
            // 选区不再是间隙光标时撤掉贴右缘样式，避免影响方向键产生的 gapcursor
            if (!(v.state.selection instanceof GapCursor)) v.dom.classList.remove('md-gap-at-block-end');
          },
          destroy: () => document.removeEventListener('mousedown', onMouseDown, true)
        };
      }
    })
);

/** 官方间隙光标插件：画出 GapCursor 竖线、支持方向键跨块 */
export const gapCursorPlugin = $prose(() => gapCursor());

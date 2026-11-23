/**
 * 块级元素同行末尾的「间隙光标」。
 *
 * 表格、代码块、分割线这类块级节点占满整行时，点击「同行最后面」（行末右侧空白，
 * 甚至块右缘外的 editor-inner）光标会落进块内或跳进下一个块；图片虽然同行空白
 * 就在段落内，但光标会贴在段落基线而不是图片右缘。这里统一在点击处放一个
 * GapCursor：竖线紧贴目标右缘（样式见 global.css），回车才在块后新建段落。
 *
 * 这里用 document 捕获阶段监听 mousedown（块外点击不属于 view.dom，ProseMirror
 * 的 handleClick 收不到），命中右缘区域后 dispatch GapCursor。
 */
import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import { GapCursor, gapCursor } from '@milkdown/kit/prose/gapcursor';
import type { EditorView } from '@milkdown/kit/prose/view';

/** 需要在其旁侧提供间隙光标的块级节点 */
const GAP_NODE_NAMES = ['table', 'code_block', 'math_block', 'hr'];

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
  const band = Math.min(56, Math.max(rect.width, 120) * 0.25);
  if (clientX < rect.right - band || clientX > rect.right + 24) return false;
  // 分割线只有 1px 高，垂直方向给一点容差；其他块只认下半部分，避免点上半部误触发
  if (rect.height < 6) return clientY >= rect.top - 8 && clientY <= rect.bottom + 8;
  if (clientY < rect.top + rect.height * 0.6 - 8 || clientY > rect.bottom + 16) return false;
  return true;
}

/**
 * 判断点击是否落在「独居一段的图片」右侧，是则返回图片 DOM 与所在段落之后的位置。
 * 图文混排的段落不处理，保持默认的点文字编辑行为。
 */
function imageLineEndHit(
  view: EditorView,
  pos: number,
  clientX: number,
  clientY: number
): { dom: HTMLElement; afterPos: number } | null {
  const $img = view.state.doc.resolve(pos);
  const parent = $img.parent;
  // 只处理整段只有这一张图的场景，避免误伤图文混排
  if (parent.type.name !== 'paragraph' || parent.childCount !== 1) return null;
  const node = view.nodeDOM(pos);
  // nodeDOM 给的是行内包装元素（比图片宽、高度只有行高），要取里面的 img 量尺寸
  const imgEl =
    node instanceof HTMLElement ? (node.matches('img') ? node : node.querySelector('img')) : null;
  if (!imgEl) return null;
  const rect = imgEl.getBoundingClientRect();
  const inRow = clientY >= rect.top - 4 && clientY <= rect.bottom + 8;
  if (!inRow || clientX < rect.right - 8) return null;
  return { dom: imgEl, afterPos: $img.after() };
}

/**
 * 块行末落间隙光标：document 捕获 mousedown，命中右缘后在目标之后建 GapCursor。
 * 由 ProseMirror 的 gapcursor 插件画出竖线，回车走 createParagraphNear 在块后换行。
 */
export const blockLineEndCaret = $prose(
  () =>
    new Plugin({
      key: new PluginKey('MDNOTE_BLOCK_LINE_END_CARET'),
      view: (view: EditorView) => {
        /**
         * 把竖线摆到目标右缘：水平贴右（块）/ 贴图片右缘（图片），
         * 垂直用位移量抬到目标底部（见 global.css 的 --md-gap-caret-lift）。
         */
        const markCaret = (kind: 'block' | 'image', target: HTMLElement) => {
          // 先清掉上一轮位移再测量，否则量到的是已上移过的位置，偏移会越算越小
          view.dom.classList.remove('md-gap-at-block-end', 'md-gap-at-image-end');
          view.dom.style.setProperty('--md-gap-caret-lift', '0px');
          const gapEl = view.dom.querySelector('.ProseMirror-gapcursor');
          const targetRect = target.getBoundingClientRect();
          let lift = 0;
          if (gapEl) {
            // widget 的静态位置在目标下方，上移这段距离让竖线底边贴住目标底部
            lift = Math.max(0, Math.round(gapEl.getBoundingClientRect().bottom - targetRect.bottom)) + 2;
          }
          view.dom.style.setProperty('--md-gap-caret-lift', `${lift}px`);
          if (kind === 'image') {
            // 图片通常窄于整行，竖线要横向定位到图片右缘；块默认贴编辑区右缘
            const left = Math.round(targetRect.right - view.dom.getBoundingClientRect().left);
            view.dom.style.setProperty('--md-gap-caret-left', `${left}px`);
            view.dom.classList.add('md-gap-at-image-end');
            return;
          }
          view.dom.classList.add('md-gap-at-block-end');
        };

        const onMouseDown = (event: MouseEvent) => {
          if (!view.editable) return;
          const { clientX, clientY } = event;
          let hitPos: number | null = null;
          let hitKind: 'block' | 'image' = 'block';
          let hitDom: HTMLElement | null = null;
          view.state.doc.descendants((node, pos) => {
            if (hitPos !== null) return false;
            if (GAP_NODE_NAMES.includes(node.type.name)) {
              const dom = view.nodeDOM(pos);
              if (!(dom instanceof HTMLElement) || !isLineEndHit(dom, clientX, clientY)) return true;
              hitPos = pos + node.nodeSize;
              hitDom = dom;
              return false;
            }
            if (node.type.name === 'image') {
              const hit = imageLineEndHit(view, pos, clientX, clientY);
              if (!hit) return true;
              hitPos = hit.afterPos;
              hitKind = 'image';
              hitDom = hit.dom;
              return false;
            }
            return true;
          });
          if (hitPos === null) return;
          const after = view.state.doc.resolve(hitPos as number);
          // 直接在目标末尾构造 GapCursor。valid 是 internal API（类型未暴露）；
          // dispatch 后检查实际 selection 是否为 GapCursor，无效则回退到最近可写位置。
          event.preventDefault();
          event.stopPropagation();
          view.dispatch(view.state.tr.setSelection(new GapCursor(after)));
          if (!(view.state.selection instanceof GapCursor)) {
            view.dispatch(view.state.tr.setSelection(TextSelection.near(after, 1)));
          }
          if (hitDom) markCaret(hitKind, hitDom as HTMLElement);
          view.focus();
        };
        document.addEventListener('mousedown', onMouseDown, true);
        return {
          update: (v: EditorView) => {
            // 选区不再是间隙光标时撤掉贴右缘样式，避免影响方向键产生的 gapcursor
            if (!(v.state.selection instanceof GapCursor)) {
              v.dom.classList.remove('md-gap-at-block-end', 'md-gap-at-image-end');
            }
          },
          destroy: () => document.removeEventListener('mousedown', onMouseDown, true)
        };
      }
    })
);

/** 官方间隙光标插件：画出 GapCursor 竖线、支持方向键跨块 */
export const gapCursorPlugin = $prose(() => gapCursor());

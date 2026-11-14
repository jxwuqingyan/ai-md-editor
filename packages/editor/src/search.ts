/**
 * 查找命中高亮。
 *
 * 用 ProseMirror 装饰（Decoration.inline）给命中文字加背景，只覆盖匹配本身，
 * 不动文档内容、不进撤销栈。跳转时把光标放到命中处并滚到可见，
 * 焦点仍留在查找框里，可以继续输入。
 */
import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { EditorView } from '@milkdown/kit/prose/view';
import { collectTextSegments, textOffsetToPos } from './textPos';

/** 一处命中（纯文本偏移区间） */
export interface SearchRange {
  start: number;
  end: number;
}

interface SearchPayload {
  ranges: SearchRange[];
  /** 当前聚焦的命中下标，-1 表示没有 */
  active: number;
}

const EMPTY: SearchPayload = { ranges: [], active: -1 };

export const searchHighlightKey = new PluginKey<SearchPayload>('MDNOTE_SEARCH_HIGHLIGHT');

export const searchHighlightPlugin = $prose(
  () =>
    new Plugin<SearchPayload>({
      key: searchHighlightKey,
      state: {
        init: () => EMPTY,
        apply(tr, value) {
          const meta = tr.getMeta(searchHighlightKey) as SearchPayload | undefined;
          if (meta) return meta;
          // 文档被编辑后旧的偏移就不可信了：先清掉，等渲染层重新算完再设回来
          if (tr.docChanged) return EMPTY;
          return value;
        }
      },
      props: {
        decorations(state) {
          const payload = searchHighlightKey.getState(state) ?? EMPTY;
          if (payload.ranges.length === 0) return DecorationSet.empty;
          const segments = collectTextSegments(state.doc);
          const decorations: Decoration[] = [];
          payload.ranges.forEach((range, index) => {
            const from = textOffsetToPos(segments, range.start);
            const to = textOffsetToPos(segments, range.end, true);
            if (from == null || to == null || to <= from) return;
            const active = index === payload.active;
            decorations.push(
              Decoration.inline(from, to, {
                class: active ? 'md-find-hit md-find-hit-active' : 'md-find-hit'
              })
            );
          });
          return DecorationSet.create(state.doc, decorations);
        }
      }
    })
);

/** 设置命中高亮（ranges 为纯文本偏移，active 为当前项下标） */
export function setSearchHighlight(view: EditorView, ranges: SearchRange[], active: number): void {
  view.dispatch(view.state.tr.setMeta(searchHighlightKey, { ranges, active }));
}

/** 清除命中高亮 */
export function clearSearchHighlight(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(searchHighlightKey, EMPTY));
}

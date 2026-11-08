/**
 * 任务列表交互插件。
 *
 * 项目没有启用 @milkdown/components 的 Vue 列表组件，`list_item` 的
 * `checked` 属性只会落成 `data-checked` 属性，页面既不画复选框、也无法勾选，
 * 看起来和普通无序列表一模一样。这里做两件事：
 *
 * 1. 视觉：复选框由 CSS 依据 `li[data-item-type='task']` / `[data-checked]` 绘制，
 *    不引入 DOM 节点，避免与 ProseMirror 的 li toDOM 冲突；
 * 2. 交互：在复选框区域按下鼠标时切换 `checked`（true ↔ false），
 *    点在正文上照常定位光标。
 */
import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { splitListItem } from '@milkdown/kit/prose/schema-list';

/** 复选框区域最小宽度（未取到 padding 时的兜底，单位 px） */
const FALLBACK_HIT_WIDTH = 22;

/** 任务列表勾选插件：点击左侧方框切换完成状态；回车产生未勾选的新条目 */
export const taskListPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey('markdownNoteTaskList'),
      props: {
        handleDOMEvents: {
          mousedown: (view, event) => {
            if (event.button !== 0 || !view.editable) return false;
            const target = event.target as HTMLElement | null;
            const item = target?.closest?.('li[data-item-type="task"]');
            if (!(item instanceof HTMLElement)) return false;
            // 只有落在左侧复选框区域才切换，避免拦截正文里的正常点击
            const rect = item.getBoundingClientRect();
            const padding = Number.parseFloat(window.getComputedStyle(item).paddingLeft) || 0;
            const hitWidth = padding > 0 ? padding : FALLBACK_HIT_WIDTH;
            if (event.clientX - rect.left > hitWidth) return false;
            const inside = view.posAtDOM(item, 0);
            const pos = inside - 1;
            const node = view.state.doc.nodeAt(pos);
            if (!node || node.type.name !== 'list_item') return false;
            const checked = node.attrs['checked'];
            view.dispatch(
              view.state.tr.setNodeAttribute(pos, 'checked', checked === true ? false : true)
            );
            event.preventDefault();
            return true;
          }
        },
        handleKeyDown: (view, event) => {
          // 任务条目里按 Enter：新条目重置为未勾选（splitListItem 会原样复制勾选态）；
          // 空条目按 Enter：清掉勾选属性变回普通列表项（常见编辑器的「退出任务列表」）
          if (event.key !== 'Enter' || event.isComposing || event.shiftKey) return false;
          const { state } = view;
          const { $from, empty } = state.selection;
          if (!empty) return false;
          for (let depth = $from.depth; depth > 0; depth -= 1) {
            const node = $from.node(depth);
            if (node.type.name !== 'list_item') continue;
            if (node.attrs['checked'] == null) return false;
            if (node.textContent.trim() === '') {
              view.dispatch(state.tr.setNodeAttribute($from.before(depth), 'checked', null));
              return true;
            }
            const split = splitListItem(node.type);
            if (!split(state, view.dispatch)) return false;
            // split 后光标落在新条目里，把它的勾选态重置为未完成
            const after = view.state.selection.$from;
            for (let d = after.depth; d > 0; d -= 1) {
              if (after.node(d).type.name === 'list_item') {
                view.dispatch(view.state.tr.setNodeAttribute(after.before(d), 'checked', false));
                break;
              }
            }
            return true;
          }
          return false;
        }
      }
    })
);

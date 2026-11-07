/**
 * 选区上下文监听插件。
 *
 * 原生菜单的「表格」子菜单需要知道光标是否在表格里，才能正确置灰。
 * 这里用 ProseMirror 插件监听选区/文档变化，只在「是否在表格」「是否在表头」
 * 真正变化时通知回调，避免每次按键都同步菜单状态（菜单重建不便宜）。
 */
import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { describeTableContext } from './commands';
import type { TableContext } from './types';

/**
 * 创建选区监听插件。
 * @param onContext 表格上下文变化回调
 */
export function selectionContextPlugin(onContext: (context: TableContext) => void) {
  // 记住上一次上报的值，用于抑制重复通知
  let last: TableContext = { inTable: false, inHeader: false };

  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('markdownNoteTableContext'),
        view: (view) => {
          // 编辑器刚创建时也上报一次，避免从源码模式切回来后菜单状态残留
          last = describeTableContext(view.state);
          onContext(last);
          return {
            update(next, prev) {
              const changed = next.state.doc !== prev.doc || !next.state.selection.eq(prev.selection);
              if (!changed) return;
              const context = describeTableContext(next.state);
              if (context.inTable === last.inTable && context.inHeader === last.inHeader) return;
              last = context;
              onContext(context);
            }
          };
        }
      })
  );
}

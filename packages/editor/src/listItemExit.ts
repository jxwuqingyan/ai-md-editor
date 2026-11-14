/**
 * 任务列表里「空项」的收尾。
 *
 * 默认键位在空列表项上按回车会用 `splitListItem` 拆项，而它不给新项带 `checked`：
 * 任务列表里的复选框就此消失，看起来像「变成了无序列表」，用户还得手动删掉再写正文。
 *
 * 这里用事务后置检查纠正：如果某个列表项
 *   1) 在任务列表里（同级有带 `checked` 的项），
 *   2) 自身没有 `checked`（说明是被拆出来的普通项），
 *   3) 内容是空的，
 * 就把这一项换成列表后面的一个空段落——正好是「空行再回车就回到正文」的预期。
 *
 * 用事务层而不是抢 Enter 键位：Milkdown 内置的 Enter 绑定会先返回 true，
 * 自建键位（哪怕是 priority 1000）抢不到那次按键。
 */
import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';

const LIST_TYPES = new Set(['bullet_list', 'ordered_list']);

interface EmptyItemHit {
  /** list_item 的位置与长度 */
  itemPos: number;
  itemSize: number;
  /** 所属列表的位置与节点 */
  listPos: number;
  list: ProseNode;
}

/** 找出「任务列表里被拆出来的空普通项」 */
function findEmptyItem(doc: ProseNode): EmptyItemHit | null {
  let hit: EmptyItemHit | null = null;

  const walk = (node: ProseNode, pos: number): void => {
    if (hit) return;
    const isList = LIST_TYPES.has(node.type.name);
    node.forEach((child, offset) => {
      if (hit) return;
      const childPos = pos + 1 + offset;
      if (isList && child.type.name === 'list_item') {
        const siblings = node.content;
        let hasTaskSibling = false;
        for (let index = 0; index < siblings.childCount; index += 1) {
          if (siblings.child(index).attrs['checked'] != null) {
            hasTaskSibling = true;
            break;
          }
        }
        if (hasTaskSibling && child.attrs['checked'] == null && child.textContent === '') {
          hit = { itemPos: childPos, itemSize: child.nodeSize, listPos: pos, list: node };
          return;
        }
      }
      walk(child, childPos);
    });
  };

  // doc 的内容从位置 0 开始，所以传 -1 让子节点位置 = offset
  walk(doc, -1);
  return hit;
}

/** 把光标放到指定位置；越界或非法位置时静默跳过，绝不让整笔事务失败 */
function setCaret(tr: Transaction, pos: number): void {
  try {
    const clamped = Math.max(0, Math.min(pos, tr.doc.content.size));
    tr.setSelection(TextSelection.near(tr.doc.resolve(clamped), 1));
  } catch {
    // 位置非法时保持原选区
  }
}

export const listItemExitPlugin = $prose(() => {
  /** 这一轮是否需要补一次焦点（删掉被聚焦的 <li> 后浏览器会把焦点丢给 body） */
  let needFocus = false;
  return new Plugin({
      key: new PluginKey('MDNOTE_LIST_ITEM_EXIT'),
      view: (view) => ({
        update: () => {
          if (!needFocus) return;
          needFocus = false;
          // 删掉被聚焦的 <li> 后，DOM 选区会掉到编辑器外层，键盘就跟不上了。
          // 这里无条件把焦点与 DOM 选区拉回编辑器（幂等，不改变 state 里的选区）。
          window.setTimeout(() => {
            view.focus();
          }, 0);
        }
      }),
      appendTransaction: (_transactions, _oldState, state) => {
        const hit = findEmptyItem(state.doc);
        if (!hit) return null;
        const paragraph = state.schema.nodes['paragraph'];
        if (!paragraph) return null;

        // 整个列表只有这一项：直接换成空段落，不用先删项再替换（位置更难算）
        if (hit.list.childCount === 1) {
          const tr = state.tr.replaceWith(
            hit.listPos,
            hit.listPos + hit.list.nodeSize,
            paragraph.create()
          );
          setCaret(tr, hit.listPos + 1);
          needFocus = true;
          return tr;
        }

        const tr = state.tr.delete(hit.itemPos, hit.itemPos + hit.itemSize);
        // 删除发生在列表末尾，`mapping.map(列表终点)` 会落回列表内部的最后一个位置；
        // 这里直接按「列表新长度」算列表之后的位置。
        const afterList = hit.listPos + hit.list.nodeSize - hit.itemSize;
        const next = tr.doc.resolve(afterList).nodeAfter;
        if (next && next.type.name === 'paragraph') {
          setCaret(tr, afterList);
        } else {
          tr.insert(afterList, paragraph.create());
          setCaret(tr, afterList + 1);
        }
        needFocus = true;
        return tr;
      }
  });
});

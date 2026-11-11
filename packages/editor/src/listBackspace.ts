/**
 * 列表退格：去掉当前行的编号，而不是把本项并进上一行。
 *
 * 默认行为（prosemirror 的 joinTextblockBackward）：光标在列表项开头按退格，
 * 会把本项内容并到上一项文字后面，光标跳到上一行；列表位于文档开头时更是删不动，
 * 也没法在最前面写新内容。
 *
 * 这里的规则分两层：
 * 1. 光标在列表项开头按退格 → 本项内容原地变成普通段落，编号消失，
 *    其余项编号保持连续（有序列表靠 order 属性续号，例如剩下的从 3. 开始）；
 * 2. 紧接着再按退格（光标停在刚摘出的段落开头、它正下方紧邻列表）→
 *    继续把上面那个列表的最后一项拆成段落，一路往上直到列表散完。
 *    这样连按退格就能退到文档最前面，之后直接输入新内容。
 *
 * 第二层只在「刚摘出过」时生效（插件状态记一次），所以用户自己写在列表下面的
 * 普通段落，退格仍然是默认的「并入上一项」，不会破坏常规编辑习惯。
 *
 * 嵌套列表不拆：先降级缩进（提到上一层），避免段落被插进 list_item 内部
 * 导致文档结构非法。
 */
import { undoInputRule } from '@milkdown/kit/prose/inputrules';
import { liftListItem } from '@milkdown/kit/prose/schema-list';
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import {
  TextSelection,
  type Command,
  type EditorState,
  type Transaction
} from '@milkdown/kit/prose/state';
import { $prose, $shortcut } from '@milkdown/kit/utils';

const LIST_TYPES = new Set(['bullet_list', 'ordered_list']);

/** 「刚摘出过列表项」的挂起状态：只影响紧接着的一次退格 */
const unlistPendingKey = new PluginKey<boolean>('MDNOTE_LIST_UNLIST_PENDING');

interface ListTarget {
  /** 外层列表节点 */
  list: ProseNode;
  /** 外层列表的节点位置 */
  listPos: number;
  /** 要摘出的项序号（0 起） */
  itemIndex: number;
}

interface ListContext extends ListTarget {
  /** 光标所在的 list_item */
  item: ProseNode;
  /** list_item 的节点位置 */
  itemPos: number;
  /** 列表不在文档顶层（嵌套列表 / 引用内的列表），只能降级缩进 */
  nested: boolean;
}

/** 列表内第 index 项的节点与位置 */
function itemAt(list: ProseNode, listPos: number, index: number) {
  let pos = listPos + 1;
  for (let i = 0; i < index; i += 1) pos += list.child(i).nodeSize;
  return { node: list.child(index), pos };
}

/** 光标是否在「列表项的第一个文本块开头」 */
function listContext(state: EditorState): ListContext | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  if (!$from.parent.isTextblock || $from.parentOffset > 0) return null;

  for (let depth = $from.depth; depth >= 2; depth -= 1) {
    if ($from.node(depth).type.name !== 'list_item') continue;
    // 光标必须在该项的第一个子块里（项内嵌套列表后面的段落不处理）
    if ($from.index(depth) !== 0) return null;
    const list = $from.node(depth - 1);
    if (!LIST_TYPES.has(list.type.name)) return null;
    return {
      list,
      listPos: $from.before(depth - 1),
      itemIndex: $from.index(depth - 1),
      item: $from.node(depth),
      itemPos: $from.before(depth),
      // 只有顶层列表才能把项内容提到列表外变成段落：
      // 嵌套列表提到外面会落进 list_item 内部，文档结构非法
      nested: depth - 1 !== 1
    };
  }
  return null;
}

/**
 * 光标在「列表正下方的顶层段落」开头时，返回要解散的列表（其最后一项）。
 * 用于连续退格一路往上拆列表。
 */
function listAboveParagraph(state: EditorState): ListTarget | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  if (!$from.parent.isTextblock || $from.parentOffset > 0) return null;
  if ($from.depth !== 1) return null;

  const index = $from.index(0);
  if (index === 0) return null;
  const previous = state.doc.child(index - 1);
  if (!LIST_TYPES.has(previous.type.name) || previous.childCount === 0) return null;

  return {
    list: previous,
    listPos: $from.before(1) - previous.nodeSize,
    itemIndex: previous.childCount - 1
  };
}

const isEmptyParagraph = (node: ProseNode | null | undefined): boolean =>
  Boolean(node && node.type.name === 'paragraph' && node.content.size === 0);

/** 列表项的正文是否为空（只有空的第一个段落） */
const isEmptyItem = (item: ProseNode): boolean =>
  item.childCount === 1 && isEmptyParagraph(item.firstChild);

/** 有序列表起始编号（1 起） */
const orderOf = (list: ProseNode): number => Number(list.attrs['order'] ?? 1) || 1;

/** 用原列表的属性重建一个同型列表（可指定起始编号） */
function rebuildList(list: ProseNode, children: ProseNode[], order?: number): ProseNode | null {
  if (children.length === 0) return null;
  const attrs = { ...list.attrs };
  if (order !== undefined) attrs['order'] = order;
  return list.type.create(attrs, Fragment.fromArray(children));
}

/** 造出「摘出目标列表项」的事务；不适用时返回 null */
function buildUnlist(state: EditorState, target: ListTarget): Transaction | null {
  const { list, listPos, itemIndex } = target;
  const paragraphType = state.schema.nodes['paragraph'];
  if (!paragraphType || itemIndex < 0 || itemIndex >= list.childCount) return null;
  const { node: item, pos: itemPos } = itemAt(list, listPos, itemIndex);

  // ① 空项且列表只有它自己：整列表换成空段落
  if (isEmptyItem(item) && list.childCount === 1) {
    const paragraph = paragraphType.create();
    const tr = state.tr.replaceWith(listPos, listPos + list.nodeSize, paragraph);
    // 末尾段落保障插件可能已经在列表后面补了一个空段落，这里会变成两个空段落
    // （序列化成 Markdown 是 `<br />`），顺手删掉多出来的那个。
    const extra = tr.doc.nodeAt(listPos + paragraph.nodeSize);
    if (isEmptyParagraph(extra) && extra) {
      tr.delete(listPos + paragraph.nodeSize, listPos + paragraph.nodeSize + extra.nodeSize);
    }
    tr.setSelection(TextSelection.create(tr.doc, listPos + 1));
    return tr;
  }

  // ② 空项但还有兄弟项：删掉该项，光标落到相邻项
  if (isEmptyItem(item)) {
    const tr = state.tr.delete(itemPos, itemPos + item.nodeSize);
    const caret = itemIndex > 0 ? itemPos - 1 : itemPos + 1;
    const clamped = Math.max(0, Math.min(caret, tr.doc.content.size));
    tr.setSelection(TextSelection.near(tr.doc.resolve(clamped), itemIndex > 0 ? -1 : 1));
    return tr;
  }

  // ③ 有内容：把该项内容提到列表外，前后两段各自成列表（有序列表续号）
  const before: ProseNode[] = [];
  const after: ProseNode[] = [];
  list.forEach((child, _offset, index) => {
    if (index < itemIndex) before.push(child);
    else if (index > itemIndex) after.push(child);
  });

  const beforeList = rebuildList(list, before);
  const afterList = rebuildList(
    list,
    after,
    list.type.name === 'ordered_list' ? orderOf(list) + itemIndex + 1 : undefined
  );

  const parts: ProseNode[] = [];
  if (beforeList) parts.push(beforeList);
  item.content.forEach((child) => parts.push(child));
  if (afterList) parts.push(afterList);

  const tr = state.tr.replaceWith(listPos, listPos + list.nodeSize, Fragment.fromArray(parts));
  // 光标落在被摘出的段落开头
  const caret = listPos + (beforeList ? beforeList.nodeSize : 0) + 1;
  tr.setSelection(TextSelection.create(tr.doc, Math.min(caret, tr.doc.content.size)));
  return tr;
}

/** 记录「刚摘出过列表项」，任何其它改动都会清掉 */
export const listUnlistPendingPlugin = $prose(
  () =>
    new Plugin<boolean>({
      key: unlistPendingKey,
      state: {
        init: () => false,
        apply: (tr, value) => {
          const meta = tr.getMeta(unlistPendingKey);
          if (meta === 'unlisted' || meta === 'continue') return true;
          // 打字、移动光标、撤销等一律清掉挂起状态，避免影响后续正常退格
          return tr.docChanged || tr.selectionSet ? false : value;
        }
      }
    })
);

/** Backspace 命令：列表项开头去掉编号，连续按可一路解散列表 */
export const backspaceUnlist: Command = (state, dispatch) => {
  const ctx = listContext(state);
  if (ctx) {
    // 刚被「1. 」这类输入规则转成列表时，先按默认撤销输入规则，还原成文字
    if (undoInputRule(state, dispatch)) return true;
    // 嵌套项先降级缩进（提到上一层），到顶层后再按一次才去掉编号
    if (ctx.nested) {
      const itemType = state.schema.nodes['list_item'];
      if (!itemType) return false;
      return liftListItem(itemType)(state, dispatch);
    }
    const tr = buildUnlist(state, ctx);
    if (!tr) return false;
    tr.setMeta(unlistPendingKey, 'unlisted');
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  }

  // 连续退格：光标停在刚摘出的段落开头，继续把上方列表的最后一项拆成段落
  if (!unlistPendingKey.getState(state)) return false;
  const above = listAboveParagraph(state);
  if (!above) return false;
  const tr = buildUnlist(state, above);
  if (!tr) return false;
  tr.setMeta(unlistPendingKey, 'continue');
  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
};

/**
 * 注册到 Milkdown 的键位管理器。
 *
 * priority 必须高于基础键位表默认的 50：同一按键的所有命令按优先级排序后
 * 串成 chainCommands，只有我们的命令先返回 false，才会轮到
 * joinTextblockBackward 把本项并进上一项。
 */
export const listBackspaceShortcut = $shortcut(() => ({
  Backspace: {
    key: 'Backspace',
    priority: 80,
    onRun: () => backspaceUnlist
  }
}));

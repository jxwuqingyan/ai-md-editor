/**
 * 自定义 ProseMirror 命令集合。
 *
 * Milkdown 预设没有提供的编辑操作（标题升降级、行移动、表格增删、片段插入等）
 * 全部下沉到 transaction 实现，保证选区与撤销历史正确。
 * 所有函数只接收 EditorView / EditorState，不持有编辑器实例，便于单独推理与测试。
 */
import { TextSelection, NodeSelection, type EditorState } from '@milkdown/kit/prose/state';
import { Fragment, Slice, type Node as ProseNode, type ResolvedPos } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { TableContext } from './types';
import { requestMathAutoEdit } from './mathView';

/** 顶层节点的起始位置（ProseMirror doc 坐标） */
export function topLevelPos(doc: ProseNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i += 1) pos += doc.child(i).nodeSize;
  return pos;
}

/** 向上查找指定类型的祖先节点，返回其起始位置与节点本身 */
export function findAncestor($from: ResolvedPos, name: string): { pos: number; node: ProseNode } | null {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === name) {
      return { pos: $from.before(depth), node };
    }
  }
  return null;
}

/** 判断光标是否在表格内、是否在表头行内 */
export function describeTableContext(state: EditorState): TableContext {
  const $from = state.selection.$from;
  if (!findAncestor($from, 'table')) return { inTable: false, inHeader: false };
  const header = findAncestor($from, 'table_header_row');
  return { inTable: true, inHeader: Boolean(header) };
}

/** 设置任务列表项的 checked 属性，返回是否成功（不在列表项内时返回 false） */
export function applyTaskState(view: EditorView, checked: boolean | null): boolean {
  const found = findAncestor(view.state.selection.$from, 'list_item');
  if (!found) return false;
  const tr = view.state.tr.setNodeMarkup(found.pos, undefined, {
    ...found.node.attrs,
    checked
  });
  view.dispatch(tr);
  return true;
}

/** 在当前顶层块的上方或下方插入一个空段落 */
export function insertParagraphAt(view: EditorView, above: boolean): void {
  const { state } = view;
  const $from = state.selection.$from;
  if ($from.depth < 1) return;
  // 必须用 index(0) 取「文档顶层」的块序号：光标在引用块/列表项内部时，
  // 深度不一定为 1，index(1) 得到的会是父容器内的序号，导致插入位置错乱
  const index = $from.index(0);
  const node = state.doc.child(index);
  const paragraph = state.schema.nodes['paragraph'];
  if (!paragraph) return;
  const pos = topLevelPos(state.doc, index);
  const insertPos = above ? pos : pos + node.nodeSize;
  const tr = state.tr.insert(insertPos, paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** 当前顶层块的行操作：上移 / 下移 / 删除 / 选择 */
export function lineOperation(view: EditorView, op: 'up' | 'down' | 'delete' | 'select'): void {
  const { state } = view;
  const $from = state.selection.$from;
  if ($from.depth < 1) return;
  const doc = state.doc;
  // 同 insertParagraphAt：取文档顶层块的序号，而不是光标直接父级的序号
  const index = $from.index(0);
  const node = doc.child(index);
  const pos = topLevelPos(doc, index);

  if (op === 'select') {
    // 文本块按内容范围选中；叶子块（分割线等）与复杂容器直接选中整个节点，
    // 避免构造出指向 doc 层（无内联内容）的非法 TextSelection
    const selection = node.isTextblock
      ? TextSelection.create(state.doc, pos + 1, pos + node.nodeSize - 1)
      : NodeSelection.create(state.doc, pos);
    view.dispatch(state.tr.setSelection(selection));
    view.focus();
    return;
  }

  if (op === 'delete') {
    let tr = state.tr.delete(pos, pos + node.nodeSize);
    if (tr.doc.childCount === 0) {
      const paragraph = state.schema.nodes['paragraph'];
      if (paragraph) tr = tr.insert(0, paragraph.create());
    }
    view.dispatch(tr);
    view.focus();
    return;
  }

  const targetIndex = op === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= doc.childCount) return;
  const neighborSize = doc.child(targetIndex).nodeSize;
  const tr = state.tr.delete(pos, pos + node.nodeSize);
  const newPos = op === 'up' ? pos - neighborSize : pos + neighborSize;
  tr.insert(newPos, node);
  tr.setSelection(TextSelection.create(tr.doc, newPos + 1));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/**
 * 删除光标所在的整张表格。
 *
 * 表格位于文档末尾时，它后面没有可以直接放光标的位置，靠 Backspace
 * 很难选中整表；菜单动作直接按节点范围删除最可靠。删除后把光标落到
 * 相邻位置，并保证文档不为空。
 */
export function deleteTable(view: EditorView): void {
  const { state } = view;
  const table = findAncestor(state.selection.$from, 'table');
  if (!table) return;

  let tr = state.tr.delete(table.pos, table.pos + table.node.nodeSize);
  if (tr.doc.childCount === 0) {
    const paragraph = state.schema.nodes['paragraph'];
    if (paragraph) tr = tr.insert(0, paragraph.create());
  }
  const caret = Math.max(0, Math.min(table.pos, tr.doc.content.size));
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(caret)));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/**
 * 删除表格当前行。
 *
 * GFM 表格必须保留表头行，所以光标在表头时不直接删：
 * 删掉旧表头，并把第一个数据行升级为表头（列数与内容都不变），
 * 表格依然合法，视觉上就是「删掉了一行」。
 */
export function deleteTableRow(view: EditorView): void {
  const { state } = view;
  const $from = state.selection.$from;
  const bodyRow = findAncestor($from, 'table_row');
  const headerRow = bodyRow ? null : findAncestor($from, 'table_header_row');
  const target = bodyRow ?? headerRow;
  if (!target) return;

  // 正文行：直接删除即可
  if (bodyRow) {
    view.dispatch(state.tr.delete(bodyRow.pos, bodyRow.pos + bodyRow.node.nodeSize));
    view.focus();
    return;
  }

  const table = findAncestor($from, 'table');
  if (!table) return;

  const headerRowType = state.schema.nodes['table_header_row'];
  const headerCellType = state.schema.nodes['table_header'];
  // 找第一个数据行（删除表头后它将成为新表头）
  let firstBody: ProseNode | null = null;
  table.node.forEach((child) => {
    if (!firstBody && child.type.name === 'table_row') firstBody = child;
  });

  // 只有表头没有数据行：整张表没有可用内容，直接删表
  if (!headerRowType || !headerCellType || !firstBody) {
    deleteTable(view);
    return;
  }

  // 重建整张表：旧表头出列，第一个数据行转成表头。
  // 不用「先 delete 再 replaceWith」两步：删掉表头会让文档短暂违反
  // 「表格必须以表头行开头」的内容表达式，后续步骤的坐标会错位。
  const rows: ProseNode[] = [];
  table.node.forEach((row) => rows.push(row));
  const headerIndex = rows.findIndex((row) => row.type.name === 'table_header_row');
  const bodyStart = rows.findIndex((row) => row.type.name === 'table_row');
  if (headerIndex < 0 || bodyStart < 0) return;

  const promoted = rows[bodyStart];
  const cells: ProseNode[] = [];
  promoted.forEach((cell) => {
    cells.push(headerCellType.create(cell.attrs, cell.content, cell.marks));
  });

  const nextRows = [...rows];
  nextRows.splice(headerIndex, 1);
  nextRows.splice(headerIndex, 1, headerRowType.create(promoted.attrs, Fragment.fromArray(cells)));

  const nextTable = table.node.type.create(table.node.attrs, Fragment.fromArray(nextRows));
  let tr = state.tr.replaceWith(table.pos, table.pos + table.node.nodeSize, nextTable);
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(table.pos + 4, tr.doc.content.size))));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** 删除表格当前列 */
export function deleteTableColumn(view: EditorView): void {
  const { state } = view;
  const $from = state.selection.$from;
  const cell = findAncestor($from, 'table_cell') ?? findAncestor($from, 'table_header');
  const table = findAncestor($from, 'table');
  if (!cell || !table) return;
  // 单元格在所属行中的索引：必须取 table_row 那一层的子索引。
  // 用 $from.index($from.depth - 1) 取到的是单元格内部（段落）的索引，永远是 0，
  // 于是删列只会删第一列或完全不生效。
  let cellIndex = -1;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name === 'table_row' || name === 'table_header_row') {
      cellIndex = $from.index(depth);
      break;
    }
  }
  if (cellIndex < 0) return;
  const targets: { pos: number; size: number }[] = [];
  table.node.forEach((row, rowOffset) => {
    // 表头行的节点类型是 table_header_row，必须一并处理：
    // 只删数据行的同一列会让表格列数不一致，prosemirror-tables 会自动补回
    // 缺失的单元格，表现就是「删除列没有任何反应」
    if (row.type.name !== 'table_row' && row.type.name !== 'table_header_row') return;
    let offset = 0;
    row.forEach((column, _childOffset, i) => {
      if (i === cellIndex) {
        targets.push({ pos: table.pos + 1 + rowOffset + 1 + offset, size: column.nodeSize });
      }
      offset += column.nodeSize;
    });
  });
  // 从后往前删，避免位置偏移
  let tr = state.tr;
  targets.reverse().forEach(({ pos, size }) => {
    tr = tr.delete(pos, pos + size);
  });
  if (targets.length > 0) view.dispatch(tr);
}

/**
 * 插入 Markdown 片段。
 *
 * 片段分两类，插入方式不同，否则会拆坏原有段落：
 * - 行内片段（`$x$`、`[链接](url)`、`![图](url)`）：直接替换当前选区；
 * - 块级片段（引用块、表格、公式块、脚注/链接定义、`[TOC]`、Front Matter）：
 *   插入到光标所在顶层块的后面。定义类节点在 Markdown 里只能出现在顶层，
 *   直接在段落中间替换会破坏段落结构。
 *
 * @param parse Markdown → ProseMirror 节点的解析函数（parserCtx）
 */
/**
 * 在新插入区间内查找一段占位文字，返回其绝对位置。
 * 只查插入区间，避免选中文档别处恰好相同的文字。
 */
function findInsertedText(
  doc: ProseNode,
  from: number,
  to: number,
  text: string
): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  doc.nodesBetween(from, to, (node, pos) => {
    if (found || !node.isText || !node.text) return !found;
    const index = node.text.indexOf(text);
    if (index >= 0) {
      const start = pos + index;
      if (start >= from && start + text.length <= to) {
        found = { from: start, to: start + text.length };
      }
    }
    return !found;
  });
  return found;
}

/**
 * 插入 Markdown 片段。
 * placeholder 传入时选中新片段里的占位文字（如警告框的「内容」），
 * 用户插完直接打字就替换掉它，而不是把字敲进 `[!NOTE]` 语法标记前面。
 */
export function insertSnippet(
  view: EditorView,
  parse: (markdown: string) => ProseNode,
  markdown: string,
  atStart: boolean,
  placeholder?: string
): void {
  const { state } = view;
  const fragment = parse(markdown).content;

  // 插入的是公式块时，让新节点视图自动进入编辑态（用户插完就能直接写 TeX）
  if (fragment.firstChild?.type.name === 'math_block') requestMathAutoEdit();

  // 只在「单个段落 + 无换行」时按行内方式插入
  const onlyParagraph = fragment.childCount === 1 && fragment.firstChild?.type.name === 'paragraph';
  const inline = onlyParagraph && !markdown.startsWith('\n') && !markdown.includes('\n\n');

  let tr;
  let caret: number;
  let insertStart: number;

  if (atStart) {
    tr = state.tr.insert(0, fragment);
    caret = 1;
    insertStart = 0;
  } else if (inline) {
    tr = state.tr.replaceRange(state.selection.from, state.selection.to, new Slice(fragment, 0, 0));
    caret = state.selection.from + fragment.size;
    insertStart = state.selection.from;
  } else {
    // 定位光标所在顶层块，块级片段插到它后面（定义类节点只能存在于顶层）
    const $from = state.selection.$from;
    const index = $from.index(0);
    const blockStart = topLevelPos(state.doc, index);
    const block = state.doc.child(index);
    const blockEnd = blockStart + block.nodeSize;
    // 当前块是空段落（新建的空文档）时直接替换，避免留下一个空段落
    const emptyParagraph = block.type.name === 'paragraph' && block.content.size === 0;
    tr = emptyParagraph
      ? state.tr.replaceWith(blockStart, blockEnd, fragment)
      : state.tr.insert(blockEnd, fragment);
    insertStart = emptyParagraph ? blockStart : blockEnd;
    caret = insertStart + 1;
  }

  const safeCaret = Math.max(0, Math.min(caret, tr.doc.content.size));
  const placeholderRange = placeholder
    ? findInsertedText(tr.doc, insertStart, insertStart + fragment.size, placeholder)
    : null;
  // 有占位文字就选中它；否则 near 保证光标落在合法的内联位置
  tr = placeholderRange
    ? tr.setSelection(TextSelection.create(tr.doc, placeholderRange.from, placeholderRange.to))
    : tr.setSelection(TextSelection.near(tr.doc.resolve(safeCaret)));
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

/** 清除选区内的行内样式；光标为空时清空待输入的 stored marks */
export function clearFormat(view: EditorView): void {
  const { state } = view;
  const { from, to, empty } = state.selection;
  if (empty) {
    view.dispatch(state.tr.setStoredMarks([]));
    return;
  }
  let tr = state.tr;
  Object.values(state.schema.marks).forEach((type) => {
    tr = tr.removeMark(from, to, type);
  });
  view.dispatch(tr);
}

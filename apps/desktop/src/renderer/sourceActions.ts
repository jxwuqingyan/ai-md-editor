/**
 * 源码模式的格式化动作（纯函数）。
 *
 * WYSIWYG 模式由 packages/editor 走 ProseMirror 命令；源码模式没有编辑器实例，
 * 这里直接对 Markdown 字符串 + textarea 选区做等价变换，保证两个模式的菜单行为一致。
 */
import type { FormatAction, TableContext } from '@ai-md-editor/editor';

/** 源码上下文：完整内容与当前选区 */
export interface SourceContext {
  content: string;
  selectionStart: number;
  selectionEnd: number;
}

/** 变换结果：新内容与新选区 */
export interface SourceResult {
  content: string;
  selectionStart: number;
  selectionEnd: number;
}

/** 已有行前缀（标题 / 引用 / 列表 / 任务列表 / 有序列表） */
const LINE_PREFIX = /^\s*(#{1,6}\s|>\s?|[-*+]\s(?:\[[ xX]\]\s)?|\d+\.\s)/;

/** 当前选区涉及的行范围 */
function lineBounds(content: string, start: number, end: number): { lineStart: number; lineEnd: number } {
  const lineStart = content.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = content.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = content.length;
  return { lineStart, lineEnd };
}

/** 当前光标所在行的序号（0 起） */
function currentLineIndex(content: string, start: number): number {
  return content.slice(0, start).split('\n').length - 1;
}

/** 保持原样 */
function unchanged(ctx: SourceContext): SourceResult {
  return { content: ctx.content, selectionStart: ctx.selectionStart, selectionEnd: ctx.selectionEnd };
}

/** 用 before/after 包裹选区 */
function wrap(ctx: SourceContext, before: string, after: string): SourceResult {
  const { content, selectionStart: start, selectionEnd: end } = ctx;
  const selected = content.slice(start, end);
  return {
    content: content.slice(0, start) + before + selected + after + content.slice(end),
    selectionStart: start + before.length,
    selectionEnd: start + before.length + selected.length
  };
}

/** 在光标处（或文档开头）插入文本，插入后光标落在文本末尾 */
function insert(ctx: SourceContext, text: string, atStart = false): SourceResult {
  const { content, selectionStart: start, selectionEnd: end } = ctx;
  if (atStart) {
    return { content: text + content, selectionStart: text.length, selectionEnd: text.length };
  }
  return {
    content: content.slice(0, start) + text + content.slice(end),
    selectionStart: start + text.length,
    selectionEnd: start + text.length
  };
}

/** 对选区涉及的每一行做变换，光标落在变换后文本末尾 */
function transformLines(ctx: SourceContext, transform: (lines: string[]) => string[]): SourceResult {
  const { content, selectionStart, selectionEnd } = ctx;
  const { lineStart, lineEnd } = lineBounds(content, selectionStart, selectionEnd);
  const replaced = transform(content.slice(lineStart, lineEnd).split('\n')).join('\n');
  return {
    content: content.slice(0, lineStart) + replaced + content.slice(lineEnd),
    selectionStart: lineStart + replaced.length,
    selectionEnd: lineStart + replaced.length
  };
}

/** 给行加前缀（prefix 为空表示转正文） */
function linePrefix(ctx: SourceContext, prefix: string): SourceResult {
  return transformLines(ctx, (lines) =>
    lines.map((line) => prefix + line.replace(LINE_PREFIX, ''))
  );
}

/** 对整篇文档的「当前行」做移动 / 删除 / 选择 */
function wholeLineOperation(ctx: SourceContext, op: 'up' | 'down' | 'delete' | 'select'): SourceResult {
  const lines = ctx.content.split('\n');
  const index = currentLineIndex(ctx.content, ctx.selectionStart);
  const target = op === 'up' ? index - 1 : index + 1;

  if (op === 'select') {
    let offset = 0;
    for (let i = 0; i < index; i += 1) offset += lines[i].length + 1;
    return {
      content: ctx.content,
      selectionStart: offset,
      selectionEnd: offset + lines[index].length
    };
  }
  if (op === 'delete') {
    const next = [...lines.slice(0, index), ...lines.slice(index + 1)];
    const joined = next.join('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(index, next.length - 1); i += 1) offset += next[i].length + 1;
    return { content: joined, selectionStart: offset, selectionEnd: offset };
  }
  if (target < 0 || target >= lines.length) return unchanged(ctx);

  const swapped = [...lines];
  [swapped[index], swapped[target]] = [swapped[target], swapped[index]];
  const joined = swapped.join('\n');
  let offset = 0;
  for (let i = 0; i < target; i += 1) offset += swapped[i].length + 1;
  return { content: joined, selectionStart: offset, selectionEnd: offset };
}

/** 简化选中文本的行内 Markdown 标记（清除样式） */
function clearInlineMarks(ctx: SourceContext): SourceResult {
  const { content, selectionStart: start, selectionEnd: end } = ctx;
  const target = start === end
    ? { from: lineBounds(content, start, end).lineStart, to: lineBounds(content, start, end).lineEnd }
    : { from: start, to: end };
  const cleaned = content
    .slice(target.from, target.to)
    .replace(/<\/?u>/g, '')
    .replace(/(\*\*|__|~~|`|\*|_)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  return {
    content: content.slice(0, target.from) + cleaned + content.slice(target.to),
    selectionStart: target.from,
    selectionEnd: target.from + cleaned.length
  };
}

/** 判断一行是否是表格行（以 | 开头，允许前导空白） */
function isTableRow(line: string | undefined): boolean {
  return Boolean(line && /^\s*\|/.test(line));
}

/** 判断一行是否是 GFM 表格的分隔行（|---|---|） */
function isTableSeparator(line: string | undefined): boolean {
  if (!line) return false;
  return /^\s*\|[\s:|-]+\|\s*$/.test(line) && /-{2,}/.test(line);
}

/** 表格块：同一张表在源码中的行范围 */
interface TableBlock {
  /** 起始行号（0 起） */
  start: number;
  /** 结束行号（不含） */
  end: number;
  /** 表格所有行 */
  lines: string[];
}

/** 找到光标所在的表格块（连续的以 | 开头的行） */
function findTableBlock(content: string, caret: number): TableBlock | null {
  const lines = content.split('\n');
  const index = currentLineIndex(content, caret);
  if (!isTableRow(lines[index])) return null;
  let start = index;
  while (start > 0 && isTableRow(lines[start - 1])) start -= 1;
  let end = index;
  while (end + 1 < lines.length && isTableRow(lines[end + 1])) end += 1;
  return { start, end: end + 1, lines: lines.slice(start, end + 1) };
}

/** 把一行拆成单元格原始文本（保留各自原有的空白，避免整表被重排） */
function rowCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|');
}

/** 用单元格拼回一行（保留原有空白） */
function joinCells(cells: string[]): string {
  return `|${cells.join('|')}|`;
}

/** 光标所在列（0 起）；不在表格行内返回 -1 */
function caretColumn(line: string, columnInLine: number): number {
  const before = line.slice(0, columnInLine);
  const pipes = (before.match(/\|/g) ?? []).length;
  // 行以 | 开头时第一个 | 之前没有单元格，因此列号要减一
  return pipes - 1;
}

/** 表格行操作：增删行 / 增删列（以整张表为单位，保证列数一致） */
function tableLineOperation(ctx: SourceContext, op: 'addRow' | 'addCol' | 'deleteRow' | 'deleteCol'): SourceResult {
  const block = findTableBlock(ctx.content, ctx.selectionStart);
  if (!block) return unchanged(ctx);

  const { content, selectionStart } = ctx;
  const lines = content.split('\n');
  const rowIndex = currentLineIndex(content, selectionStart) - block.start;
  const lineStart = content.lastIndexOf('\n', selectionStart - 1) + 1;
  const columnInLine = selectionStart - lineStart;
  const hasHeader = isTableSeparator(block.lines[1]);

  /** 用新的表格行替换原块，光标落在指定行首 */
  const rebuild = (rows: string[], caretRow: number): SourceResult => {
    const before = lines.slice(0, block.start);
    const after = lines.slice(block.end);
    const nextLines = [...before, ...rows, ...after];
    let offset = 0;
    for (let i = 0; i < block.start + caretRow; i += 1) offset += nextLines[i].length + 1;
    return { content: nextLines.join('\n'), selectionStart: offset, selectionEnd: offset };
  };

  if (op === 'deleteRow') {
    // 表头行：删掉旧表头，把分隔行下移一行，让首个数据行成为新表头（GFM 必须保留表头）
    if (hasHeader && rowIndex === 0) {
      if (block.lines.length < 3) return unchanged(ctx);
      const rows = [block.lines[2], block.lines[1], ...block.lines.slice(3)];
      return rebuild(rows, 0);
    }
    // 只剩表头时不允许删掉唯一的数据行
    if (block.lines.length <= 2) return unchanged(ctx);
    return rebuild(block.lines.filter((_line, i) => i !== rowIndex), Math.max(0, rowIndex - 1));
  }

  if (op === 'addRow') {
    const cellCount = rowCells(block.lines[0]).length;
    // 「在下方插入行」：表头下方应插在分隔行之后，否则会破坏表格结构
    const insertAt = hasHeader && rowIndex === 0 ? 2 : rowIndex + 1;
    const emptyRow = joinCells(Array.from({ length: cellCount }, () => '  '));
    const rows = [...block.lines.slice(0, insertAt), emptyRow, ...block.lines.slice(insertAt)];
    return rebuild(rows, insertAt);
  }

  const column = caretColumn(block.lines[rowIndex], columnInLine);
  if (column < 0) return unchanged(ctx);
  const cellCount = rowCells(block.lines[rowIndex]).length;

  if (op === 'addCol') {
    const rows = block.lines.map((line, i) => {
      const cells = rowCells(line);
      if (column + 1 > cells.length) return line;
      cells.splice(column + 1, 0, i === 1 ? ' --- ' : '  ');
      return joinCells(cells);
    });
    return rebuild(rows, rowIndex);
  }

  // 只剩一列时删列等于删表，交给「删除行」处理更安全
  if (cellCount <= 1) return unchanged(ctx);
  const rows = block.lines.map((line) => {
    const cells = rowCells(line);
    if (column >= cells.length) return line;
    cells.splice(column, 1);
    return joinCells(cells);
  });
  return rebuild(rows, rowIndex);
}

/**
 * 源码模式的表格上下文：按光标所在行判断是否在表格 / 表头。
 * 与 WYSIWYG 模式的 editor.getTableContext() 对齐，供原生菜单置灰使用。
 */
export function sourceTableContext(content: string, caret: number): TableContext {
  const block = findTableBlock(content, caret);
  if (!block) return { inTable: false, inHeader: false };
  const rowIndex = currentLineIndex(content, caret) - block.start;
  return { inTable: true, inHeader: isTableSeparator(block.lines[1]) && rowIndex === 0 };
}

/** 3×3 表格片段 */
const TABLE_SNIPPET = '\n| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n';

/** 源码模式的统一格式化分发 */
export function applySourceFormat(
  action: FormatAction,
  payload: number | string | undefined,
  ctx: SourceContext
): SourceResult {
  switch (action) {
    case 'bold':
      return wrap(ctx, '**', '**');
    case 'italic':
      return wrap(ctx, '*', '*');
    case 'code':
      return wrap(ctx, '`', '`');
    case 'strikethrough':
      return wrap(ctx, '~~', '~~');
    case 'underline':
      return wrap(ctx, '<u>', '</u>');
    case 'heading':
      return linePrefix(ctx, '#'.repeat(typeof payload === 'number' ? payload : 1) + ' ');
    case 'paragraph':
      return linePrefix(ctx, '');
    case 'quote':
      return linePrefix(ctx, '> ');
    case 'bulletList':
      return linePrefix(ctx, '- ');
    case 'orderedList':
      return linePrefix(ctx, '1. ');
    case 'taskList':
      return linePrefix(ctx, '- [ ] ');
    case 'taskDone':
      return transformLines(ctx, (lines) =>
        lines.map((line) => line.replace(/^(\s*[-*+]\s+)\[[ xX]\]\s*/, '$1[x] '))
      );
    case 'taskUndone':
      return transformLines(ctx, (lines) =>
        lines.map((line) => line.replace(/^(\s*[-*+]\s+)\[[ xX]\]\s*/, '$1[ ] '))
      );
    case 'taskClear':
      return transformLines(ctx, (lines) =>
        lines.map((line) => line.replace(/^(\s*[-*+]\s+)\[[ xX]\]\s*/, '$1'))
      );
    case 'upgradeHeading':
      return transformLines(ctx, (lines) =>
        lines.map((line) => {
          const matched = line.match(/^(#{1,6})\s/);
          if (!matched) return '# ' + line;
          return '#'.repeat(Math.max(1, matched[1].length - 1)) + ' ' + line.slice(matched[0].length);
        })
      );
    case 'downgradeHeading':
      return transformLines(ctx, (lines) =>
        lines.map((line) => {
          const matched = line.match(/^(#{1,6})\s/);
          if (!matched) return line;
          if (matched[1].length === 1) return line.slice(matched[0].length);
          return '#'.repeat(matched[1].length - 1) + ' ' + line.slice(matched[0].length);
        })
      );
    case 'indentList':
      return transformLines(ctx, (lines) => lines.map((line) => '  ' + line));
    case 'outdentList':
      return transformLines(ctx, (lines) => lines.map((line) => line.replace(/^ {1,2}/, '')));
    case 'codeBlock':
      return wrap(ctx, '\n```\n', '\n```\n');
    case 'hr':
      return insert(ctx, '\n---\n');
    case 'hardBreak':
      return insert(ctx, '  \n');
    case 'insertTable':
      return insert(ctx, TABLE_SNIPPET);
    case 'tableAddRow':
      return tableLineOperation(ctx, 'addRow');
    case 'tableAddCol':
      return tableLineOperation(ctx, 'addCol');
    case 'tableDeleteRow':
      return tableLineOperation(ctx, 'deleteRow');
    case 'tableDeleteCol':
      return tableLineOperation(ctx, 'deleteCol');
    case 'insertParagraphAbove': {
      const { lineStart } = lineBounds(ctx.content, ctx.selectionStart, ctx.selectionEnd);
      return {
        content: ctx.content.slice(0, lineStart) + '\n' + ctx.content.slice(lineStart),
        selectionStart: lineStart,
        selectionEnd: lineStart
      };
    }
    case 'insertParagraphBelow': {
      const { lineEnd } = lineBounds(ctx.content, ctx.selectionStart, ctx.selectionEnd);
      return {
        content: ctx.content.slice(0, lineEnd) + '\n' + ctx.content.slice(lineEnd),
        selectionStart: lineEnd + 1,
        selectionEnd: lineEnd + 1
      };
    }
    case 'moveLineUp':
      return wholeLineOperation(ctx, 'up');
    case 'moveLineDown':
      return wholeLineOperation(ctx, 'down');
    case 'deleteLine':
      return wholeLineOperation(ctx, 'delete');
    case 'selectLine':
      return wholeLineOperation(ctx, 'select');
    case 'clearFormat':
      return clearInlineMarks(ctx);
    case 'snippet':
      return typeof payload === 'string' ? insert(ctx, payload) : unchanged(ctx);
    case 'snippetAtStart':
      return typeof payload === 'string' ? insert(ctx, payload, true) : unchanged(ctx);
  }
}

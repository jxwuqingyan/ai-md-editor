/**
 * 源码模式的格式化动作（纯函数）。
 *
 * WYSIWYG 模式由 packages/editor 走 ProseMirror 命令；源码模式没有编辑器实例，
 * 这里直接对 Markdown 字符串 + textarea 选区做等价变换，保证两个模式的菜单行为一致。
 */
import type { FormatAction } from '@ai-md-editor/editor';

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

/** 表格行操作：仅在当前行是表格行时生效 */
function tableLineOperation(ctx: SourceContext, op: 'addRow' | 'addCol' | 'deleteRow' | 'deleteCol'): SourceResult {
  const { content, selectionStart } = ctx;
  const { lineStart, lineEnd } = lineBounds(content, selectionStart, selectionStart);
  const line = content.slice(lineStart, lineEnd);
  if (!line.trim().startsWith('|')) return unchanged(ctx);

  if (op === 'deleteRow') {
    return {
      content: content.slice(0, lineStart) + content.slice(Math.min(lineEnd + 1, content.length)),
      selectionStart: lineStart,
      selectionEnd: lineStart
    };
  }
  if (op === 'addRow') {
    const columns = Math.max(2, line.split('|').length - 2);
    const row = `|${'  |'.repeat(columns)}\n`;
    return {
      content: content.slice(0, lineEnd + 1) + row + content.slice(lineEnd + 1),
      selectionStart: lineEnd + 1,
      selectionEnd: lineEnd + 1
    };
  }
  if (op === 'addCol') {
    const withColumn = line.replace(/\|\s*$/, '  |');
    return {
      content: content.slice(0, lineStart) + withColumn + content.slice(lineEnd),
      selectionStart: lineStart + withColumn.length,
      selectionEnd: lineStart + withColumn.length
    };
  }
  // 删除最后一列
  const cells = line.split('|');
  const trimmed = cells.length > 3 ? cells.slice(0, -2).concat('|').join('|') : line;
  return {
    content: content.slice(0, lineStart) + trimmed + content.slice(lineEnd),
    selectionStart: lineStart + trimmed.length,
    selectionEnd: lineStart + trimmed.length
  };
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

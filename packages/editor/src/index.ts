/**
 * WYSIWYG 编辑器封装（基于 Milkdown / ProseMirror）。
 *
 * 职责边界：
 * - 封装 Milkdown 初始化、预设配置、生命周期管理
 * - 提供统一的 EditorInstance 接口：内容读写、格式化命令、选区/查找、视图状态
 * - 中文 IME 适配：ProseMirror 已内置 composition 处理，此处不额外干预
 *
 * 格式化命令分两类：
 * 1. Milkdown 预设提供的 $command（加粗、标题、列表、表格等），用 callCommand 调用；
 * 2. 预设没有的命令（标题升降级、任务状态、段落插入、行移动、清除样式等），
 *    下沉到 ProseMirror transaction 实现，保证选区与撤销历史正确。
 */

import { Editor, defaultValueCtx, editorViewCtx, parserCtx, rootCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { callCommand } from '@milkdown/kit/utils';
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInHeadingCommand,
  turnIntoTextCommand,
  createCodeBlockCommand,
  insertHrCommand,
  sinkListItemCommand,
  liftListItemCommand,
  insertHardbreakCommand
} from '@milkdown/kit/preset/commonmark';
import {
  toggleStrikethroughCommand,
  addRowAfterCommand,
  addColAfterCommand
} from '@milkdown/kit/preset/gfm';
import { TextSelection, NodeSelection } from '@milkdown/kit/prose/state';
import { toggleMark } from '@milkdown/kit/prose/commands';
import type { EditorView } from '@milkdown/kit/prose/view';
import { Slice, type Node as ProseNode, type ResolvedPos } from '@milkdown/kit/prose/model';
import { highlight, highlightPluginConfig } from '@milkdown/plugin-highlight';
import { createParser } from '@milkdown/plugin-highlight/shiki';
import { createCssVariablesTheme, getSingletonHighlighter } from 'shiki';
import { math } from '@milkdown/plugin-math';
import { diagram } from '@milkdown/plugin-diagram';
import { underlineRemark, underlineSchema } from './underline';
import { frontmatterRemark, frontmatterSchema } from './frontmatter';
import { configureStringify } from './stringify';
import { calloutPlugin, tocPlugin } from './decorations';

/** Shiki 支持的常用语言（按需加载，避免体积过大） */
const HIGHLIGHT_LANGS = [
  'javascript', 'typescript', 'jsx', 'tsx', 'json', 'html', 'css', 'scss',
  'python', 'go', 'rust', 'java', 'c', 'cpp', 'csharp', 'bash', 'shell',
  'sql', 'yaml', 'toml', 'markdown', 'docker', 'diff', 'xml', 'php',
  'ruby', 'swift', 'kotlin'
];

/** 3×3 表格片段（带表头文字，插入后可直接填写） */
const TABLE_SNIPPET = '\n| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n';

/** 工具栏/菜单支持的格式化动作 */
export type FormatAction =
  | 'bold' | 'italic' | 'code' | 'quote' | 'bulletList' | 'orderedList'
  | 'heading' | 'paragraph' | 'codeBlock' | 'hr'
  | 'upgradeHeading' | 'downgradeHeading'
  | 'strikethrough' | 'underline' | 'clearFormat' | 'hardBreak'
  | 'insertTable' | 'tableAddRow' | 'tableAddCol' | 'tableDeleteRow' | 'tableDeleteCol'
  | 'taskList' | 'taskDone' | 'taskUndone' | 'taskClear'
  | 'indentList' | 'outdentList'
  | 'insertParagraphAbove' | 'insertParagraphBelow'
  | 'moveLineUp' | 'moveLineDown' | 'deleteLine' | 'selectLine'
  | 'snippet' | 'snippetAtStart';

/** 编辑器实例的统一接口（供渲染层调用） */
export interface EditorInstance {
  /** 获取当前 Markdown 文本 */
  getMarkdown(): string;
  /** 设置编辑器内容（替换全部） */
  setMarkdown(markdown: string): void;
  /** 在光标处插入 markdown 文本（如粘贴图片语法） */
  insertAtCursor(markdown: string): void;
  /** 滚动到指定标题（大纲跳转），index 为标题在文档中的序号（0 起） */
  scrollToHeading(index: number): void;
  /** 应用格式化命令（工具栏与系统菜单共用） */
  format(action: FormatAction, payload?: number | string): void;
  /** 设置可编辑状态（只读模式） */
  setEditable(editable: boolean): void;
  /** 获取纯文本（不含 Markdown 标记），供查找功能使用 */
  getPlainText(): string;
  /** 按纯文本偏移选中一段文本，并滚动到可见区域（查找跳转） */
  selectTextRange(start: number, end: number): void;
  /** 用纯文本替换当前选区（查找替换） */
  replaceSelection(text: string): void;
  /** 把光标保持在可视区域中部（打字机模式） */
  centerCaret(): void;
  /** 聚焦编辑器 */
  focus(): void;
  /** 销毁编辑器，释放资源 */
  destroy(): void;
}

/** 编辑器创建选项 */
export interface CreateEditorOptions {
  /** 初始 Markdown 内容 */
  defaultValue?: string;
  /** 内容变化回调（markdownUpdated 触发），返回最新 Markdown 文本 */
  onChange?: (markdown: string) => void;
}

/** 顶层节点的起始位置（ProseMirror doc 坐标） */
function topLevelPos(doc: ProseNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i += 1) pos += doc.child(i).nodeSize;
  return pos;
}

/** 向上查找指定类型的祖先节点，返回其起始位置与节点本身 */
function findAncestor($from: ResolvedPos, name: string): { pos: number; node: ProseNode } | null {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === name) {
      return { pos: $from.before(depth), node };
    }
  }
  return null;
}

/**
 * 创建编辑器实例（基于 Milkdown）。
 *
 * @param container 编辑器挂载的 DOM 容器
 * @param options 创建选项（初始内容、变化回调）
 */
export async function createEditor(
  container: HTMLElement,
  options: CreateEditorOptions = {}
): Promise<EditorInstance> {
  const { defaultValue = '', onChange } = options;

  // 缓存最新的 Markdown 文本（由 markdownUpdated 回调更新）
  let currentMarkdown = defaultValue;

  // 用 CSS 变量主题：token 颜色输出为 var(--s-token-xxx)，明暗切换只需改 CSS 变量
  const cssTheme = createCssVariablesTheme({
    name: 'markdown-note',
    variablePrefix: '--s-',
    variableDefaults: { foreground: '#24292e', background: '#f6f8fa' }
  });

  const highlighter = await getSingletonHighlighter({
    themes: [cssTheme],
    langs: HIGHLIGHT_LANGS
  });
  const highlightParser = createParser(highlighter);

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container);
      ctx.set(defaultValueCtx, defaultValue);
      // 注册 underline / front matter / 目录语法的 stringify handler（Markdown 往返不丢格式）
      configureStringify(ctx);
    })
    .config((ctx) => {
      ctx.set(highlightPluginConfig.key, { parser: highlightParser });
    })
    .use(listener)
    .config((ctx) => {
      const manager = ctx.get(listenerCtx);
      manager.markdownUpdated((_ctx, markdown) => {
        currentMarkdown = markdown;
        onChange?.(markdown);
      });
    })
    .use(commonmark)
    .use(gfm)
    .use([...underlineSchema])
    // $remark 返回 [optionsCtx, plugin]，两者都要注册，否则上下文注入缺失
    .use([...underlineRemark])
    // YAML Front Matter：解析/渲染/序列化三位一体
    .use([...frontmatterSchema])
    .use([...frontmatterRemark])
    // 警告框与 [TOC] 目录块的渲染增强（纯装饰，不改 Markdown 文本）
    .use(calloutPlugin)
    .use(tocPlugin)
    .use(highlight)
    .use(math)
    .use(diagram)
    .create();

  /** 统一的 action 入口：拿到 view 后执行自定义 ProseMirror 事务 */
  const withView = (run: (view: EditorView) => void): void => {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (view) run(view);
    });
  };

  /** 当前光标所在标题级别（0 表示不在标题内） */
  const headingLevel = (): number => {
    let level = 0;
    withView((view) => {
      const found = findAncestor(view.state.selection.$from, 'heading');
      if (found) level = Number(found.node.attrs['level'] ?? 0);
    });
    return level;
  };

  /** 设置任务列表项的 checked 属性（不在列表中时先包成无序列表） */
  const applyTaskState = (mode: 'taskList' | 'taskDone' | 'taskUndone' | 'taskClear', retried = false): void => {
    let applied = false;
    withView((view) => {
      const found = findAncestor(view.state.selection.$from, 'list_item');
      if (!found) return;
      const previous = found.node.attrs['checked'] as boolean | null | undefined;
      const checked =
        mode === 'taskDone' ? true
          : mode === 'taskUndone' ? false
            : mode === 'taskClear' ? null
              : previous == null ? false : previous;
      const tr = view.state.tr.setNodeMarkup(found.pos, undefined, {
        ...found.node.attrs,
        checked
      });
      view.dispatch(tr);
      applied = true;
    });
    if (!applied && !retried) {
      editor.action(callCommand(wrapInBulletListCommand.key));
      applyTaskState(mode, true);
    }
  };

  /** 在当前块的上方或下方插入一个空段落 */
  const insertParagraph = (above: boolean): void => {
    withView((view) => {
      const { state } = view;
      const $from = state.selection.$from;
      if ($from.depth < 1) return;
      const index = $from.index(1);
      const node = state.doc.child(index);
      const paragraph = state.schema.nodes['paragraph'];
      if (!paragraph) return;
      const pos = topLevelPos(state.doc, index);
      const insertPos = above ? pos : pos + node.nodeSize;
      const tr = state.tr.insert(insertPos, paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
      view.dispatch(tr.scrollIntoView());
      view.focus();
    });
  };

  /** 当前顶层块的行操作：上移 / 下移 / 删除 / 选择 */
  const lineOperation = (op: 'up' | 'down' | 'delete' | 'select'): void => {
    withView((view) => {
      const { state } = view;
      const $from = state.selection.$from;
      if ($from.depth < 1) return;
      const doc = state.doc;
      const index = $from.index(1);
      const node = doc.child(index);
      const pos = topLevelPos(doc, index);

      if (op === 'select') {
        // 文本块按内容范围选中；叶子块（分割线等）与复杂容器直接选中整个节点，
        // 避免构造出指向 doc 层（无内联内容）的非法 TextSelection
        const selection = node.isTextblock
          ? TextSelection.create(state.doc, pos + 1, pos + node.nodeSize - 1)
          : NodeSelection.create(state.doc, pos);
        const tr = state.tr.setSelection(selection);
        view.dispatch(tr);
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
    });
  };

  /** 删除表格当前行 / 当前列（预设命令需要选区，直接用事务更稳） */
  const deleteTableLine = (kind: 'row' | 'col'): void => {
    withView((view) => {
      const { state } = view;
      const $from = state.selection.$from;
      if (kind === 'row') {
        const row = findAncestor($from, 'table_row');
        if (row) view.dispatch(state.tr.delete(row.pos, row.pos + row.node.nodeSize));
        return;
      }
      const cell = findAncestor($from, 'table_cell') ?? findAncestor($from, 'table_header');
      const table = findAncestor($from, 'table');
      if (!cell || !table) return;
      // 单元格在其父行中的索引即列索引
      const cellIndex = $from.index($from.depth - 1);
      const targets: { pos: number; size: number }[] = [];
      table.node.forEach((row, rowOffset) => {
        if (row.type.name !== 'table_row') return;
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
    });
  };

  /**
   * 插入 Markdown 片段。
   *
   * 片段分两类，插入方式不同，否则会拆坏原有段落：
   * - 行内片段（`$x$`、`[链接](url)`、`![图](url)`）：直接替换当前选区；
   * - 块级片段（引用块、表格、公式块、脚注/链接定义、`[TOC]`、Front Matter）：
   *   插入到光标所在顶层块的后面。定义类节点在 Markdown 里只能出现在顶层，
   *   直接在段落中间替换会破坏段落结构。
   */
  const insertSnippet = (markdown: string, atStart: boolean): void => {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const parser = ctx.get(parserCtx);
      if (!view || !parser) return;
      const { state } = view;
      const fragment = parser(markdown).content;

      // 只在「单个段落 + 无换行」时按行内方式插入
      const onlyParagraph =
        fragment.childCount === 1 && fragment.firstChild?.type.name === 'paragraph';
      const inline = onlyParagraph && !markdown.startsWith('\n') && !markdown.includes('\n\n');

      let tr;
      let caret: number;

      if (atStart) {
        tr = state.tr.insert(0, fragment);
        caret = 1;
      } else if (inline) {
        tr = state.tr.replaceRange(
          state.selection.from,
          state.selection.to,
          new Slice(fragment, 0, 0)
        );
        caret = state.selection.from + fragment.size;
      } else {
        // 定位光标所在顶层块，块级片段插到它后面（定义类节点只能存在于顶层）
        const $from = state.selection.$from;
        const index = $from.index(0);
        let blockStart = 0;
        for (let i = 0; i < index; i += 1) blockStart += state.doc.child(i).nodeSize;
        const block = state.doc.child(index);
        const blockEnd = blockStart + block.nodeSize;
        // 当前块是空段落（新建的空文档）时直接替换，避免留下一个空段落
        const emptyParagraph = block.type.name === 'paragraph' && block.content.size === 0;
        tr = emptyParagraph
          ? state.tr.replaceWith(blockStart, blockEnd, fragment)
          : state.tr.insert(blockEnd, fragment);
        caret = (emptyParagraph ? blockStart : blockEnd) + 1;
      }

      const safeCaret = Math.max(0, Math.min(caret, tr.doc.content.size));
      // 片段可能包含脚注定义等纯块容器，near 保证光标落在合法的内联位置
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(safeCaret)));
      view.dispatch(tr.scrollIntoView());
      view.focus();
    });
  };

  return {
    getMarkdown(): string {
      return currentMarkdown;
    },

    setMarkdown(markdown: string): void {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const parser = ctx.get(parserCtx);
        if (!view || !parser) return;
        const doc = parser(markdown);
        const { state } = view;
        const tr = state.tr.replaceWith(0, state.doc.content.size, doc);
        view.dispatch(tr);
        currentMarkdown = markdown;
      });
    },

    insertAtCursor(markdown: string): void {
      insertSnippet(markdown, false);
    },

    scrollToHeading(index: number): void {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (!view || index < 0) return;
        let headingIndex = 0;
        let targetPos: number | null = null;
        view.state.doc.descendants((node, pos) => {
          if (targetPos !== null) return false;
          if (node.type.name === 'heading') {
            if (headingIndex === index) {
              targetPos = pos;
              return false;
            }
            headingIndex += 1;
          }
          return true;
        });
        if (targetPos === null) return;
        const element = view.nodeDOM(targetPos);
        if (element instanceof HTMLElement) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        view.focus();
      });
    },

    /** 应用格式化命令（工具栏与系统菜单共用） */
    format(action: FormatAction, payload?: number | string): void {
      switch (action) {
        case 'bold':
          editor.action(callCommand(toggleStrongCommand.key));
          break;
        case 'italic':
          editor.action(callCommand(toggleEmphasisCommand.key));
          break;
        case 'code':
          editor.action(callCommand(toggleInlineCodeCommand.key));
          break;
        case 'quote':
          editor.action(callCommand(wrapInBlockquoteCommand.key));
          break;
        case 'bulletList':
          editor.action(callCommand(wrapInBulletListCommand.key));
          break;
        case 'orderedList':
          editor.action(callCommand(wrapInOrderedListCommand.key));
          break;
        case 'heading':
          editor.action(callCommand(wrapInHeadingCommand.key, typeof payload === 'number' ? payload : 1));
          break;
        case 'paragraph':
          editor.action(callCommand(turnIntoTextCommand.key));
          break;
        case 'codeBlock':
          editor.action(callCommand(createCodeBlockCommand.key));
          break;
        case 'hr':
          editor.action(callCommand(insertHrCommand.key));
          break;
        case 'hardBreak':
          // 光标落在纯块容器（脚注定义等）时该命令会抛异常，捕获后保持原状
          try {
            editor.action(callCommand(insertHardbreakCommand.key));
          } catch {
            // 当前上下文不支持内联换行符
          }
          break;
        case 'strikethrough':
          editor.action(callCommand(toggleStrikethroughCommand.key));
          break;
        case 'indentList':
          editor.action(callCommand(sinkListItemCommand.key));
          break;
        case 'outdentList':
          editor.action(callCommand(liftListItemCommand.key));
          break;
        case 'insertTable':
          // 用带表头的片段插入，编辑器内直接可读；命令版只能得到空表头
          insertSnippet(TABLE_SNIPPET, false);
          break;
        case 'tableAddRow':
          editor.action(callCommand(addRowAfterCommand.key));
          break;
        case 'tableAddCol':
          editor.action(callCommand(addColAfterCommand.key));
          break;
        case 'tableDeleteRow':
          deleteTableLine('row');
          break;
        case 'tableDeleteCol':
          deleteTableLine('col');
          break;
        case 'upgradeHeading':
        case 'downgradeHeading': {
          const level = headingLevel();
          if (action === 'upgradeHeading') {
            editor.action(callCommand(wrapInHeadingCommand.key, level <= 1 ? 1 : level - 1));
          } else if (level <= 1) {
            editor.action(callCommand(turnIntoTextCommand.key));
          } else {
            editor.action(callCommand(wrapInHeadingCommand.key, level - 1));
          }
          break;
        }
        case 'taskList':
        case 'taskDone':
        case 'taskUndone':
        case 'taskClear':
          applyTaskState(action);
          break;
        case 'insertParagraphAbove':
          insertParagraph(true);
          break;
        case 'insertParagraphBelow':
          insertParagraph(false);
          break;
        case 'moveLineUp':
          lineOperation('up');
          break;
        case 'moveLineDown':
          lineOperation('down');
          break;
        case 'deleteLine':
          lineOperation('delete');
          break;
        case 'selectLine':
          lineOperation('select');
          break;
        case 'clearFormat':
          withView((view) => {
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
          });
          break;
        case 'underline':
          withView((view) => {
            const type = view.state.schema.marks['underline'];
            if (type) toggleMark(type)(view.state, view.dispatch, view);
          });
          break;
        case 'snippet':
        case 'snippetAtStart':
          if (typeof payload === 'string') insertSnippet(payload, action === 'snippetAtStart');
          break;
      }
    },

    setEditable(editable: boolean): void {
      withView((view) => {
        view.setProps({ editable: () => editable });
      });
    },

    getPlainText(): string {
      let text = '';
      withView((view) => {
        text = view.state.doc.textContent;
      });
      return text;
    },

    selectTextRange(start: number, end: number): void {
      withView((view) => {
        const { state } = view;
        let offset = 0;
        let from = -1;
        let to = -1;
        state.doc.descendants((node, pos) => {
          if (node.isText) {
            const length = node.text?.length ?? 0;
            if (from < 0 && offset + length >= start) from = pos + Math.max(0, start - offset);
            if (offset + length >= end) {
              to = pos + Math.max(0, end - offset);
              return false;
            }
            offset += length;
            return false;
          }
          return true;
        });
        if (from < 0 || to < 0 || from > to) return;
        const tr = state.tr.setSelection(TextSelection.create(state.doc, from, to));
        view.dispatch(tr.scrollIntoView());
        view.focus();
      });
    },

    replaceSelection(text: string): void {
      withView((view) => {
        const { from, to } = view.state.selection;
        const tr = view.state.tr.insertText(text, from, to);
        view.dispatch(tr.scrollIntoView());
        view.focus();
      });
    },

    centerCaret(): void {
      withView((view) => {
        const scroller = view.dom.closest('.editor-wrap');
        if (!(scroller instanceof HTMLElement)) return;
        const coords = view.coordsAtPos(view.state.selection.from);
        const rect = scroller.getBoundingClientRect();
        const target = rect.top + rect.height * 0.45;
        const delta = coords.top - target;
        if (Math.abs(delta) > 2) scroller.scrollTop += delta;
      });
    },

    focus(): void {
      withView((view) => view.focus());
    },

    destroy(): void {
      void editor.destroy();
    }
  };
}

// 导出 Milkdown 类型，供渲染层使用
export type { Editor } from '@milkdown/kit/core';

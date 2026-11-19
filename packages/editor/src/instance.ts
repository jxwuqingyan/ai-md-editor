/**
 * WYSIWYG 编辑器实例（基于 Milkdown / ProseMirror）。
 *
 * 职责边界：
 * - 封装 Milkdown 初始化、预设配置、生命周期管理
 * - 提供统一的 EditorInstance 接口：内容读写、格式化命令、选区/查找、视图状态
 * - 中文 IME 适配：ProseMirror 已内置 composition 处理，此处不额外干预
 *
 * 格式化命令分两类：
 * 1. Milkdown 预设提供的 $command（加粗、标题、列表、表格等），用 callCommand 调用；
 * 2. 预设没有的命令，下沉到 ProseMirror transaction（见 commands.ts）。
 */

import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  parserCtx,
  rootCtx,
  serializerCtx
} from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { callCommand } from '@milkdown/kit/utils';
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
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
  addColAfterCommand,
  addRowBeforeCommand,
  addColBeforeCommand
} from '@milkdown/kit/preset/gfm';
import { TextSelection } from '@milkdown/kit/prose/state';
import { toggleMark } from '@milkdown/kit/prose/commands';
import { history, undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
import type { EditorView } from '@milkdown/kit/prose/view';
import { highlight } from '@milkdown/plugin-highlight';
import { math } from '@milkdown/plugin-math';
import { diagram } from '@milkdown/plugin-diagram';
import { underlineRemark, underlineSchema } from './underline';
import { frontmatterRemark, frontmatterSchema } from './frontmatter';
import { configureStringify } from './stringify';
import { calloutPlugin, tocPlugin } from './decorations';
import { createHighlightParser, highlightConfigKey } from './highlight';
import { selectionContextPlugin } from './selection';
import { trailingParagraphPlugin } from './trailing';
import { blockLineEndCaret } from './gapCursor';
import { listBackspaceShortcut, listUnlistPendingPlugin } from './listBackspace';
import { listItemExitPlugin } from './listItemExit';
import { configureMathView, mathNodeViewPlugin } from './mathView';
import { clearSearchHighlight, searchHighlightPlugin, setSearchHighlight } from './search';
import { collectTextSegments, textOffsetToPos } from './textPos';
import { slashMenuPlugin } from './slash';
import { linkClickPlugin } from './link';
import { taskListPlugin } from './task';
import { tableHandlesPlugin } from './tableHandles';
import { applyImageSources, imageSourcePlugin } from './images';
import {
  applyTaskState,
  clearFormat,
  deleteTable,
  deleteTableColumn,
  deleteTableRow,
  describeTableContext,
  findAncestor,
  insertParagraphAt,
  insertSnippet,
  lineOperation
} from './commands';
import type { CreateEditorOptions, EditorInstance, FormatAction, TableContext } from './types';

/** 3×3 表格片段（带表头文字，插入后可直接填写） */
/** 动态构造表格片段：cols 列（带「列 N」表头）、rows 行（含表头行） */
function buildTableSnippet(cols: number, rows: number): string {
  const header = `| ${Array.from({ length: cols }, (_, i) => `列 ${i + 1}`).join(' | ')} |`;
  const separator = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`;
  const emptyRow = `| ${Array.from({ length: cols }, () => '').join(' | ')} |`;
  const body = Array.from({ length: Math.max(0, rows - 1) }, () => emptyRow);
  return ['\n' + header, separator, ...body].join('\n') + '\n';
}

/**
 * 把文档位置对应的屏幕坐标滚进编辑区可见范围。
 *
 * 不用 ProseMirror 的 tr.scrollIntoView()：它在 update 阶段走 scrollToSelection()，
 * 而后者要求 DOM 选区的 focusNode 落在编辑器内。查找时焦点停在查找框，
 * focusNode 是查找输入框，滚动会被整个跳过——现象就是「计数在变、正文不跳」。
 * 这里按坐标手动滚 .editor-scroll，不碰焦点，查找框可以继续输入。
 */
function scrollPosIntoView(view: EditorView, pos: number): void {
  const scroller = view.dom.closest<HTMLElement>('.editor-scroll');
  if (!scroller) return;
  try {
    const coords = view.coordsAtPos(pos);
    if (!coords) return;
    const box = scroller.getBoundingClientRect();
    const margin = 8; // 命中贴边时留一点余量，避免被容器边缘裁掉
    if (coords.top < box.top + margin) {
      scroller.scrollTop -= box.top + margin - coords.top;
    } else if (coords.bottom > box.bottom - margin) {
      scroller.scrollTop += coords.bottom - (box.bottom - margin);
    }
  } catch {
    // 节点正在重建时位置可能暂不可换算，跳过即可，下次跳转会再试
  }
}

/**
 * 创建编辑器实例（基于 Milkdown）。
 *
 * @param container 编辑器挂载的 DOM 容器
 * @param options 创建选项（初始内容、变化回调、表格上下文回调）
 */
export async function createEditor(
  container: HTMLElement,
  options: CreateEditorOptions = {}
): Promise<EditorInstance> {
  const { defaultValue = '', onChange, onTableContext, onPickImage, onOpenLink } = options;

  // 缓存最新的 Markdown 文本（由 markdownUpdated 回调更新）
  let currentMarkdown = defaultValue;

  const highlightParser = await createHighlightParser();
  // 当前文档所在目录：用于把 `img/xxx.png` 之类的相对路径解析成可显示的绝对地址
  const imageState = { dir: '' };

  configureMathView({ openLink: onOpenLink });

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, container);
      ctx.set(defaultValueCtx, defaultValue);
      // 注册 underline / front matter / 目录语法的 stringify handler（Markdown 往返不丢格式）
      configureStringify(ctx);
      ctx.set(highlightConfigKey, { parser: highlightParser });
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
    // 表格行列手柄：点选整行 / 整列后浮出增删工具条（与工具栏、菜单共用 format 链路）
    .use(tableHandlesPlugin((action) => formatRef.current(action)))
    // 末尾是非文本块（表格/分割线等）时补一个空段落，保证表格下方能点进去输入、整表也能被删除
    .use(trailingParagraphPlugin)
    // 块同行末尾落光标：点击表格 / 代码块最后一行右侧空白时，光标落到块后，
    // 回车即可在块后新建正文段落（图片是 inline 节点，本就支持，无需处理）。
    .use(blockLineEndCaret)
    // 查找命中高亮：装饰而非改文本，不影响撤销栈
    .use(searchHighlightPlugin)
    // 列表项开头按退格：去掉当前编号变普通段落，而不是并进上一行；连续按可一路解散列表
    .use(listUnlistPendingPlugin)
    .use(listBackspaceShortcut)
    // 任务列表里被拆出来的空项：换成列表后面的正文段落
    .use(listItemExitPlugin)
    // 撤销/重做历史（ProseMirror history）：没有它 Cmd+Z 在整个编辑器里无效
    .use(history)
    .use([...underlineSchema])
    // $remark 返回 [optionsCtx, plugin]，两者都要注册，否则上下文注入缺失
    .use([...underlineRemark])
    // YAML Front Matter：解析/渲染/序列化三位一体
    .use([...frontmatterSchema])
    .use([...frontmatterRemark])
    // 警告框与 [TOC] 目录块的渲染增强（纯装饰，不改 Markdown 文本）
    .use(calloutPlugin)
    .use(tocPlugin)
    // 光标进出表格时通知渲染层，用于原生菜单置灰
    .use(selectionContextPlugin((context) => onTableContext?.(context)))
    // 相对图片路径 → 绝对 file:// 地址（只改 DOM，不改 Markdown 文本）
    .use(imageSourcePlugin(() => imageState.dir))
    // 斜杠快速插入菜单（确认后统一走 format，与工具栏/菜单同链路；实例就绪后经 formatRef 接线）
    .use(
      slashMenuPlugin({
        format: (action, payload) => formatRef.current(action, payload),
        pickImage: () => onPickImage?.()
      })
    )
    // 任务列表：点击左侧方框切换完成状态（复选框视觉由 CSS 绘制）
    .use(taskListPlugin)
    // ⌘ / Ctrl + 点击链接：经渲染层用系统默认浏览器打开（悬停补 title 提示）
    .use(linkClickPlugin({ openLink: (url) => onOpenLink?.(url) }))
    .use(highlight)
    .use(math)
    // 公式节点视图：点击原地编辑 TeX（插件默认是 atom，只能选中、不能改）；
    // 编辑态底部的「查看帮助文档」走渲染层注入的外部链接打开方式
    .use(mathNodeViewPlugin)
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

  /**
   * 切换任务列表状态（不在列表项内时先包成无序列表再重试一次）。
   * taskList 是开关语义：普通项 → 未完成任务；已勾选/未勾选的任务项 → 变回普通项。
   */
  const applyTask = (mode: 'taskList' | 'taskDone' | 'taskUndone' | 'taskClear', retried = false): void => {
    let applied = false;
    withView((view) => {
      const found = findAncestor(view.state.selection.$from, 'list_item');
      if (!found) return;
      const previous = found.node.attrs['checked'] as boolean | null | undefined;
      const checked =
        mode === 'taskDone' ? true
          : mode === 'taskUndone' ? false
            : mode === 'taskClear' ? null
              : previous == null ? false : null;
      applied = applyTaskState(view, checked);
    });
    if (!applied && !retried) {
      editor.action(callCommand(wrapInBulletListCommand.key));
      applyTask(mode, true);
    }
  };

  /** 插入 Markdown 片段（委派给命令层，解析器从上下文取） */
  const insertFragment = (markdown: string, atStart: boolean, placeholder?: string): void => {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const parser = ctx.get(parserCtx);
      if (!view || !parser) return;
      insertSnippet(view, parser, markdown, atStart, placeholder);
    });
  };

  /** 斜杠菜单的格式化入口（实例创建后接上 format，实现见返回对象的 format 方法） */
  const formatRef: { current: (action: FormatAction, payload?: number | string) => void } = {
    current: () => {}
  };

  const instance: EditorInstance = {
    getMarkdown(): string {
      return currentMarkdown;
    },

    flushMarkdown(): string {
      let markdown = currentMarkdown;
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const serializer = ctx.get(serializerCtx);
        if (!view || !serializer) return;
        markdown = serializer(view.state.doc);
        currentMarkdown = markdown;
      });
      return markdown;
    },

    setMarkdown(markdown: string): void {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const parser = ctx.get(parserCtx);
        if (!view || !parser) return;
        const doc = parser(markdown);
        const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc);
        view.dispatch(tr);
        currentMarkdown = markdown;
      });
    },

    insertAtCursor(markdown: string): void {
      insertFragment(markdown, false);
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
          // 预设的 toggleInlineCodeCommand 在空选区时直接返回 false：光标没选中文字时
          // 点「行内代码」按钮/菜单毫无反应。改用 ProseMirror 的 toggleMark，它在空选区
          // 会切换 storedMark，与加粗/斜体一致——下一次输入自动带行内代码，再点一次取消。
          withView((view) => {
            const type = view.state.schema.marks['inlineCode'];
            if (type) toggleMark(type)(view.state, view.dispatch, view);
          });
          break;
        case 'quote':
          editor.action(callCommand(wrapInBlockquoteCommand.key));
          break;
        case 'bulletList':
          // 任务项切普通列表：先清掉 checked，否则 wrapIn 对已有列表项是空操作，
          // 看起来「点了没反应」
          withView((view) => {
            const found = findAncestor(view.state.selection.$from, 'list_item');
            if (found && found.node.attrs['checked'] != null) applyTaskState(view, null);
          });
          editor.action(callCommand(wrapInBulletListCommand.key));
          break;
        case 'orderedList':
          withView((view) => {
            const found = findAncestor(view.state.selection.$from, 'list_item');
            if (found && found.node.attrs['checked'] != null) applyTaskState(view, null);
          });
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
        case 'insertTable': {
          // 斜杠菜单二级网格会带 '列数x行数'（如 '5x2'）选择行列；默认 3×3
          const size = typeof payload === 'string' ? /^(\d+)x(\d+)$/.exec(payload) : null;
          const cols = size ? Math.min(10, Math.max(1, Number(size[1]))) : 3;
          const rows = size ? Math.min(20, Math.max(1, Number(size[2]))) : 3;
          // 用带表头的片段插入，编辑器内直接可读；命令版只能得到空表头
          insertFragment(buildTableSnippet(cols, rows), false);
          break;
        }
        case 'tableAddRow':
          editor.action(callCommand(addRowAfterCommand.key));
          break;
        case 'tableAddCol':
          editor.action(callCommand(addColAfterCommand.key));
          break;
        case 'tableAddRowBefore':
          editor.action(callCommand(addRowBeforeCommand.key));
          break;
        case 'tableAddColBefore':
          editor.action(callCommand(addColBeforeCommand.key));
          break;
        case 'tableDeleteRow':
          withView(deleteTableRow);
          break;
        case 'tableDeleteCol':
          withView(deleteTableColumn);
          break;
        case 'tableDelete':
          withView(deleteTable);
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
          applyTask(action);
          break;
        case 'insertParagraphAbove':
          withView((view) => insertParagraphAt(view, true));
          break;
        case 'insertParagraphBelow':
          withView((view) => insertParagraphAt(view, false));
          break;
        case 'moveLineUp':
          withView((view) => lineOperation(view, 'up'));
          break;
        case 'moveLineDown':
          withView((view) => lineOperation(view, 'down'));
          break;
        case 'deleteLine':
          withView((view) => lineOperation(view, 'delete'));
          break;
        case 'selectLine':
          withView((view) => lineOperation(view, 'select'));
          break;
        case 'clearFormat':
          withView(clearFormat);
          break;
        case 'underline':
          withView((view) => {
            const type = view.state.schema.marks['underline'];
            if (type) toggleMark(type)(view.state, view.dispatch, view);
          });
          break;
        case 'snippet':
        case 'snippetAtStart':
          if (typeof payload === 'string') insertFragment(payload, action === 'snippetAtStart');
          break;
        case 'insertCallout': {
          // 警告框是引用块 + 行首语法标记，插入后必须选中「内容」占位文字：
          // 否则光标停在 `[!NOTE]` 前，用户直接打字会把标记挤到中间，装饰失效、源码标记外露。
          const kinds = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'];
          const kind = typeof payload === 'string' ? payload.toUpperCase() : 'NOTE';
          insertFragment(`\n> [!${kinds.includes(kind) ? kind : 'NOTE'}]\n> 内容\n`, false, '内容');
          break;
        }
      }
    },

    setEditable(editable: boolean): void {
      withView((view) => {
        view.setProps({ editable: () => editable });
      });
    },

    undo(): void {
      // 直接调 history 的 undo 命令；无历史时命令返回 false，不产生副作用
      editor.action(callCommand(undoCommand.key));
      withView((view) => view.focus());
    },

    redo(): void {
      editor.action(callCommand(redoCommand.key));
      withView((view) => view.focus());
    },

    canUndoRedo(): { undo: boolean; redo: boolean } {
      let result = { undo: false, redo: false };
      withView((view) => {
        // undoDepth / redoDepth 由 history 插件的 state 暴露
        const state = view.state as unknown as { undoDepth?: number; redoDepth?: number };
        result = { undo: (state.undoDepth ?? 0) > 0, redo: (state.redoDepth ?? 0) > 0 };
      });
      return result;
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
        const segments = collectTextSegments(state.doc);
        const from = textOffsetToPos(segments, start);
        const to = textOffsetToPos(segments, end, true);
        if (from == null || to == null || from >= to) return;
        const tr = state.tr.setSelection(TextSelection.create(state.doc, from, to));
        view.dispatch(tr.scrollIntoView());
        view.focus();
      });
    },

    replaceTextRange(start: number, end: number, text: string): void {
      withView((view) => {
        const { state } = view;
        const segments = collectTextSegments(state.doc);
        const from = textOffsetToPos(segments, start);
        const to = textOffsetToPos(segments, end, true);
        if (from == null || to == null || from > to) return;
        view.dispatch(state.tr.insertText(text, from, to).scrollIntoView());
      });
    },

    placeCaretAtTextOffset(offset: number): void {
      withView((view) => {
        const { state } = view;
        const segments = collectTextSegments(state.doc);
        const pos = textOffsetToPos(segments, offset);
        if (pos == null) return;
        // 不抢焦点：查找框还在输入，焦点被拉走就没法继续打字了
        const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(pos), 1));
        view.dispatch(tr);
        // 焦点不在编辑器内时 ProseMirror 自带的 scrollIntoView 会被跳过，必须显式滚动
        scrollPosIntoView(view, pos);
      });
    },

    setSearchHighlight(ranges: { start: number; end: number }[], active: number): void {
      withView((view) => setSearchHighlight(view, ranges, active));
    },

    clearSearchHighlight(): void {
      withView((view) => clearSearchHighlight(view));
    },

    replaceSelection(text: string): void {
      withView((view) => {
        const { from, to } = view.state.selection;
        const tr = view.state.tr.insertText(text, from, to);
        view.dispatch(tr.scrollIntoView());
        view.focus();
      });
    },

    setImageBaseDir(dir: string | null): void {
      imageState.dir = dir ?? '';
      withView((view) => applyImageSources(view, imageState.dir));
    },

    getTableContext(): TableContext {
      let result: TableContext = { inTable: false, inHeader: false };
      withView((view) => {
        result = describeTableContext(view.state);
      });
      return result;
    },

    focus(): void {
      withView((view) => view.focus());
    },

    destroy(): void {
      void editor.destroy();
    }
  };

  // 实例就绪：把统一格式化入口接给斜杠菜单插件
  formatRef.current = (action, payload) => instance.format(action, payload);
  return instance;
}

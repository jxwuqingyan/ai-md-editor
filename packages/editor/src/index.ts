/**
 * WYSIWYG 编辑器封装（基于 Milkdown / ProseMirror）—— 公共入口。
 *
 * 模块划分：
 * - types.ts     对外类型契约（FormatAction / EditorInstance / TableContext）
 * - instance.ts  编辑器实例创建与命令分发
 * - commands.ts  自定义 ProseMirror 命令（行操作、表格、片段插入等）
 * - selection.ts 光标表格上下文监听插件
 * - slash.ts     斜杠快速插入菜单插件（输入「/」弹出）
 * - highlight.ts Shiki 代码高亮初始化
 * - underline / frontmatter / stringify / decorations  扩展语法兼容
 */

export { createEditor } from './instance';
export type {
  CreateEditorOptions,
  EditorInstance,
  FormatAction,
  TableContext
} from './types';
export { NO_TABLE_CONTEXT } from './types';

// 导出 Milkdown 类型，供渲染层使用
export type { Editor } from '@milkdown/kit/core';

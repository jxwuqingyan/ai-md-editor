/**
 * 编辑器对外类型契约。
 * 只放类型与常量，不引入任何运行时依赖，避免循环引用。
 */

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

/**
 * 光标所在的表格上下文。
 * 供原生菜单判断「表格」子菜单项是否可用（不在表格内时置灰）。
 */
export interface TableContext {
  /** 光标在表格内 */
  inTable: boolean;
  /** 光标在表头行内（GFM 表格必须保留表头，删除行时走特殊逻辑） */
  inHeader: boolean;
}

/** 不在表格内的默认上下文（复用同一对象，便于浅比较） */
export const NO_TABLE_CONTEXT: TableContext = { inTable: false, inHeader: false };

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
  /** 撤销上一步编辑 */
  undo(): void;
  /** 重做被撤销的编辑 */
  redo(): void;
  /** 当前是否还有可撤销 / 可重做的历史 */
  canUndoRedo(): { undo: boolean; redo: boolean };
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
  /** 查询当前光标是否在表格 / 表头内 */
  getTableContext(): TableContext;
  /**
   * 设置当前文档所在目录（用于把 Markdown 里的相对图片路径解析成可显示的绝对地址）。
   * 传入 null 表示未保存的新文档，图片不解析。
   */
  setImageBaseDir(dir: string | null): void;
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
  /**
   * 光标位置上下文变化回调。
   * 只在「是否在表格 / 是否在表头」真正变化时触发，避免每次按键都刷新菜单。
   */
  onTableContext?: (context: TableContext) => void;
}

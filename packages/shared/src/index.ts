/**
 * 共享类型与工具。
 * 提供跨进程共用的 IPC 通道名、请求/响应类型，供主进程、preload、渲染层三方共用。
 */

/** IPC 通道名统一枚举，避免魔法字符串 */
export const IpcChannel = {
  /** 打开文件对话框（返回文件路径与内容） */
  OpenFile: 'file:open',
  /** 保存文件对话框（另存为） */
  SaveFileAs: 'file:save-as',
  /** 读取指定路径的文件内容 */
  ReadFile: 'file:read',
  /** 写入内容到指定路径 */
  WriteFile: 'file:write',
  /** 保存粘贴的图片到 assets 目录（返回相对路径） */
  SaveImage: 'image:save',
  /** 选择本地图片并保存到 assets 目录（返回相对路径） */
  ChooseImage: 'image:choose',
  /** 读取最近文件列表 */
  GetRecent: 'recent:get',
  /** 添加一条最近文件记录 */
  AddRecent: 'recent:add',
  /** 通过系统对话框打开文件并返回内容（供拖拽/菜单复用） */
  OpenPath: 'file:open-path',
  /** 读取目录列表（文件树用，返回子目录与 Markdown 文件条目） */
  ReadDir: 'fs:read-dir',
  /** 选择文件夹（文件树打开目录用） */
  ChooseFolder: 'fs:choose-folder',
  /** 导出（html/pdf/word） */
  Export: 'export:file',
  /** 重命名当前文档（同目录内改名，保留内容） */
  RenameFile: 'file:rename',
  /** 在系统文件管理器中显示当前文档 */
  RevealInFolder: 'file:reveal',
  /** 打印当前文档 */
  Print: 'app:print',
  /** 写剪贴板（纯文本 / Markdown / HTML 代码） */
  ClipboardWrite: 'clipboard:write',
  /** 读剪贴板纯文本（粘贴为纯文本） */
  ClipboardReadText: 'clipboard:read-text',
  /** 界面缩放 */
  Zoom: 'app:zoom',
  /** 窗口置顶 */
  AlwaysOnTop: 'app:always-on-top',
  /** 新建独立窗口 */
  NewWindow: 'app:new-window',
  /** 切换全屏（返回切换后的状态） */
  ToggleFullScreen: 'app:toggle-fullscreen',
  /** 查询窗口是否全屏 */
  IsFullScreen: 'app:is-fullscreen',
  /** 最小化当前窗口 */
  MinimizeWindow: 'app:minimize-window'
} as const;

/** 导出类型 */
export type ExportFormat = 'html' | 'pdf' | 'word';

/** 导出请求入参 */
export interface ExportInput {
  /** 导出格式 */
  format: ExportFormat;
  /** Markdown 源文本 */
  markdown: string;
  /** 默认文件名（不含扩展名） */
  defaultName: string;
}

/** 导出结果 */
export interface ExportResult {
  /** 是否成功 */
  ok: boolean;
  /** 保存的绝对路径（失败为 null） */
  path: string | null;
  /** 错误信息（成功为 null） */
  error: string | null;
}

/** 文件树条目类型：目录或 Markdown 文件 */
export type FsEntryKind = 'dir' | 'md';

/** 文件树目录条目 */
export interface FsEntry {
  /** 条目名（文件/目录名，不含路径） */
  name: string;
  /** 绝对路径 */
  path: string;
  /** 类型：目录 or markdown 文件 */
  kind: FsEntryKind;
}

/** 读取目录的结果 */
export interface ReadDirResult {
  /** 是否成功 */
  ok: boolean;
  /** 目录条目（按 目录在前、名称排序） */
  entries: FsEntry[];
  /** 错误信息（成功为 null） */
  error: string | null;
}

/** 应用基础信息 */
export interface AppInfo {
  version: string;
  platform: string;
}

/** 文档基础模型 */
export interface DocMeta {
  /** 绝对路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 最近修改时间戳（毫秒） */
  modifiedAt: number;
}

/** 最近文件条目 */
export interface RecentFile {
  /** 绝对路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 最近打开时间戳（毫秒） */
  openedAt: number;
}

/** 打开文件的结果 */
export interface OpenFileResult {
  /** 是否取消（用户点了取消） */
  canceled: boolean;
  /** 文件绝对路径（取消时为 null） */
  path: string | null;
  /** 文件名（取消时为 null） */
  name: string | null;
  /** 文件内容（取消时为 null） */
  content: string | null;
}

/** 保存文件的结果 */
export interface SaveFileResult {
  /** 是否取消 */
  canceled: boolean;
  /** 保存的文件绝对路径（取消时为 null） */
  path: string | null;
  /** 文件名（取消时为 null） */
  name: string | null;
}

/** 保存图片的入参 */
export interface SaveImageInput {
  /** 图片二进制数据（ArrayBuffer 序列化后） */
  data: Uint8Array;
  /** 文件扩展名（不含点，如 png/jpg） */
  extension: string;
  /** 目标 Markdown 文件的绝对路径（图片存到它的同级 img/ 目录） */
  docPath: string;
}

/** 保存图片的结果 */
export interface SaveImageResult {
  /** 保存成功后的相对路径（如 img/20261026-123456.png），失败为 null */
  relativePath: string | null;
  /** 错误信息（成功为 null） */
  error: string | null;
}

/** 重命名请求 */
export interface RenameFileInput {
  /** 原绝对路径 */
  path: string;
  /** 新文件名（不含路径） */
  newName: string;
}

/** 重命名结果 */
export interface RenameFileResult {
  /** 是否成功 */
  ok: boolean;
  /** 新绝对路径（失败为 null） */
  path: string | null;
  /** 新文件名（失败为 null） */
  name: string | null;
  /** 错误信息（成功为 null） */
  error: string | null;
}

/** 复制到剪贴板的格式 */
export type ClipboardFormat = 'plain' | 'markdown' | 'html';

/** 写剪贴板请求 */
export interface ClipboardWriteInput {
  /** 目标格式 */
  format: ClipboardFormat;
  /** 原始 Markdown 文本 */
  markdown: string;
}

/** 缩放动作 */
export type ZoomAction = 'in' | 'out' | 'reset';

/** 主进程 → 渲染进程的菜单动作事件通道 */
export const MenuActionChannel = 'menu:action';

/** 渲染进程 → 主进程的菜单状态同步通道 */
export const MenuStateChannel = 'menu:state';

/** 菜单动作携带的可选参数（如最近文件路径、插入的 Markdown 片段） */
export interface MenuActionMessage {
  /** 动作 ID */
  action: MenuAction;
  /** 可选参数 */
  payload?: string;
}

/**
 * 渲染层同步给主进程的界面状态。
 * 用于让原生菜单的勾选项（源码模式、只读、专注模式等）与实际界面保持一致。
 */
export interface MenuViewState {
  /** 标签栏可见 */
  tabbarVisible: boolean;
  /** 源码模式（否则为所见即所得） */
  sourceMode: boolean;
  /** 只读模式 */
  readOnly: boolean;
  /** 专注模式 */
  focusMode: boolean;
  /** 打字机模式 */
  typewriterMode: boolean;
  /** 底部工具栏可见 */
  toolbarVisible: boolean;
  /** 侧栏可见 */
  sidebarVisible: boolean;
  /** 侧栏当前面板 */
  sidebarPanel: 'files' | 'outline';
  /** 字数统计窗口可见 */
  wordCountVisible: boolean;
  /** 独立大纲窗口可见 */
  outlineWindowVisible: boolean;
  /** 窗口置顶 */
  alwaysOnTop: boolean;
  /** 窗口处于全屏（菜单显示「退出全屏」并打勾） */
  fullscreen: boolean;
  /** 当前文档已关联磁盘路径（决定重命名/重载等菜单项是否可用） */
  hasPath: boolean;
  /** 光标在表格内（决定表格增删行列菜单项是否可用） */
  inTable: boolean;
  /** 光标在表头行内 */
  inTableHeader: boolean;
  /** 当前界面缩放百分比（100 表示原始大小） */
  zoomPercent: number;
}

/** 默认菜单状态（主进程启动时使用） */
export const DEFAULT_MENU_VIEW_STATE: MenuViewState = {
  tabbarVisible: true,
  sourceMode: false,
  readOnly: false,
  focusMode: false,
  typewriterMode: false,
  toolbarVisible: true,
  sidebarVisible: true,
  sidebarPanel: 'files',
  wordCountVisible: false,
  outlineWindowVisible: false,
  alwaysOnTop: false,
  fullscreen: false,
  hasPath: false,
  inTable: false,
  inTableHeader: false,
  zoomPercent: 100
};

/** 原生应用菜单可触发的动作（集中定义，避免跨进程魔法字符串） */
export const MenuActions = {
  // ===== 文件 =====
  NewTab: 'file:new-tab',
  NewWindow: 'file:new-window',
  OpenFile: 'file:open',
  OpenRecent: 'file:open-recent',
  OpenRecentPath: 'file:open-recent-path',
  QuickOpen: 'file:quick-open',
  ImportFile: 'file:import',
  CloseTab: 'file:close-tab',
  Save: 'file:save',
  SaveAll: 'file:save-all',
  SaveAs: 'file:save-as',
  RenameFile: 'file:rename-file',
  DuplicateFile: 'file:duplicate-file',
  ReloadFromDisk: 'file:reload',
  RevealInFolder: 'file:reveal',
  ExportHtml: 'file:export-html',
  ExportPdf: 'file:export-pdf',
  ExportWord: 'file:export-word',
  Print: 'file:print',

  // ===== 编辑 =====
  Undo: 'edit:undo',
  Redo: 'edit:redo',
  CopyMarkdown: 'edit:copy-markdown',
  CopyPlainText: 'edit:copy-plain',
  CopyHtml: 'edit:copy-html',
  PastePlainText: 'edit:paste-plain',
  SelectLine: 'edit:select-line',
  MoveLineUp: 'edit:move-line-up',
  MoveLineDown: 'edit:move-line-down',
  DeleteLine: 'edit:delete-line',
  Find: 'edit:find',
  FindNext: 'edit:find-next',
  FindPrev: 'edit:find-prev',
  Replace: 'edit:replace',
  InsertHardBreak: 'edit:insert-hard-break',
  InsertMathInline: 'edit:insert-math-inline',
  InsertMathBlock: 'edit:insert-math-block',

  // ===== 段落 =====
  FormatParagraph: 'format:paragraph',
  FormatHeading1: 'format:heading-1',
  FormatHeading2: 'format:heading-2',
  FormatHeading3: 'format:heading-3',
  FormatHeading4: 'format:heading-4',
  FormatHeading5: 'format:heading-5',
  FormatHeading6: 'format:heading-6',
  UpgradeHeading: 'format:upgrade-heading',
  DowngradeHeading: 'format:downgrade-heading',
  InsertTable: 'format:insert-table',
  TableAddRow: 'format:table-add-row',
  TableAddCol: 'format:table-add-col',
  TableDeleteRow: 'format:table-delete-row',
  TableDeleteCol: 'format:table-delete-col',
  FormatCodeBlock: 'format:code-block',
  FormatQuote: 'format:quote',
  FormatBulletList: 'format:bullet-list',
  FormatOrderedList: 'format:ordered-list',
  FormatTaskList: 'format:task-list',
  TaskDone: 'format:task-done',
  TaskUndone: 'format:task-undone',
  TaskClear: 'format:task-clear',
  IndentList: 'format:indent-list',
  OutdentList: 'format:outdent-list',
  InsertParagraphAbove: 'format:insert-paragraph-above',
  InsertParagraphBelow: 'format:insert-paragraph-below',
  InsertLinkReference: 'format:insert-link-reference',
  InsertFootnote: 'format:insert-footnote',
  InsertCallout: 'format:insert-callout',
  InsertToc: 'format:insert-toc',
  InsertFrontMatter: 'format:insert-front-matter',
  FormatHorizontalRule: 'format:horizontal-rule',

  // ===== 格式 =====
  FormatBold: 'format:bold',
  FormatItalic: 'format:italic',
  FormatUnderline: 'format:underline',
  FormatCode: 'format:code',
  FormatStrikethrough: 'format:strikethrough',
  InsertComment: 'format:insert-comment',
  InsertLink: 'format:insert-link',
  InsertImage: 'format:insert-image',
  ChooseImage: 'format:choose-image',
  ClearFormat: 'format:clear',

  // ===== 显示 =====
  ToggleTabbar: 'view:toggle-tabbar',
  ToggleMode: 'view:toggle-mode',
  ToggleReadOnly: 'view:toggle-read-only',
  ToggleFocusMode: 'view:toggle-focus',
  ToggleTypewriter: 'view:toggle-typewriter',
  ToggleToolbar: 'view:toggle-toolbar',
  ToggleSidebar: 'view:toggle-sidebar',
  ShowFiles: 'view:show-files',
  ShowOutline: 'view:show-outline',
  ToggleWordCount: 'view:toggle-word-count',
  ToggleOutlineWindow: 'view:toggle-outline-window',
  ToggleSearch: 'view:toggle-search',
  ZoomIn: 'view:zoom-in',
  ZoomOut: 'view:zoom-out',
  ZoomReset: 'view:zoom-reset',
  ToggleAlwaysOnTop: 'view:toggle-always-on-top',
  ToggleFullScreen: 'view:toggle-fullscreen',
  MinimizeWindow: 'view:minimize-window'
} as const;

/** 菜单动作联合类型 */
export type MenuAction = (typeof MenuActions)[keyof typeof MenuActions];

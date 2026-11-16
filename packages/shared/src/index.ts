/**
 * 共享类型与工具。
 * 提供跨进程共用的 IPC 通道名、请求/响应类型，供主进程、preload、渲染层三方共用。
 */

import type { TextEncoding } from './text';

export {
  TEXT_ENCODING_LABELS,
  baseNameOf,
  decodeBytes,
  dirNameOf,
  encodeText,
  isRelativeImagePath,
  localImagePath,
  moveOutlineSection,
  scanDocLinks,
  stripMarkdown,
  toFileUrl,
  writeEncoding,
  type DocLinkRef,
  type DocLinkScan,
  type OutlineMoveResult,
  type OutlineSectionItem,
  type TextEncoding
} from './text';

/** IPC 通道名统一枚举，避免魔法字符串 */
export const IpcChannel = {
  /** 打开文件对话框（返回文件路径与内容） */
  OpenFile: 'file:open',
  /** 保存文件对话框（另存为） */
  SaveFileAs: 'file:save-as',
  /** 读取指定路径的文件内容与编码 */
  ReadFile: 'file:read',
  /** 静默读取文件（会话恢复用：文件不存在时不弹窗、不写入最近文件） */
  ReadPathQuiet: 'file:read-quiet',
  /** 监听文件的外部修改 */
  WatchFile: 'fs:watch',
  /** 取消监听文件的外部修改 */
  UnwatchFile: 'fs:unwatch',
  /** 写入内容到指定路径 */
  WriteFile: 'file:write',
  /** 保存粘贴的图片到文档同级 img/ 目录（返回相对路径） */
  SaveImage: 'image:save',
  /** 选择本地图片并暂存到文档同级 img/ 目录（返回相对路径） */
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
  /** 用系统默认浏览器打开外部链接 */
  OpenExternal: 'shell:open-external',
  /** 打印当前文档 */
  Print: 'app:print',
  /** 写剪贴板（纯文本 / Markdown / HTML 代码） */
  ClipboardWrite: 'clipboard:write',
  /** 读剪贴板纯文本（粘贴为纯文本） */
  ClipboardReadText: 'clipboard:read-text',
  /** 界面缩放 */
  Zoom: 'app:zoom',
  /** 直接设置缩放百分比（用于恢复上次的缩放） */
  SetZoom: 'app:set-zoom',
  /** 读取持久化设置 */
  SettingsGet: 'settings:get',
  /** 更新持久化设置（部分字段） */
  SettingsUpdate: 'settings:update',
  /** 查询路径类型（拖拽文件夹/文件时判断） */
  StatPath: 'fs:stat',
  /** 把磁盘上的图片复制到文档同级 img/ 目录 */
  SaveImageFromPath: 'image:from-path',
  /** 窗口置顶 */
  AlwaysOnTop: 'app:always-on-top',
  /** 新建独立窗口 */
  NewWindow: 'app:new-window',
  /** 切换全屏（返回切换后的状态） */
  ToggleFullScreen: 'app:toggle-fullscreen',
  /** 查询窗口是否全屏 */
  IsFullScreen: 'app:is-fullscreen',
  /** 最小化当前窗口 */
  MinimizeWindow: 'app:minimize-window',
  /** 在目录里新建 Markdown 文件（自动避让重名） */
  CreateFile: 'fs:create-file',
  /** 在目录内搜索所有 Markdown 文件内容 */
  SearchFolder: 'search:folder',
  /** 取消一次进行中的文件夹搜索（按请求 id） */
  SearchCancel: 'search:cancel'
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
  /** 当前文档的磁盘路径（用于把 img/xxx.png 这类相对图片内联，避免导出后图片打不开） */
  docPath?: string | null;
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

/** 目录内新建文件的结果 */
export interface CreateFileResult {
  /** 是否成功 */
  ok: boolean;
  /** 新文件的绝对路径（失败为 null） */
  path: string | null;
  /** 错误信息（成功为 null） */
  error: string | null;
}

/** 文件夹搜索请求 */
export interface SearchFolderInput {
  /** 搜索根目录 */
  root: string;
  /** 查询文本（正则模式下为表达式） */
  query: string;
  /** 区分大小写 */
  caseSensitive: boolean;
  /** 全单词匹配 */
  wholeWord: boolean;
  /** 正则表达式模式 */
  regex: boolean;
  /** 请求 id：用于取消（不填则不可取消） */
  requestId?: string;
}

/** 单条搜索匹配 */
export interface SearchMatch {
  /** 1 起的行号 */
  line: number;
  /** 匹配起始列（0 起，按字符数，相对裁剪后的展示文本） */
  column: number;
  /** 匹配起始列（相对未裁剪的原始行，供源码模式精确定位） */
  rawColumn: number;
  /** 匹配文本长度 */
  length: number;
  /** 该行原文（已裁剪首尾空白） */
  text: string;
}

/** 单个文件的搜索结果 */
export interface SearchFileResult {
  /** 文件绝对路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 文件内匹配行 */
  matches: SearchMatch[];
}

/** 文件夹搜索结果 */
export interface SearchFolderResult {
  /** 是否成功 */
  ok: boolean;
  /** 有匹配的文件 */
  files: SearchFileResult[];
  /** 结果是否被截断（超出上限） */
  truncated: boolean;
  /** 是否被取消（取消时 files 为已搜到的部分结果） */
  cancelled?: boolean;
  /** 错误信息（成功为 null） */
  error: string | null;
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
  /** 是否取消（用户点了取消，或文件无法读取） */
  canceled: boolean;
  /** 文件绝对路径（取消时为 null） */
  path: string | null;
  /** 文件名（取消时为 null） */
  name: string | null;
  /** 文件内容（取消时为 null） */
  content: string | null;
  /** 读入时识别到的编码（取消时为 null） */
  encoding: TextEncoding | null;
}

/** 读取文件内容的结果 */
export interface ReadFileResult {
  /** 文件内容 */
  content: string;
  /** 读入时识别到的编码 */
  encoding: TextEncoding;
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

/** 打开外部链接的结果 */
export interface OpenExternalResult {
  /** 是否已交给系统浏览器 */
  ok: boolean;
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

/** 窗口尺寸与位置（持久化用） */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 上次会话：重启后要恢复的标签 */
export interface SessionSnapshot {
  /** 已保存文档的绝对路径（按标签顺序） */
  paths: string[];
  /** 上次的活动标签路径 */
  activePath: string | null;
}

/**
 * 持久化到 userData/settings.json 的应用设置。
 * 只存「下次启动仍然希望保持」的偏好，不存临时状态。
 */
export interface AppSettings {
  /** 主题 */
  themeId: 'light' | 'dark';
  /** 侧栏展开 */
  sidebarOpen: boolean;
  /** 侧栏当前面板 */
  sidebarPanel: 'files' | 'outline';
  /** 标签栏可见 */
  tabbarVisible: boolean;
  /** 底部工具栏可见 */
  toolbarVisible: boolean;
  /** 界面缩放百分比（50~300） */
  zoomPercent: number;
  /** 上次窗口尺寸与位置（null 表示用默认值） */
  windowBounds: WindowBounds | null;
  /** 启动时恢复上次打开的文档 */
  restoreSession: boolean;
  /** 上次会话的标签路径（restoreSession 为 false 时忽略） */
  lastSession: SessionSnapshot | null;
}

/** 默认设置 */
export const DEFAULT_SETTINGS: AppSettings = {
  themeId: 'light',
  sidebarOpen: true,
  sidebarPanel: 'files',
  tabbarVisible: true,
  toolbarVisible: true,
  zoomPercent: 100,
  windowBounds: null,
  restoreSession: true,
  lastSession: null
};

/** 路径类型查询结果 */
export interface StatPathResult {
  /** 路径存在 */
  exists: boolean;
  /** 是目录 */
  isDirectory: boolean;
  /** 是文件 */
  isFile: boolean;
}

/** 从磁盘复制图片到文档 img/ 目录的入参 */
export interface SaveImageFromPathInput {
  /** 目标 Markdown 文件绝对路径 */
  docPath: string;
  /** 源图片绝对路径 */
  sourcePath: string;
}

/** 主进程 → 渲染进程的菜单动作事件通道 */
export const MenuActionChannel = 'menu:action';

/** 渲染进程 → 主进程的菜单状态同步通道 */
export const MenuStateChannel = 'menu:state';

/** 主进程 → 渲染进程：文件被外部程序修改 */
export const FileChangedChannel = 'file:changed';

/** 主进程 → 渲染进程：关闭窗口前询问未保存文档 */
export const UnsavedAskChannel = 'app:unsaved-ask';

/** 渲染进程 → 主进程：未保存文档汇总 */
export const UnsavedReplyChannel = 'app:unsaved-reply';

/** 主进程 → 渲染进程：退出前把所有有路径的改动写盘（带 requestId，渲染层必须回复） */
export const FlushBeforeCloseChannel = 'app:flush-before-close';

/** 渲染进程 → 主进程：退出前写盘结果（成功与失败清单） */
export const FlushReplyChannel = 'app:flush-reply';

/**
 * 写入前发现磁盘文件已被外部改动时，主进程抛出的错误前缀。
 * 渲染层据此区分「写盘失败」和「外部版本已变化、拒绝静默覆盖」。
 */
export const EXTERNAL_CHANGE_ERROR = 'EXTERNAL_CHANGED';

/** 判断异常信息是否为外部改动冲突 */
export function isExternalChangeError(message: string): boolean {
  return message.includes(EXTERNAL_CHANGE_ERROR);
}

/** 关闭窗口前的未保存文档汇总 */
export interface UnsavedSummary {
  /** 未落盘（无磁盘路径）且有改动的文档数：关掉就真的丢了 */
  untitledCount: number;
  /** 有路径但尚未写入磁盘的文档数：退出前会补写一次 */
  dirtyCount: number;
}

/** 退出前写盘请求 */
export interface FlushBeforeCloseMessage {
  /** 请求 id：渲染层的回复必须原样带回，主进程按 id 匹配，避免串话 */
  requestId: string;
}

/** 单个文档写盘失败的原因 */
export interface FlushFailure {
  /** 文件绝对路径（未落盘文档为空串） */
  path: string;
  /** 标签显示名 */
  name: string;
  /** 失败原因（外部版本已变化 / 权限 / 磁盘错误等） */
  reason: string;
}

/** 退出前写盘回复 */
export interface FlushReplyMessage {
  /** 对应 FlushBeforeCloseMessage.requestId */
  requestId: string;
  /** 写盘失败或未能落盘的文档；空数组表示全部保存成功 */
  failures: FlushFailure[];
}

/** 写入文件的选项 */
export interface WriteFileOptions {
  /** 忽略「磁盘已被外部修改」的检查（用户显式保存时使用） */
  force?: boolean;
}

/** 文件外部修改事件 */
export interface FileChangedMessage {
  /** 被修改文件的绝对路径 */
  path: string;
}

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
  CheckDocLinks: 'file:check-doc-links',
  RevealInFolder: 'file:reveal',
  ExportHtml: 'file:export-html',
  ExportPdf: 'file:export-pdf',
  ExportWord: 'file:export-word',
  Print: 'file:print',

  // ===== 帮助 =====
  ShowMarkdownExample: 'help:markdown-example',

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
  TableDelete: 'format:table-delete',
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
  FormatHorizontalRule: 'format:horizontal-rule',

  // ===== 格式 =====
  FormatBold: 'format:bold',
  FormatItalic: 'format:italic',
  FormatUnderline: 'format:underline',
  FormatCode: 'format:code',
  FormatStrikethrough: 'format:strikethrough',
  InsertComment: 'format:insert-comment',
  InsertLink: 'format:insert-link',
  ChooseImage: 'format:choose-image',
  ClearFormat: 'format:clear',

  // ===== 显示 =====
  ToggleTabbar: 'view:toggle-tabbar',
  ToggleMode: 'view:toggle-mode',
  ToggleReadOnly: 'view:toggle-read-only',
  ToggleFocusMode: 'view:toggle-focus',
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

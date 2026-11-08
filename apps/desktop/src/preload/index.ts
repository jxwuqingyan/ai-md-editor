import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  OpenFileResult,
  ReadFileResult,
  SaveFileResult,
  SaveImageInput,
  SaveImageResult,
  RecentFile,
  ReadDirResult,
  CreateFileResult,
  SearchFolderInput,
  SearchFolderResult,
  ExportInput,
  ExportResult,
  RenameFileInput,
  RenameFileResult,
  ClipboardWriteInput,
  ZoomAction,
  MenuAction,
  MenuViewState,
  MenuActionMessage,
  AppSettings,
  StatPathResult,
  SaveImageFromPathInput,
  OpenExternalResult,
  TextEncoding,
  UnsavedSummary,
  FileChangedMessage
} from '@ai-md-editor/shared';
import {
  FileChangedChannel,
  FlushBeforeCloseChannel,
  IpcChannel,
  MenuActionChannel,
  MenuStateChannel,
  UnsavedAskChannel,
  UnsavedReplyChannel
} from '@ai-md-editor/shared';

/**
 * 通过 contextBridge 暴露给渲染进程的白名单 API。
 * 遵循安全基线：不暴露 node/electron 原生能力，只暴露最小必要接口。
 * 文件操作均通过 ipcRenderer.invoke 走主进程，渲染进程无直接文件系统权限。
 */
const api = {
  /** 打开文件对话框，返回选中的文件路径与内容 */
  openFile: (): Promise<OpenFileResult> => ipcRenderer.invoke(IpcChannel.OpenFile),

  /** 打开指定路径的文件（拖拽打开用），返回内容 */
  openPath: (filePath: string): Promise<OpenFileResult> =>
    ipcRenderer.invoke(IpcChannel.OpenPath, filePath),

  /** 另存为对话框，写入内容到用户选择的路径 */
  saveFileAs: (content: string, defaultName: string): Promise<SaveFileResult> =>
    ipcRenderer.invoke(IpcChannel.SaveFileAs, content, defaultName),

  /** 读取指定路径的文件内容与编码 */
  readFile: (filePath: string): Promise<ReadFileResult> =>
    ipcRenderer.invoke(IpcChannel.ReadFile, filePath),

  /** 静默读取文件（会话恢复用：不存在时返回取消，不弹窗、不写最近文件） */
  readPathQuiet: (filePath: string): Promise<OpenFileResult> =>
    ipcRenderer.invoke(IpcChannel.ReadPathQuiet, filePath),

  /** 写入内容到指定路径，返回实际使用的编码 */
  writeFile: (filePath: string, content: string, encoding?: TextEncoding): Promise<TextEncoding> =>
    ipcRenderer.invoke(IpcChannel.WriteFile, filePath, content, encoding),

  /** 监听指定文件的外部修改 */
  watchFile: (filePath: string): Promise<void> => ipcRenderer.invoke(IpcChannel.WatchFile, filePath),

  /** 取消监听文件的外部修改 */
  unwatchFile: (filePath: string): Promise<void> => ipcRenderer.invoke(IpcChannel.UnwatchFile, filePath),

  /** 保存粘贴的图片到文档同级 img/ 目录，返回相对路径 */
  saveImage: (input: SaveImageInput): Promise<SaveImageResult> =>
    ipcRenderer.invoke(IpcChannel.SaveImage, input),

  /** 选择本地图片并保存到文档同级 img/ 目录，返回相对路径 */
  chooseImage: (docPath: string): Promise<SaveImageResult> =>
    ipcRenderer.invoke(IpcChannel.ChooseImage, docPath),

  /** 获取最近文件列表 */
  getRecent: (): Promise<RecentFile[]> => ipcRenderer.invoke(IpcChannel.GetRecent),

  /** 添加最近文件记录 */
  addRecent: (path: string, name: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.AddRecent, path, name),

  /** 读取目录列表（文件树用）：返回子目录与 Markdown 文件条目 */
  readDir: (dirPath: string): Promise<ReadDirResult> =>
    ipcRenderer.invoke(IpcChannel.ReadDir, dirPath),

  /** 在目录里新建 Markdown 文件（可指定名称；自动补 .md 并避让重名），返回新文件路径 */
  createFile: (dirPath: string, name?: string): Promise<CreateFileResult> =>
    ipcRenderer.invoke(IpcChannel.CreateFile, dirPath, name),

  /** 在目录内搜索所有 Markdown 文件内容 */
  searchFolder: (input: SearchFolderInput): Promise<SearchFolderResult> =>
    ipcRenderer.invoke(IpcChannel.SearchFolder, input),

  /** 弹出文件夹选择对话框（文件树打开目录用） */
  chooseFolder: (): Promise<{ canceled: boolean; path: string | null }> =>
    ipcRenderer.invoke(IpcChannel.ChooseFolder),

  /** 导出 Markdown 为 HTML/PDF/Word */
  exportFile: (input: ExportInput): Promise<ExportResult> =>
    ipcRenderer.invoke(IpcChannel.Export, input),

  /** 重命名当前文档（同目录改名） */
  renameFile: (input: RenameFileInput): Promise<RenameFileResult> =>
    ipcRenderer.invoke(IpcChannel.RenameFile, input),

  /** 在系统文件管理器中显示文档 */
  revealInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.RevealInFolder, filePath),

  /** 用系统默认浏览器打开外部链接（仅 http/https） */
  openExternal: (url: string): Promise<OpenExternalResult> =>
    ipcRenderer.invoke(IpcChannel.OpenExternal, url),

  /** 打印当前文档 */
  print: (): Promise<void> => ipcRenderer.invoke(IpcChannel.Print),

  /** 按指定格式写剪贴板（纯文本 / Markdown / HTML 代码） */
  writeClipboard: (input: ClipboardWriteInput): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.ClipboardWrite, input),

  /** 读取剪贴板纯文本 */
  readClipboardText: (): Promise<string> => ipcRenderer.invoke(IpcChannel.ClipboardReadText),

  /** 界面缩放，返回新的缩放百分比（如 110） */
  zoom: (action: ZoomAction): Promise<number> => ipcRenderer.invoke(IpcChannel.Zoom, action),

  /** 直接设置缩放百分比（恢复上次缩放），返回实际生效值 */
  setZoom: (percent: number): Promise<number> => ipcRenderer.invoke(IpcChannel.SetZoom, percent),

  /** 读取持久化设置 */
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IpcChannel.SettingsGet),

  /** 更新持久化设置（部分字段） */
  updateSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IpcChannel.SettingsUpdate, patch),

  /** 查询路径类型（拖拽时判断文件夹 / 文件） */
  statPath: (targetPath: string): Promise<StatPathResult> =>
    ipcRenderer.invoke(IpcChannel.StatPath, targetPath),

  /** 把磁盘上的图片复制到文档同级 img/ 目录（拖拽插入） */
  saveImageFromPath: (input: SaveImageFromPathInput): Promise<SaveImageResult> =>
    ipcRenderer.invoke(IpcChannel.SaveImageFromPath, input),

  /**
   * 取拖拽进来的文件的真实磁盘路径。
   * Electron 32+ 的 File 不再带 path 属性，必须用 webUtils 转换。
   */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  /** 窗口置顶 */
  setAlwaysOnTop: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.AlwaysOnTop, enabled),

  /** 切换全屏，返回切换后的状态 */
  toggleFullScreen: (): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannel.ToggleFullScreen),

  /** 查询当前是否全屏 */
  isFullScreen: (): Promise<boolean> =>
    ipcRenderer.invoke(IpcChannel.IsFullScreen),

  /** 最小化当前窗口 */
  minimizeWindow: (): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.MinimizeWindow),

  /** 新建独立窗口 */
  newWindow: (): Promise<void> => ipcRenderer.invoke(IpcChannel.NewWindow),

  /** 同步界面状态到主进程，刷新原生菜单勾选项 */
  updateMenuState: (state: MenuViewState): void => ipcRenderer.send(MenuStateChannel, state),

  /** 监听主进程的「打开文件」事件（拖拽到 Dock/命令行打开） */
  onOpenFile: (callback: (filePath: string) => void): (() => void) => {
    const listener = (_event: unknown, filePath: string): void => callback(filePath);
    ipcRenderer.on('open-file', listener);
    // 返回取消监听的函数
    return () => ipcRenderer.removeListener('open-file', listener);
  },

  /** 监听原生应用菜单动作，动作 ID 与参数均由 shared 包统一定义 */
  onMenuAction: (callback: (action: MenuAction, payload?: string) => void): (() => void) => {
    const listener = (_event: unknown, message: MenuActionMessage | MenuAction): void => {
      // 兼容旧格式的纯字符串消息
      if (typeof message === 'string') {
        callback(message);
        return;
      }
      callback(message.action, message.payload);
    };
    ipcRenderer.on(MenuActionChannel, listener);
    return () => ipcRenderer.removeListener(MenuActionChannel, listener);
  },

  /** 监听「当前文档被外部程序修改」 */
  onFileChanged: (callback: (message: FileChangedMessage) => void): (() => void) => {
    const listener = (_event: unknown, message: FileChangedMessage): void => callback(message);
    ipcRenderer.on(FileChangedChannel, listener);
    return () => ipcRenderer.removeListener(FileChangedChannel, listener);
  },

  /** 监听「关闭窗口前询问未保存文档」，需用 replyUnsaved 同步回复 */
  onUnsavedAsk: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on(UnsavedAskChannel, listener);
    return () => ipcRenderer.removeListener(UnsavedAskChannel, listener);
  },

  /** 回复未保存文档汇总（配合 onUnsavedAsk 使用） */
  replyUnsaved: (summary: UnsavedSummary): void => {
    ipcRenderer.send(UnsavedReplyChannel, summary);
  },

  /** 监听「退出前立即写盘」请求 */
  onFlushBeforeClose: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on(FlushBeforeCloseChannel, listener);
    return () => ipcRenderer.removeListener(FlushBeforeCloseChannel, listener);
  }
};

contextBridge.exposeInMainWorld('api', api);

/** 全局类型声明：让渲染进程能感知 window.api 的类型 */
export type ExposedApi = typeof api;

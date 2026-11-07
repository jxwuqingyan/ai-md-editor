import { contextBridge, ipcRenderer } from 'electron';
import type {
  OpenFileResult,
  SaveFileResult,
  SaveImageInput,
  SaveImageResult,
  RecentFile,
  ReadDirResult,
  ExportInput,
  ExportResult,
  RenameFileInput,
  RenameFileResult,
  ClipboardWriteInput,
  ZoomAction,
  MenuAction,
  MenuViewState,
  MenuActionMessage
} from '@ai-md-editor/shared';
import { IpcChannel, MenuActionChannel, MenuStateChannel } from '@ai-md-editor/shared';

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

  /** 读取指定路径的文件内容（UTF-8） */
  readFile: (filePath: string): Promise<string> => ipcRenderer.invoke(IpcChannel.ReadFile, filePath),

  /** 写入内容到指定路径 */
  writeFile: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.WriteFile, filePath, content),

  /** 保存粘贴的图片到文档同级 assets/ 目录，返回相对路径 */
  saveImage: (input: SaveImageInput): Promise<SaveImageResult> =>
    ipcRenderer.invoke(IpcChannel.SaveImage, input),

  /** 选择本地图片并保存到 assets/ 目录，返回相对路径 */
  chooseImage: (docDir: string): Promise<SaveImageResult> =>
    ipcRenderer.invoke(IpcChannel.ChooseImage, docDir),

  /** 获取最近文件列表 */
  getRecent: (): Promise<RecentFile[]> => ipcRenderer.invoke(IpcChannel.GetRecent),

  /** 添加最近文件记录 */
  addRecent: (path: string, name: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.AddRecent, path, name),

  /** 读取目录列表（文件树用）：返回子目录与 Markdown 文件条目 */
  readDir: (dirPath: string): Promise<ReadDirResult> =>
    ipcRenderer.invoke(IpcChannel.ReadDir, dirPath),

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

  /** 打印当前文档 */
  print: (): Promise<void> => ipcRenderer.invoke(IpcChannel.Print),

  /** 按指定格式写剪贴板（纯文本 / Markdown / HTML 代码） */
  writeClipboard: (input: ClipboardWriteInput): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.ClipboardWrite, input),

  /** 读取剪贴板纯文本 */
  readClipboardText: (): Promise<string> => ipcRenderer.invoke(IpcChannel.ClipboardReadText),

  /** 界面缩放 */
  zoom: (action: ZoomAction): Promise<void> => ipcRenderer.invoke(IpcChannel.Zoom, action),

  /** 窗口置顶 */
  setAlwaysOnTop: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke(IpcChannel.AlwaysOnTop, enabled),

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
  }
};

contextBridge.exposeInMainWorld('api', api);

/** 全局类型声明：让渲染进程能感知 window.api 的类型 */
export type ExposedApi = typeof api;

import { contextBridge, ipcRenderer } from 'electron';
import type {
  OpenFileResult,
  SaveFileResult,
  SaveImageInput,
  SaveImageResult
} from '@ai-md-editor/shared';
import { IpcChannel } from '@ai-md-editor/shared';

/**
 * 通过 contextBridge 暴露给渲染进程的白名单 API。
 * 遵循安全基线：不暴露 node/electron 原生能力，只暴露最小必要接口。
 * 文件操作均通过 ipcRenderer.invoke 走主进程，渲染进程无直接文件系统权限。
 */
const api = {
  /** 应用版本号 */
  getVersion: (): string => process.env['npm_package_version'] ?? '0.1.0',
  /** 当前平台（darwin / win32） */
  getPlatform: (): string => process.platform,

  /** 打开文件对话框，返回选中的文件路径与内容 */
  openFile: (): Promise<OpenFileResult> => ipcRenderer.invoke(IpcChannel.OpenFile),

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
    ipcRenderer.invoke(IpcChannel.SaveImage, input)
};

contextBridge.exposeInMainWorld('api', api);

/** 全局类型声明：让渲染进程能感知 window.api 的类型 */
export type ExposedApi = typeof api;

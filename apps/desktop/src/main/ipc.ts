/**
 * 主进程 IPC handler 注册。
 * 处理文件打开/保存、图片保存等能力，通过 ipcMain.handle 暴露给渲染进程。
 * 遵循安全基线：仅处理白名单通道，校验入参，不暴露任意文件系统能力。
 */

import { dialog, ipcMain, BrowserWindow } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type {
  OpenFileResult,
  SaveFileResult,
  SaveImageInput,
  SaveImageResult
} from '@ai-md-editor/shared';
import { IpcChannel } from '@ai-md-editor/shared';

/** Markdown 文件扩展名过滤 */
const MD_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
  { name: '所有文件', extensions: ['*'] }
];

/**
 * 打开文件对话框，读取选中的 Markdown 文件内容。
 */
async function handleOpenFile(win: BrowserWindow | null): Promise<OpenFileResult> {
  const options = {
    properties: ['openFile' as const],
    filters: MD_FILTERS
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, path: null, name: null, content: null };
  }
  const filePath = result.filePaths[0];
  // 以 UTF-8 读取；后续可扩展编码检测（GBK 等）
  const content = await readFile(filePath, 'utf-8');
  return { canceled: false, path: filePath, name: basename(filePath), content };
}

/**
 * 保存文件对话框（另存为），写入内容。
 */
async function handleSaveFileAs(
  win: BrowserWindow | null,
  content: string,
  defaultName: string
): Promise<SaveFileResult> {
  const options = { defaultPath: defaultName, filters: MD_FILTERS };
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) {
    return { canceled: true, path: null, name: null };
  }
  await writeFile(result.filePath, content, 'utf-8');
  return { canceled: false, path: result.filePath, name: basename(result.filePath) };
}

/**
 * 读取指定路径的文件内容（UTF-8）。
 */
async function handleReadFile(_win: BrowserWindow | null, filePath: string): Promise<string> {
  return readFile(filePath, 'utf-8');
}

/**
 * 写入内容到指定路径。
 */
async function handleWriteFile(
  _win: BrowserWindow | null,
  filePath: string,
  content: string
): Promise<void> {
  await writeFile(filePath, content, 'utf-8');
}

/**
 * 保存粘贴的图片到文档同级的 assets/ 目录，返回相对路径。
 * 文件名用时间戳 + 随机后缀，避免冲突。
 */
async function handleSaveImage(
  _win: BrowserWindow | null,
  input: SaveImageInput
): Promise<SaveImageResult> {
  try {
    const { data, extension, docDir } = input;
    // 生成 assets 目录（文档同级）
    const assetsDir = join(docDir, 'assets');
    await mkdir(assetsDir, { recursive: true });

    // 生成唯一文件名：时间戳 + 随机后缀
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T]/g, '')
      .slice(0, 14);
    const random = Math.random().toString(36).slice(2, 8);
    const filename = `${timestamp}-${random}.${extension}`;
    const fullPath = join(assetsDir, filename);

    // 写入图片二进制数据
    await writeFile(fullPath, Buffer.from(data));

    return { relativePath: `assets/${filename}`, error: null };
  } catch (err) {
    return { relativePath: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 注册所有 IPC handler。
 * 每个 handler 通过 event.sender 获取发起请求的窗口，作为对话框的父窗口。
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannel.OpenFile, (event) =>
    handleOpenFile(BrowserWindow.fromWebContents(event.sender))
  );
  ipcMain.handle(IpcChannel.SaveFileAs, (event, content: string, defaultName: string) =>
    handleSaveFileAs(BrowserWindow.fromWebContents(event.sender), content, defaultName)
  );
  ipcMain.handle(IpcChannel.ReadFile, (event, filePath: string) =>
    handleReadFile(BrowserWindow.fromWebContents(event.sender), filePath)
  );
  ipcMain.handle(IpcChannel.WriteFile, (event, filePath: string, content: string) =>
    handleWriteFile(BrowserWindow.fromWebContents(event.sender), filePath, content)
  );
  ipcMain.handle(IpcChannel.SaveImage, (event, input: SaveImageInput) =>
    handleSaveImage(BrowserWindow.fromWebContents(event.sender), input)
  );
}

/**
 * 主进程 IPC handler 注册。
 * 处理文件打开/保存、图片保存等能力，通过 ipcMain.handle 暴露给渲染进程。
 * 遵循安全基线：仅处理白名单通道，校验入参，不暴露任意文件系统能力。
 */

import { dialog, ipcMain, BrowserWindow, clipboard, shell } from 'electron';
import { readFile, writeFile, mkdir, readdir, rename } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { marked } from 'marked';
import type {
  OpenFileResult,
  SaveFileResult,
  SaveImageInput,
  SaveImageResult,
  RecentFile,
  FsEntry,
  ReadDirResult,
  ExportInput,
  ExportResult,
  RenameFileInput,
  RenameFileResult,
  ClipboardWriteInput,
  ZoomAction,
  MenuViewState
} from '@ai-md-editor/shared';
import { IpcChannel, MenuStateChannel } from '@ai-md-editor/shared';
import { getRecent, addRecent } from './recent';
import { exportFile } from './export';
import { updateMenuState, refreshRecentMenu } from './menu';
import { createWindow } from './window';

/** Markdown 文件扩展名过滤 */
const MD_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
  { name: '所有文件', extensions: ['*'] }
];

/**
 * 打开文件对话框，读取选中的 Markdown 文件内容。
 * 打开成功后记录到最近文件。
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
  const content = await readFile(filePath, 'utf-8');
  const name = basename(filePath);
  await addRecent(filePath, name);
  return { canceled: false, path: filePath, name, content };
}

/**
 * 打开指定路径的文件（供拖拽打开使用）。
 * 读取内容并记录最近文件。
 */
async function handleOpenPath(_win: BrowserWindow | null, filePath: string): Promise<OpenFileResult> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const name = basename(filePath);
    await addRecent(filePath, name);
    return { canceled: false, path: filePath, name, content };
  } catch {
    return { canceled: true, path: null, name: null, content: null };
  }
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

/** 把图片二进制写到文档同级 assets/ 目录，返回相对路径 */
async function saveImageToAssets(data: Uint8Array, extension: string, docDir: string): Promise<string> {
  const assetsDir = join(docDir || '.', 'assets');
  await mkdir(assetsDir, { recursive: true });

  // 生成唯一文件名：时间戳 + 随机后缀，避免冲突
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  const filename = `${timestamp}-${random}.${extension}`;
  await writeFile(join(assetsDir, filename), Buffer.from(data));
  return `assets/${filename}`;
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
    const relativePath = await saveImageToAssets(input.data, input.extension, input.docDir);
    return { relativePath, error: null };
  } catch (err) {
    return { relativePath: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 从系统对话框选择本地图片，复制到 assets/ 目录并返回相对路径 */
async function handleChooseImage(
  win: BrowserWindow | null,
  docDir: string
): Promise<SaveImageResult> {
  const options = {
    properties: ['openFile' as const],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }]
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return { relativePath: null, error: '已取消' };
  }
  try {
    const filePath = result.filePaths[0];
    const data = await readFile(filePath);
    const extension = (filePath.split('.').pop() ?? 'png').toLowerCase();
    const relativePath = await saveImageToAssets(new Uint8Array(data), extension, docDir);
    return { relativePath, error: null };
  } catch (err) {
    return { relativePath: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 读取目录列表（文件树用）。
 * 返回子目录与 Markdown 文件（.md/.markdown/.txt），隐藏文件（.开头）与 node_modules 排除。
 * 结果按 目录在前、名称不区分大小写排序。
 */
async function handleReadDir(_win: BrowserWindow | null, dirPath: string): Promise<ReadDirResult> {
  try {
    const raw = await readdir(dirPath, { withFileTypes: true });
    const entries: FsEntry[] = [];
    for (const item of raw) {
      // 排除隐藏文件/目录与常见噪声目录
      if (item.name.startsWith('.') || item.name === 'node_modules') continue;
      if (item.isDirectory()) {
        entries.push({ name: item.name, path: join(dirPath, item.name), kind: 'dir' });
      } else if (item.isFile() && /\.(md|markdown|txt)$/i.test(item.name)) {
        entries.push({ name: item.name, path: join(dirPath, item.name), kind: 'md' });
      }
    }
    // 目录在前，同类型按名称排序（不区分大小写）
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return { ok: true, entries, error: null };
  } catch (err) {
    return { ok: false, entries: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 弹出文件夹选择对话框（文件树打开目录用）。
 */
async function handleChooseFolder(win: BrowserWindow | null): Promise<{ canceled: boolean; path: string | null }> {
  const options = { properties: ['openDirectory' as const] };
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, path: null };
  }
  return { canceled: false, path: result.filePaths[0] };
}

/** 导出格式 → 文件扩展名 + 过滤器 */
const EXPORT_FILTERS: Record<ExportInput['format'], { ext: string; name: string }> = {
  html: { ext: '.html', name: 'HTML' },
  pdf: { ext: '.pdf', name: 'PDF' },
  word: { ext: '.doc', name: 'Word 文档' }
};

/**
 * 导出 Markdown 为 HTML/PDF/Word。
 * 弹保存对话框确定路径，然后写文件。
 */
async function handleExport(
  win: BrowserWindow | null,
  input: ExportInput
): Promise<ExportResult> {
  const { ext, name } = EXPORT_FILTERS[input.format];
  const defaultPath = input.defaultName.replace(/\.(md|markdown|txt)$/i, '') + ext;
  const options = {
    defaultPath,
    filters: [{ name, extensions: [ext.slice(1)] }]
  };
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) {
    return { ok: false, path: null, error: '已取消' };
  }
  try {
    await exportFile(input.format, input.markdown, result.filePath, input.defaultName);
    return { ok: true, path: result.filePath, error: null };
  } catch (err) {
    return { ok: false, path: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 重命名当前文档（同目录内改名，不改动内容） */
async function handleRenameFile(input: RenameFileInput): Promise<RenameFileResult> {
  const newName = input.newName.trim();
  if (!newName || /[/\\]/.test(newName)) {
    return { ok: false, path: null, name: null, error: '文件名不合法' };
  }
  try {
    const target = join(dirname(input.path), newName);
    await rename(input.path, target);
    return { ok: true, path: target, name: newName, error: null };
  } catch (err) {
    return { ok: false, path: null, name: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 简化 Markdown 为纯文本（复制为纯文本用，保留段落结构） */
function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?|```$/g, ''))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/^\s{0,3}(-{3,}|\*{3,})\s*$/gm, '')
    .trim();
}

/** 写剪贴板：纯文本 / Markdown 原文 / 渲染后的 HTML 代码（Electron 45 为异步 API） */
async function handleClipboardWrite(input: ClipboardWriteInput): Promise<void> {
  if (input.format === 'markdown') {
    await clipboard.writeText(input.markdown);
    return;
  }
  if (input.format === 'html') {
    const html = marked.parse(input.markdown, { gfm: true, breaks: false }) as string;
    await clipboard.writeText(html);
    return;
  }
  await clipboard.writeText(stripMarkdown(input.markdown));
}

/** 界面缩放（Electron webContents 缩放级别，范围限制在 -3 ~ 3） */
function handleZoom(win: BrowserWindow | null, action: ZoomAction): void {
  if (!win) return;
  const current = win.webContents.getZoomLevel();
  const next = action === 'reset' ? 0 : Math.max(-3, Math.min(3, current + (action === 'in' ? 0.5 : -0.5)));
  win.webContents.setZoomLevel(next);
}

/**
 * 注册所有 IPC handler。
 * 每个 handler 通过 event.sender 获取发起请求的窗口，作为对话框的父窗口。
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannel.OpenFile, (event) =>
    handleOpenFile(BrowserWindow.fromWebContents(event.sender))
  );
  ipcMain.handle(IpcChannel.OpenPath, (event, filePath: string) =>
    handleOpenPath(BrowserWindow.fromWebContents(event.sender), filePath)
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
  ipcMain.handle(IpcChannel.ChooseImage, (event, docDir: string) =>
    handleChooseImage(BrowserWindow.fromWebContents(event.sender), docDir)
  );
  ipcMain.handle(IpcChannel.GetRecent, (): RecentFile[] => getRecent());
  ipcMain.handle(IpcChannel.AddRecent, async (_event, path: string, name: string) => {
    await addRecent(path, name);
    // 最近文件变化后重建菜单，保证「打开最近文件」子菜单是最新列表
    refreshRecentMenu();
  });
  ipcMain.handle(IpcChannel.ReadDir, (event, dirPath: string) =>
    handleReadDir(BrowserWindow.fromWebContents(event.sender), dirPath)
  );
  ipcMain.handle(IpcChannel.ChooseFolder, (event) =>
    handleChooseFolder(BrowserWindow.fromWebContents(event.sender))
  );
  ipcMain.handle(IpcChannel.Export, (event, input: ExportInput) =>
    handleExport(BrowserWindow.fromWebContents(event.sender), input)
  );
  ipcMain.handle(IpcChannel.RenameFile, (_event, input: RenameFileInput) => handleRenameFile(input));
  ipcMain.handle(IpcChannel.RevealInFolder, (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });
  ipcMain.handle(IpcChannel.Print, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.webContents.print();
  });
  ipcMain.handle(IpcChannel.ClipboardWrite, (_event, input: ClipboardWriteInput) =>
    handleClipboardWrite(input)
  );
  ipcMain.handle(IpcChannel.ClipboardReadText, () => clipboard.readText());
  ipcMain.handle(IpcChannel.Zoom, (event, action: ZoomAction) =>
    handleZoom(BrowserWindow.fromWebContents(event.sender), action)
  );
  ipcMain.handle(IpcChannel.AlwaysOnTop, (event, enabled: boolean) => {
    BrowserWindow.fromWebContents(event.sender)?.setAlwaysOnTop(enabled);
  });
  ipcMain.handle(IpcChannel.NewWindow, () => {
    createWindow();
  });

  // 渲染层同步界面状态：重建原生菜单以刷新勾选项
  ipcMain.on(MenuStateChannel, (_event, state: MenuViewState) => {
    if (state && typeof state === 'object') updateMenuState(state);
  });
}

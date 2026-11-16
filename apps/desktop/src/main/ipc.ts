/**
 * 主进程 IPC handler 注册。
 * 处理文件打开/保存、图片保存等能力，通过 ipcMain.handle 暴露给渲染进程。
 * 遵循安全基线：仅处理白名单通道，校验入参，不暴露任意文件系统能力。
 */

import { dialog, ipcMain, BrowserWindow, clipboard, shell } from 'electron';
import { readFile, writeFile, mkdir, readdir, rename, stat } from 'node:fs/promises';
import { join, basename, dirname, extname } from 'node:path';
import { marked } from 'marked';
import { searchFolder } from './searcher';
import type {
  OpenFileResult,
  ReadFileResult,
  SaveFileResult,
  SaveImageInput,
  SaveImageResult,
  RecentFile,
  FsEntry,
  ReadDirResult,
  CreateFileResult,
  SearchFolderInput,
  ExportInput,
  ExportResult,
  RenameFileInput,
  RenameFileResult,
  ClipboardWriteInput,
  ZoomAction,
  MenuViewState,
  AppSettings,
  StatPathResult,
  SaveImageFromPathInput,
  OpenExternalResult,
  TextEncoding,
  WriteFileOptions
} from '@ai-md-editor/shared';
import {
  IpcChannel,
  MenuStateChannel,
  decodeBytes,
  encodeText,
  stripMarkdown,
  writeEncoding
} from '@ai-md-editor/shared';
import { getRecent, addRecent } from './recent';
import { getSettings, updateSettings } from './settings';
import { exportFile } from './export';
import { updateMenuState, refreshRecentMenu } from './menu';
import { createWindow } from './window';
import { markSelfWrite, watchDocumentFile, unwatchDocumentFile } from './fileWatcher';
import { assertDiskUnchanged, forgetDiskStamp, recordDiskStamp, writeFileAtomic } from './fileWrite';

/** 按渲染进程隔离的活动搜索请求，避免不同窗口互相取消。 */
const searchControllers = new Map<string, AbortController>();

/** Markdown 文件扩展名过滤 */
const MD_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
  { name: '所有文件', extensions: ['*'] }
];

/** 打开文本文件的体积上限：超过这个量级已不是「写文档」的场景，读进内存会长时间卡住 */
const MAX_TEXT_FILE_BYTES = 20 * 1024 * 1024;

/**
 * 读取文本文件，附带体积、二进制与编码识别。
 * 返回 error 时由调用方弹窗告知用户，而不是静默失败。
 */
async function readTextFile(
  filePath: string
): Promise<{ content: string | null; encoding: TextEncoding | null; error: string | null }> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return { content: null, encoding: null, error: '只能打开文件，不能打开文件夹' };
    }
    if (info.size > MAX_TEXT_FILE_BYTES) {
      return {
        content: null,
        encoding: null,
        error: `文件大小 ${(info.size / 1024 / 1024).toFixed(1)} MB，超过 20 MB 上限`
      };
    }
    const bytes = await readFile(filePath);
    // 二进制文件（图片/压缩包/pdf 等）里出现 NUL 字节，别当成 Markdown 打开
    if (bytes.includes(0)) {
      return { content: null, encoding: null, error: '这不是文本文件' };
    }
    // UTF-8 BOM / UTF-16 / GBK 都在这里识别；纯 UTF-8 也走同一分支
    const { text, encoding } = decodeBytes(bytes);
    // 记住这次读到的磁盘版本：之后写入前要比对，防止静默覆盖外部改动
    await recordDiskStamp(filePath);
    return { content: text, encoding, error: null };
  } catch (err) {
    return { content: null, encoding: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 用系统对话框告知「无法打开」（拖拽二进制/超大文件时给出明确反馈） */
async function notifyOpenError(win: BrowserWindow | null, message: string): Promise<void> {
  const options = { type: 'error' as const, title: '无法打开文件', message, buttons: ['好'] };
  if (win) await dialog.showMessageBox(win, options);
  else await dialog.showMessageBox(options);
}

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
    return { canceled: true, path: null, name: null, content: null, encoding: null };
  }
  const filePath = result.filePaths[0];
  const read = await readTextFile(filePath);
  if (read.content === null) {
    await notifyOpenError(win, `${basename(filePath)}：${read.error ?? '读取失败'}`);
    return { canceled: true, path: null, name: null, content: null, encoding: null };
  }
  const name = basename(filePath);
  await addRecent(filePath, name);
  return { canceled: false, path: filePath, name, content: read.content, encoding: read.encoding };
}

/**
 * 打开指定路径的文件（供拖拽打开使用）。
 * 读取内容并记录最近文件。
 */
async function handleOpenPath(win: BrowserWindow | null, filePath: string): Promise<OpenFileResult> {
  const read = await readTextFile(filePath);
  if (read.content === null) {
    await notifyOpenError(win, `${basename(filePath)}：${read.error ?? '读取失败'}`);
    return { canceled: true, path: null, name: null, content: null, encoding: null };
  }
  const name = basename(filePath);
  await addRecent(filePath, name);
  return { canceled: false, path: filePath, name, content: read.content, encoding: read.encoding };
}

/**
 * 静默读取文件（会话恢复用）。
 * 与 handleOpenPath 的区别：文件不存在时直接返回取消，不弹窗、不写入最近文件。
 */
async function handleReadPathQuiet(filePath: string): Promise<OpenFileResult> {
  const read = await readTextFile(filePath);
  if (read.content === null) {
    return { canceled: true, path: null, name: null, content: null, encoding: null };
  }
  return {
    canceled: false,
    path: filePath,
    name: basename(filePath),
    content: read.content,
    encoding: read.encoding
  };
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
  // 另存为一律写 UTF-8：新文件不存在「沿用原编码」的问题
  markSelfWrite(result.filePath);
  await writeFileAtomic(result.filePath, content);
  return { canceled: false, path: result.filePath, name: basename(result.filePath) };
}

/**
 * 读取指定路径的文件内容与编码。
 * 读完记录磁盘版本，后续写入时据此判断是否被外部改过。
 */
async function handleReadFile(filePath: string): Promise<ReadFileResult> {
  const { text, encoding } = decodeBytes(await readFile(filePath));
  await recordDiskStamp(filePath);
  return { content: text, encoding };
}

/**
 * 写入内容到指定路径，返回实际使用的编码。
 *
 * 除带 BOM 的 UTF-8 外统一写成 UTF-8：TextEncoder 无法编码 GBK / UTF-16，
 * 强行写回会乱码，转存 UTF-8 内容不会丢失。
 *
 * 写入前先比对磁盘版本：被外部程序改过就抛错，避免自动保存静默覆盖；
 * 用户显式「保存」传 force，明确表示以当前编辑器内容为准。
 */
async function handleWriteFile(
  filePath: string,
  content: string,
  encoding: TextEncoding = 'utf-8',
  options?: WriteFileOptions
): Promise<TextEncoding> {
  const effective = writeEncoding(encoding);
  if (!options?.force) await assertDiskUnchanged(filePath);
  // 先登记再写：写盘与 fs.watch 事件之间存在竞态，提前登记才能可靠过滤自身写入
  markSelfWrite(filePath);
  await writeFileAtomic(filePath, encodeText(content, effective));
  return effective;
}

/** 图片目录名：固定放在 Markdown 文件同级，随文档一起拷贝即可带走图片 */
const IMAGE_DIR = 'img';

/** 允许写入的图片扩展名白名单 */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);

/**
 * 提取安全的图片扩展名。
 * 入参可能是 'png'、'.png' 或整条磁盘路径；目录名中的点、无扩展名的文件、
 * 非图片后缀都会被挡掉并回退到 png，避免路径片段混进生成的文件名。
 */
function normalizeImageExtension(value: string): string {
  const raw = String(value ?? '');
  const ext = (raw.includes('.') ? extname(raw).slice(1) : raw).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext) ? ext : 'png';
}

/**
 * 把图片二进制写到 Markdown 文件同级的 img/ 目录，返回相对路径。
 * 相对路径保证文档 + img 目录整体拷走后仍能正确引用。
 *
 * @param docPath Markdown 文件的绝对路径（未保存的新文档无法确定目录）
 */
async function saveImageToDocDir(data: Uint8Array, extension: string, docPath: string): Promise<string> {
  if (!docPath) {
    throw new Error('文档尚未保存，无法确定图片目录');
  }
  const dir = join(dirname(docPath), IMAGE_DIR);
  await mkdir(dir, { recursive: true });

  // 生成唯一文件名：时间戳 + 随机后缀，避免冲突
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  const filename = `${timestamp}-${random}.${normalizeImageExtension(extension)}`;
  await writeFile(join(dir, filename), Buffer.from(data));
  return `${IMAGE_DIR}/${filename}`;
}

/**
 * 保存粘贴的图片到文档同级的 img/ 目录，返回相对路径。
 * 文件名用时间戳 + 随机后缀，避免冲突。
 */
async function handleSaveImage(
  _win: BrowserWindow | null,
  input: SaveImageInput
): Promise<SaveImageResult> {
  try {
    const relativePath = await saveImageToDocDir(
      input.data,
      normalizeImageExtension(input.extension),
      input.docPath
    );
    return { relativePath, error: null };
  } catch (err) {
    return { relativePath: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 从系统对话框选择本地图片，复制到文档同级 img/ 目录并返回相对路径 */
async function handleChooseImage(
  win: BrowserWindow | null,
  docPath: string
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
    const extension = normalizeImageExtension(filePath);
    const relativePath = await saveImageToDocDir(new Uint8Array(data), extension, docPath);
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
 * 在目录里新建 Markdown 文件（文件树 ⋮ 菜单的「新建文件」）。
 * 未指定名称时用「未命名.md」；与现有文件重名时追加序号（未命名-2.md…）。
 */
async function handleCreateFile(
  _win: BrowserWindow | null,
  dirPath: string,
  desiredName?: string
): Promise<CreateFileResult> {
  try {
    // 用户输入的名称：去掉路径分隔符、非法字符与结尾的点/空格（Windows 不允许），补 .md 后缀
    const raw = (desiredName ?? '')
      .trim()
      .replace(/[/\\:*?"<>|]/g, '')
      .replace(/^\.+/, '')
      .replace(/[. ]+$/, '');
    const withExt = raw.length === 0 ? '未命名' : /\.(md|markdown|txt)$/i.test(raw) ? raw.replace(/\.(markdown|txt)$/i, '.md') : `${raw}.md`;
    const stem = withExt.replace(/\.md$/i, '');
    let candidate = join(dirPath, withExt);
    for (let n = 2; n <= 99; n += 1) {
      try {
        await stat(candidate);
        candidate = join(dirPath, `${stem}-${n}.md`); // 已存在则换下一个名字
      } catch {
        break; // 不存在，可用
      }
    }
    await writeFile(candidate, '', 'utf-8');
    return { ok: true, path: candidate, error: null };
  } catch (err) {
    return { ok: false, path: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 弹出文件夹选择对话框（文件树打开目录用）。
 */
async function handleChooseFolder(win: BrowserWindow | null): Promise<{ canceled: boolean; path: string | null }> {
  const options = { properties: ['openDirectory' as const] };  const result = win
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
    // 文档所在目录用于把 img/ 相对路径图片内联，导出的文件换目录也能正常显示
    const docDir = input.docPath ? dirname(input.docPath) : null;
    await exportFile(input.format, input.markdown, result.filePath, input.defaultName, docDir);
    return { ok: true, path: result.filePath, error: null };
  } catch (err) {
    return { ok: false, path: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 文本类扩展名：用户输入这些后缀时视为「已写扩展名」，其余（含「报告.v2」）继续补原后缀 */
const TEXT_EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.txt']);

/** 重命名当前文档（同目录内改名，不改动内容） */
async function handleRenameFile(input: RenameFileInput): Promise<RenameFileResult> {
  const newName = input.newName.trim();
  if (!newName) {
    return { ok: false, path: null, name: null, error: '文件名不能为空' };
  }
  // 路径分隔符、Windows 保留字符、结尾的点和空格都不能进文件名
  if (/[/\\]/.test(newName) || /[<>:"|?*\u0000-\u001f]/.test(newName) || /[. ]$/.test(newName)) {
    return { ok: false, path: null, name: null, error: '文件名包含不允许的字符' };
  }
  // 用户没写扩展名时沿用原文件扩展名（重命名「纪要」→「纪要.md」，而不是丢掉 .md）
  const originalExt = extname(input.path);
  const typedExt = extname(newName).toLowerCase();
  const finalName =
    originalExt !== '' && !TEXT_EXTS.has(typedExt) ? `${newName}${originalExt}` : newName;
  try {
    const target = join(dirname(input.path), finalName);
    if (target === input.path) {
      return { ok: true, path: input.path, name: finalName, error: null };
    }
    // fs.rename 在多数平台是覆盖语义，必须先确认目标不存在，否则会悄悄顶掉同名文件。
    // 大小写改名（a.md → A.md）在大小写不敏感的文件系统上 stat 会命中自己，需要放行。
    if (target.toLowerCase() !== input.path.toLowerCase()) {
      try {
        await stat(target);
        return { ok: false, path: null, name: null, error: `同名文件已存在：${finalName}` };
      } catch {
        // 不存在，可以改名
      }
    }
    await rename(input.path, target);
    // 旧路径的版本记录作废，新路径按改名后的状态重新登记
    forgetDiskStamp(input.path);
    await recordDiskStamp(target);
    return { ok: true, path: target, name: finalName, error: null };
  } catch (err) {
    return { ok: false, path: null, name: null, error: err instanceof Error ? err.message : String(err) };
  }
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

/**
 * 界面缩放档位（离散百分比，50% ~ 300%）。
 * 用 setZoomFactor 而不是 setZoomLevel：档位是精确比例，
 * 状态栏与菜单里显示的百分比不会出现 110%、132% 这类奇怪的中间值。
 */
const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/** 100% 所在的档位下标 */
const ZOOM_DEFAULT_INDEX = ZOOM_STEPS.indexOf(1);

/**
 * 调整界面缩放，返回调整后的百分比。
 * @returns 新的缩放百分比（如 110）
 */
function handleZoom(win: BrowserWindow | null, action: ZoomAction): number {
  if (!win) return 100;
  const current = win.webContents.getZoomFactor();
  // 找最接近当前值的档位，避免浮点误差导致「放大」无效
  let index = ZOOM_STEPS.findIndex((step) => Math.abs(step - current) < 0.02);
  if (index < 0) index = ZOOM_DEFAULT_INDEX;
  const target = action === 'reset'
    ? ZOOM_DEFAULT_INDEX
    : Math.max(0, Math.min(ZOOM_STEPS.length - 1, index + (action === 'in' ? 1 : -1)));
  win.webContents.setZoomFactor(ZOOM_STEPS[target]);
  return Math.round(ZOOM_STEPS[target] * 100);
}

/**
 * 直接设定缩放百分比（恢复上次缩放用），会吸附到最近的档位。
 * @returns 实际生效的百分比
 */
function handleSetZoom(win: BrowserWindow | null, percent: number): number {
  if (!win) return 100;
  const clamped = Math.max(50, Math.min(300, Number(percent) || 100));
  const factor = clamped / 100;
  const nearest = ZOOM_STEPS.reduce((best, step) =>
    Math.abs(step - factor) < Math.abs(best - factor) ? step : best
  );
  win.webContents.setZoomFactor(nearest);
  return Math.round(nearest * 100);
}

/** 查询路径类型（拖拽时区分文件夹 / 文件） */
async function handleStatPath(targetPath: string): Promise<StatPathResult> {
  try {
    const info = await stat(targetPath);
    return { exists: true, isDirectory: info.isDirectory(), isFile: info.isFile() };
  } catch {
    return { exists: false, isDirectory: false, isFile: false };
  }
}

/** 把磁盘上的图片文件复制到文档同级 img/ 目录（拖拽插入用） */
async function handleSaveImageFromPath(input: SaveImageFromPathInput): Promise<SaveImageResult> {
  try {
    const data = await readFile(input.sourcePath);
    const extension = normalizeImageExtension(input.sourcePath);
    const relativePath = await saveImageToDocDir(new Uint8Array(data), extension, input.docPath);
    return { relativePath, error: null };
  } catch (err) {
    return { relativePath: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 用系统默认浏览器打开外部链接。
 * 只放行 http/https：渲染进程内容可被任意文档注入，任意协议（file: 等）
 * 都不应当被直接执行。
 */
async function handleOpenExternal(url: string): Promise<OpenExternalResult> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, error: `不支持的链接协议：${parsed.protocol}` };
    }
    await shell.openExternal(parsed.href);
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: '链接格式无效' };
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
  ipcMain.handle(IpcChannel.OpenPath, (event, filePath: string) =>
    handleOpenPath(BrowserWindow.fromWebContents(event.sender), filePath)
  );
  ipcMain.handle(IpcChannel.SaveFileAs, (event, content: string, defaultName: string) =>
    handleSaveFileAs(BrowserWindow.fromWebContents(event.sender), content, defaultName)
  );
  ipcMain.handle(IpcChannel.ReadFile, (_event, filePath: string) => handleReadFile(filePath));
  ipcMain.handle(IpcChannel.ReadPathQuiet, (_event, filePath: string) => handleReadPathQuiet(filePath));
  ipcMain.handle(
    IpcChannel.WriteFile,
    (_event, filePath: string, content: string, encoding?: TextEncoding, options?: WriteFileOptions) =>
      handleWriteFile(filePath, content, encoding, options)
  );
  ipcMain.handle(IpcChannel.WatchFile, (_event, filePath: string) => {
    watchDocumentFile(filePath);
  });
  ipcMain.handle(IpcChannel.UnwatchFile, (_event, filePath: string) => {
    unwatchDocumentFile(filePath);
  });
  ipcMain.handle(IpcChannel.SaveImage, (event, input: SaveImageInput) =>
    handleSaveImage(BrowserWindow.fromWebContents(event.sender), input)
  );
  ipcMain.handle(IpcChannel.ChooseImage, (event, docPath: string) =>
    handleChooseImage(BrowserWindow.fromWebContents(event.sender), docPath)
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
  ipcMain.handle(IpcChannel.CreateFile, (event, dirPath: string, name?: string) =>
    handleCreateFile(BrowserWindow.fromWebContents(event.sender), dirPath, name)
  );
  ipcMain.handle(IpcChannel.SearchFolder, async (event, input: SearchFolderInput) => {
    if (!input.requestId) return searchFolder(input);
    const key = String(event.sender.id) + ':' + input.requestId;
    searchControllers.get(key)?.abort();
    const controller = new AbortController();
    searchControllers.set(key, controller);
    try {
      return await searchFolder(input, controller.signal);
    } finally {
      if (searchControllers.get(key) === controller) searchControllers.delete(key);
    }
  });
  ipcMain.handle(IpcChannel.SearchCancel, (event, requestId: string) => {
    searchControllers.get(String(event.sender.id) + ':' + requestId)?.abort();
  });
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
  ipcMain.handle(IpcChannel.Zoom, (event, action: ZoomAction): number =>
    handleZoom(BrowserWindow.fromWebContents(event.sender), action)
  );
  ipcMain.handle(IpcChannel.SetZoom, (event, percent: number): number =>
    handleSetZoom(BrowserWindow.fromWebContents(event.sender), percent)
  );
  ipcMain.handle(IpcChannel.SettingsGet, (): AppSettings => getSettings());
  ipcMain.handle(IpcChannel.SettingsUpdate, (_event, patch: Partial<AppSettings>): AppSettings =>
    updateSettings(patch ?? {})
  );
  ipcMain.handle(IpcChannel.StatPath, (_event, targetPath: string) => handleStatPath(targetPath));
  ipcMain.handle(IpcChannel.SaveImageFromPath, (_event, input: SaveImageFromPathInput) =>
    handleSaveImageFromPath(input)
  );
  ipcMain.handle(IpcChannel.OpenExternal, (_event, url: string) => handleOpenExternal(url));
  ipcMain.handle(IpcChannel.AlwaysOnTop, (event, enabled: boolean) => {
    BrowserWindow.fromWebContents(event.sender)?.setAlwaysOnTop(enabled);
  });
  ipcMain.handle(IpcChannel.ToggleFullScreen, (event): boolean => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    const next = !win.isFullScreen();
    win.setFullScreen(next);
    return next;
  });
  ipcMain.handle(IpcChannel.IsFullScreen, (event): boolean =>
    BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false
  );
  ipcMain.handle(IpcChannel.MinimizeWindow, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle(IpcChannel.NewWindow, () => {
    createWindow();
  });

  // 渲染层同步界面状态：重建原生菜单以刷新勾选项
  ipcMain.on(MenuStateChannel, (_event, state: MenuViewState) => {
    if (state && typeof state === 'object') updateMenuState(state);
  });
}

/**
 * 导出模块：把 Markdown 导出为 HTML / PDF / Word。
 * - HTML：marked 渲染成带内联样式的单文件
 * - Word：生成 Word 可打开的 HTML 格式（.doc）
 * - PDF：用隐藏 BrowserWindow 加载 HTML 后 printToPDF
 */
import { BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { marked } from 'marked';
import type { ExportFormat } from '@ai-md-editor/shared';

/** 导出文档的完整 HTML（内联样式，中文字体友好） */
function buildHtml(markdown: string, title: string): string {
  // marked 渲染正文；gfm:true 支持表格/任务列表等
  const body = marked.parse(markdown, { gfm: true, breaks: false }) as string;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>
  body {
    font-family: -apple-system, 'SF Pro Text', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    max-width: 720px;
    margin: 0 auto;
    padding: 40px 24px;
    line-height: 1.75;
    color: #1a1a1a;
    font-size: 15px;
  }
  h1 { font-size: 1.7em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
  h2 { font-size: 1.4em; border-bottom: 1px solid #f0f0f0; padding-bottom: 0.2em; }
  h3 { font-size: 1.2em; }
  code {
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.88em;
    background: #f5f5f5;
    padding: 0.15em 0.4em;
    border-radius: 4px;
  }
  pre {
    background: #f6f8fa;
    padding: 12px 16px;
    border-radius: 6px;
    overflow-x: auto;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 3px solid #ddd;
    margin: 0.8em 0;
    padding: 0.1em 0 0.1em 1em;
    color: #666;
  }
  table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
  th, td { border: 1px solid #ddd; padding: 6px 12px; text-align: left; }
  th { background: #f5f5f5; }
  img { max-width: 100%; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  hr { border: none; border-top: 1px solid #ddd; margin: 1.5em 0; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** HTML 转义（标题等） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 导出 Markdown 为 HTML 文件。
 */
export async function exportHtml(markdown: string, filePath: string, title: string): Promise<void> {
  const html = buildHtml(markdown, title);
  await writeFile(filePath, html, 'utf-8');
}

/**
 * 导出 Markdown 为 Word（.doc，Word 能打开的 HTML 格式）。
 */
export async function exportWord(markdown: string, filePath: string, title: string): Promise<void> {
  const html = buildHtml(markdown, title);
  // 加 Word 识别 META 头，确保以 .doc 打开时按 HTML 解析
  const wordHtml = html.replace(
    '</head>',
    '<meta name="ProgId" content="Word.Document" />\n</head>'
  );
  await writeFile(filePath, wordHtml, 'utf-8');
}

/**
 * 导出 Markdown 为 PDF。
 * 用隐藏 BrowserWindow 加载 HTML，再 printToPDF 输出。
 */
export async function exportPdf(
  markdown: string,
  filePath: string,
  title: string
): Promise<void> {
  const html = buildHtml(markdown, title);
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true }
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
      pageSize: 'A4'
    });
    await writeFile(filePath, pdf);
  } finally {
    win.destroy();
  }
}

/** 导出分发 */
export async function exportFile(
  format: ExportFormat,
  markdown: string,
  filePath: string,
  title: string
): Promise<void> {
  switch (format) {
    case 'html':
      await exportHtml(markdown, filePath, title);
      break;
    case 'pdf':
      await exportPdf(markdown, filePath, title);
      break;
    case 'word':
      await exportWord(markdown, filePath, title);
      break;
  }
}

/**
 * 导出模块：把 Markdown 导出为 HTML / PDF / Word。
 * - HTML：marked 渲染成带内联样式的单文件
 * - Word：生成 Word 可打开的 HTML 格式（.doc）
 * - PDF：用隐藏 BrowserWindow 加载 HTML 后 printToPDF
 * - 数学公式：$...$ / $$...$$ 用 KaTeX 渲染成 HTML，并把
 *   katex.min.css 与 woff2 字体以 data URI 内联，导出文件自包含
 */
import { BrowserWindow } from 'electron';
import { writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { marked } from 'marked';
import type { ExportFormat } from '@ai-md-editor/shared';
import { extractMath, restoreMath, escapeHtml } from './mathExport';
import { inlineLocalImages } from './exportAssets';

/** katex.min.css 缓存：woff2 字体全部内联为 data URI（约 1.5MB，仅含公式的文档才嵌入） */
let katexCssCache: string | null = null;
function getKatexCss(): string {
  if (katexCssCache !== null) return katexCssCache;
  try {
    const cssPath = require.resolve('katex/dist/katex.min.css');
    const fontDir = join(dirname(cssPath), 'fonts');
    katexCssCache = readFileSync(cssPath, 'utf-8').replace(
      /url\(fonts\/([^)]+\.woff2)\)/g,
      (_match, file: string) => {
        const data = readFileSync(join(fontDir, file));
        return `url(data:font/woff2;base64,${data.toString('base64')})`;
      }
    );
  } catch {
    katexCssCache = '';
  }
  return katexCssCache;
}

/** 去掉文件头 YAML front matter（导出正文不该出现两条分隔线 + 元信息文本） */
function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '');
}

/** 给标题补锚点，并把 `[TOC]` 占位符展开成真实目录 */
function renderToc(html: string): string {
  const headings: { level: number; text: string; id: string }[] = [];
  const withIds = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_match, level: string, inner: string) => {
    const id = `toc-${headings.length + 1}`;
    headings.push({ level: Number(level), text: inner.replace(/<[^>]+>/g, '').trim(), id });
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
  if (!/\[TOC\]/.test(withIds)) return withIds;
  const nav = headings.length === 0
    ? ''
    : `<nav class="toc">${headings
        .map((h) => `<div class="toc-item toc-level-${h.level}"><a href="#${h.id}">${h.text}</a></div>`)
        .join('')}</nav>`;
  return withIds.replace(/<p>\s*\[TOC\]\s*<\/p>/g, nav);
}

/** 导出文档的完整 HTML（内联样式，中文字体友好） */
export function buildHtml(
  markdown: string,
  title: string,
  options: { math?: 'render' | 'text'; docDir?: string | null } = {}
): string {
  const mathMode = options.math ?? 'render';
  const source = stripFrontmatter(markdown);
  // 标题用文件名去掉扩展名，避免 PDF/HTML 标题出现「纪要.md」
  const displayTitle = title.replace(/\.(md|markdown|txt)$/i, '');

  let parsed: string;
  let mathCss = '';
  if (mathMode === 'render') {
    // 公式先换成占位符再交给 marked，避免 TeX 里的 *、_ 等被当成 Markdown 语法
    const { text, items } = extractMath(source);
    const raw = marked.parse(text, { gfm: true, breaks: false }) as string;
    parsed = restoreMath(raw, items);
    if (items.length > 0) {
      const katexCss = getKatexCss();
      if (katexCss) {
        // 放在 katex.min.css 之后覆盖默认 1.21em，防止上标溢出行框
        mathCss = `<style>${katexCss}\n.katex { font-size: 1.05em; }</style>`;
      }
    }
  } else {
    // Word 不渲染 KaTeX：保留 TeX 原文
    parsed = marked.parse(source, { gfm: true, breaks: false }) as string;
  }
  const body = inlineLocalImages(renderToc(parsed), options.docDir ?? null);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(displayTitle)}</title>
${mathCss}
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
  .toc {
    margin: 1em 0 1.5em;
    padding: 0.6em 0 0.6em 0.9em;
    border-left: 2px solid #e5e5e5;
    font-size: 0.95em;
  }
  .toc-item { padding: 3px 0; }
  .toc-level-1 { font-weight: 600; }
  .toc-level-2 { padding-left: 0.9em; }
  .toc-level-3 { padding-left: 1.8em; }
  .toc-level-4, .toc-level-5, .toc-level-6 { padding-left: 2.7em; }
  .toc a { color: #444; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * 导出 Markdown 为 HTML 文件。
 */
export async function exportHtml(
  markdown: string,
  filePath: string,
  title: string,
  docDir: string | null = null
): Promise<void> {
  const html = buildHtml(markdown, title, { docDir });
  await writeFile(filePath, html, 'utf-8');
}

/**
 * 导出 Markdown 为 Word（.doc，Word 能打开的 HTML 格式）。
 */
export async function exportWord(
  markdown: string,
  filePath: string,
  title: string,
  docDir: string | null = null
): Promise<void> {
  // Word 无法渲染 KaTeX HTML，公式保留 TeX 原文
  const html = buildHtml(markdown, title, { math: 'text', docDir });
  // 加 Word 识别 META 头，确保以 .doc 打开时按 HTML 解析
  const wordHtml = html.replace(
    '</head>',
    '<meta name="ProgId" content="Word.Document" />\n</head>'
  );
  await writeFile(filePath, wordHtml, 'utf-8');
}

/**
 * 导出 Markdown 为 PDF。
 * 先把 HTML 写成临时文件再用隐藏窗口加载：data: URL 在文档较大时
 * 会超过 Chromium 的导航长度限制，导致 PDF 一页空白。
 */
export async function exportPdf(
  markdown: string,
  filePath: string,
  title: string,
  docDir: string | null = null
): Promise<void> {
  const html = buildHtml(markdown, title, { docDir });
  const tempHtml = join(
    tmpdir(),
    `markdownnote-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`
  );
  await writeFile(tempHtml, html, 'utf-8');
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true }
  });
  try {
    await win.loadFile(tempHtml);
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
      pageSize: 'A4'
    });
    await writeFile(filePath, pdf);
  } finally {
    win.destroy();
    // 临时文件清理失败不影响导出结果
    await rm(tempHtml, { force: true }).catch(() => undefined);
  }
}

/** 导出分发 */
export async function exportFile(
  format: ExportFormat,
  markdown: string,
  filePath: string,
  title: string,
  docDir: string | null = null
): Promise<void> {
  switch (format) {
    case 'html':
      await exportHtml(markdown, filePath, title, docDir);
      break;
    case 'pdf':
      await exportPdf(markdown, filePath, title, docDir);
      break;
    case 'word':
      await exportWord(markdown, filePath, title, docDir);
      break;
  }
}

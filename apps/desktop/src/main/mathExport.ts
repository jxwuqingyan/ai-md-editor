/**
 * 导出用数学公式处理：把 Markdown 里的 $...$ / $$...$$ 提取成占位符，
 * marked 渲染后再还原成 KaTeX HTML。纯函数，主进程与单测共用。
 */
import katex from 'katex';

/** 一段被提取出来的公式 */
export interface MathItem {
  /** TeX 源码 */
  tex: string;
  /** 是否块级公式（$$...$$） */
  display: boolean;
}

/** 代码段掩码（仅在本模块内部短暂存在，不会交给 marked） */
const codeMask = (index: number): string => `\u0000C${index}\u0000`;
/** 公式占位符：纯 ASCII，marked 不会改写 */
const mathMask = (index: number): string => `%%MATH${index}%%`;

/** HTML 转义（标题、渲染失败的 TeX 原文等） */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 把 Markdown 里的数学公式提取成占位符。
 * 提取前先把围栏代码块与行内代码掩码掉，避免代码里的 $ 符号被误判成公式；
 * 返回的 text 里只保留公式占位符（代码段已还原），可直接交给 marked。
 */
export function extractMath(markdown: string): { text: string; items: MathItem[] } {
  const codeSegments: string[] = [];
  const stash = (match: string): string => codeMask(codeSegments.push(match) - 1);

  // 1) 掩码围栏代码块（``` 或 ~~~，闭合围栏用相同标记开头）
  let masked = markdown.replace(
    /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[^\n]*(?=\n|$)/gm,
    stash
  );
  // 2) 掩码行内代码
  masked = masked.replace(/(`+)[^`]*?\1/g, stash);

  const items: MathItem[] = [];
  // 3) 块级公式 $$...$$（允许跨行）
  masked = masked.replace(/\$\$([\s\S]+?)\$\$/g, (_match, tex: string) => {
    items.push({ tex: tex.trim(), display: true });
    return mathMask(items.length - 1);
  });
  // 4) 行内公式 $...$（不跨行；要求首尾非空白，避免把 "$5, $10" 这类文本误判成公式）
  masked = masked.replace(/\$(?!\s)([^$\n]+?)(?<!\s)\$/g, (_match, tex: string) => {
    items.push({ tex, display: false });
    return mathMask(items.length - 1);
  });

  // 5) 还原代码段，正文里只留下公式占位符
  const text = masked.replace(/\u0000C(\d+)\u0000/g, (_match, index: string) =>
    codeSegments[Number(index)]
  );
  return { text, items };
}

/** 用 KaTeX 把占位符还原成公式 HTML；渲染失败时退回 TeX 原文 */
export function restoreMath(html: string, items: MathItem[]): string {
  if (items.length === 0) return html;
  return html.replace(/%%MATH(\d+)%%/g, (match, index: string) => {
    const item = items[Number(index)];
    if (!item) return match;
    try {
      return katex.renderToString(item.tex, {
        displayMode: item.display,
        throwOnError: false,
        strict: false
      });
    } catch {
      const fallback = `<code>${escapeHtml(item.tex)}</code>`;
      return item.display ? `<p>${fallback}</p>` : fallback;
    }
  });
}

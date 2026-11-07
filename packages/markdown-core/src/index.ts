/**
 * Markdown 核心领域逻辑（纯函数，无 UI 依赖）。
 * 使用 remark 解析源码，确保大纲与编辑器遵循同一套 Markdown 语义。
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import { toString } from 'mdast-util-to-string';
import type { Heading, Root, RootContent } from 'mdast';

/** 大纲条目：从标题 AST 提取 */
export interface OutlineItem {
  /** 标题层级 1-6 */
  level: number;
  /** 标题纯文本（保留 C#、下划线等合法字符） */
  text: string;
  /** 在源文档中的行号（1 起） */
  line: number;
  /** 在文档全部标题中的序号（0 起），用于编辑器精确定位 */
  index: number;
}

/** 递归收集标题，兼容引用等容器内的标题 */
function collectHeadings(children: RootContent[], headings: Heading[]): void {
  for (const child of children) {
    if (child.type === 'heading') {
      headings.push(child);
    } else if ('children' in child) {
      collectHeadings(child.children as RootContent[], headings);
    }
  }
}

/**
 * 从 Markdown 源码提取大纲。
 * remark 会正确处理代码围栏、Setext 标题、行内格式、链接和 HTML 实体，
 * 避免正则解析与 Milkdown 实际渲染结果不一致。
 *
 * @param source Markdown 源码
 * @returns 标题大纲列表
 */
export function extractOutline(source: string): OutlineItem[] {
  // 识别 YAML front matter，否则文件头两条 `---` 会被误判成 Setext 标题
  const tree = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml'])
    .parse(source) as Root;
  const headings: Heading[] = [];
  collectHeadings(tree.children, headings);

  return headings.flatMap((heading, index) => {
    const text = toString(heading).trim();
    const line = heading.position?.start.line;
    // 没有源码位置或无可见文本的标题不生成无效导航项
    if (!text || !line) return [];
    return [{ level: heading.depth, text, line, index }];
  });
}

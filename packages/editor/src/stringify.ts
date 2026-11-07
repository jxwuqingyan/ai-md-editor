/**
 * Markdown 序列化配置（统一在此注入 remark-stringify handler）。
 *
 * 需要自定义 handler 的场景：
 * - `underline`：CommonMark 没有下划线语法，写回 `<u>…</u>`；
 * - `yaml`：文件头 front matter 原样写回 `---` 区块；
 * - `text`：remark 默认会把 `[TOC]`、`[!WARNING]` 中的方括号转义成 `\[`，
 *   导致目录与警告框语法失效，这里只对这两类标记定向解除转义。
 */
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/ctx';
import { underlineHandler } from './underline';
import { yamlHandler } from './frontmatter';

/** 需要保留原始方括号的标记：目录占位与 GitHub 风格警告框 */
const KEEP_BRACKETS = /\\\[(?=(?:TOC|!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION))])/g;

/** mdast-util-to-markdown 状态机的最小可用子集 */
interface TextStringifyState {
  safe(value: string, info: unknown): string;
}

/** 文本节点 handler：沿用默认转义，仅放行目录 / 警告框标记 */
function textHandler(
  node: unknown,
  parent: unknown,
  state: unknown,
  info: unknown
): string {
  const { value = '' } = node as { value?: string };
  const children = (parent as { children?: unknown[] } | undefined)?.children ?? [];
  const index = children.indexOf(node);
  const escaped = (state as TextStringifyState).safe(value, {
    ...(info as Record<string, unknown>),
    afterNode: children[index + 1],
    beforeNode: children[index - 1]
  });
  return escaped.replace(KEEP_BRACKETS, '[');
}

/** 在 Milkdown 配置阶段注入全部 stringify handler */
export function configureStringify(ctx: Ctx): void {
  ctx.update(remarkStringifyOptionsCtx, (prev) => ({
    ...prev,
    // 与 GitHub 等常见书写习惯保持一致，减少保存时的无意义改写
    bullet: '-',
    rule: '-',
    handlers: {
      ...prev.handlers,
      text: textHandler,
      underline: underlineHandler,
      yaml: yamlHandler
    }
  }) as typeof prev);
}

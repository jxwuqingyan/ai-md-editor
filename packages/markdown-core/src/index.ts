/**
 * Markdown 核心领域逻辑（纯函数，无 UI 依赖）。
 * 当前为 M0 占位：后续接入 remark 解析/序列化/大纲提取。
 */

/** 大纲条目：从标题 AST 提取 */
export interface OutlineItem {
  /** 标题层级 1-6 */
  level: number;
  /** 标题文本 */
  text: string;
  /** 在源文档中的行号（1 起） */
  line: number;
}

/**
 * 从 Markdown 源码提取大纲（标题列表）。
 * M0 阶段用简单的行匹配实现，后续替换为 remark AST 解析。
 *
 * @param source Markdown 源码
 * @returns 标题大纲列表
 */
export function extractOutline(source: string): OutlineItem[] {
  const lines = source.split('\n');
  const outline: OutlineItem[] = [];

  lines.forEach((line, index) => {
    // 匹配 ATX 标题（# 开头），忽略代码块内的情况（M0 简化处理）
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match) {
      outline.push({
        level: match[1].length,
        text: match[2].trim(),
        line: index + 1
      });
    }
  });

  return outline;
}

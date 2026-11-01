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
 * 逐行解析时跟踪围栏代码块状态（``` / ~~~），代码块内的 `#` 注释行（YAML/Shell 等配置常见）
 * 不计入大纲；同时去除标题中的行内 Markdown 标记，使文本与渲染后的标题 textContent 一致。
 *
 * @param source Markdown 源码
 * @returns 标题大纲列表
 */
export function extractOutline(source: string): OutlineItem[] {
  const lines = source.split('\n');
  const outline: OutlineItem[] = [];
  // 当前所处围栏代码块：null 表示不在代码块内；否则记录围栏字符与最小闭合长度
  let fenceChar: string | null = null;
  let fenceLen = 0;

  lines.forEach((line, index) => {
    // 围栏开/闭：``` 或 ~~~（闭合围栏长度需不小于开栏）
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fenceChar) {
        fenceChar = marker[0];
        fenceLen = marker.length;
      } else if (marker[0] === fenceChar && marker.length >= fenceLen) {
        fenceChar = null;
        fenceLen = 0;
      }
      return;
    }
    // 代码块内的行一律不算标题
    if (fenceChar) return;

    // 匹配 ATX 标题（# 开头），允许结尾的 # 装饰
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      // 去除行内 Markdown 标记（加粗/斜体/行内代码/链接保留文字），与 ProseMirror textContent 对齐
      const text = match[2]
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`~]/g, '')
        .trim();
      if (text) {
        outline.push({
          level: match[1].length,
          text,
          line: index + 1
        });
      }
    }
  });

  return outline;
}

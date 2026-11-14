/**
 * 纯文本偏移 ↔ ProseMirror 文档位置的映射。
 *
 * 查找功能用的是「整篇纯文本」的字符偏移（`doc.textContent` 把各文本节点直接拼接，
 * 不加任何分隔符），换算成文档位置时必须逐个文本节点累加。之前直接在一个
 * `descendants` 遍历里累加却把结果覆盖写，导致终点被后续段落反复改写，
 * 选区一下跨好几个块——就是「回车后出现一大片高亮」的原因。
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model';

/** 一个文本节点在纯文本里的区间 */
export interface TextSegment {
  /** 文本节点在文档中的位置（内容从这里开始） */
  pos: number;
  /** 该节点首字符在整篇纯文本里的偏移 */
  offset: number;
  /** 节点文本长度 */
  length: number;
}

/** 收集所有文本节点，按文档顺序累加偏移 */
export function collectTextSegments(doc: ProseNode): TextSegment[] {
  const segments: TextSegment[] = [];
  let offset = 0;
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const length = node.text?.length ?? 0;
    if (length === 0) return false;
    segments.push({ pos, offset, length });
    offset += length;
    return false;
  });
  return segments;
}

/**
 * 纯文本偏移 → 文档位置。
 *
 * @param preferEnd 为真时表示这是「区间的结束」，恰好落在节点边界上时取边界后的位置
 *                  （选区终点要用它，否则会少选最后一个字符）
 */
export function textOffsetToPos(
  segments: TextSegment[],
  offset: number,
  preferEnd = false
): number | null {
  if (segments.length === 0) return null;
  for (const segment of segments) {
    const end = segment.offset + segment.length;
    if (offset < end || (preferEnd && offset === end)) {
      const delta = Math.max(0, Math.min(segment.length, offset - segment.offset));
      return segment.pos + delta;
    }
  }
  // 偏移越界：落到最后一段文本末尾
  const last = segments[segments.length - 1];
  return last.pos + last.length;
}

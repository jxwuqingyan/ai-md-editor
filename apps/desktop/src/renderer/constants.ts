/**
 * 渲染层共用的小常量。
 *
 * 放在这里而不是从编辑器包导入，是为了避免入口 chunk 静态依赖整个编辑器：
 * 编辑器（Milkdown + Shiki + Mermaid + KaTeX）体积很大，改成动态加载后
 * 入口只保留类型引用，首屏启动明显更快。
 */
import type { TableContext } from '@ai-md-editor/editor';

/** 光标不在表格内 */
export const NO_TABLE_CONTEXT: TableContext = { inTable: false, inHeader: false };

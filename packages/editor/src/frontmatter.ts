/**
 * YAML Front Matter 支持（Typora「段落 → YAML Front Matter」）。
 *
 * CommonMark 不识别文件头的 `---` 区块，会把首尾两条分隔线当成分割线 / Setext 下划线，
 * 导致插入后再序列化时被改写成 `***` 与正文，属于内容损坏。这里补三件事：
 * 1. remark-frontmatter：解析阶段把文件头 YAML 区块识别为 `yaml` 节点；
 * 2. Milkdown node schema：渲染成只读代码块样式的区块，避免被当成普通段落；
 * 3. remark-stringify 自定义 handler：序列化回 `---` 包夹的原始 YAML。
 */
import { $nodeSchema, $remark } from '@milkdown/kit/utils';
import remarkFrontmatter from 'remark-frontmatter';

/** remark 插件：让解析器识别文件头 YAML 区块（必须传入 'yaml'，否则 remark-frontmatter 会因空配置报错） */
export const frontmatterRemark = $remark(
  'markdownNoteFrontmatter',
  () => remarkFrontmatter as unknown as (options?: string) => void,
  'yaml'
);

/** front matter 节点：内容为 YAML 原文，渲染为代码块样式的区块 */
export const frontmatterSchema = $nodeSchema('frontmatter', () => ({
  content: 'text*',
  group: 'block',
  defining: true,
  marks: '',
  parseDOM: [{ tag: 'pre[data-frontmatter]', preserveWhitespace: 'full' as const }],
  toDOM: () =>
    ['pre', { 'data-frontmatter': 'true', class: 'frontmatter-block' }, ['code', 0]] as const,
  parseMarkdown: {
    match: (node) => node.type === 'yaml',
    runner: (state, node, type) => {
      state.openNode(type);
      const value = typeof node.value === 'string' ? node.value : '';
      if (value) state.addText(value);
      state.closeNode();
    }
  },
  toMarkdown: {
    match: (node) => node.type.name === 'frontmatter',
    runner: (state, node) => {
      state.addNode('yaml', undefined, node.textContent);
    }
  }
}));

/** 把 `yaml` mdast 节点写成 `---` 包夹的原始文本 */
export function yamlHandler(node: unknown): string {
  const value = (node as { value?: string }).value ?? '';
  if (!value.trim()) return '---\n\n---';
  return `---\n${value}\n---`;
}

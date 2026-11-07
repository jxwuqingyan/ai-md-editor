/**
 * 代码高亮的 Shiki 初始化。
 *
 * 用 CSS 变量主题：token 颜色输出为 var(--s-token-xxx)，明暗切换只需改 CSS 变量，
 * 不必重建编辑器。语言按需加载，控制首屏体积。
 */
import { highlightPluginConfig } from '@milkdown/plugin-highlight';
import { createParser } from '@milkdown/plugin-highlight/shiki';
import { createCssVariablesTheme, getSingletonHighlighter } from 'shiki';

/** Shiki 支持的常用语言 */
const HIGHLIGHT_LANGS = [
  'javascript', 'typescript', 'jsx', 'tsx', 'json', 'html', 'css', 'scss',
  'python', 'go', 'rust', 'java', 'c', 'cpp', 'csharp', 'bash', 'shell',
  'sql', 'yaml', 'toml', 'markdown', 'docker', 'diff', 'xml', 'php',
  'ruby', 'swift', 'kotlin'
];

/** 创建 Shiki 解析器，供 highlightPluginConfig 使用（异步，因为高亮器按需加载） */
export async function createHighlightParser(): Promise<ReturnType<typeof createParser>> {
  const cssTheme = createCssVariablesTheme({
    name: 'markdown-note',
    variablePrefix: '--s-',
    variableDefaults: { foreground: '#24292e', background: '#f6f8fa' }
  });
  const highlighter = await getSingletonHighlighter({
    themes: [cssTheme],
    langs: HIGHLIGHT_LANGS
  });
  return createParser(highlighter);
}

/** 高亮插件配置键（Milkdown 配置项） */
export const highlightConfigKey = highlightPluginConfig.key;

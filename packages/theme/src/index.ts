/**
 * 主题系统核心：design tokens。
 * 落地 docs/UI-UX设计规范.md 第 3 节「视觉规范」。
 * 现代极简：中性界面 + 少量强调色，色彩花在内容上。
 */

/** 主题标识 */
export type ThemeId = 'light' | 'dark';

/** 单个主题的完整 token 集合 */
export interface ThemeTokens {
  /** 应用最外层背景（窗口 chrome 区） */
  bgApp: string;
  /** 面板/编辑区背景 */
  bgPanel: string;
  /** 次要背景（侧边栏 hover、代码块、选中态） */
  bgSubtle: string;
  /** 悬停反馈背景 */
  bgHover: string;
  /** 安静边框 */
  border: string;
  /** 更弱的分隔线 */
  borderSubtle: string;
  /** 正文（墨色） */
  textPrimary: string;
  /** 次要文字 */
  textSecondary: string;
  /** 辅助/占位符 */
  textTertiary: string;
  /** 强调色（选中、链接、焦点） */
  accent: string;
  /** 强调色浅底 */
  accentSubtle: string;
  /** 代码块语法高亮配色（Shiki CSS 变量主题的 token 颜色） */
  syntax: SyntaxTokens;
}

/** 代码块语法高亮 token 配色（Shiki 用 var(--s-*) 引用这些值） */
export interface SyntaxTokens {
  /** 代码默认前景色 */
  foreground: string;
  /** 代码块背景色 */
  background: string;
  /** 关键字（const/let/return/if...） */
  keyword: string;
  /** 字符串 */
  string: string;
  /** 注释 */
  comment: string;
  /** 函数名 */
  function: string;
  /** 常量/数字 */
  constant: string;
  /** 参数/变量 */
  parameter: string;
  /** 标点 */
  punctuation: string;
  /** 链接 */
  link: string;
  /** 字符串内插值表达式 */
  stringExpression: string;
  /** 新增行（diff） */
  inserted: string;
  /** 删除行（diff） */
  deleted: string;
  /** 变更行（diff） */
  changed: string;
}

/** 明亮主题（默认） */
export const lightTokens: ThemeTokens = {
  bgApp: '#fafafa',
  bgPanel: '#ffffff',
  bgSubtle: '#f5f5f5',
  bgHover: 'rgba(0, 0, 0, 0.045)',
  border: '#e5e5e5',
  borderSubtle: '#ededed',
  textPrimary: '#1a1a1a',
  textSecondary: '#666666',
  textTertiary: '#999999',
  accent: '#2563eb',
  accentSubtle: 'rgba(37, 99, 235, 0.1)',
  syntax: {
    foreground: '#24292e',
    background: '#f6f8fa',
    keyword: '#d73a49',
    string: '#032f62',
    comment: '#6a737d',
    function: '#6f42c1',
    constant: '#005cc5',
    parameter: '#24292e',
    punctuation: '#24292e',
    link: '#032f62',
    stringExpression: '#032f62',
    inserted: '#22863a',
    deleted: '#b31d28',
    changed: '#e36209'
  }
};

/** 深色主题（值反转，强调色略调亮保证对比度） */
export const darkTokens: ThemeTokens = {
  bgApp: '#111111',
  bgPanel: '#1a1a1a',
  bgSubtle: '#222222',
  bgHover: 'rgba(255, 255, 255, 0.06)',
  border: '#2a2a2a',
  borderSubtle: '#252525',
  textPrimary: '#e5e5e5',
  textSecondary: '#9a9a9a',
  textTertiary: '#666666',
  accent: '#3b82f6',
  accentSubtle: 'rgba(59, 130, 246, 0.14)',
  syntax: {
    foreground: '#e1e4e8',
    background: '#161b22',
    keyword: '#ff7b72',
    string: '#a5d6ff',
    comment: '#8b949e',
    function: '#d2a8ff',
    constant: '#79c0ff',
    parameter: '#e1e4e8',
    punctuation: '#e1e4e8',
    link: '#a5d6ff',
    stringExpression: '#a5d6ff',
    inserted: '#3fb950',
    deleted: '#ffa198',
    changed: '#d29922'
  }
};

/** 主题注册表 */
export const themes: Record<ThemeId, ThemeTokens> = {
  light: lightTokens,
  dark: darkTokens
};

/**
 * 将 ThemeTokens 转为 CSS 变量对象（key 加 `--` 前缀）。
 * 供 React 通过 style 对象注入，或序列化为 CSS 字符串。
 */
export function tokensToCssVars(tokens: ThemeTokens): Record<string, string> {
  const map: Record<string, string> = {
    '--bg-app': tokens.bgApp,
    '--bg-panel': tokens.bgPanel,
    '--bg-subtle': tokens.bgSubtle,
    '--bg-hover': tokens.bgHover,
    '--border': tokens.border,
    '--border-subtle': tokens.borderSubtle,
    '--text-primary': tokens.textPrimary,
    '--text-secondary': tokens.textSecondary,
    '--text-tertiary': tokens.textTertiary,
    '--accent': tokens.accent,
    '--accent-subtle': tokens.accentSubtle,
    // 代码块语法高亮（Shiki CSS 变量主题引用 --s-*）
    '--s-foreground': tokens.syntax.foreground,
    '--s-background': tokens.syntax.background,
    '--s-token-keyword': tokens.syntax.keyword,
    '--s-token-string': tokens.syntax.string,
    '--s-token-comment': tokens.syntax.comment,
    '--s-token-function': tokens.syntax.function,
    '--s-token-constant': tokens.syntax.constant,
    '--s-token-parameter': tokens.syntax.parameter,
    '--s-token-punctuation': tokens.syntax.punctuation,
    '--s-token-link': tokens.syntax.link,
    '--s-token-string-expression': tokens.syntax.stringExpression,
    '--s-token-inserted': tokens.syntax.inserted,
    '--s-token-deleted': tokens.syntax.deleted,
    '--s-token-changed': tokens.syntax.changed
  };
  return map;
}

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
  accentSubtle: 'rgba(37, 99, 235, 0.1)'
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
  accentSubtle: 'rgba(59, 130, 246, 0.14)'
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
    '--accent-subtle': tokens.accentSubtle
  };
  return map;
}

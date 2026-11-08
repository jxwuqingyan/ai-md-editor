import type { ThemeId } from '@ai-md-editor/theme';

/** 标签栏右侧动作区属性 */
interface TopbarActionsProps {
  /** 当前主题 */
  themeId: ThemeId;
  /** 切换主题 */
  onThemeChange: (themeId: ThemeId) => void;
  /** 侧栏是否展开 */
  sidebarOpen: boolean;
  /** 展开/收起侧栏 */
  onToggleSidebar: () => void;
}

/** 主题图标：半圆表达明暗，不依赖平台 Emoji */
function ThemeIcon(): JSX.Element {
  return (
    <svg className="tabbar-action-icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor" />
    </svg>
  );
}

/** 侧栏图标：方框 + 竖直分隔线 */
function SidebarIcon({ open }: { open: boolean }): JSX.Element {
  return (
    <svg className="tabbar-action-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2.5" y="3" width="15" height="14" rx="2" />
      <path d="M8 3v14" />
      {!open && <path d="m12 7 2 3-2 3" />}
    </svg>
  );
}

/**
 * 标签栏右侧动作区。
 * 主题按钮单击即在浅色/深色之间直接切换（不做下拉选择），侧栏开关固定在右上角。
 */
export default function TopbarActions({
  themeId,
  onThemeChange,
  sidebarOpen,
  onToggleSidebar
}: TopbarActionsProps): JSX.Element {
  /** 单击主题按钮：切到另一个主题 */
  const toggleTheme = (): void => {
    onThemeChange(themeId === 'dark' ? 'light' : 'dark');
  };

  return (
    <div className="tabbar-actions">
      <button
        className="icon-btn icon-btn-icon"
        title={themeId === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
        aria-label={themeId === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
        onClick={toggleTheme}
      >
        <ThemeIcon />
      </button>
      <button
        className="icon-btn icon-btn-icon"
        title={sidebarOpen ? '收起侧栏' : '展开侧栏'}
        aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'}
        aria-pressed={!sidebarOpen}
        onClick={onToggleSidebar}
      >
        <SidebarIcon open={sidebarOpen} />
      </button>
    </div>
  );
}

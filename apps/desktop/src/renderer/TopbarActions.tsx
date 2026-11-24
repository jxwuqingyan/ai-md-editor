import type { ThemeMode } from '@ai-md-editor/shared';
import type { ThemeId } from '@ai-md-editor/theme';

/** 标签栏右侧动作区属性 */
interface TopbarActionsProps {
  /** 当前主题模式（浅色 / 深色 / 跟随系统） */
  themeMode: ThemeMode;
  /** 实际生效的主题（用于提示当前真实明暗） */
  themeId: ThemeId;
  /** 切换主题模式 */
  onThemeModeChange: (mode: ThemeMode) => void;
  /** 侧栏是否展开 */
  sidebarOpen: boolean;
  /** 展开/收起侧栏 */
  onToggleSidebar: () => void;
}

/** 点击时的循环顺序：浅色 → 深色 → 跟随系统 */
const NEXT_MODE: Record<ThemeMode, ThemeMode> = {
  light: 'dark',
  dark: 'system',
  system: 'light'
};

/** 主题模式名称 */
const MODE_LABEL: Record<ThemeMode, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统'
};

/** 主题图标：半圆表达明暗，跟随系统时加一条中线区分 */
function ThemeIcon({ mode }: { mode: ThemeMode }): JSX.Element {
  if (mode === 'dark') {
    return (
      <svg className="tabbar-action-icon" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="7" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className="tabbar-action-icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 3a7 7 0 0 1 0 14z" fill="currentColor" />
      {mode === 'system' && <path d="M3 10h14" stroke="currentColor" strokeWidth="1.5" />}
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
 * 主题按钮单击在「浅色 → 深色 → 跟随系统」之间循环，侧栏开关固定在右上角。
 */
export default function TopbarActions({
  themeMode,
  themeId,
  onThemeModeChange,
  sidebarOpen,
  onToggleSidebar
}: TopbarActionsProps): JSX.Element {
  const next = NEXT_MODE[themeMode];
  const current = themeMode === 'system' ? `跟随系统（当前${MODE_LABEL[themeId]}）` : MODE_LABEL[themeMode];
  const hint = `主题：${current}，点击切换到${MODE_LABEL[next]}`;

  return (
    <div className="tabbar-actions">
      <button
        className="icon-btn icon-btn-icon"
        title={hint}
        aria-label={hint}
        onClick={() => onThemeModeChange(next)}
      >
        <ThemeIcon mode={themeMode} />
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

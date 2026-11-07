import { useEffect, useRef, useState } from 'react';
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
 * 主题选择合并为单个按钮 + 下拉，侧栏开关固定在右上角；不再额外占用一行顶栏。
 */
export default function TopbarActions({
  themeId,
  onThemeChange,
  sidebarOpen,
  onToggleSidebar
}: TopbarActionsProps): JSX.Element {
  const [themeOpen, setThemeOpen] = useState(false);
  const themeRef = useRef<HTMLDivElement>(null);

  // 点击外部或按 Esc 关闭主题菜单
  useEffect(() => {
    if (!themeOpen) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (themeRef.current && !themeRef.current.contains(event.target as Node)) {
        setThemeOpen(false);
      }
    };
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setThemeOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeydown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeydown);
    };
  }, [themeOpen]);

  /** 选择主题后关闭菜单 */
  const selectTheme = (id: ThemeId): void => {
    onThemeChange(id);
    setThemeOpen(false);
  };

  return (
    <div className="tabbar-actions">
      <div className="theme-wrap" ref={themeRef}>
        <button
          className="icon-btn icon-btn-icon"
          title="主题"
          aria-label="选择主题"
          aria-haspopup="menu"
          aria-expanded={themeOpen}
          onClick={() => setThemeOpen((v) => !v)}
        >
          <ThemeIcon />
        </button>
        {themeOpen && (
          <div className="theme-menu" role="menu">
            <button
              className={`theme-option ${themeId === 'light' ? 'theme-option-active' : ''}`}
              role="menuitemradio"
              aria-checked={themeId === 'light'}
              onClick={() => selectTheme('light')}
            >
              <span className="theme-dot theme-dot-light" />
              浅色
              {themeId === 'light' && <span className="theme-check">✓</span>}
            </button>
            <button
              className={`theme-option ${themeId === 'dark' ? 'theme-option-active' : ''}`}
              role="menuitemradio"
              aria-checked={themeId === 'dark'}
              onClick={() => selectTheme('dark')}
            >
              <span className="theme-dot theme-dot-dark" />
              深色
              {themeId === 'dark' && <span className="theme-check">✓</span>}
            </button>
          </div>
        )}
      </div>
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

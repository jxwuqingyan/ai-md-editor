import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Tab } from './types';

// 兼容既有引用：Tab 类型已移到 types.ts
export type { Tab };

/** 标签右键菜单可执行的动作 */
export type TabContextAction =
  | 'close'
  | 'closeOthers'
  | 'closeLeft'
  | 'closeRight'
  | 'copyPath'
  | 'copyName'
  | 'reveal';

/** Tabs 组件的属性 */
interface TabsProps {
  /** 所有标签 */
  tabs: Tab[];
  /** 当前活动标签 id */
  activeId: string;
  /** 切换标签回调 */
  onSelect: (id: string) => void;
  /** 关闭标签回调 */
  onClose: (id: string) => void;
  /** 双击标签重命名回调（无路径标签由调用方决定是另存为还是提示） */
  onRename?: (id: string) => void;
  /** 新建标签回调 */
  onNew: () => void;
  /** 右键菜单动作回调 */
  onContextAction?: (id: string, action: TabContextAction) => void;
  /** 固定在标签栏右侧的动作区 */
  actions?: ReactNode;
}

/** 取路径的父目录名（用于同名标签的副标题） */
function parentDirName(targetPath: string): string {
  const parts = targetPath.split(/[\\/]/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

/** 右键菜单状态 */
interface TabMenuState {
  /** 目标标签 id */
  id: string;
  /** 视口坐标 */
  x: number;
  y: number;
}

/** 菜单项 */
interface MenuEntry {
  label: string;
  action: TabContextAction;
  disabled?: boolean;
  /** 前置分隔线 */
  separatorBefore?: boolean;
  shortcut?: string;
}

/**
 * 标签栏组件。
 * 展示打开的文档标签，支持切换、关闭、新建、右键批量操作。
 * 贴合设计规范：细线分隔、活动态中性高亮、dirty 用圆点标记。
 * 存在同名标签时，给有路径的标签加父目录副标题（如 notes.md · docs/）以作区分。
 */
export default function Tabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  onRename,
  onContextAction,
  actions
}: TabsProps): JSX.Element {
  // 同名标签计数：只给重名的加副标题，无同名时保持界面干净
  const nameCounts = new Map<string, number>();
  const normalizeName = (name: string): string => name.normalize('NFC').toLowerCase();
  tabs.forEach((tab) => {
    const key = normalizeName(tab.name);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  });

  const [menu, setMenu] = useState<TabMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点空白 / Esc / 滚动 / 窗口失焦都关掉菜单，避免残留在界面上
  useEffect(() => {
    if (!menu) return;
    const close = (event: Event): void => {
      if (event.type === 'mousedown' && menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', close, true);
    document.addEventListener('scroll', close, true);
    window.addEventListener('blur', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close, true);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('blur', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // 右键菜单关闭后把焦点还回去，避免 Esc 之后按键失去落点
  const runAction = (action: TabContextAction): void => {
    if (!menu) return;
    const id = menu.id;
    setMenu(null);
    onContextAction?.(id, action);
  };

  const menuTab = menu ? tabs.find((tab) => tab.id === menu.id) ?? null : null;
  const menuIndex = menuTab ? tabs.findIndex((tab) => tab.id === menuTab.id) : -1;
  const entries: MenuEntry[] = menuTab
    ? [
        { label: '关闭', action: 'close', shortcut: '⌘W' },
        { label: '关闭其他标签', action: 'closeOthers', disabled: tabs.length <= 1 },
        { label: '关闭左侧标签', action: 'closeLeft', disabled: menuIndex <= 0 },
        { label: '关闭右侧标签', action: 'closeRight', disabled: menuIndex >= tabs.length - 1 },
        { label: '复制文件路径', action: 'copyPath', disabled: !menuTab.path, separatorBefore: true },
        { label: '复制文件名', action: 'copyName' },
        { label: '在文件管理器中显示', action: 'reveal', disabled: !menuTab.path }
      ]
    : [];

  return (
    <div className="tabbar">
      <div className="tab-scroll">
        {tabs.map((tab) => {
          const duplicated = (nameCounts.get(normalizeName(tab.name)) ?? 0) > 1;
          const dirLabel = duplicated && tab.path ? parentDirName(tab.path) : '';
          return (
            <div
              key={tab.id}
              className={`tab ${tab.id === activeId ? 'tab-active' : ''}`}
              onClick={() => onSelect(tab.id)}
              onDoubleClick={() => onRename?.(tab.id)}
              onContextMenu={(event) => {
                if (!onContextAction) return;
                event.preventDefault();
                // 选中被右键的标签，菜单里的「关闭其他」等操作才有明确主体
                if (tab.id !== activeId) onSelect(tab.id);
                setMenu({ id: tab.id, x: event.clientX, y: event.clientY });
              }}
              onAuxClick={(event) => {
                // 中键关闭，与常见编辑器一致
                if (event.button === 1) onClose(tab.id);
              }}
              title={`${tab.path ?? '未命名文档'}（双击可重命名）`}
            >
              <span className="tab-name">{tab.name}</span>
              {dirLabel !== '' && <span className="tab-dir">{dirLabel}/</span>}
              {tab.dirty && <span className="tab-dirty" aria-label="未保存">•</span>}
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                title="关闭标签"
              >
                ×
              </button>
            </div>
          );
        })}
        <button className="tab-new" onClick={onNew} title="新建标签">
          +
        </button>
      </div>
      {actions}

      {menu && entries.length > 0 && (
        <div
          ref={menuRef}
          className="tab-context-menu"
          role="menu"
          style={{
            // 贴边时向内收，避免菜单被视口裁掉
            left: Math.min(menu.x, Math.max(8, window.innerWidth - 208)),
            top: Math.min(menu.y, Math.max(8, window.innerHeight - 268))
          }}
        >
          {entries.map((entry) => (
            <button
              key={entry.action}
              type="button"
              role="menuitem"
              className={`tab-context-item ${entry.separatorBefore ? 'tab-context-sep' : ''}`}
              disabled={entry.disabled}
              onClick={() => runAction(entry.action)}
            >
              <span>{entry.label}</span>
              {entry.shortcut && <span className="tab-context-shortcut">{entry.shortcut}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

import type { ReactNode } from 'react';
import type { Tab } from './types';

// 兼容既有引用：Tab 类型已移到 types.ts
export type { Tab };

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
  /** 固定在标签栏右侧的动作区 */
  actions?: ReactNode;
}

/** 取路径的父目录名（用于同名标签的副标题） */
function parentDirName(targetPath: string): string {
  const parts = targetPath.split(/[\\/]/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

/**
 * 标签栏组件。
 * 展示打开的文档标签，支持切换、关闭、新建。
 * 贴合设计规范：细线分隔、活动态中性高亮、dirty 用圆点标记。
 * 存在同名标签时，给有路径的标签加父目录副标题（如 notes.md · docs/）以作区分。
 */
export default function Tabs({ tabs, activeId, onSelect, onClose, onNew, onRename, actions }: TabsProps): JSX.Element {
  // 同名标签计数：只给重名的加副标题，无同名时保持界面干净
  const nameCounts = new Map<string, number>();
  const normalizeName = (name: string): string => name.normalize('NFC').toLowerCase();
  tabs.forEach((tab) => {
    const key = normalizeName(tab.name);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  });

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
    </div>
  );
}

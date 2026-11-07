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
  /** 新建标签回调 */
  onNew: () => void;
  /** 固定在标签栏右侧的动作区 */
  actions?: ReactNode;
}

/**
 * 标签栏组件。
 * 展示打开的文档标签，支持切换、关闭、新建。
 * 贴合设计规范：细线分隔、活动态中性高亮、dirty 用圆点标记。
 */
export default function Tabs({ tabs, activeId, onSelect, onClose, onNew, actions }: TabsProps): JSX.Element {
  return (
    <div className="tabbar">
      <div className="tab-scroll">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeId ? 'tab-active' : ''}`}
            onClick={() => onSelect(tab.id)}
            title={tab.path ?? '未命名文档'}
          >
            <span className="tab-name">{tab.name}</span>
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
        ))}
        <button className="tab-new" onClick={onNew} title="新建标签">
          +
        </button>
      </div>
      {actions}
    </div>
  );
}

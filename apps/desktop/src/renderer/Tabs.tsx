/** 单个标签的数据模型 */
export interface Tab {
  /** 唯一标识 */
  id: string;
  /** 文件绝对路径（未保存的新文档为 null） */
  path: string | null;
  /** 标签显示名（文件名） */
  name: string;
  /** 当前内容（与编辑器同步） */
  content: string;
  /** 是否有未保存修改 */
  dirty: boolean;
}

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
}

/**
 * 标签栏组件。
 * 展示打开的文档标签，支持切换、关闭、新建。
 * 贴合设计规范：细线分隔、活动态中性高亮、dirty 用圆点标记。
 */
export default function Tabs({ tabs, activeId, onSelect, onClose, onNew }: TabsProps): JSX.Element {
  return (
    <div className="tabbar">
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
  );
}

/**
 * 左侧边栏：文件树 / 大纲两个面板。
 * 从 App.tsx 拆出，保持根组件只做状态编排与布局组合。
 */
import type { OutlineItem } from '@ai-md-editor/markdown-core';
import FileTree from './FileTree';

/** 侧栏属性 */
interface SidebarProps {
  /** 侧栏是否展开 */
  open: boolean;
  /** 当前面板 */
  panel: 'files' | 'outline';
  /** 切换面板 */
  onPanelChange: (panel: 'files' | 'outline') => void;
  /** 文档大纲 */
  outline: OutlineItem[];
  /** 点击大纲项跳转 */
  onOutlineClick: (line: number, index: number) => void;
  /** 文件树根目录 */
  treeRoot: string | null;
  /** 当前活动文件路径（高亮） */
  activePath: string | null;
  /** 打开文件树中的文件 */
  onOpenFile: (path: string, name: string) => void;
  /** 选择文件夹 */
  onChooseFolder: () => void;
}

/** 左侧边栏 */
export default function Sidebar({
  open,
  panel,
  onPanelChange,
  outline,
  onOutlineClick,
  treeRoot,
  activePath,
  onOpenFile,
  onChooseFolder
}: SidebarProps): JSX.Element {
  return (
    <aside className={`sidebar ${open ? 'sidebar-open' : 'sidebar-collapsed'}`}>
      {open ? (
        <>
          <div className="sidebar-tabs">
            <button
              className={`sidebar-tab ${panel === 'files' ? 'sidebar-tab-active' : ''}`}
              onClick={() => onPanelChange('files')}
            >
              文件
            </button>
            <button
              className={`sidebar-tab ${panel === 'outline' ? 'sidebar-tab-active' : ''}`}
              onClick={() => onPanelChange('outline')}
            >
              大纲
            </button>
          </div>
          {panel === 'files' ? (
            <FileTree
              rootDir={treeRoot}
              activePath={activePath}
              onOpenFile={onOpenFile}
              onChooseFolder={onChooseFolder}
            />
          ) : (
            <div className="outline-list">
              {outline.length === 0 ? (
                <div className="outline-empty">暂无标题</div>
              ) : (
                outline.map((item) => (
                  <div
                    key={`${item.line}-${item.index}`}
                    className="outline-item"
                    style={{ paddingLeft: 16 + (item.level - 1) * 14 }}
                    onClick={() => onOutlineClick(item.line, item.index)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onOutlineClick(item.line, item.index);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    title={`跳转到「${item.text}」`}
                  >
                    {item.text}
                  </div>
                ))
              )}
            </div>
          )}
        </>
      ) : null}
    </aside>
  );
}

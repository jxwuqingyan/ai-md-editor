/**
 * 左侧边栏：文件树 / 大纲 / 搜索三个面板。
 * 从 App.tsx 拆出，保持根组件只做状态编排与布局组合。
 */
import { useState } from 'react';
import type { OutlineItem } from '@ai-md-editor/markdown-core';
import FileTree from './FileTree';
import SidebarSearch from './SidebarSearch';

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
  /** 在目录里新建文件（⋮ 菜单） */
  onCreateFile: () => void;
  /** 重命名当前活动文件（⋮ 菜单） */
  onRenameFile: () => void;
  /** 在文件管理器中显示当前目录（⋮ 菜单） */
  onRevealFolder: () => void;
  /** 刷新文件树（⋮ 菜单） */
  onRefresh: () => void;
  /** 刷新信号：数值变化时重新加载根目录 */
  refreshToken: number;
  /** 点击搜索结果：打开文件并跳到匹配行（rawColumn 为原始行列号） */
  onOpenMatch: (
    path: string,
    name: string,
    line: number,
    column: number,
    length: number,
    text: string,
    rawColumn: number
  ) => void;
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
  onChooseFolder,
  onCreateFile,
  onRenameFile,
  onRevealFolder,
  onRefresh,
  refreshToken,
  onOpenMatch
}: SidebarProps): JSX.Element {
  // 搜索面板开关（tab 行搜索图标 / ⋮ 菜单「搜索」都会打开）
  const [searchOpen, setSearchOpen] = useState(false);

  const toggleSearch = (): void => setSearchOpen((v) => !v);

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
            <div className="sidebar-tabs-spacer" />
            <button
              type="button"
              className={`sidebar-search-btn ${searchOpen ? 'sidebar-search-btn-active' : ''}`}
              aria-label="搜索文件夹内容"
              title="搜索"
              aria-pressed={searchOpen}
              onClick={toggleSearch}
            >
              <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <circle cx="9" cy="9" r="5.5" />
                <path d="m13.5 13.5 3.5 3.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {searchOpen ? (
            <SidebarSearch rootDir={treeRoot} onOpenMatch={onOpenMatch} onClose={() => setSearchOpen(false)} />
          ) : panel === 'files' ? (
            <FileTree
              rootDir={treeRoot}
              activePath={activePath}
              onOpenFile={onOpenFile}
              onChooseFolder={onChooseFolder}
              onCreateFile={onCreateFile}
              onRenameFile={onRenameFile}
              onRevealFolder={onRevealFolder}
              onOpenSearch={() => setSearchOpen(true)}
              onRefresh={onRefresh}
              refreshToken={refreshToken}
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

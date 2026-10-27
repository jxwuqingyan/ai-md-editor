import { useEffect, useRef, useState } from 'react';
import type { RecentFile } from '@ai-md-editor/shared';

/** RecentFiles 组件属性 */
interface RecentFilesProps {
  /** 选择某个最近文件时回调 */
  onSelect: (file: RecentFile) => void;
}

/**
 * 最近文件下拉菜单。
 * 点击「最近」按钮展开列表，点击某项打开对应文件，点击外部关闭。
 */
export default function RecentFiles({ onSelect }: RecentFilesProps): JSX.Element {
  // 最近文件列表
  const [recent, setRecent] = useState<RecentFile[]>([]);
  // 下拉是否展开
  const [open, setOpen] = useState(false);
  // 容器 ref，用于点击外部关闭
  const containerRef = useRef<HTMLDivElement>(null);

  // 加载最近文件列表
  const loadRecent = async (): Promise<void> => {
    const list = await window.api.getRecent();
    setRecent(list);
  };

  // 挂载时加载
  useEffect(() => {
    void loadRecent();
  }, []);

  // 每次展开时刷新列表
  const handleToggle = (): void => {
    if (!open) {
      void loadRecent();
    }
    setOpen((v) => !v);
  };

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  // 选择某个文件
  const handleSelect = (file: RecentFile): void => {
    setOpen(false);
    onSelect(file);
  };

  return (
    <div className="recent-wrap" ref={containerRef}>
      <button className="icon-btn" onClick={handleToggle} title="最近文件">
        最近
      </button>
      {open && (
        <div className="recent-menu">
          {recent.length === 0 ? (
            <div className="recent-empty">暂无最近文件</div>
          ) : (
            recent.map((file) => (
              <div key={file.path} className="recent-item" onClick={() => handleSelect(file)} title={file.path}>
                <span className="recent-name">{file.name}</span>
                <span className="recent-path">{file.path}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

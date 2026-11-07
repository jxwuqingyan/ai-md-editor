import { useCallback, useEffect, useState } from 'react';
import type { FsEntry } from '@ai-md-editor/shared';

/** 文件树组件的属性 */
interface FileTreeProps {
  /** 当前文件树根目录（null = 未打开） */
  rootDir: string | null;
  /** 当前活动文件的绝对路径（高亮用） */
  activePath: string | null;
  /** 点击 Markdown 文件打开 */
  onOpenFile: (path: string, name: string) => void;
  /** 请求选择文件夹（弹出系统对话框） */
  onChooseFolder: () => void;
}

/** 树节点：目录条目 + 展开状态 + 已加载子项 */
interface DirNode {
  entry: FsEntry;
  expanded: boolean;
  children: FsEntry[];
}

/**
 * 文件树组件（左侧文件管理器）。
 * - 显示当前打开文档所在目录的子目录与 Markdown 文件
 * - 目录可展开/折叠（懒加载子级）
 * - 点击文件触发打开
 * - 顶部有「打开文件夹」入口与当前目录名
 */
export default function FileTree({
  rootDir,
  activePath,
  onOpenFile,
  onChooseFolder
}: FileTreeProps): JSX.Element {
  // 已展开目录的状态表（path → 节点信息），刷新用计数器驱动
  const [dirs, setDirs] = useState<Map<string, DirNode>>(new Map());

  /** 展开目录：读取其子项 */
  const expandDir = useCallback(
    async (path: string) => {
      const result = await window.api.readDir(path);
      if (!result.ok) return;
      setDirs((prev) => {
        const next = new Map(prev);
        const node = next.get(path);
        next.set(path, {
          entry: node?.entry ?? { name: path.split('/').pop() ?? path, path, kind: 'dir' },
          expanded: true,
          children: result.entries
        });
        return next;
      });
    },
    []
  );

  /** 折叠目录 */
  const collapseDir = useCallback((path: string) => {
    setDirs((prev) => {
      const next = new Map(prev);
      const node = next.get(path);
      if (node) next.set(path, { ...node, expanded: false });
      return next;
    });
  }, []);

  // 根目录变化时：清空状态并自动展开根目录
  useEffect(() => {
    setDirs(new Map());
    if (rootDir) {
      void expandDir(rootDir);
    }
  }, [rootDir, expandDir]);

  /**
   * 自动定位当前文档：逐级展开父目录，并把高亮项滚动到可见区域。
   * 「显示 → 在文件树中显示」和普通打开文件都走这条路径。
   */
  useEffect(() => {
    if (!activePath || !rootDir) return;
    const normalizedRoot = rootDir.replace(/\\/g, '/').replace(/\/$/, '');
    const normalizedPath = activePath.replace(/\\/g, '/');
    if (!normalizedPath.startsWith(normalizedRoot)) return;

    const relative = normalizedPath.slice(normalizedRoot.length).replace(/^\//, '');
    const segments = relative.split('/');
    segments.pop(); // 最后一段是文件名，不需要展开
    if (segments.length === 0) return;

    void (async () => {
      let current = normalizedRoot;
      for (const segment of segments) {
        current = `${current}/${segment}`;
        await expandDir(current);
      }
      requestAnimationFrame(() => {
        const active = document.querySelector('.tree-file-active');
        active?.scrollIntoView({ block: 'nearest' });
      });
    })();
  }, [activePath, rootDir, expandDir]);

  /** 渲染一个条目（目录或文件） */
  const renderEntry = (entry: FsEntry, depth: number): JSX.Element => {
    const indent = 12 + depth * 14;
    if (entry.kind === 'dir') {
      const node = dirs.get(entry.path);
      const expanded = node?.expanded ?? false;
      return (
        <div key={entry.path}>
          <div
            className="tree-item tree-dir"
            style={{ paddingLeft: indent }}
            onClick={() => (expanded ? collapseDir(entry.path) : void expandDir(entry.path))}
            role="button"
            tabIndex={0}
          >
            <span className="tree-caret">{expanded ? '▾' : '▸'}</span>
            <span className="tree-name">{entry.name}</span>
          </div>
          {expanded &&
            node?.children.map((child) => renderEntry(child, depth + 1))}
        </div>
      );
    }
    return (
      <div
        key={entry.path}
        className={`tree-item tree-file ${entry.path === activePath ? 'tree-file-active' : ''}`}
        style={{ paddingLeft: indent + 16 }}
        onClick={() => onOpenFile(entry.path, entry.name)}
        role="button"
        tabIndex={0}
        title={entry.path}
      >
        <span className="tree-name">{entry.name}</span>
      </div>
    );
  };

  if (!rootDir) {
    return (
      <div className="filetree">
        <button className="filetree-open-btn" onClick={onChooseFolder} title="打开文件夹">
          打开文件夹
        </button>
        <div className="filetree-empty">打开文件夹以浏览文件</div>
      </div>
    );
  }

  const rootName = rootDir.split(/[\\/]/).pop() ?? rootDir;

  return (
    <div className="filetree">
      <button className="filetree-open-btn" onClick={onChooseFolder} title="切换文件夹">
        {rootName}
      </button>
      {dirs.get(rootDir)?.children.map((child) => renderEntry(child, 0))}
    </div>
  );
}

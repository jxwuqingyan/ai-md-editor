import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
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
 *
 * 无障碍：每个条目都是真正的 <button>（Enter/Space 天然可用），
 * 容器统一处理方向键导航，键盘用户可以完整浏览整棵树。
 */
export default function FileTree({
  rootDir,
  activePath,
  onOpenFile,
  onChooseFolder
}: FileTreeProps): JSX.Element {
  // 已展开目录的状态表（path → 节点信息），刷新用计数器驱动
  const [dirs, setDirs] = useState<Map<string, DirNode>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

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

  /**
   * 方向键导航：在可见条目之间移动焦点。
   * - ↑/↓：前后一项；Home/End：首尾
   * - →：展开目录（已展开则进入第一个子项）
   * - ←：折叠目录（已折叠则回到父目录）
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const keys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const root = containerRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLButtonElement>('.tree-item'));
    const current = document.activeElement as HTMLButtonElement | null;
    const index = current ? items.indexOf(current) : -1;
    if (index < 0) return;
    event.preventDefault();

    if (event.key === 'ArrowDown') {
      items[Math.min(items.length - 1, index + 1)]?.focus();
      return;
    }
    if (event.key === 'ArrowUp') {
      items[Math.max(0, index - 1)]?.focus();
      return;
    }
    if (event.key === 'Home') {
      items[0]?.focus();
      return;
    }
    if (event.key === 'End') {
      items[items.length - 1]?.focus();
      return;
    }

    const isDir = current?.classList.contains('tree-dir') ?? false;
    const expanded = current?.getAttribute('aria-expanded') === 'true';
    if (event.key === 'ArrowRight') {
      if (isDir && !expanded) current?.click();
      else items[index + 1]?.focus();
      return;
    }
    // ArrowLeft
    if (isDir && expanded) {
      current?.click();
      return;
    }
    const depth = Number(current?.dataset['depth'] ?? '0');
    for (let i = index - 1; i >= 0; i -= 1) {
      if (Number(items[i].dataset['depth'] ?? '0') < depth) {
        items[i].focus();
        return;
      }
    }
  };

  /** 渲染一个条目（目录或文件） */
  const renderEntry = (entry: FsEntry, depth: number): JSX.Element => {
    const indent = 12 + depth * 14;
    if (entry.kind === 'dir') {
      const node = dirs.get(entry.path);
      const expanded = node?.expanded ?? false;
      return (
        <div key={entry.path}>
          <button
            type="button"
            className="tree-item tree-dir"
            style={{ paddingLeft: indent }}
            data-depth={depth}
            aria-expanded={expanded}
            onClick={() => (expanded ? collapseDir(entry.path) : void expandDir(entry.path))}
          >
            <span className="tree-caret">{expanded ? '▾' : '▸'}</span>
            <span className="tree-name">{entry.name}</span>
          </button>
          {expanded && node?.children.map((child) => renderEntry(child, depth + 1))}
        </div>
      );
    }
    return (
      <button
        type="button"
        key={entry.path}
        className={`tree-item tree-file ${entry.path === activePath ? 'tree-file-active' : ''}`}
        style={{ paddingLeft: indent + 16 }}
        data-depth={depth}
        onClick={() => onOpenFile(entry.path, entry.name)}
        title={entry.path}
      >
        <span className="tree-name">{entry.name}</span>
      </button>
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
    <div className="filetree" ref={containerRef} onKeyDown={handleKeyDown} role="tree">
      <button className="filetree-open-btn" onClick={onChooseFolder} title="切换文件夹">
        {rootName}
      </button>
      {dirs.get(rootDir)?.children.map((child) => renderEntry(child, 0))}
    </div>
  );
}

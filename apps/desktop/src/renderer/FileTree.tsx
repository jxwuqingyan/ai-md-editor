import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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
  /** 在目录里新建文件（⋮ 菜单） */
  onCreateFile: () => void;
  /** 重命名当前活动文件（⋮ 菜单，无路径时置灰） */
  onRenameFile: () => void;
  /** 在文件管理器中显示当前目录（⋮ 菜单） */
  onRevealFolder: () => void;
  /** 打开侧栏搜索面板（⋮ 菜单） */
  onOpenSearch: () => void;
  /** 刷新文件树（⋮ 菜单） */
  onRefresh: () => void;
  /** 刷新信号：数值变化时重新加载根目录（⋮ 菜单「刷新」用） */
  refreshToken: number;
}

/** 树节点：目录条目 + 展开状态 + 已加载子项 */
interface DirNode {
  entry: FsEntry;
  expanded: boolean;
  children: FsEntry[];
}

/** Windows 显示「资源管理器」，macOS 显示「Finder」 */
function isWindows(): boolean {
  return typeof navigator !== 'undefined' && /Win/i.test(navigator.platform);
}

/**
 * 文件树组件（左侧文件管理器）。
 * - 显示当前打开文档所在目录的子目录与 Markdown 文件
 * - 目录可展开/折叠（懒加载子级）
 * - 点击文件触发打开
 * - 底部固定「打开文件夹」按钮 + ⋮ 操作菜单（新建文件/搜索/显示/打开/刷新）
 *
 * 无障碍：每个条目都是真正的 <button>（Enter/Space 天然可用），
 * 容器统一处理方向键导航，键盘用户可以完整浏览整棵树。
 */
export default function FileTree({
  rootDir,
  activePath,
  onOpenFile,
  onChooseFolder,
  onCreateFile,
  onRenameFile,
  onRevealFolder,
  onOpenSearch,
  onRefresh,
  refreshToken
}: FileTreeProps): JSX.Element {
  // 已展开目录的状态表（path → 节点信息），刷新用计数器驱动
  const [dirs, setDirs] = useState<Map<string, DirNode>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  // ⋮ 菜单开关
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // 已展开目录的镜像：刷新时按它逐个重读，effect 不必依赖整个 Map
  const dirsRef = useRef(dirs);
  dirsRef.current = dirs;
  // 上一次的刷新信号（跳过首次挂载）
  const lastRefreshToken = useRef(refreshToken);

  /** 展开目录：读取其子项 */
  const expandDir = useCallback(
    async (path: string) => {
      const result = await window.api.readDir(path);
      if (!result.ok) return;
      setDirs((prev) => {
        const next = new Map(prev);
        const node = next.get(path);
        // 目录名取路径最后一段：必须同时按 / 和 \ 拆，Windows 上只按 / 拆会得到整条路径
        const segments = path.split(/[\\/]/);
        next.set(path, {
          entry: node?.entry ?? { name: segments[segments.length - 1] ?? path, path, kind: 'dir' },
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

  // 「刷新」信号变化时重新读取已展开的每个目录（保留展开状态，只更新列表）。
  // 新建/改名可能发生在任意层级的子目录里，只重读根目录会让深处留着旧文件名。
  useEffect(() => {
    if (lastRefreshToken.current === refreshToken) return;
    lastRefreshToken.current = refreshToken;
    if (!rootDir) return;
    const targets = [rootDir, ...dirsRef.current.keys()].filter(
      (path, index, all) => path === rootDir || all.indexOf(path) === index
    );
    void Promise.all(targets.map((path) => expandDir(path)));
  }, [refreshToken, rootDir, expandDir]);

  // ⋮ 菜单点击外部或 Esc 关闭
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeydown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeydown);
    };
  }, [menuOpen]);

  /** 执行 ⋮ 菜单动作并关闭菜单 */
  const runMenuAction = (action: () => void): void => {
    setMenuOpen(false);
    action();
  };

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
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
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

  /** ⋮ 菜单（仅打开目录后显示） */
  const renderMenu = (): JSX.Element | null => {
    if (!menuOpen) return null;
    return (
      <div className="filetree-menu" role="menu">
        <button type="button" className="filetree-menu-item" role="menuitem" onClick={() => runMenuAction(onCreateFile)}>
          新建文件
        </button>
        <button
          type="button"
          className="filetree-menu-item"
          role="menuitem"
          title="重命名当前文档（未保存的文档只改标签名）"
          onClick={() => runMenuAction(onRenameFile)}
        >
          重命名当前文档…
        </button>
        <button type="button" className="filetree-menu-item" role="menuitem" onClick={() => runMenuAction(onOpenSearch)}>
          搜索
        </button>
        <button type="button" className="filetree-menu-item" role="menuitem" onClick={() => runMenuAction(onRevealFolder)}>
          {isWindows() ? '在资源管理器中显示' : '在 Finder 中显示'}
        </button>
        <button type="button" className="filetree-menu-item" role="menuitem" onClick={() => runMenuAction(onChooseFolder)}>
          打开文件夹…
        </button>
        <button type="button" className="filetree-menu-item" role="menuitem" onClick={() => runMenuAction(onRefresh)}>
          刷新
        </button>
      </div>
    );
  };

  if (!rootDir) {
    return (
      <div className="filetree">
        <div className="filetree-empty">打开文件夹以浏览文件</div>
        <div className="filetree-footer">
          <button className="filetree-open-btn" onClick={onChooseFolder} title="打开文件夹">
            打开文件夹…
          </button>
        </div>
      </div>
    );
  }

  const rootName = rootDir.split(/[\\/]/).pop() ?? rootDir;

  return (
    <div className="filetree">
      <div className="filetree-body" ref={containerRef} onKeyDown={handleKeyDown} role="tree">
        {dirs.get(rootDir)?.children.map((child) => renderEntry(child, 0))}
      </div>
      <div className="filetree-footer" ref={menuRef}>
        <button className="filetree-open-btn" onClick={onChooseFolder} title={`切换文件夹：${rootDir}`}>
          {rootName}
        </button>
        <button
          type="button"
          className="filetree-more-btn"
          aria-label="文件树操作"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="更多操作"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <circle cx="8" cy="3" r="1.4" fill="currentColor" />
            <circle cx="8" cy="8" r="1.4" fill="currentColor" />
            <circle cx="8" cy="13" r="1.4" fill="currentColor" />
          </svg>
        </button>
        {renderMenu()}
      </div>
    </div>
  );
}

/**
 * 文档（标签页）状态与文件读写。
 *
 * 承担原来 App.tsx 里「标签 / 打开 / 保存 / 自动保存 / 文件树根目录」这一整块职责，
 * 对外的回调都是稳定引用，供菜单分发表与其它 hook 直接使用。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { EditorInstance } from '@ai-md-editor/editor';
import type { Tab } from '../types';
import type { QuickEntry } from '../Dialogs';
import type { SourceHistory } from './useSourceHistory';

/** 默认文档内容（首次启动时的示例） */
const DEFAULT_DOC = `# MarkdownNote

跨平台的本地 Markdown 编辑器，所见即所得。

## 核心特性

- 输入即渲染（WYSIWYG）
- 克制动效，专注内容
- 现代极简，去 AI 味
- 支持数学公式：$c = \\pm\\sqrt{a^2 + b^2}$

## 技术栈

- Electron + React + TypeScript
- Milkdown（ProseMirror + remark）

> 支持多标签页、打开 .md 文件、Cmd/Ctrl+S 保存、粘贴图片到 assets/ 目录。
`;

/** 生成唯一标签 id（时间戳 + 自增序号） */
let tabSeq = 0;
function genTabId(): string {
  tabSeq += 1;
  return `tab-${Date.now()}-${tabSeq}`;
}

/** 创建新标签的工厂函数 */
function createTab(name = '未命名.md', content = '', path: string | null = null): Tab {
  return { id: genTabId(), path, name, content, dirty: false };
}

/** useTabs 的入参 */
interface UseTabsOptions {
  /** 编辑器实例引用（切换文档时同步内容） */
  editorRef: MutableRefObject<EditorInstance | null>;
  /** 源码模式撤销栈（切换文档时清空） */
  history: SourceHistory;
}

/**
 * 文档状态 hook。
 * 所有会修改标签内容的操作都在这里收口，避免多处 setState 竞争。
 */
export function useTabs({ editorRef, history }: UseTabsOptions) {
  const [tabs, setTabs] = useState<Tab[]>(() => [createTab('未命名.md', DEFAULT_DOC)]);
  const [activeId, setActiveId] = useState<string>(() => tabs[0]?.id ?? '');
  const [treeRoot, setTreeRoot] = useState<string | null>(null);

  // 保存最新的 tabs / activeId，供事件回调使用（避免闭包过期）
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeId) ?? null, [tabs, activeId]);

  /** 查找当前活动标签 */
  const findActive = useCallback(
    () => tabsRef.current.find((t) => t.id === activeIdRef.current) ?? null,
    []
  );

  /** 内容变化回调：更新活动标签的 content + dirty */
  const handleChange = useCallback((markdown: string) => {
    const id = activeIdRef.current;
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, content: markdown, dirty: true } : t)));
  }, []);

  /** 直接替换当前标签内容（源码格式化、查找替换、粘贴图片等用） */
  const setActiveContent = useCallback((content: string, dirty = true) => {
    const id = activeIdRef.current;
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, content, dirty } : t)));
  }, []);

  /** 新建标签 */
  const newTab = useCallback(() => {
    const tab = createTab('未命名.md', '');
    history.reset();
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
    editorRef.current?.setMarkdown('');
  }, [editorRef, history]);

  /** 切换标签：载入目标标签内容到编辑器 */
  const selectTab = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) return;
      const target = tabsRef.current.find((t) => t.id === id);
      if (!target) return;
      history.reset();
      setActiveId(id);
      editorRef.current?.setMarkdown(target.content);
    },
    [editorRef, history]
  );

  /** 关闭标签：先算出下一个活动标签，再一次性更新状态（避免在 setState 回调里做副作用） */
  const closeTab = useCallback(
    (id: string) => {
      const prev = tabsRef.current;
      const index = prev.findIndex((t) => t.id === id);
      if (index < 0) return;
      const rest = prev.filter((t) => t.id !== id);

      if (id !== activeIdRef.current) {
        setTabs(rest);
        return;
      }
      // 关掉的是当前标签：没有剩余标签时补一个空白页
      const next = rest.length === 0 ? createTab('未命名.md', '') : rest[Math.min(index, rest.length - 1)];
      history.reset();
      setTabs(rest.length === 0 ? [next] : rest);
      setActiveId(next.id);
      editorRef.current?.setMarkdown(next.content);
    },
    [editorRef, history]
  );

  /** 打开文件内容（新建/复用标签），供对话框、拖拽、open-file 事件复用 */
  const openFileContent = useCallback(
    (path: string, name: string, content: string) => {
      const existing = tabsRef.current.find((t) => t.path === path);
      if (existing) {
        history.reset();
        setActiveId(existing.id);
        editorRef.current?.setMarkdown(existing.content);
        return;
      }
      const tab = createTab(name, content, path);
      history.reset();
      setTabs((prev) => [...prev, tab]);
      setActiveId(tab.id);
      editorRef.current?.setMarkdown(content);
      const dir = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
      if (dir) {
        // 文件在「已打开的文件夹」内部时保留原有根目录：
        // 否则每打开一个文件都会把树根改成它的父目录，
        // 「在文件树中显示」就没法从根目录逐级展开定位了
        setTreeRoot((prev) => {
          if (!prev) return dir;
          const normalizedRoot = prev.replace(/\\/g, '/').replace(/\/$/, '');
          const normalizedPath = path.replace(/\\/g, '/');
          return normalizedPath.startsWith(`${normalizedRoot}/`) ? prev : dir;
        });
      }
    },
    [editorRef, history]
  );

  /** 选择文件夹作为文件树根目录 */
  const chooseFolder = useCallback(async () => {
    const result = await window.api.chooseFolder();
    if (!result.canceled && result.path) setTreeRoot(result.path);
  }, []);

  /** 打开文件：弹出对话框选择文件 */
  const openFile = useCallback(async () => {
    const result = await window.api.openFile();
    if (result.canceled || !result.path || result.content === null) return;
    openFileContent(result.path, result.name ?? '未命名.md', result.content);
  }, [openFileContent]);

  /** 打开指定路径（最近文件、快速打开、文件树共用） */
  const openPath = useCallback(
    async (path: string, fallbackName?: string) => {
      const result = await window.api.openPath(path);
      if (!result.canceled && result.path && result.content !== null) {
        openFileContent(result.path, result.name ?? fallbackName ?? path, result.content);
      }
    },
    [openFileContent]
  );

  /** 保存活动标签：有路径直接写，无路径则另存为 */
  const save = useCallback(async () => {
    const tab = findActive();
    if (!tab) return;
    if (tab.path) {
      await window.api.writeFile(tab.path, tab.content);
      setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, dirty: false } : t)));
      return;
    }
    const result = await window.api.saveFileAs(tab.content, tab.name);
    if (!result.canceled && result.path) {
      setTabs((prev) =>
        prev.map((t) => (t.id === tab.id ? { ...t, path: result.path, name: result.name ?? t.name, dirty: false } : t))
      );
    }
  }, [findActive]);

  /** 保存全部打开的文件（只写有路径且已修改的标签） */
  const saveAll = useCallback(async () => {
    const dirty = tabsRef.current.filter((t) => t.path && t.dirty);
    await Promise.all(dirty.map((t) => window.api.writeFile(t.path as string, t.content)));
    if (dirty.length === 0) return;
    const ids = new Set(dirty.map((t) => t.id));
    setTabs((prev) => prev.map((t) => (ids.has(t.id) ? { ...t, dirty: false } : t)));
  }, []);

  /** 另存为：弹出保存对话框 */
  const saveAs = useCallback(async () => {
    const tab = findActive();
    if (!tab) return;
    const result = await window.api.saveFileAs(tab.content, tab.name);
    if (!result.canceled && result.path) {
      setTabs((prev) =>
        prev.map((t) => (t.id === tab.id ? { ...t, path: result.path, name: result.name ?? t.name, dirty: false } : t))
      );
    }
  }, [findActive]);

  /** 复制一份到新路径：原文档与标签保持不变，新副本作为独立标签打开 */
  const duplicate = useCallback(async () => {
    const tab = findActive();
    if (!tab) return;
    const base = tab.name.replace(/\.md$/i, '');
    const result = await window.api.saveFileAs(tab.content, `${base} 副本.md`);
    if (result.canceled || !result.path) return;
    const name = result.name ?? `${base} 副本.md`;
    openFileContent(result.path, name, tab.content);
    void window.api.addRecent(result.path, name);
  }, [findActive, openFileContent]);

  /** 从磁盘重新加载当前文档（丢弃未写入磁盘的改动） */
  const reloadFromDisk = useCallback(async () => {
    const tab = findActive();
    if (!tab?.path) return;
    const content = await window.api.readFile(tab.path);
    setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, content, dirty: false } : t)));
    editorRef.current?.setMarkdown(content);
  }, [editorRef, findActive]);

  /** 重命名当前文档（返回是否成功，供对话框决定是否关闭） */
  const rename = useCallback(async (newName: string): Promise<void> => {
    const tab = findActive();
    if (!tab?.path) return;
    const result = await window.api.renameFile({ path: tab.path, newName });
    if (result.ok && result.path) {
      const path = result.path;
      const name = result.name ?? newName;
      setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, path, name, dirty: false } : t)));
      void window.api.addRecent(path, name);
    }
  }, [findActive]);

  /** 快速打开：载入最近文件 + 文件树两层内的 Markdown 文件 */
  const loadQuickEntries = useCallback(async (): Promise<{ recent: QuickEntry[]; tree: QuickEntry[] }> => {
    const recent = (await window.api.getRecent()).map((f) => ({ path: f.path, name: f.name }));
    const tree: QuickEntry[] = [];
    if (treeRoot) {
      const root = await window.api.readDir(treeRoot);
      if (root.ok) {
        for (const entry of root.entries) {
          if (entry.kind === 'md') tree.push({ path: entry.path, name: entry.name });
          else {
            const sub = await window.api.readDir(entry.path);
            if (sub.ok) {
              sub.entries
                .filter((child) => child.kind === 'md')
                .forEach((child) => tree.push({ path: child.path, name: child.name }));
            }
          }
        }
      }
    }
    return { recent, tree };
  }, [treeRoot]);

  // 自动保存：编辑内容变化后防抖 1.5s 自动写入（仅当标签有路径且 dirty）
  useEffect(() => {
    const timer = setTimeout(() => {
      const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
      if (tab && tab.path && tab.dirty) {
        void window.api.writeFile(tab.path, tab.content).then(() => {
          setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, dirty: false } : t)));
        });
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [tabs]);

  return {
    tabs,
    activeId,
    activeTab,
    tabsRef,
    activeIdRef,
    treeRoot,
    setTreeRoot,
    handleChange,
    setActiveContent,
    newTab,
    selectTab,
    closeTab,
    openFileContent,
    chooseFolder,
    openFile,
    openPath,
    save,
    saveAll,
    saveAs,
    duplicate,
    reloadFromDisk,
    rename,
    loadQuickEntries
  };
}

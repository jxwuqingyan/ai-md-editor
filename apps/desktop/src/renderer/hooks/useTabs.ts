/**
 * 文档（标签页）状态与文件读写。
 *
 * 承担原来 App.tsx 里「标签 / 打开 / 保存 / 自动保存 / 文件树根目录 / 会话恢复」这一整块职责，
 * 对外的回调都是稳定引用，供菜单分发表与其它 hook 直接使用。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { TextEncoding } from '@ai-md-editor/shared';
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

> 支持多标签页、打开 .md 文件、Cmd/Ctrl+S 保存、粘贴图片自动存到同级 img/ 目录。
`;

/** 生成唯一标签 id（时间戳 + 自增序号） */
let tabSeq = 0;
function genTabId(): string {
  tabSeq += 1;
  return `tab-${Date.now()}-${tabSeq}`;
}

/** 创建新标签的工厂函数 */
function createTab(
  name = '未命名.md',
  content = '',
  path: string | null = null,
  encoding: TextEncoding = 'utf-8'
): Tab {
  return { id: genTabId(), path, name, content, dirty: false, encoding };
}

/** 取路径的父目录 */
function parentDir(targetPath: string): string {
  const index = Math.max(targetPath.lastIndexOf('/'), targetPath.lastIndexOf('\\'));
  return index > 0 ? targetPath.slice(0, index) : '';
}

/** useTabs 的入参 */
interface UseTabsOptions {
  /** 编辑器实例引用（切换文档时同步内容） */
  editorRef: MutableRefObject<EditorInstance | null>;
  /** 源码模式撤销栈（切换文档时清空） */
  history: SourceHistory;
  /** 会话恢复完成（参数为恢复的文档数，0 表示没有可恢复的内容） */
  onSessionRestored?: (count: number) => void;
  /** 状态栏提示（外部修改、写盘失败等） */
  onNotice?: (message: string) => void;
}

/**
 * 文档状态 hook。
 * 所有会修改标签内容的操作都在这里收口，避免多处 setState 竞争。
 */
export function useTabs({ editorRef, history, onSessionRestored, onNotice }: UseTabsOptions) {
  const [tabs, setTabs] = useState<Tab[]>(() => [createTab('未命名.md', DEFAULT_DOC)]);
  const [activeId, setActiveId] = useState<string>(() => tabs[0]?.id ?? '');
  const [treeRoot, setTreeRoot] = useState<string | null>(null);

  // 保存最新的 tabs / activeId，供事件回调使用（避免闭包过期）
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  // 会话恢复完成后才允许回写，否则默认标签会先覆盖掉上次会话
  const [sessionReady, setSessionReady] = useState(false);
  // 通知回调放 ref：恢复流程只跑一次，不能因为回调重建而重跑
  const notifyRef = useRef({ onSessionRestored, onNotice });
  notifyRef.current = { onSessionRestored, onNotice };

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeId) ?? null, [tabs, activeId]);

  /** 查找当前活动标签 */
  const findActive = useCallback(
    () => tabsRef.current.find((t) => t.id === activeIdRef.current) ?? null,
    []
  );

  /** 内容变化回调：更新活动标签的 content + dirty */
  const handleChange = useCallback((markdown: string) => {
    const id = activeIdRef.current;
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        // 编辑器为保证表格等非文本块末尾可输入会补一个空段落，序列化后
        // 只多出尾部换行。这类变化不算用户编辑，避免打开文件就被误标脏。
        if (t.content.replace(/\s+$/, '') === markdown.replace(/\s+$/, '')) {
          return t.content === markdown ? t : { ...t, content: markdown };
        }
        return { ...t, content: markdown, dirty: true };
      })
    );
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

  /**
   * 把编辑器里的当前内容同步回标签状态。
   *
   * 编辑器内容回写走变更监听，有 200ms 防抖；切换标签 / 切换模式 / 关闭标签都会
   * 卸载编辑器，防抖中的那次回写会被取消，刚改的内容就丢了。所有会让编辑器
   * 换内容的操作前都必须先 flush 一次。
   */
  const flushEditor = useCallback((): string | undefined => {
    const markdown = editorRef.current?.flushMarkdown?.();
    if (typeof markdown !== 'string') return undefined;
    handleChange(markdown);
    return markdown;
  }, [editorRef, handleChange]);

  /** 切换标签：载入目标标签内容到编辑器 */
  const selectTab = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) return;
      const target = tabsRef.current.find((t) => t.id === id);
      if (!target) return;
      // 先落定当前标签的改动，再换内容
      flushEditor();
      history.reset();
      setActiveId(id);
      editorRef.current?.setMarkdown(target.content);
    },
    [editorRef, history, flushEditor]
  );

  /** 关闭标签：先算出下一个活动标签，再一次性更新状态（避免在 setState 回调里做副作用） */
  const closeTab = useCallback(
    (id: string) => {
      // 关闭前先落定未回写的改动，避免刚敲的内容没进 content 就被写盘/丢弃
      flushEditor();
      const prev = tabsRef.current;
      const index = prev.findIndex((t) => t.id === id);
      if (index < 0) return;
      const target = prev[index];

      // 有路径的改动直接补写一次，不打断用户（自动保存的防抖可能还没到）
      if (target.path && target.dirty) {
        void window.api.writeFile(target.path, target.content, target.encoding);
      }
      // 未落盘的新文档没有兜底，关掉就真的没了，必须问一句
      if (!target.path && target.dirty) {
        const confirmed = window.confirm(`「${target.name}」尚未保存到磁盘，关闭后内容会丢失。仍要关闭吗？`);
        if (!confirmed) return;
      }

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
    (path: string, name: string, content: string, encoding: TextEncoding = 'utf-8') => {
      const existing = tabsRef.current.find((t) => t.path === path);
      if (existing) {
        history.reset();
        setActiveId(existing.id);
        editorRef.current?.setMarkdown(existing.content);
        return;
      }
      const tab = createTab(name, content, path, encoding);
      history.reset();
      setTabs((prev) => [...prev, tab]);
      setActiveId(tab.id);
      editorRef.current?.setMarkdown(content);
      const dir = parentDir(path);
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
    openFileContent(result.path, result.name ?? '未命名.md', result.content, result.encoding ?? 'utf-8');
  }, [openFileContent]);

  /** 打开指定路径（最近文件、快速打开、文件树共用） */
  const openPath = useCallback(
    async (path: string, fallbackName?: string) => {
      const result = await window.api.openPath(path);
      if (!result.canceled && result.path && result.content !== null) {
        openFileContent(
          result.path,
          result.name ?? fallbackName ?? path,
          result.content,
          result.encoding ?? 'utf-8'
        );
      }
    },
    [openFileContent]
  );

  /**
   * 写盘并把标签标记为已保存。
   * 非 UTF-8 文档会被转存为 UTF-8（TextEncoder 无法编码 GBK / UTF-16），
   * 因此这里用主进程返回的实际编码覆盖标签编码，避免下次读回时按旧编码误解码。
   */
  const persistTab = useCallback(async (tab: Tab): Promise<void> => {
    if (!tab.path) return;
    const effective = await window.api.writeFile(tab.path, tab.content, tab.encoding);
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tab.id
          ? { ...t, encoding: effective, dirty: t.content === tab.content ? false : t.dirty }
          : t
      )
    );
  }, []);

  /** 保存活动标签：有路径直接写，无路径则另存为 */
  const save = useCallback(async () => {
    // 先同步取一次编辑器内容：防抖中的回写可能还没落到 tab.content
    const markdown = flushEditor();
    const found = findActive();
    if (!found) return;
    const tab = markdown === undefined ? found : { ...found, content: markdown };
    if (tab.path) {
      try {
        await persistTab(tab);
      } catch (err) {
        notifyRef.current.onNotice?.(`保存失败：${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }
    const result = await window.api.saveFileAs(tab.content, tab.name);
    if (!result.canceled && result.path) {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tab.id
            ? { ...t, content: tab.content, path: result.path, name: result.name ?? t.name, dirty: false, encoding: 'utf-8' }
            : t
        )
      );
    }
  }, [findActive, persistTab, flushEditor]);

  /** 保存全部打开的文件（只写有路径且已修改的标签） */
  const saveAll = useCallback(async () => {
    // 同上：先把编辑器里的最新内容同步出来，再挑要写的标签
    const markdown = flushEditor();
    const activeIdNow = activeIdRef.current;
    const dirty = tabsRef.current.filter(
      (t) => t.path && (t.dirty || (t.id === activeIdNow && markdown !== undefined && markdown !== t.content))
    ) as (Tab & { path: string })[];
    if (dirty.length === 0) return;
    const targets = dirty.map((t) =>
      t.id === activeIdNow && markdown !== undefined ? { ...t, content: markdown } : t
    );
    try {
      await Promise.all(targets.map((t) => persistTab(t)));
    } catch (err) {
      notifyRef.current.onNotice?.(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [persistTab, flushEditor]);

  /** 另存为：弹出保存对话框 */
  const saveAs = useCallback(async () => {
    const markdown = flushEditor();
    const found = findActive();
    if (!found) return;
    const tab = markdown === undefined ? found : { ...found, content: markdown };
    const result = await window.api.saveFileAs(tab.content, tab.name);
    if (!result.canceled && result.path) {
      const path = result.path;
      const name = result.name ?? tab.name;
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tab.id ? { ...t, content: tab.content, path, name, dirty: false, encoding: 'utf-8' } : t
        )
      );
      // 与保存/重命名保持一致：另存出来的新路径也要进最近文件
      void window.api.addRecent(path, name);
    }
  }, [findActive, flushEditor]);

  /**
   * 确保当前标签有磁盘路径（插入图片、插入需要落盘的内容前调用）。
   * 未保存的新文档会先弹「另存为」，用户取消则返回 null。
   */
  const ensureActivePath = useCallback(async (): Promise<string | null> => {
    const tab = findActive();
    if (!tab) return null;
    if (tab.path) return tab.path;
    const result = await window.api.saveFileAs(tab.content, tab.name);
    if (result.canceled || !result.path) return null;
    const path = result.path;
    const name = result.name ?? tab.name;
    setTabs((prev) =>
      prev.map((t) => (t.id === tab.id ? { ...t, path, name, dirty: false, encoding: 'utf-8' } : t))
    );
    void window.api.addRecent(path, name);
    return path;
  }, [findActive]);

  /** 复制一份到新路径：原文档与标签保持不变，新副本作为独立标签打开 */
  const duplicate = useCallback(async () => {
    const tab = findActive();
    if (!tab) return;
    const base = tab.name.replace(/\.md$/i, '');
    const result = await window.api.saveFileAs(tab.content, `${base} 副本.md`);
    if (result.canceled || !result.path) return;
    const name = result.name ?? `${base} 副本.md`;
    openFileContent(result.path, name, tab.content, 'utf-8');
    void window.api.addRecent(result.path, name);
  }, [findActive, openFileContent]);

  /**
   * 从磁盘重新加载指定路径的文档（丢弃未写入磁盘的改动）。
   * 外部修改提示点击后会走到这里，因此按路径定位而不是「当前标签」。
   */
  const reloadPath = useCallback(
    async (path: string) => {
      const target = tabsRef.current.find((t) => t.path === path);
      if (!target) return;
      try {
        const result = await window.api.readFile(path);
        setTabs((prev) =>
          prev.map((t) =>
            t.id === target.id
              ? { ...t, content: result.content, encoding: result.encoding, dirty: false }
              : t
          )
        );
        if (target.id === activeIdRef.current) {
          editorRef.current?.setMarkdown(result.content);
        }
      } catch (err) {
        notifyRef.current.onNotice?.(`重新加载失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [editorRef]
  );

  /** 从磁盘重新加载当前文档 */
  const reloadFromDisk = useCallback(async () => {
    const tab = findActive();
    if (!tab?.path) return;
    await reloadPath(tab.path);
  }, [findActive, reloadPath]);

  /** 重命名当前文档（返回结果，供对话框/提示决定后续动作） */
  const rename = useCallback(
    async (newName: string): Promise<{ ok: boolean; error?: string }> => {
      const tab = findActive();
      if (!tab) return { ok: false, error: '没有活动文档' };
      const name = newName.trim();
      if (!name) return { ok: false, error: '文件名不能为空' };

      // 未落盘的标签没有磁盘目标，改名只作用在标签上（另存为时用它做默认文件名）
      if (!tab.path) {
        setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, name } : t)));
        return { ok: true };
      }

      const result = await window.api.renameFile({ path: tab.path, newName: name });
      if (!result.ok || !result.path) {
        return { ok: false, error: result.error ?? '未知错误' };
      }
      const path = result.path;
      const finalName = result.name ?? name;

      // 改名只动目录项，未保存的改动要补写到新路径，
      // 否则这里清掉 dirty 之后内存里的内容再也不会落盘
      let encoding = tab.encoding;
      let dirty = tab.dirty;
      if (dirty) {
        try {
          encoding = await window.api.writeFile(path, tab.content, tab.encoding);
          dirty = false;
        } catch {
          // 补写失败就保留 dirty，交给自动保存继续重试
        }
      }

      setTabs((prev) =>
        prev.map((t) => (t.id === tab.id ? { ...t, path, name: finalName, dirty, encoding } : t))
      );
      void window.api.addRecent(path, finalName);
      return { ok: true };
    },
    [findActive]
  );

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

  // ===== 会话恢复 =====
  // 只恢复「有磁盘路径」的标签：未落盘的新文档在退出前已经问过用户，
  // 这里若把内容也存进设置文件，等于隐式做了草稿持久化，语义容易混淆。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const settings = await window.api.getSettings().catch(() => null);
      if (cancelled) return;
      const session = settings?.restoreSession ? settings.lastSession : null;
      if (session && session.paths.length > 0) {
        const restored: Tab[] = [];
        for (const path of session.paths) {
          const result = await window.api.readPathQuiet(path);
          if (result.canceled || !result.path || result.content === null) continue;
          restored.push(
            createTab(result.name ?? path, result.content, result.path, result.encoding ?? 'utf-8')
          );
        }
        if (!cancelled && restored.length > 0) {
          const active = restored.find((tab) => tab.path === session.activePath) ?? restored[0];
          history.reset();
          setTabs(restored);
          setActiveId(active.id);
          // 编辑器可能还没挂载完：handleReady 会以活动标签内容为准再同步一次
          editorRef.current?.setMarkdown(active.content);
          const dir = active.path ? parentDir(active.path) : '';
          if (dir) setTreeRoot(dir);
          notifyRef.current.onSessionRestored?.(restored.length);
        } else if (!cancelled) {
          notifyRef.current.onSessionRestored?.(0);
        }
      } else {
        notifyRef.current.onSessionRestored?.(0);
      }
      if (!cancelled) setSessionReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // 只在挂载时恢复一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 会话内容变化时落盘（防抖 + 签名去重：每次按键都写设置文件没有意义）
  const sessionSignatureRef = useRef('');
  useEffect(() => {
    if (!sessionReady) return;
    const paths = tabs.filter((tab) => tab.path).map((tab) => tab.path as string);
    const activePath = tabs.find((tab) => tab.id === activeId)?.path ?? null;
    const signature = `${paths.join('|')}::${activePath ?? ''}`;
    if (signature === sessionSignatureRef.current) return;
    const timer = setTimeout(() => {
      sessionSignatureRef.current = signature;
      void window.api.updateSettings({ lastSession: paths.length > 0 ? { paths, activePath } : null });
    }, 500);
    return () => clearTimeout(timer);
  }, [sessionReady, tabs, activeId]);

  // 自动保存：内容变化后防抖 1.5s 写入所有「有路径且 dirty」的标签。
  // 只保存当前标签会丢稿：敲完立刻切到别的标签（或新建标签）时，
  // 原标签的计时器被清掉且再也不会重新触发。
  useEffect(() => {
    const timer = setTimeout(() => {
      const dirty = tabsRef.current.filter((tab) => tab.path && tab.dirty);
      if (dirty.length === 0) return;
      // 记录写入时的内容快照：写盘过程中用户继续编辑，不能把 dirty 清掉
      const snapshots = new Map(dirty.map((tab) => [tab.id, tab.content]));
      void Promise.all(
        dirty.map((tab) => window.api.writeFile(tab.path as string, tab.content, tab.encoding))
      )
        .then((encodings) => {
          const effective = new Map(dirty.map((tab, index) => [tab.id, encodings[index]]));
          setTabs((prev) =>
            prev.map((tab) => {
              const written = snapshots.get(tab.id);
              const encoding = effective.get(tab.id);
              if (written === undefined || written !== tab.content) {
                return encoding && encoding !== tab.encoding ? { ...tab, encoding } : tab;
              }
              return { ...tab, dirty: false, encoding: encoding ?? tab.encoding };
            })
          );
        })
        .catch(() => {
          // 写盘失败保留 dirty，下一次编辑继续重试
        });
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
    flushEditor,
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
    ensureActivePath,
    duplicate,
    reloadFromDisk,
    reloadPath,
    rename,
    loadQuickEntries
  };
}

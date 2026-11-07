import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { themes, tokensToCssVars, type ThemeId } from '@ai-md-editor/theme';
import { extractOutline } from '@ai-md-editor/markdown-core';
import type { MenuViewState } from '@ai-md-editor/shared';
import type { EditorInstance, FormatAction } from '@ai-md-editor/editor';
import MarkdownEditor from './MarkdownEditor';
import Tabs, { type Tab } from './Tabs';
import TopbarActions from './TopbarActions';
import FileTree from './FileTree';
import Toolbar from './Toolbar';
import {
  FindBar,
  QuickOpen,
  RenameDialog,
  FloatPanels,
  type DocStats,
  type QuickEntry
} from './Dialogs';
import { applySourceFormat, type SourceResult } from './sourceActions';
import { buildMenuHandlers } from './menuHandlers';

/** 默认文档内容 */
const DEFAULT_DOC = `# MarkdownNote

对标 Typora 的跨平台 Markdown 编辑器，所见即所得。

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

/**
 * 应用根组件。
 * 架构：单编辑器实例 + 切换内容；原生菜单动作统一经 IPC 分发到此处。
 */
export default function App(): JSX.Element {
  // ===== 基础界面状态 =====
  const [themeId, setThemeId] = useState<ThemeId>('light');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarPanel, setSidebarPanel] = useState<'files' | 'outline'>('files');
  const [treeRoot, setTreeRoot] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>(() => [createTab('未命名.md', DEFAULT_DOC)]);
  const [activeId, setActiveId] = useState<string>(() => tabs[0]?.id ?? '');
  const [viewMode, setViewMode] = useState<'wysiwyg' | 'source'>('wysiwyg');

  // ===== Typora 风格显示模式 =====
  const [tabbarVisible, setTabbarVisible] = useState(true);
  const [readOnly, setReadOnly] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [typewriterMode, setTypewriterMode] = useState(false);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [wordCountVisible, setWordCountVisible] = useState(false);
  const [outlineWindowVisible, setOutlineWindowVisible] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // ===== 查找 / 替换 =====
  const [findOpen, setFindOpen] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [searchText, setSearchText] = useState('');
  const [currentMatch, setCurrentMatch] = useState(0);

  // ===== 浮层 =====
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [quickEntries, setQuickEntries] = useState<{ recent: QuickEntry[]; tree: QuickEntry[] }>({
    recent: [],
    tree: []
  });
  const [renameOpen, setRenameOpen] = useState(false);

  // 编辑器实例引用（通过 onReady 获取）
  const editorRef = useRef<EditorInstance | null>(null);
  // 编辑器就绪版本号（异步初始化完成后刷新依赖编辑器的派生数据）
  const [editorVersion, setEditorVersion] = useState(0);
  // 保存最新的 tabs / activeId / viewMode，供事件回调使用（避免闭包过期）
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const alwaysOnTopRef = useRef(alwaysOnTop);
  alwaysOnTopRef.current = alwaysOnTop;
  const findIndexRef = useRef(0);
  const replaceTextRef = useRef(replaceText);
  replaceTextRef.current = replaceText;

  const tokens = themes[themeId];
  const cssVars = useMemo(() => tokensToCssVars(tokens), [tokens]);

  // 当前活动标签
  const activeTab = useMemo(() => tabs.find((t) => t.id === activeId) ?? null, [tabs, activeId]);

  // 应用主题到 <html>，保证全局 CSS 变量生效
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeId);
  }, [themeId]);

  // 从活动标签内容提取大纲（实时跟随编辑）
  const outline = useMemo(() => extractOutline(activeTab?.content ?? ''), [activeTab]);

  // 统计信息
  const stats: DocStats = useMemo(() => {
    const text = activeTab?.content ?? '';
    const wordCount = text.replace(/\s/g, '').length;
    return {
      lineCount: text.split('\n').length,
      wordCount,
      charCount: text.length,
      paragraphCount: text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length,
      readMinutes: Math.max(1, Math.ceil(wordCount / 400))
    };
  }, [activeTab]);

  // 同步界面状态到主进程，让原生菜单勾选项与界面一致
  useEffect(() => {
    const state: MenuViewState = {
      tabbarVisible,
      sourceMode: viewMode === 'source',
      readOnly,
      focusMode,
      typewriterMode,
      // 专注模式与只读模式会临时隐藏工具栏/侧栏，菜单勾选状态跟随实际可见性
      toolbarVisible: toolbarVisible && !readOnly,
      sidebarVisible: sidebarOpen && !focusMode,
      sidebarPanel,
      wordCountVisible,
      outlineWindowVisible,
      alwaysOnTop,
      fullscreen,
      hasPath: Boolean(activeTab?.path)
    };
    window.api.updateMenuState(state);
  }, [
    tabbarVisible, viewMode, readOnly, focusMode, typewriterMode, toolbarVisible,
    sidebarOpen, sidebarPanel, wordCountVisible, outlineWindowVisible, alwaysOnTop, fullscreen,
    activeTab?.path
  ]);

  // 初始化并跟随窗口全屏状态（用户也可能用系统绿灯按钮进入全屏）
  useEffect(() => {
    void window.api.isFullScreen().then(setFullscreen);
  }, []);

  useEffect(() => {
    const onResize = (): void => {
      void window.api.isFullScreen().then(setFullscreen);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 内容变化回调：更新活动标签的 content + dirty
  const handleChange = useCallback((markdown: string) => {
    const id = activeIdRef.current;
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, content: markdown, dirty: true } : t)));
  }, []);

  /**
   * 源码模式的撤销栈。
   * WYSIWYG 的历史由 ProseMirror 维护；纯 textarea 没有可用的撤销历史
   * （浏览器只在真实键入时记录，程序性改值不进栈），因此这里自己记录快照。
   */
  const sourceHistoryRef = useRef<{ past: string[]; future: string[] }>({ past: [], future: [] });

  const resetSourceHistory = useCallback(() => {
    sourceHistoryRef.current = { past: [], future: [] };
  }, []);

  /** 源码编辑：先把旧内容压栈，再更新状态 */
  const handleSourceChange = useCallback(
    (value: string) => {
      const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
      const history = sourceHistoryRef.current;
      if (tab && tab.content !== value) {
        history.past.push(tab.content);
        if (history.past.length > 200) history.past.shift();
        history.future = [];
      }
      handleChange(value);
    },
    [handleChange]
  );

  // 编辑器就绪：保存实例、补同步异步初始化期间打开的文档、恢复只读状态
  const handleReady = useCallback((instance: EditorInstance) => {
    editorRef.current = instance;
    const active = tabsRef.current.find((tab) => tab.id === activeIdRef.current);
    if (active && instance.getMarkdown() !== active.content) {
      instance.setMarkdown(active.content);
    }
    instance.setEditable(!readOnlyRef.current);
    setEditorVersion((v) => v + 1);
  }, []);

  /** 切换源码/渲染模式 */
  const toggleViewMode = useCallback(() => {
    const next = viewModeRef.current === 'wysiwyg' ? 'source' : 'wysiwyg';
    if (next === 'source') editorRef.current = null;
    // 切换视图后旧的文本快照不再对应，清空避免撤回到别的模式的内容
    resetSourceHistory();
    setViewMode(next);
  }, [resetSourceHistory]);

  /** 只读模式同步到编辑器实例 */
  useEffect(() => {
    editorRef.current?.setEditable(!readOnly);
  }, [readOnly, editorVersion]);

  /** 打字机模式：按键或点击后把光标保持在视区中部 */
  useEffect(() => {
    if (!typewriterMode) return;
    const center = (): void => editorRef.current?.centerCaret();
    window.addEventListener('keyup', center);
    window.addEventListener('click', center);
    center();
    return () => {
      window.removeEventListener('keyup', center);
      window.removeEventListener('click', center);
    };
  }, [typewriterMode, viewMode]);

  /** 大纲点击跳转：源码按行号定位选区，渲染按标题序号定位节点 */
  const handleOutlineClick = useCallback((line: number, index: number) => {
    if (viewModeRef.current === 'source') {
      const ta = document.querySelector<HTMLTextAreaElement>('.source-editor');
      const active = tabsRef.current.find((tab) => tab.id === activeIdRef.current);
      if (ta && active) {
        const offset = active.content.split('\n').slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0);
        ta.focus();
        ta.setSelectionRange(offset, offset);
      }
      return;
    }
    editorRef.current?.scrollToHeading(index);
  }, []);

  /** 切换标签：载入目标标签内容到编辑器 */
  const handleSelectTab = useCallback((id: string) => {
    if (id === activeIdRef.current) return;
    const target = tabsRef.current.find((t) => t.id === id);
    if (!target) return;
    resetSourceHistory();
    setActiveId(id);
    editorRef.current?.setMarkdown(target.content);
  }, [resetSourceHistory]);

  /** 新建标签 */
  const handleNewTab = useCallback(() => {
    const tab = createTab('未命名.md', '');
    resetSourceHistory();
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
    editorRef.current?.setMarkdown('');
  }, [resetSourceHistory]);

  /** 关闭标签：先算出下一个活动标签，再一次性更新状态（避免在 setState 回调里做副作用） */
  const handleCloseTab = useCallback((id: string) => {
    const prev = tabsRef.current;
    const idx = prev.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const rest = prev.filter((t) => t.id !== id);

    if (id !== activeIdRef.current) {
      setTabs(rest);
      return;
    }
    // 关掉的是当前标签：没有剩余标签时补一个空白页
    const next = rest.length === 0 ? createTab('未命名.md', '') : rest[Math.min(idx, rest.length - 1)];
    resetSourceHistory();
    setTabs(rest.length === 0 ? [next] : rest);
    setActiveId(next.id);
    editorRef.current?.setMarkdown(next.content);
  }, [resetSourceHistory]);

  /** 打开文件内容（新建/复用标签），供对话框、拖拽、open-file 事件复用 */
  const openFileContent = useCallback((path: string, name: string, content: string) => {
    const existing = tabsRef.current.find((t) => t.path === path);
    if (existing) {
      resetSourceHistory();
      setActiveId(existing.id);
      editorRef.current?.setMarkdown(existing.content);
      return;
    }
    const tab = createTab(name, content, path);
    resetSourceHistory();
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
    editorRef.current?.setMarkdown(content);
    const dir = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
    if (dir) setTreeRoot(dir);
  }, [resetSourceHistory]);

  /** 选择文件夹作为文件树根目录 */
  const handleChooseFolder = useCallback(async () => {
    const result = await window.api.chooseFolder();
    if (!result.canceled && result.path) setTreeRoot(result.path);
  }, []);

  /** 打开文件：弹出对话框选择文件 */
  const handleOpen = useCallback(async () => {
    const result = await window.api.openFile();
    if (result.canceled || !result.path || result.content === null) return;
    openFileContent(result.path, result.name ?? '未命名.md', result.content);
  }, [openFileContent]);

  /** 打开指定路径（最近文件、快速打开、文件树共用） */
  const handleOpenPath = useCallback(async (path: string, fallbackName?: string) => {
    const result = await window.api.openPath(path);
    if (!result.canceled && result.path && result.content !== null) {
      openFileContent(result.path, result.name ?? fallbackName ?? path, result.content);
    }
  }, [openFileContent]);

  /** 打开最近文件列表中的某个文件 */
  const handleOpenRecent = useCallback(
    async (file: { path: string; name: string }) => handleOpenPath(file.path, file.name),
    [handleOpenPath]
  );

  /** 保存活动标签：有路径直接写，无路径则另存为 */
  const handleSave = useCallback(async () => {
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (!tab) return;
    if (tab.path) {
      await window.api.writeFile(tab.path, tab.content);
      setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, dirty: false } : t)));
    } else {
      const result = await window.api.saveFileAs(tab.content, tab.name);
      if (!result.canceled && result.path) {
        setTabs((prev) =>
          prev.map((t) => (t.id === tab.id ? { ...t, path: result.path, name: result.name ?? t.name, dirty: false } : t))
        );
      }
    }
  }, []);

  /** 保存全部打开的文件（只写有路径且已修改的标签） */
  const handleSaveAll = useCallback(async () => {
    const dirty = tabsRef.current.filter((t) => t.path && t.dirty);
    await Promise.all(dirty.map((t) => window.api.writeFile(t.path as string, t.content)));
    if (dirty.length > 0) {
      const ids = new Set(dirty.map((t) => t.id));
      setTabs((prev) => prev.map((t) => (ids.has(t.id) ? { ...t, dirty: false } : t)));
    }
  }, []);

  /** 另存为：弹出保存对话框 */
  const handleSaveAs = useCallback(async () => {
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (!tab) return;
    const result = await window.api.saveFileAs(tab.content, tab.name);
    if (!result.canceled && result.path) {
      setTabs((prev) =>
        prev.map((t) => (t.id === tab.id ? { ...t, path: result.path, name: result.name ?? t.name, dirty: false } : t))
      );
    }
  }, []);

  /** 复制一份到新路径：原文档与标签保持不变，新副本作为独立标签打开 */
  const handleDuplicate = useCallback(async () => {
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (!tab) return;
    const base = tab.name.replace(/\.md$/i, '');
    const result = await window.api.saveFileAs(tab.content, `${base} 副本.md`);
    if (result.canceled || !result.path) return;
    const name = result.name ?? `${base} 副本.md`;
    openFileContent(result.path, name, tab.content);
    void window.api.addRecent(result.path, name);
  }, [openFileContent]);

  /** 从磁盘重新加载当前文档（丢弃未写入磁盘的改动） */
  const handleReloadFromDisk = useCallback(async () => {
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (!tab?.path) return;
    const content = await window.api.readFile(tab.path);
    setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, content, dirty: false } : t)));
    editorRef.current?.setMarkdown(content);
  }, []);

  /** 重命名当前文档 */
  const handleRename = useCallback(async (newName: string) => {
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (!tab?.path) return;
    const result = await window.api.renameFile({ path: tab.path, newName });
    if (result.ok && result.path) {
      const path = result.path;
      const name = result.name ?? newName;
      setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, path, name, dirty: false } : t)));
      void window.api.addRecent(path, name);
    }
    setRenameOpen(false);
  }, []);

  /** 快速打开：载入最近文件 + 文件树两层内的 Markdown 文件 */
  const handleQuickOpen = useCallback(async () => {
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
    setQuickEntries({ recent, tree });
    setQuickOpenOpen(true);
  }, [treeRoot]);

  /** 处理图片粘贴：保存到 assets/ 目录，插入 markdown 图片语法 */
  const handlePaste = useCallback(async (event: ClipboardEvent) => {
    if (readOnlyRef.current) return;
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (!blob) continue;
        event.preventDefault();
        const extension = item.type.split('/')[1] ?? 'png';
        const data = new Uint8Array(await blob.arrayBuffer());
        const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
        const docDir = tab?.path ? tab.path.slice(0, tab.path.lastIndexOf('/')) : '';
        const result = await window.api.saveImage({ data, extension, docDir });
        if (!result.relativePath) {
          console.error('图片保存失败:', result.error);
          break;
        }
        const imageMarkdown = `![图片](${result.relativePath})`;
        if (viewModeRef.current === 'wysiwyg' && editorRef.current) {
          editorRef.current.insertAtCursor(imageMarkdown);
        } else {
          const ta = document.querySelector<HTMLTextAreaElement>('.source-editor');
          const current = tabsRef.current.find((t) => t.id === activeIdRef.current);
          if (ta && current) {
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const next = current.content.slice(0, start) + imageMarkdown + current.content.slice(end);
            setTabs((prev) => prev.map((t) => (t.id === current.id ? { ...t, content: next, dirty: true } : t)));
            requestAnimationFrame(() => {
              ta.focus();
              ta.setSelectionRange(start + imageMarkdown.length, start + imageMarkdown.length);
            });
          }
        }
        break;
      }
    }
  }, []);

  // 快捷键统一由原生应用菜单注册，避免菜单加速器与渲染层重复触发

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => void handlePaste(event);
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handlePaste]);

  // 拖拽打开：把 .md 文件拖到窗口内打开
  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    const onDrop = (event: DragEvent): void => {
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return;
      event.preventDefault();
      const filePath = (files[0] as File & { path?: string }).path;
      if (filePath) void handleOpenPath(filePath);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleOpenPath]);

  // 监听主进程的 open-file 事件（拖到 Dock 图标 / Finder 打开方式）
  useEffect(() => window.api.onOpenFile((filePath) => void handleOpenPath(filePath)), [handleOpenPath]);

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

  /** 把源码变换结果写回活动标签，并恢复 textarea 选区 */
  const applySourceResult = useCallback((result: SourceResult) => {
    const id = activeIdRef.current;
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, content: result.content, dirty: true } : t)));
    requestAnimationFrame(() => {
      const ta = document.querySelector<HTMLTextAreaElement>('.source-editor');
      if (ta) {
        ta.focus();
        ta.setSelectionRange(result.selectionStart, result.selectionEnd);
      }
    });
  }, []);

  /**
   * 统一格式化入口：工具栏、系统菜单共用。
   * WYSIWYG 走 ProseMirror 命令，源码模式走等价的 Markdown 文本变换。
   */
  const applyFormat = useCallback((action: FormatAction, payload?: number | string): void => {
    if (readOnlyRef.current) return;
    if (viewModeRef.current === 'wysiwyg' && editorRef.current) {
      editorRef.current.format(action, payload);
      editorRef.current.focus();
      return;
    }
    const ta = document.querySelector<HTMLTextAreaElement>('.source-editor');
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (!tab) return;
    const ctx = {
      content: tab.content,
      selectionStart: ta?.selectionStart ?? 0,
      selectionEnd: ta?.selectionEnd ?? 0
    };
    applySourceResult(applySourceFormat(action, payload, ctx));
  }, [applySourceResult]);

  /**
   * 撤销 / 重做。
   *
   * WYSIWYG 必须走 ProseMirror 的历史命令：Electron 的 role: 'undo' 调的是
   * webContents 的 DOM 撤销，而 ProseMirror 的编辑历史不经过 DOM，所以菜单里
   * 原来的 role 版 Cmd+Z 一直无效。源码模式与查找框等原生控件则用 DOM 撤销。
   */
  const handleUndoRedo = useCallback((kind: 'undo' | 'redo') => {
    if (readOnlyRef.current) return;

    // 源码模式：使用自建快照栈
    if (viewModeRef.current === 'source') {
      const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
      if (!tab) return;
      const history = sourceHistoryRef.current;
      const target = kind === 'undo' ? history.past.pop() : history.future.pop();
      if (target === undefined) return;
      if (kind === 'undo') history.future.push(tab.content);
      else history.past.push(tab.content);
      setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, content: target, dirty: true } : t)));
      requestAnimationFrame(() => {
        const ta = document.querySelector<HTMLTextAreaElement>('.source-editor');
        if (ta) {
          ta.focus();
          ta.setSelectionRange(target.length, target.length);
        }
      });
      return;
    }

    // 查找框等原生输入框：交给浏览器自己的撤销
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      document.execCommand(kind);
      return;
    }

    if (editorRef.current) {
      if (kind === 'undo') editorRef.current.undo();
      else editorRef.current.redo();
    }
  }, []);

  /** 插入链接 / 图片占位 */
  const handleInsertLink = useCallback(() => applyFormat('snippet', '[链接文字](url)'), [applyFormat]);
  const handleInsertImage = useCallback(() => applyFormat('snippet', '![图片](url)'), [applyFormat]);

  /** 从本地文件选择图片并插入相对路径（复用粘贴图片的 assets 保存链路） */
  const handleChooseImage = useCallback(async () => {
    if (readOnlyRef.current) return;
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    const docDir = tab?.path ? tab.path.slice(0, tab.path.lastIndexOf('/')) : '';
    const result = await window.api.chooseImage(docDir);
    if (result.relativePath) applyFormat('snippet', `![图片](${result.relativePath})`);
  }, [applyFormat]);

  /** 导出当前文档为 HTML/PDF/Word */
  const handleExport = useCallback(async (format: 'html' | 'pdf' | 'word') => {
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (!tab) return;
    const result = await window.api.exportFile({ format, markdown: tab.content, defaultName: tab.name });
    if (!result.ok && result.error !== '已取消') console.error('导出失败:', result.error);
  }, []);

  /** 复制为指定格式 */
  const handleCopyAs = useCallback(async (format: 'plain' | 'markdown' | 'html') => {
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (tab) await window.api.writeClipboard({ format, markdown: tab.content });
  }, []);

  /** 粘贴为纯文本：读剪贴板纯文本后在光标处插入 */
  const handlePastePlain = useCallback(async () => {
    if (readOnlyRef.current) return;
    const text = await window.api.readClipboardText();
    if (text) applyFormat('snippet', text);
  }, [applyFormat]);

  /** 打开最近列表中的第一个文件 */
  const handleOpenMostRecent = useCallback(async () => {
    const recent = await window.api.getRecent();
    if (recent[0]) await handleOpenRecent(recent[0]);
  }, [handleOpenRecent]);

  // ===== 查找 / 替换 =====
  // wysiwyg 用 ProseMirror 纯文本，源码模式用 Markdown 原文，两者都按字符偏移定位
  useEffect(() => {
    const text = viewMode === 'wysiwyg' && editorRef.current
      ? editorRef.current.getPlainText()
      : activeTab?.content ?? '';
    setSearchText(text);
  }, [activeTab?.content, activeTab?.id, viewMode, editorVersion]);

  const matches = useMemo(() => {
    if (!findQuery) return [] as { start: number; end: number }[];
    const needle = findQuery.toLowerCase();
    const haystack = searchText.toLowerCase();
    const result: { start: number; end: number }[] = [];
    let from = 0;
    while (from < haystack.length) {
      const index = haystack.indexOf(needle, from);
      if (index === -1) break;
      result.push({ start: index, end: index + needle.length });
      from = index + Math.max(1, needle.length);
    }
    return result;
  }, [findQuery, searchText]);
  const matchesRef = useRef(matches);
  matchesRef.current = matches;

  useEffect(() => {
    findIndexRef.current = 0;
    setCurrentMatch(0);
  }, [findQuery]);

  /** 跳到第 N 个匹配项并选中 */
  const goToMatch = useCallback((step: number) => {
    const list = matchesRef.current;
    if (list.length === 0) return;
    const next = (findIndexRef.current + step + list.length) % list.length;
    findIndexRef.current = next;
    setCurrentMatch(next);
    const target = list[next];
    if (viewModeRef.current === 'wysiwyg' && editorRef.current) {
      editorRef.current.selectTextRange(target.start, target.end);
      return;
    }
    const ta = document.querySelector<HTMLTextAreaElement>('.source-editor');
    if (ta) {
      ta.focus();
      ta.setSelectionRange(target.start, target.end);
    }
  }, []);

  /** 替换当前匹配项 */
  const replaceCurrent = useCallback(() => {
    if (readOnlyRef.current) return;
    const list = matchesRef.current;
    if (list.length === 0) return;
    const target = list[findIndexRef.current] ?? list[0];
    const replacement = replaceTextRef.current;
    if (viewModeRef.current === 'wysiwyg' && editorRef.current) {
      editorRef.current.selectTextRange(target.start, target.end);
      editorRef.current.replaceSelection(replacement);
      return;
    }
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (!tab) return;
    const content = tab.content.slice(0, target.start) + replacement + tab.content.slice(target.end);
    setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, content, dirty: true } : t)));
  }, []);

  /** 替换全部：从后往前替换，避免偏移变化 */
  const replaceAll = useCallback(() => {
    if (readOnlyRef.current) return;
    const list = [...matchesRef.current].reverse();
    if (list.length === 0) return;
    const replacement = replaceTextRef.current;
    if (viewModeRef.current === 'wysiwyg' && editorRef.current) {
      list.forEach((target) => {
        editorRef.current?.selectTextRange(target.start, target.end);
        editorRef.current?.replaceSelection(replacement);
      });
      return;
    }
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (!tab) return;
    let content = tab.content;
    list.forEach((target) => {
      content = content.slice(0, target.start) + replacement + content.slice(target.end);
    });
    setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, content, dirty: true } : t)));
  }, []);

  /** 打开查找栏（可同时展开替换） */
  const openFind = useCallback((withReplace: boolean) => {
    setFindOpen(true);
    if (withReplace) setShowReplace(true);
  }, []);

  // ===== 原生菜单动作分发（分发表在 menuHandlers.ts 中维护） =====
  const menuHandlersRef = useRef<ReturnType<typeof buildMenuHandlers>>({});
  menuHandlersRef.current = buildMenuHandlers({
    newTab: handleNewTab,
    newWindow: () => void window.api.newWindow(),
    openFile: () => void handleOpen(),
    openMostRecent: () => void handleOpenMostRecent(),
    openPath: (path) => void handleOpenPath(path),
    quickOpen: () => void handleQuickOpen(),
    closeTab: () => handleCloseTab(activeIdRef.current),
    save: () => void handleSave(),
    saveAll: () => void handleSaveAll(),
    saveAs: () => void handleSaveAs(),
    duplicate: () => void handleDuplicate(),
    reloadFromDisk: () => void handleReloadFromDisk(),
    openRename: () => {
      if (tabsRef.current.find((t) => t.id === activeIdRef.current)?.path) setRenameOpen(true);
    },
    revealInFolder: () => {
      const path = tabsRef.current.find((t) => t.id === activeIdRef.current)?.path;
      if (path) void window.api.revealInFolder(path);
    },
    print: () => void window.api.print(),
    exportAs: (format) => void handleExport(format),
    copyAs: (format) => void handleCopyAs(format),
    undo: () => handleUndoRedo('undo'),
    redo: () => handleUndoRedo('redo'),
    pastePlain: () => void handlePastePlain(),
    format: applyFormat,
    insertLink: handleInsertLink,
    insertImage: handleInsertImage,
    chooseImage: () => void handleChooseImage(),
    openFind,
    goToMatch,
    toggleMode: toggleViewMode,
    toggleTabbar: () => setTabbarVisible((v) => !v),
    toggleReadOnly: () => setReadOnly((v) => !v),
    toggleFocus: () => setFocusMode((v) => !v),
    toggleTypewriter: () => setTypewriterMode((v) => !v),
    toggleToolbar: () => setToolbarVisible((v) => !v),
    toggleSidebar: () => setSidebarOpen((v) => !v),
    showPanel: (panel) => {
      setSidebarPanel(panel);
      setSidebarOpen(true);
      // 「在文件树中显示」：面板已打开时 activePath 不会变，需要主动滚到高亮项
      if (panel === 'files') {
        requestAnimationFrame(() => {
          document.querySelector('.tree-file-active')?.scrollIntoView({ block: 'nearest' });
        });
      }
    },
    toggleWordCount: () => setWordCountVisible((v) => !v),
    toggleOutlineWindow: () => setOutlineWindowVisible((v) => !v),
    zoom: (action) => void window.api.zoom(action),
    toggleAlwaysOnTop: () => {
      const next = !alwaysOnTopRef.current;
      alwaysOnTopRef.current = next;
      setAlwaysOnTop(next);
      void window.api.setAlwaysOnTop(next);
    },
    toggleFullScreen: () => {
      void window.api.toggleFullScreen().then(setFullscreen);
    },
    minimizeWindow: () => void window.api.minimizeWindow()
  });

  // 监听原生应用菜单动作（含可选参数）
  useEffect(() => window.api.onMenuAction((action, payload) => {
    menuHandlersRef.current[action]?.(payload);
  }), []);

  return (
    <div
      className={`app ${tabbarVisible ? '' : 'app-no-tabbar'} ${focusMode ? 'focus-mode' : ''} ${typewriterMode ? 'typewriter-mode' : ''}`}
      style={cssVars}
    >
      {/* 标签栏：文档标签在左，主题/侧栏动作固定在右上角 */}
      {tabbarVisible && (
        <Tabs
          tabs={tabs}
          activeId={activeId}
          onSelect={handleSelectTab}
          onClose={handleCloseTab}
          onNew={handleNewTab}
          actions={
            <TopbarActions
              themeId={themeId}
              onThemeChange={setThemeId}
              sidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen((v) => !v)}
            />
          }
        />
      )}

      {/* 主体 */}
      <div className="main">
        <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : 'sidebar-collapsed'}`}>
          {sidebarOpen ? (
            <>
              <div className="sidebar-tabs">
                <button
                  className={`sidebar-tab ${sidebarPanel === 'files' ? 'sidebar-tab-active' : ''}`}
                  onClick={() => setSidebarPanel('files')}
                >
                  文件
                </button>
                <button
                  className={`sidebar-tab ${sidebarPanel === 'outline' ? 'sidebar-tab-active' : ''}`}
                  onClick={() => setSidebarPanel('outline')}
                >
                  大纲
                </button>
              </div>
              {sidebarPanel === 'files' ? (
                <FileTree
                  rootDir={treeRoot}
                  activePath={activeTab?.path ?? null}
                  onOpenFile={(path, name) => void handleOpenPath(path, name)}
                  onChooseFolder={() => void handleChooseFolder()}
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
                        onClick={() => handleOutlineClick(item.line, item.index)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleOutlineClick(item.line, item.index);
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

        {/* 编辑区 */}
        <main className="editor-wrap">
          {findOpen && (
            <FindBar
              query={findQuery}
              onQuery={setFindQuery}
              replaceText={replaceText}
              onReplaceText={setReplaceText}
              showReplace={showReplace}
              onToggleReplace={() => setShowReplace((v) => !v)}
              matchCount={matches.length}
              currentMatch={currentMatch}
              onNext={() => goToMatch(1)}
              onPrev={() => goToMatch(-1)}
              onReplace={replaceCurrent}
              onReplaceAll={replaceAll}
              onClose={() => setFindOpen(false)}
            />
          )}
          <div className="editor-inner">
            {viewMode === 'wysiwyg' ? (
              <MarkdownEditor initialValue={activeTab?.content ?? ''} onChange={handleChange} onReady={handleReady} />
            ) : (
              <textarea
                className="source-editor"
                value={activeTab?.content ?? ''}
                onChange={(event) => handleSourceChange(event.target.value)}
                placeholder="在此输入 Markdown 源码..."
                spellCheck={false}
                readOnly={readOnly}
              />
            )}
          </div>
          {toolbarVisible && !readOnly && (
            <Toolbar
              onFormat={applyFormat}
              onInsertLink={handleInsertLink}
              onInsertImage={handleInsertImage}
            />
          )}
        </main>
      </div>

      {/* 浮动窗口 / 对话框 */}
      <FloatPanels
        stats={stats}
        outline={outline}
        wordCountVisible={wordCountVisible}
        outlineWindowVisible={outlineWindowVisible}
        onOutlineClick={handleOutlineClick}
        onCloseWordCount={() => setWordCountVisible(false)}
        onCloseOutline={() => setOutlineWindowVisible(false)}
      />
      {quickOpenOpen && (
        <QuickOpen
          recent={quickEntries.recent}
          treeFiles={quickEntries.tree}
          onPick={(path) => {
            setQuickOpenOpen(false);
            void handleOpenPath(path);
          }}
          onClose={() => setQuickOpenOpen(false)}
        />
      )}
      {renameOpen && (
        <RenameDialog
          initialName={activeTab?.name ?? '未命名.md'}
          onSubmit={(name) => void handleRename(name)}
          onClose={() => setRenameOpen(false)}
        />
      )}

      {/* 状态栏 */}
      <footer className="statusbar">
        <span>{viewMode === 'wysiwyg' ? 'Markdown' : '源码'}</span>
        {readOnly && <span>只读</span>}
        <span>UTF-8</span>
        <div className="spacer" />
        <span>{stats.lineCount} 行</span>
        <span>{stats.wordCount} 字</span>
      </footer>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { themes, tokensToCssVars, type ThemeId } from '@ai-md-editor/theme';
import { extractOutline } from '@ai-md-editor/markdown-core';
import type { EditorInstance } from '@ai-md-editor/editor';
import MarkdownEditor from './MarkdownEditor';
import Tabs, { type Tab } from './Tabs';
import RecentFiles from './RecentFiles';

/** 默认文档内容 */
const DEFAULT_DOC = `# MarkdownNote

对标 Typora 的跨平台 Markdown 编辑器，所见即所得。

## 核心特性

- 输入即渲染（WYSIWYG）
- 克制动效，专注内容
- 现代极简，去 AI 味

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
 * M1：接入 Milkdown，打通内容 ↔ 状态栏 ↔ 大纲数据流。
 * M2：接入文件打开/保存、图片粘贴（相对路径 assets 目录）。
 * M3：多标签页管理。
 *
 * 架构：单编辑器实例 + 切换内容。切换标签时先保存旧标签内容，再载入新标签。
 */
export default function App(): JSX.Element {
  // 主题状态，默认 light
  const [themeId, setThemeId] = useState<ThemeId>('light');
  // 侧边栏折叠状态
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // 标签列表（初始一个未命名文档）
  const [tabs, setTabs] = useState<Tab[]>(() => [createTab('未命名.md', DEFAULT_DOC)]);
  // 当前活动标签 id
  const [activeId, setActiveId] = useState<string>(() => tabs[0]?.id ?? '');
  // 视图模式：wysiwyg（所见即所得）| source（源码）
  const [viewMode, setViewMode] = useState<'wysiwyg' | 'source'>('wysiwyg');

  // 编辑器实例引用（通过 onReady 获取）
  const editorRef = useRef<EditorInstance | null>(null);
  // 保存最新的 tabs 和 activeId，供事件回调使用（避免闭包过期）
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

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

  // 内容变化回调：更新活动标签的 content + dirty
  const handleChange = useCallback((markdown: string) => {
    const id = activeIdRef.current;
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, content: markdown, dirty: true } : t)));
  }, []);

  // 编辑器就绪回调：保存实例引用
  const handleReady = useCallback((instance: EditorInstance) => {
    editorRef.current = instance;
  }, []);

  // 切换主题
  const toggleTheme = (): void => {
    setThemeId((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  /** 切换源码/渲染模式 */
  const toggleViewMode = useCallback(() => {
    const next = viewModeRef.current === 'wysiwyg' ? 'source' : 'wysiwyg';
    if (next === 'source') {
      // 渲染 → 源码：清空编辑器实例引用（MarkdownEditor 即将卸载销毁实例）
      // 源码 textarea 是受控的，直接绑定 activeTab.content
      editorRef.current = null;
    }
    // 源码 → 渲染：MarkdownEditor 重新挂载时用 initialValue（activeTab.content）初始化，无需手动 setMarkdown
    setViewMode(next);
  }, []);

  /** 大纲点击跳转：滚动编辑器到对应标题 */
  const handleOutlineClick = useCallback((text: string) => {
    // 源码模式下无编辑器实例，直接滚动源码 textarea 对应行
    if (viewModeRef.current === 'source') {
      const idx = outline.findIndex((i) => i.text === text);
      if (idx >= 0) {
        const targetLine = outline[idx].line;
        const ta = document.querySelector<HTMLTextAreaElement>('.source-editor');
        if (ta) {
          // 估算行高，滚动到目标行
          const lineHeight = 20;
          ta.scrollTop = Math.max(0, (targetLine - 1) * lineHeight);
        }
      }
      return;
    }
    editorRef.current?.scrollToHeading(text);
  }, [outline]);

  /** 切换标签：载入目标标签内容到编辑器 */
  const handleSelectTab = useCallback((id: string) => {
    if (id === activeIdRef.current) return;
    const target = tabsRef.current.find((t) => t.id === id);
    if (!target) return;
    setActiveId(id);
    editorRef.current?.setMarkdown(target.content);
  }, []);

  /** 新建标签 */
  const handleNewTab = useCallback(() => {
    const tab = createTab('未命名.md', '');
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
    editorRef.current?.setMarkdown('');
  }, []);

  /** 关闭标签 */
  const handleCloseTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      // 关闭的是活动标签时，切换到相邻标签
      if (id === activeIdRef.current) {
        if (next.length === 0) {
          // 关闭最后一个标签：保留一个空的未命名文档
          const fallback = createTab('未命名.md', '');
          setActiveId(fallback.id);
          editorRef.current?.setMarkdown('');
          return [fallback];
        }
        const newActive = next[Math.min(idx, next.length - 1)];
        setActiveId(newActive.id);
        editorRef.current?.setMarkdown(newActive.content);
      }
      return next;
    });
  }, []);

  /** 打开文件内容（新建/复用标签），供对话框、拖拽、open-file 事件复用 */
  const openFileContent = useCallback((path: string, name: string, content: string) => {
    // 若已有相同路径的标签，直接切换到它
    const existing = tabsRef.current.find((t) => t.path === path);
    if (existing) {
      setActiveId(existing.id);
      editorRef.current?.setMarkdown(existing.content);
      return;
    }
    // 否则新建标签载入内容
    const tab = createTab(name, content, path);
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
    editorRef.current?.setMarkdown(content);
  }, []);

  /** 打开文件：弹出对话框选择文件 */
  const handleOpen = useCallback(async () => {
    const result = await window.api.openFile();
    if (result.canceled || !result.path || result.content === null) return;
    openFileContent(result.path, result.name ?? '未命名.md', result.content);
  }, [openFileContent]);

  /** 打开最近文件列表中的某个文件 */
  const handleOpenRecent = useCallback(
    async (file: { path: string; name: string }) => {
      const result = await window.api.openPath(file.path);
      if (!result.canceled && result.path && result.content !== null) {
        openFileContent(result.path, result.name ?? file.name, result.content);
      }
    },
    [openFileContent]
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
          prev.map((t) =>
            t.id === tab.id ? { ...t, path: result.path, name: result.name ?? tab.name, dirty: false } : t
          )
        );
      }
    }
  }, []);

  /** 另存为：弹出保存对话框 */
  const handleSaveAs = useCallback(async () => {
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (!tab) return;
    const result = await window.api.saveFileAs(tab.content, tab.name);
    if (!result.canceled && result.path) {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tab.id ? { ...t, path: result.path, name: result.name ?? tab.name, dirty: false } : t
        )
      );
    }
  }, []);

  /** 处理图片粘贴：保存到 assets/ 目录，插入 markdown 图片语法 */
  const handlePaste = useCallback(async (event: ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (!blob) continue;
        event.preventDefault();

        const extension = item.type.split('/')[1] ?? 'png';
        const arrayBuffer = await blob.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);

        // 文档目录：活动标签的文件目录；未打开文件时为空
        const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
        const docDir = tab?.path ? tab.path.slice(0, tab.path.lastIndexOf('/')) : '';

        const result = await window.api.saveImage({ data, extension, docDir });
        if (result.relativePath) {
          const imgMarkdown = `![图片](${result.relativePath})`;
          // 有编辑器实例（wysiwyg 模式）时在光标处插入；否则（源码模式）用当前选区插入
          const editor = editorRef.current;
          if (editor && viewModeRef.current === 'wysiwyg') {
            editor.insertAtCursor(imgMarkdown);
          } else {
            // 源码模式：手动在 textarea 选区插入 markdown 图片语法
            const ta = document.querySelector<HTMLTextAreaElement>('.source-editor');
            const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
            if (ta && tab) {
              const start = ta.selectionStart;
              const end = ta.selectionEnd;
              const next = tab.content.slice(0, start) + imgMarkdown + tab.content.slice(end);
              setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, content: next, dirty: true } : t)));
              // 光标定位到插入文本之后
              requestAnimationFrame(() => {
                ta.focus();
                ta.setSelectionRange(start + imgMarkdown.length, start + imgMarkdown.length);
              });
            }
          }
        } else {
          console.error('图片保存失败:', result.error);
        }
        break;
      }
    }
  }, []);

  // 键盘快捷键：Cmd/Ctrl+S 保存、Cmd/Ctrl+/ 切换源码/渲染模式
  useEffect(() => {
    const onKeydown = (event: KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
      } else if (mod && event.key === '/') {
        event.preventDefault();
        toggleViewMode();
      }
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, [handleSave, toggleViewMode]);

  // 图片粘贴监听
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      void handlePaste(event);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handlePaste]);

  // 拖拽打开：把 .md 文件拖到窗口内打开
  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      // 有文件拖入时阻止默认（否则会导航到文件）
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault();
      }
    };
    const onDrop = (event: DragEvent): void => {
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return;
      event.preventDefault();
      const file = files[0];
      const filePath = (file as File & { path?: string }).path;
      // Electron 的 File 对象带 path 属性（拖拽的文件）
      if (filePath) {
        void (async () => {
          const result = await window.api.openPath(filePath);
          if (!result.canceled && result.path && result.content !== null) {
            openFileContent(result.path, result.name ?? '未命名.md', result.content);
          }
        })();
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [openFileContent]);

  // 监听主进程的 open-file 事件（拖到 Dock 图标 / Finder 打开方式）
  useEffect(() => {
    const off = window.api.onOpenFile((filePath) => {
      void (async () => {
        const result = await window.api.openPath(filePath);
        if (!result.canceled && result.path && result.content !== null) {
          openFileContent(result.path, result.name ?? '未命名.md', result.content);
        }
      })();
    });
    return off;
  }, [openFileContent]);

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

  // 统计信息（基于活动标签内容）
  const stats = useMemo(() => {
    const text = activeTab?.content ?? '';
    const lines = text.split('\n');
    return { lineCount: lines.length, wordCount: text.replace(/\s/g, '').length };
  }, [activeTab]);

  return (
    <div className="app" style={cssVars}>
      {/* 顶部栏：功能按钮靠左，应用名靠右 */}
      <header className="topbar">
        <button className="icon-btn" onClick={() => void handleOpen()} title="打开文件 (Cmd/Ctrl+O)">
          打开
        </button>
        <RecentFiles onSelect={(file) => void handleOpenRecent(file)} />
        <button className="icon-btn" onClick={() => void handleSave()} title="保存 (Cmd/Ctrl+S)">
          保存
        </button>
        <button className="icon-btn" onClick={() => void handleSaveAs()} title="另存为">
          另存为
        </button>
        <button className="icon-btn" onClick={toggleViewMode} title="切换源码/渲染模式 (Cmd/Ctrl+/ )">
          {viewMode === 'wysiwyg' ? '源码' : '渲染'}
        </button>
        <button className="icon-btn" onClick={() => setSidebarOpen((v) => !v)} title="切换侧边栏">
          侧栏
        </button>
        <button className="icon-btn" onClick={toggleTheme} title="切换主题">
          {themeId === 'light' ? '深色' : '浅色'}
        </button>
        <div className="spacer" />
        <span className="brand">MarkdownNote</span>
      </header>

      {/* 标签栏 */}
      <Tabs
        tabs={tabs}
        activeId={activeId}
        onSelect={handleSelectTab}
        onClose={handleCloseTab}
        onNew={handleNewTab}
      />

      {/* 主体 */}
      <div className="main">
        {/* 侧边栏（文档结构/大纲），支持收缩 */}
        <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : 'sidebar-collapsed'}`}>
          {sidebarOpen ? (
            <>
              <div className="sidebar-head">
                <span>文档结构</span>
                <button
                  className="sidebar-toggle"
                  onClick={() => setSidebarOpen(false)}
                  title="收起侧栏"
                >
                  ‹
                </button>
              </div>
              <div className="outline-list">
                {outline.length === 0 ? (
                  <div className="outline-empty">暂无标题</div>
                ) : (
                  outline.map((item) => (
                    <div
                      key={item.line}
                      className="outline-item"
                      style={{ paddingLeft: 16 + (item.level - 1) * 14 }}
                      onClick={() => handleOutlineClick(item.text)}
                      role="button"
                      tabIndex={0}
                      title={`跳转到「${item.text}」`}
                    >
                      {item.text}
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <button
              className="sidebar-collapsed-bar"
              onClick={() => setSidebarOpen(true)}
              title="展开侧栏"
            >
              ›
            </button>
          )}
        </aside>

        {/* 编辑区（主角）：wysiwyg 用 Milkdown，source 用源码 textarea */}
        <main className="editor-wrap">
          <div className="editor-inner">
            {viewMode === 'wysiwyg' ? (
              <MarkdownEditor initialValue={activeTab?.content ?? ''} onChange={handleChange} onReady={handleReady} />
            ) : (
              <textarea
                className="source-editor"
                value={activeTab?.content ?? ''}
                onChange={(e) => handleChange(e.target.value)}
                placeholder="在此输入 Markdown 源码..."
                spellCheck={false}
              />
            )}
          </div>
        </main>
      </div>

      {/* 状态栏 */}
      <footer className="statusbar">
        <span>{viewMode === 'wysiwyg' ? 'Markdown' : '源码'}</span>
        <span>UTF-8</span>
        <div className="spacer" />
        <span>{stats.lineCount} 行</span>
        <span>{stats.wordCount} 字</span>
      </footer>
    </div>
  );
}

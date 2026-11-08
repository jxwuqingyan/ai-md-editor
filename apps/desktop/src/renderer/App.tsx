import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { extractOutline } from '@ai-md-editor/markdown-core';
import type { EditorInstance, TableContext } from '@ai-md-editor/editor';
import { TEXT_ENCODING_LABELS } from '@ai-md-editor/shared';
import { NO_TABLE_CONTEXT } from './constants';
import MarkdownEditor from './MarkdownEditor';
import Tabs from './Tabs';
import TopbarActions from './TopbarActions';
import Sidebar from './Sidebar';
import Toolbar from './Toolbar';
import { FindBar, QuickOpen, RenameDialog, FloatPanels, type DocStats, type QuickEntry } from './Dialogs';
import { useSourceHistory } from './hooks/useSourceHistory';
import { useTabs } from './hooks/useTabs';
import { useDisplayState } from './hooks/useDisplayState';
import { useEditorRuntime } from './hooks/useEditorRuntime';
import { useEditing } from './hooks/useEditing';
import { useFindReplace } from './hooks/useFindReplace';
import { useSourceTableContext } from './hooks/useSourceTableContext';
import { useMenuBridge } from './hooks/useMenuBridge';

/**
 * 应用根组件。
 * 架构：单编辑器实例 + 切换内容；原生菜单动作统一经 IPC 分发到这里。
 *
 * 状态按职责拆到 hooks：
 * - useTabs           文档 / 标签 / 文件读写 / 自动保存 / 会话恢复
 * - useDisplayState   主题 / 侧栏 / 视图模式 / 显示开关 / 缩放 / 窗口状态
 * - useEditorRuntime  编辑器实例生命周期
 * - useEditing        格式化 / 撤销重做 / 粘贴 / 复制导出
 * - useFindReplace    查找替换
 * - useMenuBridge     原生菜单动作分发
 */

/** 状态栏提示：可带一个动作按钮（如「重新加载」） */
interface Notice {
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function App(): JSX.Element {
  // ===== 文档 =====
  const history = useSourceHistory();
  const editorRef = useRef<EditorInstance | null>(null);

  // 状态栏短暂提示（图片保存失败、外部修改等）
  const [notice, setNotice] = useState<Notice | null>(null);

  /** 显示一条纯文本提示 */
  const showNotice = useCallback((text: string) => {
    setNotice({ text });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const {
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
  } = useTabs({
    editorRef,
    history,
    onSessionRestored: (count) => {
      if (count > 0) setNotice({ text: `已恢复上次打开的 ${count} 个文档` });
    },
    onNotice: showNotice
  });

  // ===== 界面状态 =====
  const {
    themeId,
    setThemeId,
    sidebarOpen,
    setSidebarOpen,
    sidebarPanel,
    setSidebarPanel,
    viewMode,
    viewModeRef,
    tabbarVisible,
    setTabbarVisible,
    readOnly,
    readOnlyRef,
    setReadOnly,
    focusMode,
    setFocusMode,
    typewriterMode,
    setTypewriterMode,
    toolbarVisible,
    setToolbarVisible,
    wordCountVisible,
    setWordCountVisible,
    outlineWindowVisible,
    setOutlineWindowVisible,
    zoomPercent,
    setTableContext,
    cssVars,
    toggleViewMode,
    toggleAlwaysOnTop,
    toggleFullScreen,
    zoom
  } = useDisplayState({ hasPath: Boolean(activeTab?.path) });

  // 当前文档所在目录：编辑器用它把相对图片路径解析成可显示地址
  const docDir = useMemo(() => {
    const path = activeTab?.path;
    if (!path) return null;
    const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return index > 0 ? path.slice(0, index) : null;
  }, [activeTab?.path]);


  // ===== 编辑器 =====
  const { editorVersion, handleReady } = useEditorRuntime({
    editorRef,
    tabsRef,
    activeIdRef,
    readOnly,
    typewriterMode,
    viewMode
  });

  useEffect(() => {
    editorRef.current?.setImageBaseDir(docDir);
  }, [docDir, editorVersion, viewMode]);

  const {
    applyFormat,
    undoRedo,
    handlePaste,
    insertImagesFromPaths,
    chooseImage,
    pastePlain,
    copyAs,
    exportAs
  } = useEditing({
    editorRef,
    tabsRef,
    activeIdRef,
    viewModeRef,
    readOnlyRef,
    history,
    setActiveContent,
    ensureDocPath: ensureActivePath,
    onError: showNotice
  });

  const {
    findOpen,
    showReplace,
    findQuery,
    setFindQuery,
    replaceText,
    setReplaceText,
    matches,
    currentMatch,
    openFind,
    closeFind,
    toggleReplace,
    goToMatch,
    replaceCurrent,
    replaceAll
  } = useFindReplace({
    editorRef,
    viewModeRef,
    readOnlyRef,
    activeContent: activeTab?.content ?? '',
    activeId,
    viewMode,
    editorVersion,
    setActiveContent
  });

  // ===== 浮层 =====
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [quickEntries, setQuickEntries] = useState<{ recent: QuickEntry[]; tree: QuickEntry[] }>({
    recent: [],
    tree: []
  });
  // 命名对话框：'rename' = 重命名当前文件，'create' = 新建文件先命名
  const [renameMode, setRenameMode] = useState<'rename' | 'create' | null>(null);

  // 文件树刷新信号：⋮ 菜单「刷新」与「新建文件」时递增，驱动 FileTree 重读根目录
  const [treeRefreshToken, setTreeRefreshToken] = useState(0);

  // 从活动标签内容提取大纲（实时跟随编辑）。
  // remark 解析要遍历整篇文档，用延迟值把渲染降为低优先级：
  // 连续输入时只解析最后一次，长文档不再每敲一个字就卡一下。
  const deferredContent = useDeferredValue(activeTab?.content ?? '');
  const outline = useMemo(() => extractOutline(deferredContent), [deferredContent]);

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

  /**
   * 上报光标表格上下文。
   * 只在「是否在表格 / 是否在表头」真正变化时才更新，
   * 否则每次按键都会触发原生菜单重建。
   */
  const updateTableContext = useCallback(
    (next: TableContext) => {
      setTableContext((prev) =>
        prev.inTable === next.inTable && prev.inHeader === next.inHeader ? prev : next
      );
    },
    [setTableContext]
  );

  // 源码模式没有编辑器实例，按 textarea 光标位置推断表格上下文
  useSourceTableContext({
    viewMode,
    content: activeTab?.content ?? '',
    onContext: updateTableContext
  });

  /** 切换源码 / 渲染模式 */
  const handleToggleMode = useCallback(() => {
    const next = viewModeRef.current === 'wysiwyg' ? 'source' : 'wysiwyg';
    // 切到源码后编辑器即将卸载，先清掉实例引用，避免格式化命令打到旧实例
    if (next === 'source') {
      editorRef.current = null;
      updateTableContext(NO_TABLE_CONTEXT);
    }
    // 切换视图后旧的文本快照不再对应，清空避免撤回到别的模式的内容
    history.reset();
    toggleViewMode();
  }, [viewModeRef, editorRef, updateTableContext, history, toggleViewMode]);

  /** 大纲点击跳转：源码按行号定位选区，渲染按标题序号定位节点 */
  const handleOutlineClick = useCallback(
    (line: number, index: number) => {
      if (viewModeRef.current === 'source') {
        const ta = document.querySelector<HTMLTextAreaElement>('.source-editor');
        const active = tabsRef.current.find((tab) => tab.id === activeIdRef.current);
        if (ta && active) {
          const offset = active.content
            .split('\n')
            .slice(0, line - 1)
            .reduce((sum, text) => sum + text.length + 1, 0);
          ta.focus();
          ta.setSelectionRange(offset, offset);
        }
        return;
      }
      editorRef.current?.scrollToHeading(index);
    },
    [viewModeRef, tabsRef, activeIdRef, editorRef]
  );

  /** 快速打开：载入最近文件 + 文件树两层内的 Markdown 文件 */
  const handleQuickOpen = useCallback(async () => {
    setQuickEntries(await loadQuickEntries());
    setQuickOpenOpen(true);
  }, [loadQuickEntries]);

  /** 打开最近列表中的第一个文件 */
  const handleOpenMostRecent = useCallback(async () => {
    const recent = await window.api.getRecent();
    if (recent[0]) await openPath(recent[0].path, recent[0].name);
  }, [openPath]);

  /**
   * 打开命名对话框。
   * 有路径的文件走磁盘改名；未落盘的标签没有磁盘目标，只改标签名（保存时用它作默认文件名）。
   */
  const openRenameDialog = useCallback(() => {
    const tab = tabsRef.current.find((item) => item.id === activeIdRef.current);
    if (!tab) return;
    setRenameMode('rename');
  }, [tabsRef]);

  /** 命名对话框提交：新建文件时按输入名创建，否则重命名当前文件 */
  const handleRename = useCallback(
    async (name: string) => {
      const mode = renameMode;
      if (mode === 'create') {
        if (!treeRoot) {
          showNotice('请先打开一个文件夹');
          setRenameMode(null);
          return;
        }
        const result = await window.api.createFile(treeRoot, name);
        if (!result.ok || !result.path) {
          showNotice(`新建文件失败：${result.error ?? '未知错误'}`);
          return;
        }
        setRenameMode(null);
        setTreeRefreshToken((v) => v + 1);
        const segments = result.path.split(/[\\/]/);
        await openPath(result.path, segments[segments.length - 1]);
        return;
      }
      const result = await rename(name);
      if (!result.ok) {
        // 失败时保留对话框，用户可以直接改名字重试
        showNotice(`重命名失败：${result.error ?? '未知错误'}`);
        return;
      }
      setRenameMode(null);
      // 文件树缓存的是改名前的列表，不重读会一直显示旧文件名（看起来像没改名）
      setTreeRefreshToken((v) => v + 1);
    },
    [renameMode, treeRoot, openPath, rename, showNotice]
  );

  /** 双击非活动标签：先切过去，等活动标签生效后再弹命名框 */
  const pendingRenameRef = useRef(false);
  useEffect(() => {
    if (!pendingRenameRef.current) return;
    pendingRenameRef.current = false;
    openRenameDialog();
  }, [activeId, openRenameDialog]);

  /** 插入链接 / 图片占位 */
  const handleInsertLink = useCallback(() => applyFormat('snippet', '[链接文字](url)'), [applyFormat]);
  const handleInsertImage = useCallback(() => applyFormat('snippet', '![图片](url)'), [applyFormat]);

  // ===== 侧栏文件树操作（⋮ 菜单） =====

  /** 刷新文件树 */
  const handleRefreshTree = useCallback(() => setTreeRefreshToken((v) => v + 1), []);

  /** 在目录里新建 Markdown 文件：先输入文件名，确认后再落盘并打开 */
  const handleCreateFile = useCallback(() => {
    if (!treeRoot) {
      showNotice('请先打开一个文件夹');
      return;
    }
    setRenameMode('create');
  }, [treeRoot, showNotice]);

  /** 在文件管理器中显示当前目录（macOS Finder / Windows 资源管理器） */
  const handleRevealFolder = useCallback(() => {
    const target = treeRoot ?? docDir ?? activeTab?.path ?? null;
    if (target) void window.api.revealInFolder(target);
    else showNotice('没有可显示的目录');
  }, [treeRoot, docDir, activeTab?.path, showNotice]);

  // ===== 侧栏搜索跳转 =====

  /** 待执行的搜索跳转：文件打开并渲染完成后再定位到匹配行 */
  const pendingJumpRef = useRef<{
    path: string;
    line: number;
    column: number;
    length: number;
    text: string;
    deadline: number;
  } | null>(null);

  /** 在当前文档里定位到匹配位置 */
  const jumpToSearchMatch = useCallback(
    (line: number, column: number, length: number, text: string): boolean => {
      if (viewModeRef.current === 'source') {
        const ta = document.querySelector<HTMLTextAreaElement>('.source-editor');
        const active = tabsRef.current.find((tab) => tab.id === activeIdRef.current);
        if (ta && active) {
          const lineStart = active.content
            .split('\n')
            .slice(0, line - 1)
            .reduce((sum, part) => sum + part.length + 1, 0);
          ta.focus();
          ta.setSelectionRange(lineStart + column, lineStart + column + length);
          return true;
        }
        return false;
      }
      const editor = editorRef.current;
      if (!editor) return false;
      // WYSIWYG 的纯文本与 Markdown 原文有差异，直接在纯文本里找匹配片段
      const hit = text.slice(column, column + length);
      const plain = editor.getPlainText();
      const index = plain.indexOf(hit);
      if (index < 0) return true; // 纯文本里找不到（如代码块匹配）就不再重试
      editor.selectTextRange(index, index + hit.length);
      return true;
    },
    [viewModeRef, tabsRef, activeIdRef, editorRef]
  );

  /** 点击搜索结果：已在当前文档则直接跳，否则先打开文件再跳 */
  const handleOpenMatch = useCallback(
    (path: string, name: string, line: number, column: number, length: number, text: string) => {
      const active = tabsRef.current.find((tab) => tab.id === activeIdRef.current);
      if (active?.path === path) {
        jumpToSearchMatch(line, column, length, text);
        return;
      }
      pendingJumpRef.current = { path, line, column, length, text, deadline: Date.now() + 2000 };
      void openPath(path, name);
    },
    [tabsRef, activeIdRef, jumpToSearchMatch, openPath]
  );

  // 文件打开/编辑器就绪后执行挂起的搜索跳转（WYSIWYG 内容异步渲染，最多重试到 deadline）
  useEffect(() => {
    const pending = pendingJumpRef.current;
    if (!pending || activeTab?.path !== pending.path) return;
    if (jumpToSearchMatch(pending.line, pending.column, pending.length, pending.text)) {
      pendingJumpRef.current = null;
      return;
    }
    const timer = window.setTimeout(function attempt() {
      const current = pendingJumpRef.current;
      if (!current) return;
      if (jumpToSearchMatch(current.line, current.column, current.length, current.text)) {
        pendingJumpRef.current = null;
        return;
      }
      if (Date.now() < current.deadline) window.setTimeout(attempt, 200);
      else pendingJumpRef.current = null; // 超时放弃
    }, 200);
    return () => window.clearTimeout(timer);
  }, [activeTab?.path, editorVersion, jumpToSearchMatch]);

  // 图片粘贴：保存到文档同级 img/ 并插入相对路径
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => void handlePaste(event);
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handlePaste]);

  // 拖拽：图片 → 复制进 img/ 并插入；文件夹 → 设为文件树根；其它文件 → 打开
  useEffect(() => {
    const isImagePath = (path: string): boolean => /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(path);

    const onDragOver = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };

    const onDrop = (event: DragEvent): void => {
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return;
      event.preventDefault();
      // Electron 32+ 的 File 没有 path 属性，必须经 preload 的 webUtils 取真实路径
      const paths = Array.from(files)
        .map((file) => window.api.getPathForFile(file))
        .filter((path): path is string => Boolean(path));
      if (paths.length === 0) return;

      void (async () => {
        const info = await window.api.statPath(paths[0]);
        if (info.isDirectory) {
          setTreeRoot(paths[0]);
          return;
        }
        const images = paths.filter(isImagePath);
        if (images.length > 0) {
          await insertImagesFromPaths(images);
          return;
        }
        await openPath(paths[0]);
      })();
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [openPath, insertImagesFromPaths, setTreeRoot]);

  // 监听主进程的 open-file 事件（拖到 Dock 图标 / Finder 打开方式）
  useEffect(() => window.api.onOpenFile((filePath) => void openPath(filePath)), [openPath]);

  // ===== 外部修改监听 =====
  // 只监听当前活动文档：切换标签时取消上一个的监听，避免文件多开时反复触发
  useEffect(() => {
    const path = activeTab?.path ?? null;
    if (!path) return;
    void window.api.watchFile(path);
    return () => {
      void window.api.unwatchFile(path);
    };
  }, [activeTab?.path]);

  useEffect(
    () =>
      window.api.onFileChanged(({ path }) => {
        const tab = tabsRef.current.find((item) => item.path === path);
        // 只对当前正在编辑的文档提示：后台标签重新激活时会重新读盘
        if (!tab || tab.id !== activeIdRef.current) return;
        if (tab.dirty) {
          setNotice({ text: '文件已被外部程序修改，当前文档有未保存改动' });
          return;
        }
        setNotice({
          text: '文件已被外部程序修改',
          actionLabel: '重新加载',
          onAction: () => {
            setNotice(null);
            void reloadPath(path);
          }
        });
      }),
    [reloadPath]
  );

  // ===== 关闭窗口前的未保存确认 =====
  // 主进程发问 → 这里同步回答当前标签状态；确认后主进程会再要求立即写盘一次
  useEffect(
    () =>
      window.api.onUnsavedAsk(() => {
        const list = tabsRef.current;
        window.api.replyUnsaved({
          untitledCount: list.filter((tab) => !tab.path && tab.dirty).length,
          dirtyCount: list.filter((tab) => tab.path && tab.dirty).length
        });
      }),
    [tabsRef]
  );

  useEffect(() => window.api.onFlushBeforeClose(() => void saveAll()), [saveAll]);

  // ===== 原生菜单动作分发 =====
  useMenuBridge({
    newTab,
    newWindow: () => void window.api.newWindow(),
    openFile: () => void openFile(),
    openMostRecent: () => void handleOpenMostRecent(),
    openPath: (path) => void openPath(path),
    quickOpen: () => void handleQuickOpen(),
    closeTab: () => closeTab(activeIdRef.current),
    save: () => void save(),
    saveAll: () => void saveAll(),
    saveAs: () => void saveAs(),
    duplicate: () => void duplicate(),
    reloadFromDisk: () => void reloadFromDisk(),
    openRename: openRenameDialog,
    revealInFolder: () => {
      const path = tabsRef.current.find((tab) => tab.id === activeIdRef.current)?.path;
      if (path) void window.api.revealInFolder(path);
    },
    print: () => void window.api.print(),
    exportAs: (format) => void exportAs(format),
    copyAs: (format) => void copyAs(format),
    undo: () => undoRedo('undo'),
    redo: () => undoRedo('redo'),
    pastePlain: () => void pastePlain(),
    format: applyFormat,
    insertLink: handleInsertLink,
    insertImage: handleInsertImage,
    chooseImage: () => void chooseImage(),
    openFind,
    goToMatch,
    toggleMode: handleToggleMode,
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
    zoom,
    toggleAlwaysOnTop,
    toggleFullScreen,
    minimizeWindow: () => void window.api.minimizeWindow()
  });

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
          onSelect={selectTab}
          onClose={closeTab}
          onNew={newTab}
          onRename={(id) => {
            if (id === activeId) openRenameDialog();
            else {
              pendingRenameRef.current = true;
              selectTab(id);
            }
          }}
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
        <Sidebar
          open={sidebarOpen}
          panel={sidebarPanel}
          onPanelChange={setSidebarPanel}
          outline={outline}
          onOutlineClick={handleOutlineClick}
          treeRoot={treeRoot}
          activePath={activeTab?.path ?? null}
          onOpenFile={(path, name) => void openPath(path, name)}
          onChooseFolder={() => void chooseFolder()}
          onCreateFile={() => void handleCreateFile()}
          onRenameFile={openRenameDialog}
          onRevealFolder={handleRevealFolder}
          onRefresh={handleRefreshTree}
          refreshToken={treeRefreshToken}
          onOpenMatch={handleOpenMatch}
        />

        {/* 编辑区 */}
        <main className="editor-wrap">
          {findOpen && (
            <FindBar
              query={findQuery}
              onQuery={setFindQuery}
              replaceText={replaceText}
              onReplaceText={setReplaceText}
              showReplace={showReplace}
              onToggleReplace={toggleReplace}
              matchCount={matches.length}
              currentMatch={currentMatch}
              onNext={() => goToMatch(1)}
              onPrev={() => goToMatch(-1)}
              onReplace={replaceCurrent}
              onReplaceAll={replaceAll}
              onClose={closeFind}
            />
          )}
          {/* 滚动容器：内容在其内部滚动，工具栏固定在下方，不与内容重叠 */}
          <div className="editor-scroll">
            <div className="editor-inner">
              {viewMode === 'wysiwyg' ? (
                <MarkdownEditor
                  initialValue={activeTab?.content ?? ''}
                  onChange={handleChange}
                  onReady={handleReady}
                  onTableContext={updateTableContext}
                />
              ) : (
                <textarea
                  className="source-editor"
                  value={activeTab?.content ?? ''}
                  onChange={(event) => {
                    history.push(activeTab?.content ?? '');
                    setActiveContent(event.target.value);
                  }}
                  placeholder="在此输入 Markdown 源码..."
                  spellCheck={false}
                  readOnly={readOnly}
                />
              )}
            </div>
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
            void openPath(path);
          }}
          onClose={() => setQuickOpenOpen(false)}
        />
      )}
      {renameMode && (
        <RenameDialog
          title={renameMode === 'create' ? '新建文件' : '重新命名'}
          initialName={renameMode === 'create' ? '未命名.md' : activeTab?.name ?? '未命名.md'}
          onSubmit={(name) => void handleRename(name)}
          onClose={() => setRenameMode(null)}
        />
      )}

      {/* 状态栏 */}
      <footer className="statusbar">
        <span>{viewMode === 'wysiwyg' ? 'Markdown' : '源码'}</span>
        {readOnly && <span>只读</span>}
        {notice && (
          <span className="statusbar-notice">
            {notice.text}
            {notice.actionLabel && (
              <button type="button" className="statusbar-notice-action" onClick={notice.onAction}>
                {notice.actionLabel}
              </button>
            )}
          </span>
        )}
        <span title="文档编码（保存时统一写 UTF-8）">
          {TEXT_ENCODING_LABELS[activeTab?.encoding ?? 'utf-8']}
        </span>
        <div className="spacer" />
        <span title="界面缩放（显示 → 缩放）">{zoomPercent}%</span>
        <span>{stats.lineCount} 行</span>
        <span>{stats.wordCount} 字</span>
      </footer>
    </div>
  );
}

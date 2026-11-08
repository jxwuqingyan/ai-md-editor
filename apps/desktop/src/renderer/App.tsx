import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { extractOutline } from '@ai-md-editor/markdown-core';
import { NO_TABLE_CONTEXT, type EditorInstance, type TableContext } from '@ai-md-editor/editor';
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
 * - useTabs           文档 / 标签 / 文件读写 / 自动保存
 * - useDisplayState   主题 / 侧栏 / 视图模式 / 显示开关 / 缩放 / 窗口状态
 * - useEditorRuntime  编辑器实例生命周期
 * - useEditing        格式化 / 撤销重做 / 粘贴 / 复制导出
 * - useFindReplace    查找替换
 * - useMenuBridge     原生菜单动作分发
 */
export default function App(): JSX.Element {
  // ===== 文档 =====
  const history = useSourceHistory();
  const editorRef = useRef<EditorInstance | null>(null);

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
    rename,
    loadQuickEntries
  } = useTabs({ editorRef, history });

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

  // 状态栏短暂提示（图片保存失败等）
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

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
    onError: setNotice
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
  const [renameOpen, setRenameOpen] = useState(false);

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

  /** 重命名当前文档，成功后关闭对话框 */
  const handleRename = useCallback(
    async (name: string) => {
      await rename(name);
      setRenameOpen(false);
    },
    [rename]
  );

  /** 插入链接 / 图片占位 */
  const handleInsertLink = useCallback(() => applyFormat('snippet', '[链接文字](url)'), [applyFormat]);
  const handleInsertImage = useCallback(() => applyFormat('snippet', '![图片](url)'), [applyFormat]);

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
    openRename: () => {
      if (tabsRef.current.find((tab) => tab.id === activeIdRef.current)?.path) setRenameOpen(true);
    },
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
        {notice && <span className="statusbar-notice">{notice}</span>}
        <span>UTF-8</span>
        <div className="spacer" />
        <span title="界面缩放（显示 → 缩放）">{zoomPercent}%</span>
        <span>{stats.lineCount} 行</span>
        <span>{stats.wordCount} 字</span>
      </footer>
    </div>
  );
}

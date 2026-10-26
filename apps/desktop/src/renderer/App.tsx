import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { themes, tokensToCssVars, type ThemeId } from '@ai-md-editor/theme';
import { extractOutline } from '@ai-md-editor/markdown-core';
import type { EditorInstance } from '@ai-md-editor/editor';
import MarkdownEditor from './MarkdownEditor';

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

> 支持打开 .md 文件、Cmd/Ctrl+S 保存、粘贴图片到 assets/ 目录。
`;

/**
 * 应用根组件。
 * M1：接入 Milkdown，打通内容 ↔ 状态栏 ↔ 大纲数据流。
 * M2：接入文件打开/保存、图片粘贴（相对路径 assets 目录）。
 */
export default function App(): JSX.Element {
  // 主题状态，默认 light
  const [themeId, setThemeId] = useState<ThemeId>('light');
  // 侧边栏折叠状态
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // 当前文档内容（由编辑器变化回调驱动）
  const [content, setContent] = useState(DEFAULT_DOC);
  // 当前文件信息（路径与文件名；未打开文件时为 null）
  const [currentFile, setCurrentFile] = useState<{ path: string; name: string } | null>(null);

  // 编辑器实例引用（通过 onReady 获取）
  const editorRef = useRef<EditorInstance | null>(null);
  // 保存最新的 content，供事件回调使用（避免闭包过期）
  const contentRef = useRef(content);
  contentRef.current = content;
  // 保存最新的 currentFile
  const currentFileRef = useRef(currentFile);
  currentFileRef.current = currentFile;

  const tokens = themes[themeId];
  const cssVars = useMemo(() => tokensToCssVars(tokens), [tokens]);

  // 应用主题到 <html>，保证全局 CSS 变量生效
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeId);
  }, [themeId]);

  // 从当前内容提取大纲（实时跟随编辑）
  const outline = useMemo(() => extractOutline(content), [content]);

  // 内容变化回调
  const handleChange = useCallback((markdown: string) => {
    setContent(markdown);
  }, []);

  // 编辑器就绪回调：保存实例引用
  const handleReady = useCallback((instance: EditorInstance) => {
    editorRef.current = instance;
  }, []);

  // 切换主题
  const toggleTheme = (): void => {
    setThemeId((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  /** 打开文件：弹出对话框，读取内容并载入编辑器 */
  const handleOpen = useCallback(async () => {
    const result = await window.api.openFile();
    if (result.canceled || !result.path || result.content === null) return;
    // 载入内容 + 更新标题栏文件名
    editorRef.current?.setMarkdown(result.content);
    setContent(result.content);
    setCurrentFile({ path: result.path, name: result.name ?? '未命名.md' });
  }, []);

  /** 保存文件：有路径直接写，无路径则另存为 */
  const handleSave = useCallback(async () => {
    const current = contentRef.current;
    const file = currentFileRef.current;
    if (file) {
      await window.api.writeFile(file.path, current);
    } else {
      const result = await window.api.saveFileAs(current, '未命名.md');
      if (!result.canceled && result.path) {
        setCurrentFile({ path: result.path, name: result.name ?? '未命名.md' });
      }
    }
  }, []);

  /** 另存为：弹出保存对话框 */
  const handleSaveAs = useCallback(async () => {
    const result = await window.api.saveFileAs(contentRef.current, '未命名.md');
    if (!result.canceled && result.path) {
      setCurrentFile({ path: result.path, name: result.name ?? '未命名.md' });
    }
  }, []);

  /** 处理图片粘贴：保存到 assets/ 目录，插入 markdown 图片语法 */
  const handlePaste = useCallback(async (event: ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    // 查找剪贴板中的图片项
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (!blob) continue;
        event.preventDefault();

        // 提取扩展名（image/png → png）
        const extension = item.type.split('/')[1] ?? 'png';
        // 图片二进制数据
        const arrayBuffer = await blob.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);

        // 文档目录：当前文件的目录；未打开文件时为空（主进程会存到默认位置）
        const file = currentFileRef.current;
        const docDir = file ? file.path.slice(0, file.path.lastIndexOf('/')) : '';

        const result = await window.api.saveImage({ data, extension, docDir });
        if (result.relativePath) {
          // 简化实现：图片语法追加到文档末尾（后续优化为光标处插入）
          const imgMarkdown = `\n\n![图片](${result.relativePath})\n`;
          const newContent = contentRef.current + imgMarkdown;
          editorRef.current?.setMarkdown(newContent);
          setContent(newContent);
        } else {
          // 保存失败：控制台提示（后续可加 UI 提示）
          console.error('图片保存失败:', result.error);
        }
        break;
      }
    }
  }, []);

  // 键盘快捷键：Cmd/Ctrl+S 保存
  useEffect(() => {
    const onKeydown = (event: KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, [handleSave]);

  // 图片粘贴监听
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      void handlePaste(event);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handlePaste]);

  // 统计信息
  const stats = useMemo(() => {
    const lines = content.split('\n');
    const lineCount = lines.length;
    const wordCount = content.replace(/\s/g, '').length;
    return { lineCount, wordCount };
  }, [content]);

  return (
    <div className="app" style={cssVars}>
      {/* 顶部栏 */}
      <header className="topbar">
        <span className="brand">MarkdownNote</span>
        <span className="doc-title">{currentFile?.name ?? '未命名.md'}</span>
        <div className="spacer" />
        <button className="icon-btn" onClick={() => void handleOpen()} title="打开文件 (Cmd/Ctrl+O)">
          打开
        </button>
        <button className="icon-btn" onClick={() => void handleSave()} title="保存 (Cmd/Ctrl+S)">
          保存
        </button>
        <button className="icon-btn" onClick={() => void handleSaveAs()} title="另存为">
          另存为
        </button>
        <button className="icon-btn" onClick={() => setSidebarOpen((v) => !v)} title="切换侧边栏">
          侧栏
        </button>
        <button className="icon-btn" onClick={toggleTheme} title="切换主题">
          {themeId === 'light' ? '深色' : '浅色'}
        </button>
      </header>

      {/* 主体 */}
      <div className="main">
        {/* 侧边栏（大纲） */}
        {sidebarOpen && (
          <aside className="sidebar">
            <div className="sidebar-head">大纲</div>
            {outline.map((item) => (
              <div key={item.line} className="outline-item" style={{ paddingLeft: 16 + (item.level - 1) * 14 }}>
                {item.text}
              </div>
            ))}
          </aside>
        )}

        {/* 编辑区（主角，接入 Milkdown WYSIWYG 编辑器） */}
        <main className="editor-wrap">
          <div className="editor-inner">
            <MarkdownEditor initialValue={DEFAULT_DOC} onChange={handleChange} onReady={handleReady} />
          </div>
        </main>
      </div>

      {/* 状态栏 */}
      <footer className="statusbar">
        <span>Markdown</span>
        <span>UTF-8</span>
        <div className="spacer" />
        <span>{stats.lineCount} 行</span>
        <span>{stats.wordCount} 字</span>
      </footer>
    </div>
  );
}

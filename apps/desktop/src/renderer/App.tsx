import { useEffect, useMemo, useState } from 'react';
import { themes, tokensToCssVars, type ThemeId } from '@ai-md-editor/theme';
import { extractOutline } from '@ai-md-editor/markdown-core';

/** M0 阶段用于演示的示例文档内容 */
const SAMPLE_DOC = `# ai-md-editor

对标 Typora 的跨平台 Markdown 编辑器，所见即所得。

## 核心特性

- 输入即渲染（WYSIWYG）
- 克制动效，专注内容
- 现代极简，去 AI 味

## 技术栈

- Electron + React + TypeScript
- Milkdown（ProseMirror + remark）

> 这是 M0 工程骨架阶段，编辑器内核将在 M1 接入。
`;

/**
 * 应用根组件。
 * 落地 UI-UX 设计规范：应用骨架（顶部栏/侧边栏/编辑区/状态栏）、主题切换、克制动效。
 */
export default function App(): JSX.Element {
  // 主题状态，默认 light
  const [themeId, setThemeId] = useState<ThemeId>('light');
  // 侧边栏折叠状态
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const tokens = themes[themeId];
  // 将 token 转为 CSS 变量，注入到根容器
  const cssVars = useMemo(() => tokensToCssVars(tokens), [tokens]);

  // 应用主题到 <html>，保证全局 CSS 变量生效
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeId);
  }, [themeId]);

  // 从示例文档提取大纲
  const outline = useMemo(() => extractOutline(SAMPLE_DOC), []);

  // 切换主题
  const toggleTheme = (): void => {
    setThemeId((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  return (
    <div className="app" style={cssVars}>
      {/* 顶部栏 */}
      <header className="topbar">
        <span className="brand">MarkdownNote</span>
        <span className="doc-title">未命名.md</span>
        <div className="spacer" />
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

        {/* 编辑区（主角） */}
        <main className="editor-wrap">
          <div className="editor-inner">
            {/* M0 阶段先展示示例内容，M1 接入 Milkdown 编辑器 */}
            <pre className="sample">{SAMPLE_DOC}</pre>
          </div>
        </main>
      </div>

      {/* 状态栏 */}
      <footer className="statusbar">
        <span>Markdown</span>
        <span>UTF-8</span>
        <div className="spacer" />
        <span>行 0, 列 0</span>
        <span>字数 0</span>
      </footer>
    </div>
  );
}

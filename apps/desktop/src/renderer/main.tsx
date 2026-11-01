import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';
// Milkdown 必需的 ProseMirror 基础排版样式 + 表格样式
import '@milkdown/kit/prose/view/style/prosemirror.css';
import '@milkdown/kit/prose/tables/style/tables.css';
// 数学公式（KaTeX）样式
import 'katex/dist/katex.min.css';

/**
 * 渲染进程入口。
 * 挂载 React 根组件。
 */
const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/global.css';

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

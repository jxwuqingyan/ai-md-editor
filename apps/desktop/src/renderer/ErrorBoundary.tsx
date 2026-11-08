/**
 * 渲染层错误边界。
 *
 * 编辑器与若干浮层是命令式创建的（Milkdown / ProseMirror / 原生 DOM），
 * 任何一处抛错都会让 React 卸载整棵树、窗口变成一片空白。
 * 这里兜住错误，至少保留「重新加载」与错误信息，避免用户只能强杀进程。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  message: string | null;
  stack: string | null;
}

/** 捕获渲染层未处理异常 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { message: null, stack: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? (error.stack ?? null) : null
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // 保留控制台堆栈，方便反馈时定位
    console.error('界面渲染异常:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.message === null) return this.props.children;
    return (
      <div className="app-error" role="alert">
        <h1>界面出现异常</h1>
        <p>编辑器已停止渲染。文档内容仍在内存中，重新加载前请尽量复制出来。</p>
        <pre className="app-error-detail">{this.state.message}</pre>
        <div className="app-error-actions">
          <button onClick={() => window.location.reload()}>重新加载</button>
          <button
            onClick={() => {
              if (this.state.stack) void navigator.clipboard.writeText(this.state.stack);
            }}
          >
            复制错误详情
          </button>
        </div>
      </div>
    );
  }
}

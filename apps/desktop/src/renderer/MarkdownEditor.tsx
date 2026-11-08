import { useEffect, useRef, useState } from 'react';
import type { EditorInstance, TableContext } from '@ai-md-editor/editor';

/** MarkdownEditor 组件的属性 */
interface MarkdownEditorProps {
  /** 初始 Markdown 内容 */
  initialValue: string;
  /** 内容变化回调（markdownUpdated 触发） */
  onChange?: (markdown: string) => void;
  /** 编辑器实例就绪回调（用于向上暴露实例，如大纲跳转等） */
  onReady?: (instance: EditorInstance) => void;
  /** 光标进出表格时回调（原生菜单置灰用） */
  onTableContext?: (context: TableContext) => void;
}

/**
 * Markdown 编辑器 React 组件。
 * 内部用命令式方式创建 Milkdown 编辑器，管理其生命周期。
 *
 * 编辑器内核（Milkdown + ProseMirror + Shiki + Mermaid + KaTeX）体积很大，
 * 这里用动态 import 切成独立 chunk：首屏只加载壳与文档数据，编辑器就绪后再填充内容，
 * 冷启动不再被几 MB 的解析器/高亮器阻塞。
 *
 * 中文 IME 适配：Milkdown（ProseMirror）已内置 composition 事件处理，
 * 拼音组合输入期间不会触发 markdown 解析，此处无需额外干预。
 *
 * 代码高亮主题：Shiki 用 CSS 变量主题，token 颜色为 var(--s-*)，
 * 明暗切换由全局 CSS 变量驱动，无需重建编辑器。
 */
export default function MarkdownEditor({
  initialValue,
  onChange,
  onReady,
  onTableContext
}: MarkdownEditorProps): JSX.Element {
  // 编辑器挂载容器
  const containerRef = useRef<HTMLDivElement>(null);
  // 编辑器实例
  const instanceRef = useRef<EditorInstance | null>(null);
  // 初始化失败原因（避免出错时只留一片空白）
  const [error, setError] = useState<string | null>(null);
  // 编辑器是否已就绪（控制加载骨架）
  const [loading, setLoading] = useState(true);
  // 保存最新的 onChange / onTableContext，避免闭包过期
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onTableContextRef = useRef(onTableContext);
  onTableContextRef.current = onTableContext;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;

    void (async () => {
      // 动态加载编辑器内核：这是应用里最大的一块依赖
      const { createEditor } = await import('@ai-md-editor/editor');
      if (disposed) return;
      return createEditor(container, {
        defaultValue: initialValue,
        onChange: (markdown) => {
          onChangeRef.current?.(markdown);
        },
        onTableContext: (context) => {
          onTableContextRef.current?.(context);
        }
      });
    })()
      .then((instance) => {
        if (!instance) return;
        if (disposed) {
          // 组件已卸载，立即销毁
          instance.destroy();
          return;
        }
        instanceRef.current = instance;
        setLoading(false);
        onReady?.(instance);
      })
      .catch((err: unknown) => {
        if (disposed) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error('编辑器初始化失败:', err);
        setLoading(false);
        setError(message);
      });

    // 清理：卸载时销毁编辑器
    return () => {
      disposed = true;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div ref={containerRef} className="milkdown-container" />
      {loading && !error && (
        <div className="editor-loading" role="status">
          正在加载编辑器…
        </div>
      )}
      {error && (
        <div className="editor-error" role="alert">
          编辑器初始化失败：{error}
        </div>
      )}
    </>
  );
}

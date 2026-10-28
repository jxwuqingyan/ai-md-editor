import { useEffect, useRef } from 'react';
import { createEditor, type EditorInstance } from '@ai-md-editor/editor';

/** MarkdownEditor 组件的属性 */
interface MarkdownEditorProps {
  /** 初始 Markdown 内容 */
  initialValue: string;
  /** 内容变化回调（markdownUpdated 触发） */
  onChange?: (markdown: string) => void;
  /** 编辑器实例就绪回调（用于向上暴露实例，如大纲跳转等） */
  onReady?: (instance: EditorInstance) => void;
}

/**
 * Markdown 编辑器 React 组件。
 * 内部用命令式方式创建 Milkdown 编辑器，管理其生命周期。
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
  onReady
}: MarkdownEditorProps): JSX.Element {
  // 编辑器挂载容器
  const containerRef = useRef<HTMLDivElement>(null);
  // 编辑器实例
  const instanceRef = useRef<EditorInstance | null>(null);
  // 保存最新的 onChange，避免闭包过期
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;

    // 异步创建编辑器（Milkdown 的 create 是异步的，Shiki 高亮器也需要异步加载）
    void createEditor(container, {
      defaultValue: initialValue,
      onChange: (markdown) => {
        onChangeRef.current?.(markdown);
      }
    }).then((instance) => {
      if (disposed) {
        // 组件已卸载，立即销毁
        instance.destroy();
        return;
      }
      instanceRef.current = instance;
      onReady?.(instance);
    });

    // 清理：卸载时销毁编辑器
    return () => {
      disposed = true;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="milkdown-container" />;
}

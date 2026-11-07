/**
 * 编辑器实例的生命周期与联动。
 *
 * - 持有 editorRef（渲染层其它模块通过它调用编辑器能力）
 * - 编辑器异步就绪后补同步内容、恢复只读状态
 * - 打字机模式：按键或点击后把光标保持在视区中部
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';import type { EditorInstance } from '@ai-md-editor/editor';
import type { Tab } from '../types';

/** useEditorRuntime 的入参 */
interface UseEditorRuntimeOptions {
  /** 编辑器实例引用（由根组件持有，与 useTabs / useEditing 共享） */
  editorRef: MutableRefObject<EditorInstance | null>;
  /** 标签列表引用（编辑器就绪时补同步内容） */
  tabsRef: MutableRefObject<Tab[]>;
  /** 当前标签 id 引用 */
  activeIdRef: MutableRefObject<string>;
  /** 只读状态 */
  readOnly: boolean;
  /** 打字机模式 */
  typewriterMode: boolean;
  /** 视图模式（切换时重新挂载监听） */
  viewMode: 'wysiwyg' | 'source';
}

/** 编辑器运行时 hook */
export function useEditorRuntime({
  editorRef,
  tabsRef,
  activeIdRef,
  readOnly,
  typewriterMode,
  viewMode
}: UseEditorRuntimeOptions) {
  // 编辑器就绪版本号（异步初始化完成后刷新依赖编辑器的派生数据）
  const [editorVersion, setEditorVersion] = useState(0);

  // 就绪回调里读取最新的只读状态，避免闭包过期
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  /** 编辑器就绪：保存实例、补同步异步初始化期间打开的文档、恢复只读状态 */
  const handleReady = useCallback(
    (instance: EditorInstance) => {
      editorRef.current = instance;
      const active = tabsRef.current.find((tab) => tab.id === activeIdRef.current);
      if (active && instance.getMarkdown() !== active.content) {
        instance.setMarkdown(active.content);
      }
      instance.setEditable(!readOnlyRef.current);
      setEditorVersion((v) => v + 1);
    },
    [tabsRef, activeIdRef]
  );

  /** 只读模式同步到编辑器实例 */
  useEffect(() => {
    editorRef.current?.setEditable(!readOnly);
  }, [readOnly, editorVersion]);

  /** 打字机模式：按键或点击后把光标保持在视区中部 */
  useEffect(() => {
    if (!typewriterMode) return;
    const center = (): void => editorRef.current?.centerCaret();
    window.addEventListener('keyup', center);
    window.addEventListener('click', center);
    center();
    return () => {
      window.removeEventListener('keyup', center);
      window.removeEventListener('click', center);
    };
  }, [typewriterMode, viewMode]);

  return { editorVersion, handleReady };
}

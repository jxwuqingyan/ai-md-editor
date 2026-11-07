/**
 * 源码模式下的光标表格上下文。
 *
 * WYSIWYG 模式由编辑器插件上报；源码模式只有一个 textarea，
 * 这里按「光标所在行是否以 | 开头 / 下一行是否为分隔行」判断，
 * 让原生菜单的表格项在两个模式下都能正确置灰。
 */
import { useEffect } from 'react';
import type { TableContext } from '@ai-md-editor/editor';
import { sourceTableContext } from '../sourceActions';

/** useSourceTableContext 的入参 */
interface UseSourceTableContextOptions {
  /** 当前视图模式 */
  viewMode: 'wysiwyg' | 'source';
  /** 当前标签内容 */
  content: string;
  /** 上报上下文（调用方需去重，避免无谓的菜单重建） */
  onContext: (context: TableContext) => void;
}

/** 源码模式表格上下文 hook */
export function useSourceTableContext({ viewMode, content, onContext }: UseSourceTableContextOptions): void {
  useEffect(() => {
    if (viewMode !== 'source') return;

    const update = (): void => {
      const ta = document.querySelector<HTMLTextAreaElement>('.source-editor');
      if (!ta) return;
      onContext(sourceTableContext(content, ta.selectionStart));
    };

    update();
    // select 事件不冒泡，用捕获阶段监听才能收到 textarea 内部的光标移动
    window.addEventListener('keyup', update);
    window.addEventListener('click', update);
    window.addEventListener('input', update);
    window.addEventListener('select', update, true);
    return () => {
      window.removeEventListener('keyup', update);
      window.removeEventListener('click', update);
      window.removeEventListener('input', update);
      window.removeEventListener('select', update, true);
    };
  }, [viewMode, content, onContext]);
}

/**
 * 编辑动作（格式化 / 撤销重做 / 粘贴图片 / 复制导出）。
 *
 * 统一入口：工具栏与原生菜单共用同一套回调。
 * WYSIWYG 走 ProseMirror 命令，源码模式走等价的 Markdown 文本变换（sourceActions）。
 */
import { useCallback, type MutableRefObject } from 'react';
import type { EditorInstance, FormatAction } from '@ai-md-editor/editor';
import { applySourceFormat, type SourceResult } from '../sourceActions';
import type { Tab } from '../types';
import type { SourceHistory } from './useSourceHistory';

/** useEditing 的入参 */
interface UseEditingOptions {
  /** 编辑器实例引用（源码模式下为 null） */
  editorRef: MutableRefObject<EditorInstance | null>;
  /** 标签列表引用 */
  tabsRef: MutableRefObject<Tab[]>;
  /** 当前标签 id 引用 */
  activeIdRef: MutableRefObject<string>;
  /** 视图模式引用 */
  viewModeRef: MutableRefObject<'wysiwyg' | 'source'>;
  /** 只读状态引用 */
  readOnlyRef: MutableRefObject<boolean>;
  /** 源码撤销栈 */
  history: SourceHistory;
  /** 替换当前标签内容 */
  setActiveContent: (content: string, dirty?: boolean) => void;
}

/**
 * 编辑动作 hook。
 * 所有会改内容的入口都从这里走，保证只读状态与撤销行为一致。
 */
export function useEditing({
  editorRef,
  tabsRef,
  activeIdRef,
  viewModeRef,
  readOnlyRef,
  history,
  setActiveContent
}: UseEditingOptions) {
  /** 取当前标签 */
  const activeTab = useCallback(
    () => tabsRef.current.find((t) => t.id === activeIdRef.current) ?? null,
    [tabsRef, activeIdRef]
  );

  /** 取源码模式的 textarea（不存在说明当前不是源码模式） */
  const sourceTextarea = useCallback(
    () => document.querySelector<HTMLTextAreaElement>('.source-editor'),
    []
  );

  /** 把源码变换结果写回活动标签，并恢复 textarea 选区 */
  const applySourceResult = useCallback(
    (result: SourceResult) => {
      setActiveContent(result.content);
      requestAnimationFrame(() => {
        const ta = sourceTextarea();
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(result.selectionStart, result.selectionEnd);
      });
    },
    [setActiveContent, sourceTextarea]
  );

  /** 统一格式化入口：工具栏、系统菜单共用 */
  const applyFormat = useCallback(
    (action: FormatAction, payload?: number | string): void => {
      if (readOnlyRef.current) return;
      if (viewModeRef.current === 'wysiwyg' && editorRef.current) {
        editorRef.current.format(action, payload);
        editorRef.current.focus();
        return;
      }
      const tab = activeTab();
      if (!tab) return;
      const ta = sourceTextarea();
      const ctx = {
        content: tab.content,
        selectionStart: ta?.selectionStart ?? 0,
        selectionEnd: ta?.selectionEnd ?? 0
      };
      applySourceResult(applySourceFormat(action, payload, ctx));
    },
    [readOnlyRef, viewModeRef, editorRef, activeTab, sourceTextarea, applySourceResult]
  );

  /**
   * 撤销 / 重做。
   *
   * WYSIWYG 必须走 ProseMirror 的历史命令：Electron 的 role: 'undo' 调的是
   * webContents 的 DOM 撤销，而 ProseMirror 的编辑历史不经过 DOM，所以菜单里
   * 原来的 role 版 Cmd+Z 一直无效。源码模式与查找框等原生控件则用 DOM 撤销。
   */
  const undoRedo = useCallback(
    (kind: 'undo' | 'redo') => {
      if (readOnlyRef.current) return;

      // 源码模式：使用自建快照栈
      if (viewModeRef.current === 'source') {
        const tab = activeTab();
        if (!tab) return;
        const target = kind === 'undo' ? history.undo(tab.content) : history.redo(tab.content);
        if (target === undefined) return;
        setActiveContent(target);
        requestAnimationFrame(() => {
          const ta = sourceTextarea();
          if (!ta) return;
          ta.focus();
          ta.setSelectionRange(target.length, target.length);
        });
        return;
      }

      // 查找框等原生输入框：交给浏览器自己的撤销
      const focused = document.activeElement;
      if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) {
        document.execCommand(kind);
        return;
      }

      if (!editorRef.current) return;
      if (kind === 'undo') editorRef.current.undo();
      else editorRef.current.redo();
    },
    [readOnlyRef, viewModeRef, activeTab, history, setActiveContent, sourceTextarea, editorRef]
  );

  /** 把一段 Markdown 插入到光标处（链接、图片、纯文本粘贴共用） */
  const insertText = useCallback(
    (text: string) => applyFormat('snippet', text),
    [applyFormat]
  );

  /** 处理图片粘贴：保存到 assets/ 目录，插入 markdown 图片语法 */
  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      if (readOnlyRef.current) return;
      const items = event.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (!item.type.startsWith('image/')) continue;
        const blob = item.getAsFile();
        if (!blob) continue;
        event.preventDefault();
        const extension = item.type.split('/')[1] ?? 'png';
        const data = new Uint8Array(await blob.arrayBuffer());
        const tab = activeTab();
        const docDir = tab?.path ? tab.path.slice(0, tab.path.lastIndexOf('/')) : '';
        const result = await window.api.saveImage({ data, extension, docDir });
        if (!result.relativePath) {
          console.error('图片保存失败:', result.error);
          break;
        }
        const imageMarkdown = `![图片](${result.relativePath})`;
        if (viewModeRef.current === 'wysiwyg' && editorRef.current) {
          editorRef.current.insertAtCursor(imageMarkdown);
        } else {
          const ta = sourceTextarea();
          const current = activeTab();
          if (ta && current) {
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            setActiveContent(current.content.slice(0, start) + imageMarkdown + current.content.slice(end));
            requestAnimationFrame(() => {
              ta.focus();
              ta.setSelectionRange(start + imageMarkdown.length, start + imageMarkdown.length);
            });
          }
        }
        break;
      }
    },
    [readOnlyRef, activeTab, viewModeRef, editorRef, sourceTextarea, setActiveContent]
  );

  /** 从本地文件选择图片并插入相对路径（复用粘贴图片的 assets 保存链路） */
  const chooseImage = useCallback(async () => {
    if (readOnlyRef.current) return;
    const tab = activeTab();
    const docDir = tab?.path ? tab.path.slice(0, tab.path.lastIndexOf('/')) : '';
    const result = await window.api.chooseImage(docDir);
    if (result.relativePath) applyFormat('snippet', `![图片](${result.relativePath})`);
  }, [readOnlyRef, activeTab, applyFormat]);

  /** 粘贴为纯文本：读剪贴板纯文本后在光标处插入 */
  const pastePlain = useCallback(async () => {
    if (readOnlyRef.current) return;
    const text = await window.api.readClipboardText();
    if (text) insertText(text);
  }, [readOnlyRef, insertText]);

  /** 复制为指定格式 */
  const copyAs = useCallback(
    async (format: 'plain' | 'markdown' | 'html') => {
      const tab = activeTab();
      if (tab) await window.api.writeClipboard({ format, markdown: tab.content });
    },
    [activeTab]
  );

  /** 导出当前文档为 HTML/PDF/Word */
  const exportAs = useCallback(
    async (format: 'html' | 'pdf' | 'word') => {
      const tab = activeTab();
      if (!tab) return;
      const result = await window.api.exportFile({ format, markdown: tab.content, defaultName: tab.name });
      if (!result.ok && result.error !== '已取消') console.error('导出失败:', result.error);
    },
    [activeTab]
  );

  return {
    applySourceResult,
    applyFormat,
    undoRedo,
    insertText,
    handlePaste,
    chooseImage,
    pastePlain,
    copyAs,
    exportAs
  };
}

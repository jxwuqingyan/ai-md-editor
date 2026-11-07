/**
 * 查找 / 替换。
 *
 * wysiwyg 模式用 ProseMirror 的纯文本偏移，源码模式用 Markdown 原文偏移，
 * 两者都按字符位置定位，因此可以共用同一套匹配逻辑。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorInstance } from '@ai-md-editor/editor';

/** useFindReplace 的入参 */
interface UseFindReplaceOptions {
  /** 编辑器实例引用 */
  editorRef: React.MutableRefObject<EditorInstance | null>;
  /** 视图模式引用 */
  viewModeRef: React.MutableRefObject<'wysiwyg' | 'source'>;
  /** 只读状态引用 */
  readOnlyRef: React.MutableRefObject<boolean>;
  /** 当前标签内容 */
  activeContent: string;
  /** 当前标签 id（切换文档时清空当前匹配位置） */
  activeId: string;
  /** 视图模式（切换时重新计算搜索文本） */
  viewMode: 'wysiwyg' | 'source';
  /** 编辑器就绪版本号（编辑器异步初始化完成后刷新） */
  editorVersion: number;
  /** 替换当前标签内容 */
  setActiveContent: (content: string, dirty?: boolean) => void;
}

/** 匹配区间 */
export interface MatchRange {
  start: number;
  end: number;
}

/** 查找替换 hook */
export function useFindReplace({
  editorRef,
  viewModeRef,
  readOnlyRef,
  activeContent,
  activeId,
  viewMode,
  editorVersion,
  setActiveContent
}: UseFindReplaceOptions) {
  const [findOpen, setFindOpen] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [searchText, setSearchText] = useState('');
  const [currentMatch, setCurrentMatch] = useState(0);

  const findIndexRef = useRef(0);
  const replaceTextRef = useRef(replaceText);
  replaceTextRef.current = replaceText;

  // 搜索文本：wysiwyg 用纯文本，源码模式用 Markdown 原文
  useEffect(() => {
    const text = viewMode === 'wysiwyg' && editorRef.current
      ? editorRef.current.getPlainText()
      : activeContent;
    setSearchText(text);
  }, [activeContent, activeId, viewMode, editorVersion, editorRef]);

  const matches = useMemo<MatchRange[]>(() => {
    if (!findQuery) return [];
    const needle = findQuery.toLowerCase();
    const haystack = searchText.toLowerCase();
    const result: MatchRange[] = [];
    let from = 0;
    while (from < haystack.length) {
      const index = haystack.indexOf(needle, from);
      if (index === -1) break;
      result.push({ start: index, end: index + needle.length });
      from = index + Math.max(1, needle.length);
    }
    return result;
  }, [findQuery, searchText]);

  const matchesRef = useRef(matches);
  matchesRef.current = matches;

  useEffect(() => {
    findIndexRef.current = 0;
    setCurrentMatch(0);
  }, [findQuery]);

  /** 跳到第 N 个匹配项并选中 */
  const goToMatch = useCallback(
    (step: number) => {
      const list = matchesRef.current;
      if (list.length === 0) return;
      const next = (findIndexRef.current + step + list.length) % list.length;
      findIndexRef.current = next;
      setCurrentMatch(next);
      const target = list[next];
      if (viewModeRef.current === 'wysiwyg' && editorRef.current) {
        editorRef.current.selectTextRange(target.start, target.end);
        return;
      }
      const ta = document.querySelector<HTMLTextAreaElement>('.source-editor');
      if (ta) {
        ta.focus();
        ta.setSelectionRange(target.start, target.end);
      }
    },
    [viewModeRef, editorRef]
  );

  /** 替换当前匹配项 */
  const replaceCurrent = useCallback(() => {
    if (readOnlyRef.current) return;
    const list = matchesRef.current;
    if (list.length === 0) return;
    const target = list[findIndexRef.current] ?? list[0];
    const replacement = replaceTextRef.current;
    if (viewModeRef.current === 'wysiwyg' && editorRef.current) {
      editorRef.current.selectTextRange(target.start, target.end);
      editorRef.current.replaceSelection(replacement);
      return;
    }
    setActiveContent(
      activeContent.slice(0, target.start) + replacement + activeContent.slice(target.end)
    );
  }, [readOnlyRef, viewModeRef, editorRef, activeContent, setActiveContent]);

  /** 替换全部：从后往前替换，避免偏移变化 */
  const replaceAll = useCallback(() => {
    if (readOnlyRef.current) return;
    const list = [...matchesRef.current].reverse();
    if (list.length === 0) return;
    const replacement = replaceTextRef.current;
    if (viewModeRef.current === 'wysiwyg' && editorRef.current) {
      list.forEach((target) => {
        editorRef.current?.selectTextRange(target.start, target.end);
        editorRef.current?.replaceSelection(replacement);
      });
      return;
    }
    let content = activeContent;
    list.forEach((target) => {
      content = content.slice(0, target.start) + replacement + content.slice(target.end);
    });
    setActiveContent(content);
  }, [readOnlyRef, viewModeRef, editorRef, activeContent, setActiveContent]);

  /** 打开查找栏（可同时展开替换） */
  const openFind = useCallback((withReplace: boolean) => {
    setFindOpen(true);
    if (withReplace) setShowReplace(true);
  }, []);

  const closeFind = useCallback(() => setFindOpen(false), []);

  return {
    findOpen,
    showReplace,
    findQuery,
    setFindQuery,
    replaceText,
    setReplaceText,
    matches,
    currentMatch,
    openFind,
    closeFind,
    toggleReplace: () => setShowReplace((v) => !v),
    goToMatch,
    replaceCurrent,
    replaceAll
  };
}

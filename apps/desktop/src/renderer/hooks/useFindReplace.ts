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

/** 在一段纯文本里找出所有命中（不区分大小写，允许重叠推进） */
function computeMatches(query: string, text: string): MatchRange[] {
  if (!query) return [];
  const needle = query.toLowerCase();
  const haystack = text.toLowerCase();
  const result: MatchRange[] = [];
  let from = 0;
  while (from < haystack.length) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    result.push({ start: index, end: index + needle.length });
    from = index + Math.max(1, needle.length);
  }
  return result;
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
  const activeContentRef = useRef(activeContent);
  activeContentRef.current = activeContent;

  /**
   * 立刻按编辑器当前内容重算搜索文本。
   * 替换之后不能等 React 状态回写（200ms 防抖 + 一次渲染）——那段时间里命中偏移是旧的，
   * 高亮会飘到隔壁文字上。这里直接读编辑器。
   */
  const refreshSearchText = useCallback(() => {
    const editor = editorRef.current;
    const text =
      viewModeRef.current === 'wysiwyg' && editor ? editor.getPlainText() : activeContentRef.current;
    setSearchText(text);
  }, [editorRef, viewModeRef]);

  // 搜索文本：wysiwyg 用纯文本，源码模式用 Markdown 原文。
  // 只在查找栏打开时才取纯文本——getPlainText 会遍历整篇文档，
  // 常驻计算会让每次按键都多一次全文档扫描。
  useEffect(() => {
    if (!findOpen) return;
    const text = viewMode === 'wysiwyg' && editorRef.current
      ? editorRef.current.getPlainText()
      : activeContent;
    setSearchText(text);
  }, [findOpen, activeContent, activeId, viewMode, editorVersion, editorRef]);

  const matches = useMemo<MatchRange[]>(
    () => computeMatches(findQuery, searchText),
    [findQuery, searchText]
  );

  const matchesRef = useRef(matches);
  matchesRef.current = matches;

  useEffect(() => {
    findIndexRef.current = 0;
    setCurrentMatch(0);
  }, [findQuery]);

  // 替换后命中变少时，当前项可能越界：夹回最后一个，避免「4/3」这种计数
  useEffect(() => {
    if (currentMatch < matches.length) return;
    const next = Math.max(0, matches.length - 1);
    findIndexRef.current = next;
    setCurrentMatch(next);
  }, [matches, currentMatch]);

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
        // 只把当前命中滚到可见并放光标，高亮由装饰负责（整段选中会糊一大片）
        editorRef.current.placeCaretAtTextOffset(target.start);
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
      editorRef.current.replaceTextRange(target.start, target.end, replacement);
      refreshSearchText();
      return;
    }
    setActiveContent(
      activeContent.slice(0, target.start) + replacement + activeContent.slice(target.end)
    );
  }, [readOnlyRef, viewModeRef, editorRef, activeContent, setActiveContent, refreshSearchText]);

  /** 替换全部：从后往前替换，避免偏移变化 */
  const replaceAll = useCallback(() => {
    if (readOnlyRef.current) return;
    const list = [...matchesRef.current].reverse();
    if (list.length === 0) return;
    const replacement = replaceTextRef.current;
    if (viewModeRef.current === 'wysiwyg' && editorRef.current) {
      list.forEach((target) => {
        editorRef.current?.replaceTextRange(target.start, target.end, replacement);
      });
      refreshSearchText();
      return;
    }
    let content = activeContent;
    list.forEach((target) => {
      content = content.slice(0, target.start) + replacement + content.slice(target.end);
    });
    setActiveContent(content);
  }, [readOnlyRef, viewModeRef, editorRef, activeContent, setActiveContent]);

  /** 最近一次应用到编辑器的「命中集合 + 当前项」，避免每帧重复派发 */
  const appliedRef = useRef('');

  // 命中变化时刷新高亮；关闭查找时清掉
  useEffect(() => {
    const editor = editorRef.current;
    if (!findOpen) {
      appliedRef.current = '';
      editor?.clearSearchHighlight();
      return;
    }
    if (viewMode !== 'wysiwyg' || !editor) return;
    // 替换后命中数量可能不变、但位置整体前移，所以签名要包含每处命中的位置
    const signature = `${findQuery}|${currentMatch}|${matches.map((m) => `${m.start}-${m.end}`).join(',')}|${editorVersion}`;
    if (appliedRef.current === signature) return;
    appliedRef.current = signature;
    const activeIndex = Math.min(currentMatch, Math.max(0, matches.length - 1));
    editor.setSearchHighlight(matches, matches.length ? activeIndex : -1);
    const active = matches[activeIndex];
    if (active) editor.placeCaretAtTextOffset(active.start);
  }, [findOpen, findQuery, matches, currentMatch, viewMode, editorVersion, editorRef]);

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

/**
 * 源码模式的撤销栈。
 *
 * WYSIWYG 的历史由 ProseMirror 维护；纯 textarea 没有可用的撤销历史
 * （浏览器只在真实键入时记录，程序性改值不进栈），因此这里自己记录快照。
 *
 * 连续键入会按时间窗合并：否则 200 条上限几秒就会被一次输入打满，
 * 用户按 Cmd+Z 只能一个字一个字地退。
 */
import { useCallback, useRef } from 'react';

/** 快照栈容量上限（超出后丢弃最早的记录） */
const HISTORY_LIMIT = 200;

/** 连续键入合并窗口：窗口内的多次改动只保留一条快照 */
const COALESCE_WINDOW_MS = 600;

/** 源码撤销栈的对外接口 */
export interface SourceHistory {
  /** 记录一次修改前的快照 */
  push(content: string): void;
  /** 取上一条快照（同时把当前内容压入重做栈） */
  undo(current: string): string | undefined;
  /** 取重做栈顶部快照 */
  redo(current: string): string | undefined;
  /** 清空历史（切换文档 / 视图模式时调用） */
  reset(): void;
}

/** 创建源码撤销栈（与组件生命周期一致） */
export function useSourceHistory(): SourceHistory {
  const store = useRef<{ past: string[]; future: string[]; lastPushAt: number }>({
    past: [],
    future: [],
    lastPushAt: 0
  });

  const push = useCallback((content: string) => {
    const history = store.current;
    const now = Date.now();
    // 合并窗口内且与栈顶内容不同：不新增快照，继续沿用本次输入的起点
    if (now - history.lastPushAt < COALESCE_WINDOW_MS && history.past.length > 0) {
      history.lastPushAt = now;
      history.future = [];
      return;
    }
    history.past.push(content);
    if (history.past.length > HISTORY_LIMIT) history.past.shift();
    history.future = [];
    history.lastPushAt = now;
  }, []);

  const undo = useCallback((current: string) => {
    const history = store.current;
    const target = history.past.pop();
    if (target === undefined) return undefined;
    history.future.push(current);
    // 撤销后紧接一次修改不应再并入同一条快照
    history.lastPushAt = 0;
    return target;
  }, []);

  const redo = useCallback((current: string) => {
    const history = store.current;
    const target = history.future.pop();
    if (target === undefined) return undefined;
    history.past.push(current);
    history.lastPushAt = 0;
    return target;
  }, []);

  const reset = useCallback(() => {
    store.current = { past: [], future: [], lastPushAt: 0 };
  }, []);

  return { push, undo, redo, reset };
}

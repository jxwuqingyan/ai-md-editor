/**
 * 原生菜单动作桥接。
 *
 * 分发表由 menuHandlers.ts 构造（纯函数），这里只负责：
 * - 每帧刷新最新的回调集合（避免闭包过期）
 * - 订阅一次主进程的菜单动作事件，按 action 分发
 */
import { useEffect, useRef } from 'react';
import type { MenuAction } from '@ai-md-editor/shared';
import { buildMenuHandlers, type MenuHandler, type MenuHandlerDeps } from '../menuHandlers';

/** 订阅原生菜单动作 */
export function useMenuBridge(deps: MenuHandlerDeps): void {
  const handlersRef = useRef<Partial<Record<MenuAction, MenuHandler>>>({});
  handlersRef.current = buildMenuHandlers(deps);

  useEffect(
    () =>
      window.api.onMenuAction((action, payload) => {
        handlersRef.current[action]?.(payload);
      }),
    []
  );
}

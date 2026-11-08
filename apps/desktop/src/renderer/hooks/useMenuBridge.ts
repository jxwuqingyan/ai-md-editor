/**
 * 原生菜单动作桥接。
 *
 * 分发表由 menuHandlers.ts 构造（纯函数），这里只负责：
 * - 首次渲染时构造一次分发表，之后通过 ref 取最新的回调（避免每次渲染重建近百个闭包）
 * - 订阅一次主进程的菜单动作事件，按 action 分发
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import type { MenuAction } from '@ai-md-editor/shared';
import { buildMenuHandlers, type MenuHandler, type MenuHandlerDeps } from '../menuHandlers';

/**
 * 生成「始终读取最新依赖」的代理对象。
 *
 * 分发表里大部分条目是直接把 deps 的函数放进去的，如果每次渲染都重建，
 * 就要创建近百个闭包（每次都要重新分配 + 触发 GC）。这里只建一次表，
 * 表里的函数固定为「转调 ref 里的最新实现」，行为与重建一致但开销恒定。
 */
function latestDeps(ref: MutableRefObject<MenuHandlerDeps>): MenuHandlerDeps {
  const cache = new Map<PropertyKey, unknown>();
  return new Proxy({} as MenuHandlerDeps, {
    get(_target, key) {
      if (!cache.has(key)) {
        cache.set(key, (...args: unknown[]) => {
          const current = ref.current as unknown as Record<PropertyKey, unknown>;
          const fn = current[key];
          if (typeof fn === 'function') {
            return (fn as (...inner: unknown[]) => unknown)(...args);
          }
          return undefined;
        });
      }
      return cache.get(key);
    }
  });
}

/** 订阅原生菜单动作 */
export function useMenuBridge(deps: MenuHandlerDeps): void {
  // 每帧同步最新依赖，但分发表只在首次渲染构造一次
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const handlersRef = useRef<Partial<Record<MenuAction, MenuHandler>> | null>(null);
  if (!handlersRef.current) {
    handlersRef.current = buildMenuHandlers(latestDeps(depsRef));
  }

  useEffect(
    () =>
      window.api.onMenuAction((action, payload) => {
        handlersRef.current?.[action]?.(payload);
      }),
    []
  );
}

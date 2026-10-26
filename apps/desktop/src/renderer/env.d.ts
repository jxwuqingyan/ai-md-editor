/**
 * 渲染进程全局类型声明。
 * 声明 preload 通过 contextBridge 暴露的 window.api 类型。
 */
import type { ExposedApi } from '../../preload';

declare global {
  interface Window {
    /** preload 暴露的白名单 API */
    api: ExposedApi;
  }
}

export {};

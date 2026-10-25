import { contextBridge } from 'electron';

/**
 * 通过 contextBridge 暴露给渲染进程的白名单 API。
 * 遵循安全基线：不暴露 node/electron 原生能力，只暴露最小必要接口。
 * 后续按需在此扩展文件读写、菜单等 IPC 能力。
 */
const api = {
  /** 应用版本号 */
  getVersion: (): string => process.env['npm_package_version'] ?? '0.1.0',
  /** 当前平台（darwin / win32） */
  getPlatform: (): string => process.platform
};

contextBridge.exposeInMainWorld('api', api);

/** 全局类型声明：让渲染进程能感知 window.api 的类型 */
export type ExposedApi = typeof api;

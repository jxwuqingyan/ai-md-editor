/**
 * 共享类型与工具。
 * 当前提供跨进程共用的基础类型定义，后续按需扩展 IPC 消息类型等。
 */

/** IPC 通道名统一枚举，避免魔法字符串 */
export const IpcChannel = {
  /** 示例：请求应用信息 */
  GetAppInfo: 'app:get-info'
} as const;

/** 应用基础信息 */
export interface AppInfo {
  version: string;
  platform: string;
}

/** 文档基础模型 */
export interface DocMeta {
  /** 绝对路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 最近修改时间戳（毫秒） */
  modifiedAt: number;
}

/**
 * 共享类型与工具。
 * 提供跨进程共用的 IPC 通道名、请求/响应类型，供主进程、preload、渲染层三方共用。
 */

/** IPC 通道名统一枚举，避免魔法字符串 */
export const IpcChannel = {
  /** 打开文件对话框（返回文件路径与内容） */
  OpenFile: 'file:open',
  /** 保存文件对话框（另存为） */
  SaveFileAs: 'file:save-as',
  /** 读取指定路径的文件内容 */
  ReadFile: 'file:read',
  /** 写入内容到指定路径 */
  WriteFile: 'file:write',
  /** 保存粘贴的图片到 assets 目录（返回相对路径） */
  SaveImage: 'image:save'
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

/** 打开文件的结果 */
export interface OpenFileResult {
  /** 是否取消（用户点了取消） */
  canceled: boolean;
  /** 文件绝对路径（取消时为 null） */
  path: string | null;
  /** 文件名（取消时为 null） */
  name: string | null;
  /** 文件内容（取消时为 null） */
  content: string | null;
}

/** 保存文件的结果 */
export interface SaveFileResult {
  /** 是否取消 */
  canceled: boolean;
  /** 保存的文件绝对路径（取消时为 null） */
  path: string | null;
  /** 文件名（取消时为 null） */
  name: string | null;
}

/** 保存图片的入参 */
export interface SaveImageInput {
  /** 图片二进制数据（ArrayBuffer 序列化后） */
  data: Uint8Array;
  /** 文件扩展名（不含点，如 png/jpg） */
  extension: string;
  /** 目标 Markdown 文件所在目录（用于确定 assets 相对路径基准） */
  docDir: string;
}

/** 保存图片的结果 */
export interface SaveImageResult {
  /** 保存成功后的相对路径（如 assets/20261026-123456.png），失败为 null */
  relativePath: string | null;
  /** 错误信息（成功为 null） */
  error: string | null;
}

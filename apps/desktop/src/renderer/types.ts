/**
 * 标签页数据模型（供 Tabs 组件与各 hook 共用）。
 */

import type { TextEncoding } from '@ai-md-editor/shared';
import type { DocLinkRef } from '@ai-md-editor/shared';

/** 单个标签的数据模型 */
export interface Tab {
  /** 唯一标识 */
  id: string;
  /** 文件绝对路径（未保存的新文档为 null） */
  path: string | null;
  /** 标签显示名（文件名） */
  name: string;
  /** 当前内容（与编辑器同步） */
  content: string;
  /** 是否有未保存修改 */
  dirty: boolean;
  /** 读入时识别到的编码（保存后统一转为 UTF-8） */
  encoding: TextEncoding;
  /**
   * 磁盘文件已被外部程序改动（与内存内容冲突）。
   * 该状态为 true 时暂停自动保存，避免静默覆盖外部版本；
   * 用户「重新加载」或显式「保存」后清除。
   */
  externalChanged?: boolean;
}

/** 当前文档的保存状态（状态栏展示） */
export type SaveStateKind = 'idle' | 'saving' | 'saved' | 'error' | 'external';

export interface SaveState {
  kind: SaveStateKind;
  /** 失败原因 / 冲突说明 */
  message?: string;
}

/** 「检查链接与图片」查出的问题（在扫描结果上补一个类型标记） */
export interface DocIssue extends DocLinkRef {
  /** 空链接 / 本地图片文件不存在 */
  kind: 'empty-link' | 'missing-image';
}

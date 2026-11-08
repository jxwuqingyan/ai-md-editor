/**
 * 标签页数据模型（供 Tabs 组件与各 hook 共用）。
 */

import type { TextEncoding } from '@ai-md-editor/shared';

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
}

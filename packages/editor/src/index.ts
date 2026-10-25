/**
 * WYSIWYG 编辑器封装（基于 Milkdown）。
 * 当前为 M0 占位：M1 阶段接入 Milkdown，实现所见即所得编辑。
 */

/** 编辑器实例的统一接口（供渲染层调用） */
export interface EditorInstance {
  /** 销毁编辑器，释放资源 */
  destroy(): void;
}

/**
 * 创建编辑器实例。
 * M0 阶段仅返回占位实现，M1 接入 Milkdown。
 *
 * @param container 编辑器挂载的 DOM 容器
 * @returns 编辑器实例
 */
export function createEditor(_container: HTMLElement): EditorInstance {
  return {
    destroy(): void {
      // M1 阶段实现：销毁 Milkdown 编辑器实例
    }
  };
}

/**
 * WYSIWYG 编辑器封装（基于 Milkdown）。
 * M1 阶段：接入 Milkdown，实现所见即所得 Markdown 编辑。
 *
 * 职责边界：
 * - 封装 Milkdown 初始化、预设配置、生命周期管理
 * - 提供统一的 EditorInstance 接口（getMarkdown / setMarkdown / destroy / onChange）
 * - 中文 IME 适配：Milkdown 底层 ProseMirror 已内置 composition 事件处理，
 *   此处不额外干预，保留默认的输入法组合行为
 */

import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  parserCtx,
  rootCtx
} from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';

/** 编辑器实例的统一接口（供渲染层调用） */
export interface EditorInstance {
  /** 获取当前 Markdown 文本 */
  getMarkdown(): string;
  /** 设置编辑器内容（替换全部） */
  setMarkdown(markdown: string): void;
  /** 在光标处插入 markdown 文本（如粘贴图片语法） */
  insertAtCursor(markdown: string): void;
  /** 滚动到指定标题（大纲跳转），title 为标题文本 */
  scrollToHeading(title: string): void;
  /** 销毁编辑器，释放资源 */
  destroy(): void;
}

/** 编辑器创建选项 */
export interface CreateEditorOptions {
  /** 初始 Markdown 内容 */
  defaultValue?: string;
  /** 内容变化回调（markdownUpdated 触发），返回最新 Markdown 文本 */
  onChange?: (markdown: string) => void;
}

/**
 * 创建编辑器实例（基于 Milkdown）。
 *
 * @param container 编辑器挂载的 DOM 容器
 * @param options 创建选项（初始内容、变化回调）
 * @returns 编辑器实例
 */
export async function createEditor(
  container: HTMLElement,
  options: CreateEditorOptions = {}
): Promise<EditorInstance> {
  const { defaultValue = '', onChange } = options;

  // 缓存最新的 Markdown 文本（由 markdownUpdated 回调更新）
  let currentMarkdown = defaultValue;

  const editor = await Editor.make()
    // 配置挂载容器与初始内容
    .config((ctx) => {
      ctx.set(rootCtx, container);
      ctx.set(defaultValueCtx, defaultValue);
    })
    // 监听器：在内容变化时同步缓存并触发回调
    .use(listener)
    // 注册内容变化监听（必须在 listener 插件之后，此时 listenerCtx 已就绪）
    .config((ctx) => {
      const manager = ctx.get(listenerCtx);
      manager.markdownUpdated((_ctx, markdown) => {
        currentMarkdown = markdown;
        onChange?.(markdown);
      });
    })
    // CommonMark 基础语法（标题/列表/引用/加粗/斜体/代码等）
    .use(commonmark)
    // GFM 扩展（表格、任务列表、删除线、自动链接等）
    .use(gfm)
    .create();

  return {
    /** 获取当前 Markdown 文本（返回缓存值） */
    getMarkdown(): string {
      return currentMarkdown;
    },

    /** 设置编辑器内容（解析 markdown 并替换整个文档） */
    setMarkdown(markdown: string): void {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const parser = ctx.get(parserCtx);
        if (!view || !parser) return;
        // 解析 markdown 为 ProseMirror 文档节点，并替换整个内容
        const doc = parser(markdown);
        const { state } = view;
        const tr = state.tr.replaceWith(0, state.doc.content.size, doc);
        view.dispatch(tr);
        currentMarkdown = markdown;
      });
    },

    /** 在光标处插入 markdown 文本（如粘贴图片语法），插入后光标落在文本末尾 */
    insertAtCursor(markdown: string): void {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const parser = ctx.get(parserCtx);
        if (!view || !parser) return;
        const { state } = view;
        // 解析要插入的 markdown 片段为文档节点
        const node = parser(markdown);
        // 在光标位置（selection.from）替换空选区，即原地插入
        const tr = state.tr.replaceWith(state.selection.from, state.selection.to, node);
        view.dispatch(tr);
      });
    },

    /** 滚动到指定标题（大纲跳转），按标题文本定位第一个匹配的标题节点 */
    scrollToHeading(title: string): void {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (!view) return;
        const { state } = view;
        let found = false;
        // 遍历文档节点，匹配标题节点且文本与目标一致
        state.doc.descendants((node, pos) => {
          if (found) return false;
          if (node.type.name === 'heading' && node.textContent === title) {
            found = true;
            // 将标题滚动到可视区域顶部（带少量内边距），并聚焦编辑器
            const dom = view.domAtPos(pos + 1).node as HTMLElement | null;
            const el = dom?.parentElement;
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            view.focus();
          }
        });
      });
    },

    /** 销毁编辑器，释放资源 */
    destroy(): void {
      void editor.destroy();
    }
  };
}

// 导出 Milkdown 类型，供渲染层使用
export type { Editor } from '@milkdown/kit/core';

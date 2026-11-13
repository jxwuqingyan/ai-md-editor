/**
 * 公式节点视图：点击即在原地编辑 TeX，而不是只能选中一个「框框」。
 *
 * 背景：所用的公式插件把 math_inline / math_block 都定义成 **atom** 节点，
 * 只负责用 KaTeX 渲染一遍，既没有编辑界面，也不能把光标放进节点内部——
 * 点一下只会拿到 NodeSelection，屏幕上就是一个选中描边框，公式改不了。
 *
 * 这里给两种公式节点挂上自定义 NodeView：
 * - 平时只显示 KaTeX 渲染结果，鼠标悬停淡底色提示「可以点」；
 * - 单击后预览换成单行 / 多行文本框，里面是原始 TeX，自动全选，可直接改；
 * - 提交时机：失焦、⌘/Ctrl + Enter、点击别处；Esc 放弃修改并退出编辑；
 * - TeX 清空后提交等于删除该公式；节点位置会随之调整，避免留下空节点。
 *
 * 数据落点：行内公式的 TeX 存在节点文本里（插件的 toMarkdown 取 textContent），
 * 块级公式存在 `value` 属性里（toMarkdown 取 attrs.value），提交时按各自规则写回。
 */
import katex from 'katex';
import { $prose } from '@milkdown/kit/utils';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import type { EditorView, NodeView } from '@milkdown/kit/prose/view';

/** 读取节点里保存的 TeX 原文 */
function readTex(node: ProseNode): string {
  if (node.type.name === 'math_block') return String(node.attrs['value'] ?? '');
  return node.textContent;
}

/**
 * 「下一个新建的公式节点自动进入编辑」标记。
 *
 * 从菜单插入公式时，用户期望直接开始写 TeX，而不是先看到占位内容再点一下。
 * 插入方（`insertSnippet`）在派发事务前调用 `requestMathAutoEdit()`，
 * 新建的节点视图消费一次即失效，不影响打开文档里已有的公式。
 */
let autoEditNext = false;

/** 请求：下一次创建的公式节点自动进入编辑态 */
export function requestMathAutoEdit(): void {
  autoEditNext = true;
}

/** 造一个带新 TeX 的同类型节点 */
function withTex(node: ProseNode, tex: string, view: EditorView): ProseNode {
  if (node.type.name === 'math_block') {
    return node.type.create({ ...node.attrs, value: tex });
  }
  // 行内公式的 TeX 放在文本内容里，空串时给 null（text* 允许空）
  return node.type.create(node.attrs, tex ? view.state.schema.text(tex) : null);
}

class MathNodeView implements NodeView {
  /** 节点根元素（保留 data-type，沿用既有公式相关样式） */
  dom: HTMLElement;
  private node: ProseNode;
  private preview: HTMLElement;
  private input: HTMLTextAreaElement;
  private editing = false;
  /** 进入编辑的时刻：用于忽略刚展开瞬间被浏览器抢焦点造成的 blur */
  private enteredAt = 0;
  /** 用户是否真的敲过内容：没敲过时的早期 blur 只重新聚焦，不提交 */
  private touched = false;
  private readonly block: boolean;

  constructor(
    node: ProseNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.node = node;
    this.block = node.type.name === 'math_block';

    this.dom = document.createElement(this.block ? 'div' : 'span');
    this.dom.className = this.block ? 'md-math md-math-block' : 'md-math md-math-inline';
    this.dom.dataset['type'] = this.block ? 'math_block' : 'math_inline';
    this.dom.contentEditable = 'false';

    this.preview = document.createElement(this.block ? 'div' : 'span');
    this.preview.className = 'md-math-preview';

    this.input = document.createElement('textarea');
    this.input.className = 'md-math-input';
    this.input.spellcheck = false;
    this.input.rows = this.block ? 2 : 1;
    this.input.style.display = 'none';

    this.dom.append(this.preview, this.input);
    this.render(node);

    // 用 mousedown 而不是 click：先挡住 ProseMirror 建 NodeSelection，
    // 否则会在公式外面套一层选中描边（就是原来那个「框框」）。
    this.dom.addEventListener('mousedown', (event) => this.handleMouseDown(event));
    this.input.addEventListener('blur', () => {
      // 刚展开的一瞬间，点选的后续处理可能把焦点抢回编辑器；这不是"编辑结束"，
      // 直接提交会导致"点开就关掉"。此时用户还没敲过字，重新聚焦让他真的能输入。
      if (this.editing && !this.touched && Date.now() - this.enteredAt < 250) {
        this.focusInput();
        return;
      }
      this.commit();
    });
    this.input.addEventListener('input', () => {
      this.touched = true;
    });
    this.input.addEventListener('keydown', (event) => this.handleInputKeyDown(event));

    // 刚从菜单插入的公式：直接进入编辑，用户可以马上敲 TeX
    if (autoEditNext) {
      autoEditNext = false;
      queueMicrotask(() => {
        if (this.view.editable && !this.editing) this.enter();
      });
    }
  }

  /** 渲染 KaTeX 预览（编辑中不刷新，避免打断输入） */
  private render(node: ProseNode): void {
    const tex = readTex(node);
    this.dom.dataset['value'] = tex;
    this.preview.innerHTML = '';
    if (!tex.trim()) {
      this.preview.className = 'md-math-preview md-math-empty';
      this.preview.textContent = this.block ? '空公式，点击编辑' : '空公式';
      return;
    }
    this.preview.className = 'md-math-preview';
    try {
      katex.render(tex, this.preview, { throwOnError: false, displayMode: this.block });
    } catch {
      // 非法 TeX 不让整个编辑器报错，原样显示
      this.preview.textContent = tex;
    }
  }

  private handleMouseDown(event: MouseEvent): void {
    if (!this.view.editable) return;
    event.preventDefault();
    event.stopPropagation();
    // 已经在编辑：把焦点还给文本框，别让 ProseMirror 把光标抢走
    if (this.editing) {
      this.focusInput();
      return;
    }
    this.enter();
  }

  private handleInputKeyDown(event: KeyboardEvent): void {
    // 输入法组合期间不拦截，回车交给输入法上屏
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      this.commit();
      return;
    }
    // 单行公式里回车直接提交，避免文本框被撑高
    if (event.key === 'Enter' && !this.block && !event.shiftKey) {
      event.preventDefault();
      this.commit();
      return;
    }
    // 内容已清空时按退格/删除 = 删掉这个公式
    if ((event.key === 'Backspace' || event.key === 'Delete') && !this.input.value) {
      event.preventDefault();
      this.commit();
      return;
    }
    event.stopPropagation();
  }

  /** 进入编辑：预览换成文本框，自动全选原始 TeX */
  private enter(): void {
    this.editing = true;
    this.enteredAt = Date.now();
    this.touched = false;
    this.dom.classList.add('md-math-editing');
    this.preview.style.display = 'none';
    this.input.style.display = '';
    this.input.value = readTex(this.node);
    this.resize();
    // 同步聚焦一次，再补一次异步：mousedown 之后浏览器可能把焦点还给编辑器
    this.focusInput();
    window.setTimeout(() => this.focusInput(), 0);
  }

  /** 聚焦文本框并全选，保证后续按键落在 TeX 上 */
  private focusInput(): void {
    if (!this.editing) return;
    this.input.focus({ preventScroll: true });
    this.input.select();
  }

  /** 按内容调整文本框尺寸（块级看行数，行内看字符数） */
  private resize(): void {
    if (this.block) {
      this.input.style.height = 'auto';
      this.input.style.height = `${Math.min(this.input.scrollHeight, 320)}px`;
      return;
    }
    const chars = Math.max(4, this.input.value.length + 1);
    this.input.style.width = `${chars}ch`;
  }

  private exit(): void {
    this.editing = false;
    this.dom.classList.remove('md-math-editing');
    this.input.style.display = 'none';
    this.preview.style.display = '';
  }

  /** 放弃修改：退出编辑，光标落到公式后面继续输入 */
  private cancel(): void {
    this.exit();
    this.render(this.node);
    const view = this.view;
    const pos = this.getPos();
    window.setTimeout(() => {
      view.focus();
      if (pos == null) return;
      const after = Math.min(pos + this.node.nodeSize, view.state.doc.content.size);
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(after), 1)));
    }, 0);
  }

  /** 提交：TeX 变了就写回节点，清空则删除该公式 */
  private commit(): void {
    if (!this.editing) return;
    const raw = this.input.value;
    const tex = this.block ? raw.replace(/\s+$/, '') : raw.replace(/\s*\n\s*/g, ' ').trim();
    const before = readTex(this.node);
    this.exit();
    const pos = this.getPos();
    const view = this.view;
    if (pos == null) return;

    const tr = view.state.tr;
    if (tex === before) {
      // 没改动：只把光标放到公式后面，避免残留节点选区（否则继续输入会覆盖公式）
      this.render(this.node);
      const after = Math.min(pos + this.node.nodeSize, tr.doc.content.size);
      view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(after), 1)));
      window.setTimeout(() => view.focus(), 0);
      return;
    }

    if (!tex) {
      // 清空即删除：块级公式删掉后文档不能空，补一个空段落
      tr.delete(pos, pos + this.node.nodeSize);
      const paragraph = view.state.schema.nodes['paragraph'];
      if (paragraph && tr.doc.childCount === 0) tr.insert(0, paragraph.create());
      const caret = Math.min(pos, tr.doc.content.size);
      tr.setSelection(TextSelection.near(tr.doc.resolve(caret), -1));
    } else {
      const next = withTex(this.node, tex, view);
      tr.replaceWith(pos, pos + this.node.nodeSize, next);
      const after = Math.min(pos + next.nodeSize, tr.doc.content.size);
      tr.setSelection(TextSelection.near(tr.doc.resolve(after), 1));
    }
    view.dispatch(tr.scrollIntoView());
    window.setTimeout(() => view.focus(), 0);
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    // 编辑过程中可能被撤销/外部改动覆盖，此时同步文本框内容
    if (this.editing) {
      const tex = readTex(node);
      if (this.input.value !== tex) this.input.value = tex;
      this.resize();
    } else {
      this.render(node);
    }
    return true;
  }

  /** 编辑中吞掉所有事件，别让 ProseMirror 抢焦点/改选区 */
  stopEvent(): boolean {
    return this.editing;
  }

  /** 预览区是 KaTeX 自己生成的 DOM，告诉 ProseMirror 不必关心这些变更 */
  ignoreMutation(): boolean {
    return true;
  }
}

/** 给行内 / 块级公式挂上可编辑节点视图 */
export const mathNodeViewPlugin = $prose(
  () =>
    new Plugin({
      props: {
        nodeViews: {
          math_inline: (node, view, getPos) => new MathNodeView(node, view, getPos),
          math_block: (node, view, getPos) => new MathNodeView(node, view, getPos)
        }
      }
    })
);

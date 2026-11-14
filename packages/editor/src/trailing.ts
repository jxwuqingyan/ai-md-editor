/**
 * 文档末尾「可输入段落」保障插件。
 *
 * 表格、分割线等块级节点一旦成为文档最后一个节点，ProseMirror 在它后面
 * 没有任何合法的文本位置：点表格下方的空白区放不进光标，也无法用
 * Backspace 选中并删除整张表。这里在每次文档变更后检查末尾节点，
 * 若它后面无法继续写普通文本，就追加一个空段落作为光标落点。
 *
 * 代码块虽然是 textblock（内部能放光标），但它是封闭块：Enter 只会继续写在
 * 代码里，点代码块下方同样没有落点，写不了正文。所以代码块与表格一样要补。
 *
 * 末尾已经是标题、正文、引用、列表这类能继续书写的块时不补，避免多出空行；
 * 补段落只改变文档结构，序列化成 Markdown 后仅影响尾部换行。
 */
import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state';

/**
 * 末尾节点是否需要补一个空段落。
 *
 * - `atom` 块（块级公式）：schema 上它带着 `content: 'text*'`，看起来是 textblock，
 *   但节点视图把 DOM 设成 `contentEditable=false`、只渲染 KaTeX，光标进不去，
 *   后面也没有可点位置——不补段落就只能看着公式、写不了下一行；
 * - 非 textblock（表格、分割线等）：后面没有合法光标位置；
 * - `spec.code` 为真的块（代码块）：内部只能写纯文本，Enter 换不出普通段落，
 *   点它下方也没有落点。
 */
function needsTrailingParagraph(node: {
  isTextblock: boolean;
  type: { spec: { code?: boolean; atom?: boolean } };
}): boolean {
  if (node.type.spec.atom === true) return true;
  if (!node.isTextblock) return true;
  return node.type.spec.code === true;
}

/** 需要时返回一个「在末尾补空段落」的事务 */
function trailingTransaction(state: EditorState): Transaction | null {
  const last = state.doc.lastChild;
  if (!last || !needsTrailingParagraph(last)) return null;
  const paragraph = state.schema.nodes['paragraph'];
  if (!paragraph) return null;
  return state.tr.insert(state.doc.content.size, paragraph.create());
}

export const trailingParagraphPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey('MDNOTE_TRAILING_PARAGRAPH'),
      appendTransaction: (_transactions, _oldState, state) => trailingTransaction(state),
      /**
       * 打开文件 / 切回所见即所得时，编辑器是用 defaultValue 直接建 state 的，
       * 没有经过任何事务，`appendTransaction` 不会被调用——于是「文档以表格、
       * 代码块、公式结尾」的文档打开后下方点不进去。这里在建视图时补一次同样的检查。
       */
      view: (view) => {
        queueMicrotask(() => {
          const tr = trailingTransaction(view.state);
          if (tr) view.dispatch(tr);
        });
        return {};
      }
    })
);

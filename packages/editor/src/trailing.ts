/**
 * 文档末尾「可输入段落」保障插件。
 *
 * 表格、分割线等块级节点一旦成为文档最后一个节点，ProseMirror 在它后面
 * 没有任何合法的文本位置：点表格下方的空白区放不进光标，也无法用
 * Backspace 选中并删除整张表。这里在每次文档变更后检查末尾节点，
 * 若它本身不能直接输入文本，就追加一个空段落作为光标落点。
 *
 * 末尾已经是标题、正文、代码块这类 textblock 时不补，避免多出空行；
 * 补段落只改变文档结构，序列化成 Markdown 后仅影响尾部换行。
 */
import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';

export const trailingParagraphPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey('MDNOTE_TRAILING_PARAGRAPH'),
      appendTransaction: (_transactions, _oldState, state) => {
        const last = state.doc.lastChild;
        if (!last || last.type.isTextblock) return null;
        const paragraph = state.schema.nodes['paragraph'];
        if (!paragraph) return null;
        return state.tr.insert(state.doc.content.size, paragraph.create());
      }
    })
);

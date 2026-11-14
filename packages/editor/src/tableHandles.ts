/**
 * 表格行列手柄：选中整行 / 整列后浮出增删工具条。
 *
 * 交互：表格上方是每列一个的列手柄，左侧是每行一个的行手柄，左上角是选中
 * 整张表的角手柄。点手柄构造整行 / 整列 / 整表的 CellSelection（选中单元格
 * 由预设的表格编辑插件自动高亮），并在表格上方浮出增删按钮。
 *
 * 手柄默认隐藏（不打扰阅读），只有鼠标悬停到表格上、或编辑光标 / 选区落在
 * 表格内时才浮现；光标离开后自动收起。
 *
 * 为什么用 NodeView 包一层：手柄必须落在表格 DOM 之外（否则会被 ProseMirror
 * 当成内容变化），又必须跟每列宽度、每行高度对齐；自定义 NodeView 让手柄
 * 成为 contentDOM 的兄弟节点，改它的 class / 文本不会污染文档。
 *
 * 命令仍然走统一的 format 分发（与工具栏、菜单、斜杠菜单同一条链路），
 * 本文件只负责选中与交互，不重复实现表格事务。
 */
import { $prose } from '@milkdown/kit/utils';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { CellSelection } from '@milkdown/kit/prose/tables';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import type { EditorView, NodeView } from '@milkdown/kit/prose/view';
import type { FormatAction } from './types';
import { findAncestor } from './commands';

/** 选中的是行还是列 */
type Axis = 'row' | 'col';
/** 选中目标：行 / 列 / 整张表（左上角手柄） */
type SelectedAxis = Axis | 'table';
/** 工具条动作 */
type HandleAction = 'insertBefore' | 'insertAfter' | 'remove' | 'removeTable';

interface SelectedHandle {
  axis: SelectedAxis;
  /** 行 / 列在表格中的序号（0 起，0 行即表头）；整表选中时为 -1 */
  index: number;
}

/** 存活的表格视图：插件在每次事务 / 选区更新时同步手柄与工具条 */
const activeViews = new Set<TableNodeView>();

/** 手柄中心的六点抓取标记（内容全部来自本文件常量，安全走 innerHTML） */
const GRIP_ICON =
  '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">' +
  '<circle cx="3" cy="2.5" r="1"/><circle cx="9" cy="2.5" r="1"/>' +
  '<circle cx="3" cy="6" r="1"/><circle cx="9" cy="6" r="1"/>' +
  '<circle cx="3" cy="9.5" r="1"/><circle cx="9" cy="9.5" r="1"/></svg>';

/**
 * 插入按钮图标：方向必须和选中的轴一致。
 * 列用左右箭头（在左 / 右插入一列），行用上下箭头（在上 / 下插入一行）；
 * 之前两个轴共用竖箭头，选列时看起来像在加行，容易误点。
 */
const INSERT_ICONS: Record<Axis, Record<'insertBefore' | 'insertAfter', string>> = {
  col: {
    insertBefore:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M5 4v16"/><path d="M20 12H9"/><path d="M12.5 8.5 9 12l3.5 3.5"/></svg>',
    insertAfter:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M19 4v16"/><path d="M4 12h11"/><path d="M11.5 8.5 15 12l-3.5 3.5"/></svg>'
  },
  row: {
    insertBefore:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4 5h16"/><path d="M12 20V9"/><path d="M8.5 12.5 12 9l3.5 3.5"/></svg>',
    insertAfter:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4 19h16"/><path d="M12 4v11"/><path d="M8.5 11.5 12 15l3.5-3.5"/></svg>'
  }
};

/** 删除整行 / 整列 */
const REMOVE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';

/** 删除整张表（只在角手柄选中整表时出现） */
const REMOVE_TABLE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M9 4v16M15 20 20 15M20 20l-5-5"/></svg>';

/** 工具条按钮文案（按选中轴切换） */
const ACTION_LABELS: Record<Axis, Record<'insertBefore' | 'insertAfter' | 'remove', string>> = {
  col: {
    insertBefore: '在左侧插入一列',
    insertAfter: '在右侧插入一列',
    remove: '删除这一列'
  },
  row: {
    insertBefore: '在上方插入一行',
    insertAfter: '在下方插入一行',
    remove: '删除这一行'
  }
};

/**
 * 计算某个单元格**节点前**的文档位置（CellSelection 需要的坐标）。
 *
 * 表格节点的文档坐标：tablePos 是节点前，+1 进入第一行，+1 进入该行的单元格列表，
 * 再按前面的单元格大小累加。这里不能再 +1 进单元格内容：单元格里还有一层
 * paragraph，多进一层会让 `$cell.node(-1)` 变成行节点，CellSelection 直接抛
 * "Not a table node"。
 */
function cellBeforePos(view: EditorView, tablePos: number, row: number, col: number): number | null {
  const table = view.state.doc.nodeAt(tablePos);
  if (!table || row < 0 || row >= table.childCount) return null;
  const rowNode = table.child(row);
  if (col < 0 || col >= rowNode.childCount) return null;
  let pos = tablePos + 1;
  for (let r = 0; r < row; r += 1) pos += table.child(r).nodeSize;
  pos += 1;
  for (let c = 0; c < col; c += 1) pos += rowNode.child(c).nodeSize;
  return pos;
}

class TableNodeView implements NodeView {
  /** 外层容器（手柄挂在这里，不属于可编辑内容） */
  dom: HTMLDivElement;
  /** 真正的表格 DOM，ProseMirror 只管理它里面的内容 */
  contentDOM: HTMLTableElement;
  private view: EditorView;
  private getPos: () => number | undefined;
  private format: (action: FormatAction) => void;
  private colBar: HTMLDivElement;
  private rowBar: HTMLDivElement;
  /** 左上角手柄：点击选中整张表 */
  private corner: HTMLButtonElement;
  /** 工具条挂在 body 上用 fixed 定位，避免被编辑区滚动容器裁掉 */
  private toolbar: HTMLDivElement;
  private selected: SelectedHandle | null = null;
  private observer: ResizeObserver;
  private colCount = -1;
  private rowCount = -1;
  /** 视口变化（滚动 / 缩放）时重算工具条位置 */
  private onViewportChange = (): void => {
    if (!this.selected) return;
    this.syncSizes();
    this.positionToolbar();
  };

  constructor(
    _node: ProseNode,
    view: EditorView,
    getPos: () => number | undefined,
    format: (action: FormatAction) => void
  ) {
    this.view = view;
    this.getPos = getPos;
    this.format = format;

    this.dom = document.createElement('div');
    this.dom.className = 'md-table-block';
    this.contentDOM = document.createElement('table');
    this.dom.appendChild(this.contentDOM);

    this.colBar = document.createElement('div');
    this.colBar.className = 'md-table-handle-bar md-table-col-bar';
    this.rowBar = document.createElement('div');
    this.rowBar.className = 'md-table-handle-bar md-table-row-bar';
    this.corner = document.createElement('button');
    this.corner.type = 'button';
    this.corner.className = 'md-table-corner';
    this.corner.title = '选中整张表';
    this.corner.innerHTML = `<span class="md-table-grip">${GRIP_ICON}</span>`;
    this.corner.addEventListener('mousedown', (event) => event.preventDefault());
    this.corner.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.selectTable();
    });
    this.dom.append(this.colBar, this.rowBar, this.corner);

    this.toolbar = document.createElement('div');
    this.toolbar.className = 'md-table-toolbar';
    this.toolbar.hidden = true;
    (['insertBefore', 'insertAfter', 'remove', 'removeTable'] as HandleAction[]).forEach((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'md-table-tool-btn';
      button.dataset.tableAction = action;
      // 图标与显隐按选中轴在 paint() 里决定：行 / 列只给插入、删除本行/列，
      // 「删除整张表」只在角手柄选中整表时出现
      button.innerHTML = action === 'removeTable' ? REMOVE_TABLE_ICON : REMOVE_ICON;
      // 不让按下去的瞬间抢走编辑器焦点，否则 CellSelection 会丢
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.run(action);
      });
      this.toolbar.appendChild(button);
    });
    document.body.appendChild(this.toolbar);

    this.observer = new ResizeObserver(() => this.onViewportChange());
    this.observer.observe(this.contentDOM);
    document.addEventListener('scroll', this.onViewportChange, true);
    window.addEventListener('resize', this.onViewportChange);
    activeViews.add(this);

    // NodeView 创建时 contentDOM 还是空 table，单元格要等 ProseMirror 挂载后才有
    requestAnimationFrame(() => this.syncEditorState(this.view));
  }

  update(node: ProseNode): boolean {
    if (node.type.name !== 'table') return false;
    this.syncEditorState(this.view);
    return true;
  }

  /** 手柄是装饰 DOM，它的变化一律忽略，否则会被当成表格内容被改动 */
  ignoreMutation(mutation: Parameters<NonNullable<NodeView['ignoreMutation']>>[0]): boolean {
    return !this.contentDOM.contains(mutation.target as Node);
  }

  destroy(): void {
    activeViews.delete(this);
    this.observer.disconnect();
    document.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange);
    this.toolbar.remove();
  }

  /** 手柄数量与表格行列数保持一致，并同步尺寸 / 选中态 */
  syncEditorState(view: EditorView): void {
    this.ensureHandles();
    const selection = view.state.selection;
    const tablePos = this.getPos();
    const isCellSelection = selection instanceof CellSelection;
    const belongsHere =
      isCellSelection &&
      tablePos !== undefined &&
      findAncestor(selection.$anchorCell, 'table')?.pos === tablePos;
    // 用户在别处点了一下，或命令改掉了选区：收起工具条
    if (!belongsHere && this.selected) {
      this.selected = null;
      this.paint();
    }
    if (this.selected) this.positionToolbar();
  }

  /** 按表格当前行列数重建手柄 */
  private ensureHandles(): void {
    const rows = Array.from(this.contentDOM.rows);
    const cols = rows[0]?.cells.length ?? 0;
    if (cols !== this.colCount) {
      this.colCount = cols;
      this.colBar.replaceChildren(
        ...Array.from({ length: cols }, (_, index) => this.makeHandle('col', index))
      );
    }
    if (rows.length !== this.rowCount) {
      this.rowCount = rows.length;
      this.rowBar.replaceChildren(
        ...Array.from({ length: rows.length }, (_, index) => this.makeHandle('row', index))
      );
    }
    this.syncSizes();
    if (this.selected) this.paint();
  }

  private makeHandle(axis: Axis, index: number): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `md-table-handle md-table-${axis}-handle`;
    button.dataset.axis = axis;
    button.dataset.index = String(index);
    button.title = axis === 'col' ? `选择第 ${index + 1} 列` : `选择第 ${index + 1} 行`;
    button.innerHTML = `<span class="md-table-grip">${GRIP_ICON}</span>`;
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.select(axis, index);
    });
    return button;
  }

  /** 手柄宽度 / 高度跟随真实单元格，列宽不匀时也不会错位 */
  private syncSizes(): void {
    const rows = Array.from(this.contentDOM.rows);
    const first = rows[0];
    Array.from(this.colBar.children).forEach((handle, index) => {
      const width = first?.cells[index]?.getBoundingClientRect().width;
      (handle as HTMLElement).style.width = width ? `${width}px` : '';
    });
    Array.from(this.rowBar.children).forEach((handle, index) => {
      const height = rows[index]?.getBoundingClientRect().height;
      (handle as HTMLElement).style.height = height ? `${height}px` : '';
    });
  }

  /** 点手柄：构造整行 / 整列的 CellSelection，预设的表格插件会自动高亮单元格 */
  private select(axis: Axis, index: number): void {
    const tablePos = this.getPos();
    if (tablePos === undefined) return;
    const row = axis === 'row' ? index : 0;
    const col = axis === 'col' ? index : 0;
    const pos = cellBeforePos(this.view, tablePos, row, col);
    if (pos === null) return;
    const $cell = this.view.state.doc.resolve(pos);
    const selection =
      axis === 'row' ? CellSelection.rowSelection($cell) : CellSelection.colSelection($cell);
    this.view.dispatch(this.view.state.tr.setSelection(selection));
    this.view.focus();
    this.selected = { axis, index };
    this.paint();
  }

  /** 左上角手柄：选中整张表（首格到末格的 CellSelection） */
  private selectTable(): void {
    const tablePos = this.getPos();
    if (tablePos === undefined) return;
    const table = this.view.state.doc.nodeAt(tablePos);
    if (!table || table.childCount === 0) return;
    const firstPos = cellBeforePos(this.view, tablePos, 0, 0);
    const lastRow = table.childCount - 1;
    const lastRowNode = table.child(lastRow);
    const lastPos = cellBeforePos(this.view, tablePos, lastRow, lastRowNode.childCount - 1);
    if (firstPos === null || lastPos === null) return;
    const selection = new CellSelection(
      this.view.state.doc.resolve(firstPos),
      this.view.state.doc.resolve(lastPos)
    );
    this.view.dispatch(this.view.state.tr.setSelection(selection));
    this.view.focus();
    this.selected = { axis: 'table', index: -1 };
    this.paint();
  }

  /** 刷新手柄选中态与工具条 */
  private paint(): void {
    const selected = this.selected;
    this.dom.classList.toggle('md-table-has-selection', selected !== null);
    this.corner.classList.toggle('is-selected', selected?.axis === 'table');
    Array.from(this.dom.querySelectorAll<HTMLElement>('.md-table-handle')).forEach((handle) => {
      // 整表选中时整条手柄带一起变蓝（与左上角角手柄连成一体），行列选中只亮对应的那一个
      const active =
        selected !== null &&
        (selected.axis === 'table' ||
          (handle.dataset.axis === selected.axis && Number(handle.dataset.index) === selected.index));
      handle.classList.toggle('is-selected', active);
    });
    this.toolbar.hidden = selected === null;
    if (!selected) return;

    const isTable = selected.axis === 'table';
    const axis: Axis = isTable ? 'row' : selected.axis;
    const labels = ACTION_LABELS[axis];
    Array.from(this.toolbar.querySelectorAll<HTMLButtonElement>('.md-table-tool-btn')).forEach((button) => {
      const action = button.dataset.tableAction as HandleAction;
      // 行列选中时只提供「插入本行/列的左右（上下）侧」和「删除本行/列」；
      // 「删除整张表」只在角手柄选中整表时出现，避免删行列时误删整表
      const visible = isTable ? action === 'removeTable' : action !== 'removeTable';
      button.hidden = !visible;
      if (!visible) {
        button.disabled = true;
        return;
      }
      if (isTable) {
        button.innerHTML = REMOVE_TABLE_ICON;
        button.disabled = false;
        button.title = '删除整张表';
        return;
      }
      button.innerHTML = action === 'remove' ? REMOVE_ICON : INSERT_ICONS[axis][action];
      // 表头行之上不能插数据行（表格必须以表头行开头），禁用而不是给出坏结果
      const headerBlocked = axis === 'row' && selected.index === 0 && action === 'insertBefore';
      // 只剩一列 / 只剩「表头 + 一个数据行」时，再删会产出非法表格
      const lastBlocked =
        action === 'remove' &&
        (axis === 'col'
          ? (this.contentDOM.rows[0]?.cells.length ?? 0) <= 1
          : this.contentDOM.rows.length <= 2);
      button.disabled = headerBlocked || lastBlocked;
      button.title = headerBlocked
        ? '表头上方不能插入行'
        : lastBlocked
          ? '表格不能再缩小了'
          : labels[action];
    });
    this.toolbar.dataset.axis = selected.axis;
    this.positionToolbar();
  }

  /**
   * 工具条浮在表格上方居中，**不压住表格**：
   * 以整个 block（含上方手柄带）为基准，向上留 8px 间隙；
   * 上方空间不足（表格贴视口顶部）时改到表格下方，同样留 8px。
   */
  private positionToolbar(): void {
    if (!this.selected) return;
    const rect = this.dom.getBoundingClientRect();
    const height = this.toolbar.offsetHeight || 36;
    const above = rect.top - height - 8;
    this.toolbar.style.left = `${rect.left + rect.width / 2}px`;
    this.toolbar.style.top = `${above >= 8 ? above : rect.bottom + 8}px`;
  }

  /** 工具栏动作：重新定位选区后交给统一的 format 链路 */
  private run(action: HandleAction): void {
    const selected = this.selected;
    if (!selected) return;
    const { axis, index } = selected;
    if (axis === 'table') {
      // 整表选中只支持删除整张表
      if (action !== 'removeTable') return;
      this.selectTable();
      this.format('tableDelete');
    } else {
      // 命令基于当前选区判断行列；先重设一次，避免中间被别的操作改掉
      this.select(axis, index);
      if (action === 'removeTable') {
        this.format('tableDelete');
      } else if (action === 'remove') {
        this.format(axis === 'row' ? 'tableDeleteRow' : 'tableDeleteCol');
      } else if (action === 'insertBefore') {
        this.format(axis === 'row' ? 'tableAddRowBefore' : 'tableAddColBefore');
      } else {
        this.format(axis === 'row' ? 'tableAddRow' : 'tableAddCol');
      }
    }
    // 收尾：命令可能留下整格选区，用户接着打字会一次清空整行 / 整列单元格。
    // 换回普通文本光标，同时让 selectedCell 高亮自然消失。
    const { state } = this.view;
    const pos = Math.min(state.selection.$from.pos, state.doc.content.size);
    this.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos))));
    this.selected = null;
    this.paint();
  }
}

/**
 * 表格行列手柄插件。
 * Plugin.view.update 在文档与选区变化时都会触发，用来同步所有表格的手柄数量、
 * 选中态和工具条位置（包括用户点别处后自动收起）。
 */
export function tableHandlesPlugin(format: (action: FormatAction) => void) {
  return $prose(
    () =>
      new Plugin({
        props: {
          nodeViews: {
            table: (node, view, getPos) => new TableNodeView(node, view, getPos, format)
          }
        },
        view() {
          return {
            update: (view: EditorView) => {
              activeViews.forEach((nodeView) => nodeView.syncEditorState(view));
            }
          };
        }
      })
  );
}

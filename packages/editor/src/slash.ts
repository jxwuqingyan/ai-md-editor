/**
 * 斜杠快速插入菜单插件。
 *
 * 在段落/标题里输入「/」（行首、空格、中文等非字母数字之后）时弹出浮层菜单：
 * - 「最近使用」：localStorage 记录最近 3 个条目，置顶为快捷胶囊；
 * - 「格式」网格：正文 / 标题 1~6 / 无序与有序与任务列表 / 引用 / 代码块 / 分割线；
 * - 「插入」列表：表格 / 图片 / 链接 / 公式。
 *
 * 继续输入可过滤（匹配中文名或拼音缩写别名），↑↓ 选择、Enter 确认、Esc 关闭；
 * 确认时先删掉「/过滤词」，再统一走 format()（与工具栏 / 原生菜单同一条命令链路），
 * 保证撤销历史、表格上下文等行为完全一致。
 * 二级面板：表格 → 行列网格；链接 → 文本/地址表单；图片 → 交还渲染层打开文件选择器。
 *
 * 触发规则刻意保守：光标必须停在文本块内、无选区、不在行内代码里，
 * 且「/」的前一个字符不能是字母数字、冒号或斜杠——避免输入网址（https://）、
 * 路径（a/b）时频繁误弹。
 */
import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { FormatAction } from './types';

/** 斜杠菜单条目 */
interface SlashItem {
  /** 稳定 id（最近使用记录用） */
  id: string;
  /** 展示名 */
  label: string;
  /** 过滤别名（拼音缩写 / 英文），统一小写 */
  aliases: string[];
  /**
   * 图标：以 `<svg` 开头当作内联 SVG，否则当作文本字形（T / H1…H6）。
   * 内容全部来自本文件常量，不含用户输入，可以安全走 innerHTML。
   */
  icon: string;
  /** 套用的格式化动作（与 FormatAction 对齐） */
  action: FormatAction;
  /** 动作参数（标题级别 / 片段文本） */
  payload?: number | string;
  /** format：改变当前块类型（网格区）；insert：插入片段（插入区） */
  kind: 'format' | 'insert';
  /** 插入区条目的补充说明（如「3×3」） */
  hint?: string;
}

/** 「格式」区图标（行内 SVG，stroke 跟随 currentColor） */
const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** 全部菜单条目（数组顺序即无过滤时的展示与键盘导航顺序） */
const ITEMS: SlashItem[] = [
  { id: 'paragraph', label: '正文', aliases: ['zw', 'zhengwen', 'text', 'body'], icon: 'T', action: 'paragraph', kind: 'format' },
  { id: 'h1', label: '标题 1', aliases: ['h1', 'bt1'], icon: 'H1', action: 'heading', payload: 1, kind: 'format' },
  { id: 'h2', label: '标题 2', aliases: ['h2', 'bt2'], icon: 'H2', action: 'heading', payload: 2, kind: 'format' },
  { id: 'h3', label: '标题 3', aliases: ['h3', 'bt3'], icon: 'H3', action: 'heading', payload: 3, kind: 'format' },
  { id: 'h4', label: '标题 4', aliases: ['h4', 'bt4'], icon: 'H4', action: 'heading', payload: 4, kind: 'format' },
  { id: 'h5', label: '标题 5', aliases: ['h5', 'bt5'], icon: 'H5', action: 'heading', payload: 5, kind: 'format' },
  { id: 'h6', label: '标题 6', aliases: ['h6', 'bt6'], icon: 'H6', action: 'heading', payload: 6, kind: 'format' },
  {
    id: 'bulletList',
    label: '无序列表',
    aliases: ['lb', 'liebiao', 'wuxu', 'ul', 'list'],
    icon: svg('<circle cx="5" cy="7" r="1.3" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="5" cy="17" r="1.3" fill="currentColor" stroke="none"/><path d="M10 7h9M10 12h9M10 17h9"/>'),
    action: 'bulletList',
    kind: 'format'
  },
  {
    id: 'orderedList',
    label: '有序列表',
    aliases: ['lb', 'liebiao', 'youxu', 'ol'],
    icon: svg('<text x="3" y="9" font-size="7.5" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="3" y="19" font-size="7.5" fill="currentColor" stroke="none" font-family="sans-serif">2</text><path d="M10 7h9M10 12h6M10 17h9"/>'),
    action: 'orderedList',
    kind: 'format'
  },
  {
    id: 'taskList',
    label: '任务列表',
    aliases: ['lb', 'liebiao', 'renwu', 'rw', 'task', 'todo', 'check'],
    icon: svg('<rect x="3.5" y="5" width="7" height="7" rx="1.5"/><path d="m5 8.4 1.8 1.8 3-3.4"/><path d="M14 8.5h6M14 16h6"/><rect x="3.5" y="12.5" width="7" height="7" rx="1.5"/>'),
    action: 'taskList',
    kind: 'format'
  },
  {
    id: 'quote',
    label: '引用',
    aliases: ['yy', 'yinyong', 'quote', 'blockquote'],
    icon: svg('<path d="M8 7c-2.5 1-4 3-4 5.5V17h5v-5H6.5C6.7 10.4 7.6 9 9.5 8.2Z" fill="currentColor" stroke="none"/><path d="M17.5 7c-2.5 1-4 3-4 5.5V17h5v-5H16c.2-1.6 1.1-3 3-3.8Z" fill="currentColor" stroke="none"/>'),
    action: 'quote',
    kind: 'format'
  },
  {
    id: 'codeBlock',
    label: '代码块',
    aliases: ['dm', 'daima', 'code', 'pre'],
    icon: svg('<path d="m8 6-6 6 6 6"/><path d="m16 6 6 6-6 6"/><path d="m14 4-4 16"/>'),
    action: 'codeBlock',
    kind: 'format'
  },
  {
    id: 'hr',
    label: '分割线',
    aliases: ['fg', 'fengex', 'fengexian', 'hr', 'line'],
    icon: svg('<path d="M3 12h18"/>'),
    action: 'hr',
    kind: 'format'
  },
  {
    id: 'insertTable',
    label: '表格',
    aliases: ['bg', 'biaoge', 'table'],
    icon: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.5h18M3 15h18M9.5 4v16M15.5 4v16"/>'),
    action: 'insertTable',
    kind: 'insert'
  },
  {
    id: 'image',
    label: '图片',
    aliases: ['tp', 'tupian', 'img', 'image', 'pic'],
    icon: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>'),
    action: 'snippet',
    payload: '![图片](url)',
    kind: 'insert',
    hint: '本地文件'
  },
  {
    id: 'link',
    label: '链接',
    aliases: ['lj', 'lianjie', 'link', 'url', 'a'],
    icon: svg('<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>'),
    action: 'snippet',
    payload: '[链接文字](url)',
    kind: 'insert'
  },
  {
    id: 'formula',
    label: '公式',
    aliases: ['gs', 'gongshi', 'math', 'latex', 'formula'],
    icon: svg('<path d="M18 5H8l6 7-6 7h10"/>'),
    action: 'snippet',
    payload: '$$\nE = mc^2\n$$',
    kind: 'insert',
    hint: '块级'
  }
];

/** 按过滤词筛条目：中文名包含，或别名前缀匹配 */
function matchItems(filter: string): SlashItem[] {
  const query = filter.trim().toLowerCase();
  if (!query) return ITEMS;
  return ITEMS.filter(
    (item) => item.label.includes(filter) || item.aliases.some((alias) => alias.startsWith(query))
  );
}

/** 最近使用记录（localStorage，最多 3 个 id） */
const RECENT_KEY = 'mdnote-slash-recents';

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, 3) : [];
  } catch {
    return [];
  }
}

function saveRecent(id: string): void {
  try {
    const next = [id, ...loadRecents().filter((x) => x !== id)].slice(0, 3);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可用（如禁用存储）时静默跳过
  }
}

/** 触发状态：「/」的位置与之后的过滤词 */
interface SlashTrigger {
  from: number;
  filter: string;
}

/**
 * 检测当前光标是否构成触发条件。
 * 返回 null 表示不触发（含只读、选区非空、不在文本块、模式不匹配等情况）。
 */
function detectSlash(state: EditorState): SlashTrigger | null {
  const { $from, empty } = state.selection;
  if (!empty) return null;
  const parent = $from.parent;
  // 只在段落/标题这类文本块里触发；代码块（type.spec.code）与行内代码（code mark）不弹
  if (!parent.isTextblock || parent.type.spec.code) return null;
  if ($from.parentOffset === 0) return null;
  if ($from.marks().some((mark) => mark.type.spec.code)) return null;
  const textBefore = parent.textBetween(0, $from.parentOffset, '\ufffc', '\ufffc');
  // 「/」前不能是字母数字 / 冒号 / 斜杠（网址、路径、纯英文单词中间不触发）
  const match = /(^|[^A-Za-z0-9/:])\/([^\s/]{0,20})$/u.exec(textBefore);
  if (!match) return null;
  return { from: $from.pos - match[2].length - 1, filter: match[2] };
}

/** XML 属性转义（条目文案是常量，这里只作防御） */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/** 插件选项：确认条目后统一走这条格式化入口（实例的 format 实现） */
export interface SlashMenuOptions {
  format: (action: FormatAction, payload?: number | string) => void;
  /** 「图片」条目确认后打开系统文件选择器（由实例注入；缺省时退回插入占位语法） */
  pickImage?: () => void;
}

/** 表格条目 id（二级行列网格挂在它上面） */
const TABLE_ID = 'insertTable';
/** 链接条目 id（二级表单挂在它上面） */
const LINK_ID = 'link';
/** 图片条目 id（确认后交还渲染层打开文件选择器） */
const IMAGE_ID = 'image';
/** 二级网格的单元格规模：最多可选 8 列 × 6 行 */
const SUB_MAX_COLS = 8;
const SUB_MAX_ROWS = 6;

/**
 * 创建斜杠菜单插件。每个编辑器实例一份独立面板与状态。
 */
export function slashMenuPlugin(options: SlashMenuOptions) {
  // —— 面板与状态（编辑器实例级） ——
  let panel: HTMLDivElement | null = null;
  /** 表格二级行列网格面板 */
  let subPanel: HTMLDivElement | null = null;
  /** 链接二级表单面板（文本 + 链接地址） */
  let formPanel: HTMLDivElement | null = null;
  let isOpen = false;
  /** 二级网格是否展开 */
  let subOpen = false;
  /** 链接表单是否展开（展开时焦点在输入框上，编辑器失焦不算关菜单信号） */
  let formOpen = false;
  /** 二级网格当前选中的行数 / 列数 */
  let subRows = 3;
  let subCols = 3;
  /** 二级网格的定位锚点：以鼠标实际悬停到的「表格」条目为准，避免网格盖住光标 */
  let subAnchor: HTMLElement | null = null;
  let trigger: SlashTrigger | null = null;
  let activeIndex = 0;
  /** 当前展示（过滤后）的条目，键盘导航与点击确认都用它的下标 */
  let visible: SlashItem[] = [];

  const ensurePanel = (): HTMLDivElement => {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.className = 'slash-menu';
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', '快速插入菜单');
    // 按下不抢焦点：否则编辑器 blur 会先把菜单关掉
    panel.addEventListener('mousedown', (event) => event.preventDefault());
    // 悬停表格条目时展开二级网格，悬停其他条目时收回；表单展开期间不抢戏
    panel.addEventListener('mouseover', (event) => {
      if (!isOpen || formOpen) return;
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-slash-id],[data-slash-index]');
      if (!target) return;
      if (target.dataset['slashId'] === TABLE_ID || visible[Number(target.dataset['slashIndex'])]?.id === TABLE_ID) {
        // 记录真正悬停到的条目：网格要贴着这一行展开，不能盖住光标
        subAnchor = target;
        if (!subOpen) openSub();
        else positionSub();
      } else {
        subAnchor = null;
        closeSub();
      }
    });
    // 鼠标移出菜单：把网格一起收回；移进网格本身不算离开
    panel.addEventListener('mouseleave', () => {
      if (!isOpen || !subOpen) return;
      window.setTimeout(() => {
        if (!isOpen || !subOpen) return;
        if (subPanel && subPanel.matches(':hover')) return;
        subAnchor = null;
        closeSub();
      }, 120);
    });
    panel.addEventListener('click', (event) => {
      const view = viewRef;
      if (!view || !isOpen) return;
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-slash-id],[data-slash-index]');
      if (!target) return;
      const byId = target.dataset['slashId'];
      const item = byId
        ? ITEMS.find((candidate) => candidate.id === byId)
        : visible[Number(target.dataset['slashIndex'])];
      if (!item) return;
      if (item.id === TABLE_ID) {
        // 表格不直接插入：悬停已展开网格，这里只保证网格可见；
        // 插入一律走点击网格单元格（或键盘 Enter），避免行点击误插 3×3。
        closeForm();
        if (subOpen) positionSub();
        else openSub();
        return;
      }
      if (item.id === LINK_ID) {
        // 链接不直接插入：展开二级表单填文本与地址
        closeSub();
        if (!formOpen) openForm();
        return;
      }
      if (item.id === IMAGE_ID) {
        // 图片不直接插入：打开系统文件选择器
        applyItemImage(view);
        return;
      }
      closeSub();
      applyItem(view, item);
    });
    // 必须挂在 .app（主题 CSS 变量的宿主）下而不是 body：
    // 变量经 React style 注入在 .app 上，挂 body 下 var(--bg-panel) 全部解析失败，
    // 面板会变成透明底、文字与正文穿透混在一起。
    const host = document.querySelector('.app');
    (host instanceof HTMLElement ? host : document.body).appendChild(panel);
    return panel;
  };

  const hidePanel = (): void => {
    if (panel) panel.style.display = 'none';
    closeSub();
    closeForm();
    isOpen = false;
  };

  // —— 表格二级行列网格（语雀式：悬扫单元格选行列，实时显示 N 行 × M 列） ——

  const ensureSubPanel = (): HTMLDivElement => {
    if (subPanel) return subPanel;
    subPanel = document.createElement('div');
    subPanel.className = 'slash-sub';
    subPanel.setAttribute('role', 'grid');
    subPanel.setAttribute('aria-label', '选择表格行列');
    subPanel.addEventListener('mousedown', (event) => event.preventDefault());
    // 悬扫单元格：以悬停到的格子为右下角，高亮 subRows × subCols 区域（只切换 class，不重建 DOM）
    subPanel.addEventListener('mouseover', (event) => {
      const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-sub-r]');
      if (!cell) return;
      subRows = Math.max(1, Number(cell.dataset['subR']));
      subCols = Math.max(1, Number(cell.dataset['subC']));
      highlightSub();
    });
    // 点击任意格子（或格子间的缝隙）都按当前选中的行列插入表格：
    // 直接命中格子用格子自身数据；命中风隙/背景时回退到最近一次悬停的 subRows/subCols，
    // 保证右下角等大尺寸「点一下即可插入」，不必再按回车。
    subPanel.addEventListener('click', (event) => {
      const view = viewRef;
      if (!view) return;
      const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-sub-r]');
      if (cell) {
        subRows = Math.max(1, Number(cell.dataset['subR']));
        subCols = Math.max(1, Number(cell.dataset['subC']));
      }
      applyTable(view);
    });
    // 鼠标离开网格：回到菜单里（含表格那一行）就留着，彻底移开则收回
    subPanel.addEventListener('mouseleave', () => {
      if (!subOpen) return;
      window.setTimeout(() => {
        if (!subOpen) return;
        if (panel && panel.matches(':hover')) return;
        subAnchor = null;
        closeSub();
      }, 120);
    });
    // 一次性构建 8×6 单元格网格（不再每次悬停重建 innerHTML，避免重建导致的点击失效与高亮滞后）
    let cells = '';
    for (let r = 1; r <= SUB_MAX_ROWS; r += 1) {
      for (let c = 1; c <= SUB_MAX_COLS; c += 1) {
        cells += `<i class="slash-sub-cell" data-sub-r="${r}" data-sub-c="${c}" role="gridcell" aria-label="${r}行${c}列"></i>`;
      }
    }
    subPanel.innerHTML =
      '<div class="slash-sub-title">表格</div>' +
      `<div class="slash-sub-grid">${cells}</div>` +
      '<div class="slash-sub-label">3 行 × 3 列</div>';
    // 与主面板挂同一宿主（.app），保证主题变量可达
    const host = document.querySelector('.app');
    (host instanceof HTMLElement ? host : document.body).appendChild(subPanel);
    return subPanel;
  };

  /** 仅切换高亮与尺寸文案（不重建 DOM，避免悬停/点击冲突） */
  const highlightSub = (): void => {
    if (!subPanel) return;
    const grid = subPanel.querySelector('.slash-sub-grid');
    if (!grid) return;
    grid.querySelectorAll<HTMLElement>('[data-sub-r]').forEach((cell) => {
      const r = Number(cell.dataset['subR']);
      const c = Number(cell.dataset['subC']);
      cell.classList.toggle('slash-sub-cell-on', r <= subRows && c <= subCols);
    });
    const label = subPanel.querySelector('.slash-sub-label');
    if (label) label.textContent = `${subRows} 行 × ${subCols} 列`;
  };

  /** 把二级网格定位到主菜单右侧；放不下时翻到左侧 */
  const positionSub = (): void => {
    if (!subPanel || !panel || subPanel.style.display === 'none') return;
    // 优先贴着鼠标悬停到的那一行（最近使用区与插入区各有一条，位置不同）；
    // 行元素被重渲染掉时退回可见的第一条表格条目。
    const anchor =
      (subAnchor && panel.contains(subAnchor) ? subAnchor : null) ??
      panel.querySelector<HTMLElement>(`[data-slash-id="${TABLE_ID}"]`) ??
      panel.querySelector<HTMLElement>('[data-slash-index]');
    if (!anchor) return;
    /**
     * 水平位置按**整个菜单**的右边缘算，而不是按条目右边缘：
     * 插入区是两列布局，贴着条目放会盖住右边那一列（图片等条目就点不到了）。
     * 垂直方向仍与悬停到的那一行对齐。
     */
    const a = anchor.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const rect = subPanel.getBoundingClientRect();
    const margin = 8;
    let left = p.right + 6;
    if (left + rect.width + margin > window.innerWidth) left = p.left - rect.width - 6;
    if (left < margin) left = Math.max(margin, window.innerWidth - rect.width - margin);
    const top = Math.max(margin, Math.min(a.top, window.innerHeight - rect.height - margin));
    subPanel.style.left = `${Math.round(left)}px`;
    subPanel.style.top = `${Math.round(top)}px`;
  };

  /** 显示二级网格并定位（网格只构建一次，这里仅切换可见 + 高亮 + 位置） */
  const renderSub = (): void => {
    const node = ensureSubPanel();
    node.style.display = '';
    highlightSub();
    positionSub();
  };

  const openSub = (): void => {
    closeForm();
    subOpen = true;
    subRows = 3;
    subCols = 3;
    if (panel) renderSub();
  };

  const closeSub = (): void => {
    subOpen = false;
    if (subPanel) subPanel.style.display = 'none';
  };

  /** 确认表格：删掉「/过滤词」→ 按选中行列插入 → 记录最近使用 */
  const applyTable = (view: EditorView): void => {
    if (!trigger) return;
    const cursor = view.state.selection.from;
    const from = trigger.from;
    trigger = null;
    hidePanel();
    if (cursor >= from) view.dispatch(view.state.tr.delete(from, cursor));
    options.format('insertTable', `${subCols}x${subRows}`);
    saveRecent(TABLE_ID);
  };

  // —— 链接二级表单（语雀式：填「文本」与「链接地址」后插入） ——

  const ensureFormPanel = (): HTMLDivElement => {
    if (formPanel) return formPanel;
    formPanel = document.createElement('div');
    formPanel.className = 'slash-form';
    formPanel.setAttribute('role', 'form');
    formPanel.setAttribute('aria-label', '插入链接');
    // 与表格网格不同：输入框必须能拿焦点，只挡面板空白处的 mousedown
    formPanel.addEventListener('mousedown', (event) => {
      const target = event.target as HTMLElement;
      if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLButtonElement)) {
        event.preventDefault();
      }
    });
    formPanel.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('.slash-form-submit')) submitLink();
    });
    // 焦点在输入框上时键盘事件只到这里：Enter 确认、Esc 收回表单
    formPanel.addEventListener('keydown', (event) => {
      if (event.isComposing || event.key === 'Process') return;
      if (event.key === 'Enter') {
        event.preventDefault();
        submitLink();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeForm();
        viewRef?.focus();
      }
    });
    formPanel.addEventListener('input', syncFormSubmit);
    // 与主面板挂同一宿主（.app），保证主题变量可达
    const host = document.querySelector('.app');
    (host instanceof HTMLElement ? host : document.body).appendChild(formPanel);
    return formPanel;
  };

  /** 地址为空时禁用确定按钮 */
  const syncFormSubmit = (): void => {
    if (!formPanel) return;
    const url = formPanel.querySelector<HTMLInputElement>('[data-form="url"]');
    const submit = formPanel.querySelector<HTMLButtonElement>('.slash-form-submit');
    if (submit) submit.disabled = !url?.value.trim();
  };

  /** 把表单定位到链接条目右侧；放不下时翻到左侧 */
  const positionForm = (): void => {
    if (!formPanel || !panel || formPanel.style.display === 'none') return;
    const index = visible.findIndex((item) => item.id === LINK_ID);
    const anchor =
      (index >= 0 ? panel.querySelector<HTMLElement>(`[data-slash-index="${index}"]`) : null) ??
      panel.querySelector<HTMLElement>('[data-slash-index]');
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const rect = formPanel.getBoundingClientRect();
    const margin = 8;
    let left = a.right + 6;
    if (left + rect.width + margin > window.innerWidth) left = a.left - rect.width - 6;
    if (left < margin) left = margin;
    let top = Math.min(a.top, window.innerHeight - rect.height - margin);
    if (top < margin) top = margin;
    formPanel.style.left = `${Math.round(left)}px`;
    formPanel.style.top = `${Math.round(top)}px`;
  };

  /** 展开链接表单（同时收回表格网格） */
  const openForm = (): void => {
    closeSub();
    formOpen = true;
    const node = ensureFormPanel();
    node.innerHTML =
      '<div class="slash-form-title">链接</div>' +
      '<label class="slash-form-field"><span class="slash-form-label">文本</span>' +
      '<input class="slash-form-input" data-form="text" placeholder="链接文本"></label>' +
      '<label class="slash-form-field"><span class="slash-form-label">链接</span>' +
      '<input class="slash-form-input" data-form="url" placeholder="链接地址"></label>' +
      '<button type="button" class="slash-form-submit" disabled>确定</button>';
    node.style.display = '';
    positionForm();
    node.querySelector<HTMLInputElement>('[data-form="text"]')?.focus();
  };

  const closeForm = (): void => {
    formOpen = false;
    if (formPanel) formPanel.style.display = 'none';
  };

  /** 确认链接：删掉「/过滤词」→ 插入 [文本](地址) → 关闭全部面板并还焦点给编辑器 */
  const submitLink = (): void => {
    const view = viewRef;
    if (!view || !trigger || !formPanel) return;
    const urlInput = formPanel.querySelector<HTMLInputElement>('[data-form="url"]');
    const textInput = formPanel.querySelector<HTMLInputElement>('[data-form="text"]');
    const url = urlInput?.value.trim() ?? '';
    if (!url) return;
    const label = textInput?.value.trim() || url;
    const cursor = view.state.selection.from;
    const from = trigger.from;
    trigger = null;
    hidePanel();
    if (cursor >= from) view.dispatch(view.state.tr.delete(from, cursor));
    // 地址含空格或括号时用尖括号包裹，避免 Markdown 解析在半截断开
    const safeUrl = /[\s()]/.test(url) ? `<${url}>` : url;
    options.format('snippet', `[${label}](${safeUrl})`);
    saveRecent(LINK_ID);
    view.focus();
  };

  /** 确认图片：删掉「/过滤词」→ 交还渲染层打开文件选择器（缺省时退回占位语法） */
  const applyItemImage = (view: EditorView): void => {
    if (!trigger) return;
    const cursor = view.state.selection.from;
    const from = trigger.from;
    trigger = null;
    hidePanel();
    if (cursor >= from) view.dispatch(view.state.tr.delete(from, cursor));
    if (options.pickImage) options.pickImage();
    else options.format('snippet', '![图片](url)');
    saveRecent(IMAGE_ID);
  };

  /** 把面板定位到「/」下方，越界时收进窗口 / 向上翻转 */
  const positionPanel = (view: EditorView): void => {
    if (!panel || !trigger || !isOpen) return;
    const pos = Math.min(trigger.from, view.state.doc.content.size);
    const coords = view.coordsAtPos(pos);
    const rect = panel.getBoundingClientRect();
    const margin = 8;
    let left = coords.left;
    let top = coords.bottom + 6;
    if (left + rect.width + margin > window.innerWidth) left = window.innerWidth - rect.width - margin;
    if (left < margin) left = margin;
    if (top + rect.height + margin > window.innerHeight && coords.top - rect.height - 6 > margin) {
      top = coords.top - rect.height - 6;
    }
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  };

  /** 重建面板内容并显示 */
  const renderPanel = (view: EditorView): void => {
    const node = ensurePanel();
    const filter = trigger?.filter ?? '';
    visible = matchItems(filter);
    if (activeIndex >= visible.length) activeIndex = Math.max(0, visible.length - 1);
    if (visible.length === 0) {
      hidePanel();
      return;
    }

    const activeId = visible[activeIndex]?.id;
    let html = '';

    if (!filter) {
      // 最近使用：胶囊快捷入口（仅鼠标，不参与键盘导航）
      const recents = loadRecents()
        .map((id) => ITEMS.find((item) => item.id === id))
        .filter((item): item is SlashItem => Boolean(item));
      if (recents.length > 0) {
        html += '<div class="slash-section">最近使用</div><div class="slash-chips">';
        recents.forEach((item) => {
          html += `<button type="button" class="slash-chip" data-slash-id="${esc(item.id)}">${esc(item.label)}</button>`;
        });
        html += '</div>';
      }
      const formatItems = visible.filter((item) => item.kind === 'format');
      const insertItems = visible.filter((item) => item.kind === 'insert');
      html += '<div class="slash-section">格式</div><div class="slash-grid">';
      formatItems.forEach((item) => {
        const icon = item.icon.startsWith('<svg')
          ? `<span class="slash-icon">${item.icon}</span>`
          : `<span class="slash-glyph">${esc(item.icon)}</span>`;
        const active = item.id === activeId ? ' slash-active' : '';
        html += `<button type="button" class="slash-grid-item${active}" data-slash-index="${visible.indexOf(item)}" title="${esc(item.label)}">${icon}</button>`;
      });
      html += '</div><div class="slash-section">插入</div><div class="slash-list slash-list-grid">';
      insertItems.forEach((item) => {
        html += rowHtml(item, visible.indexOf(item), item.id === activeId);
      });
      html += '</div>';
    } else {
      // 过滤态：压平成单列，命中高亮
      html += '<div class="slash-list">';
      visible.forEach((item, index) => {
        html += rowHtml(item, index, index === activeIndex);
      });
      html += '</div>';
    }

    node.innerHTML = html;
    node.style.display = '';
    isOpen = true;
    positionPanel(view);
    // 键盘移动高亮后保证可见
    node.querySelector('.slash-active')?.scrollIntoView({ block: 'nearest' });
    // 主面板重渲染（过滤变化 / 键盘移动）后同步二级面板：表格不在可见项里就收回网格
    if (subOpen) {
      if (visible.some((item) => item.id === TABLE_ID)) renderSub();
      else closeSub();
    }
    if (formOpen) positionForm();
  };

  /** 插入区 / 过滤态的单行条目（图标带圆角方块底座；表格带 › 二级箭头） */
  const rowHtml = (item: SlashItem, index: number, active: boolean): string => {
    const icon = item.icon.startsWith('<svg')
      ? `<span class="slash-icon">${item.icon}</span>`
      : `<span class="slash-glyph">${esc(item.icon)}</span>`;
    const tail = item.id === TABLE_ID || item.id === LINK_ID
      ? '<span class="slash-item-arrow">›</span>'
      : item.hint
        ? `<span class="slash-item-hint">${esc(item.hint)}</span>`
        : '';
    return `<button type="button" class="slash-item${active ? ' slash-active' : ''}" data-slash-index="${index}" data-slash-id="${esc(item.id)}"><span class="slash-icon-box">${icon}</span><span class="slash-item-label">${esc(item.label)}</span>${tail}</button>`;
  };

  /** 确认条目：删掉「/过滤词」→ 套用动作 → 记录最近使用 */
  const applyItem = (view: EditorView, item: SlashItem): void => {
    if (!trigger) return;
    const cursor = view.state.selection.from;
    const from = trigger.from;
    trigger = null;
    hidePanel();
    // 光标可能因输入法等原因落在别处，越界保护
    if (cursor >= from) view.dispatch(view.state.tr.delete(from, cursor));
    options.format(item.action, item.payload);
    saveRecent(item.id);
  };

  /** 文档 / 选区变化后同步触发状态 */
  const sync = (view: EditorView): void => {
    const detected = view.editable ? detectSlash(view.state) : null;
    if (!detected) {
      if (isOpen) hidePanel();
      trigger = null;
      return;
    }
    const filterChanged = !trigger || trigger.filter !== detected.filter;
    trigger = detected;
    if (filterChanged) {
      closeSub();
      closeForm();
      // 无过滤（菜单刚从「/」弹出）时，默认高亮「最近使用」的第一项，回车即插入最近类别；
      // 已输入过滤词时回到列表首项。
      if (!detected.filter) {
        const firstRecent = loadRecents()[0];
        const idx = firstRecent ? ITEMS.findIndex((item) => item.id === firstRecent) : 0;
        activeIndex = idx >= 0 ? idx : 0;
      } else {
        activeIndex = 0;
      }
    }
    renderPanel(view);
  };

  /** 当前 view（面板点击回调用） */
  let viewRef: EditorView | null = null;

  return $prose(
    () =>
      new Plugin({
        key: new PluginKey('markdownNoteSlashMenu'),
        view: (view) => {
          viewRef = view;
          const onBlur = (): void => {
            // 表单展开时焦点转移到输入框属正常流程，不作为关闭信号
            if (isOpen && !formOpen) hidePanel();
          };
          // 表单展开期间编辑器已失焦，靠全局捕获点击关闭：点到面板外一律整体收起
          const onDocMouseDown = (event: MouseEvent): void => {
            if (!formOpen) return;
            const target = event.target as Node | null;
            if (target && formPanel?.contains(target)) return;
            if (target && panel?.contains(target)) return;
            hidePanel();
          };
          const onScroll = (): void => {
            if (isOpen && trigger) {
              positionPanel(view);
              if (subOpen) positionSub();
              if (formOpen) positionForm();
            }
          };
          view.dom.addEventListener('blur', onBlur);
          document.addEventListener('mousedown', onDocMouseDown, true);
          // 编辑器内滚动（捕获：内层容器滚动也会触发）时跟随「/」的位置
          view.dom.addEventListener('scroll', onScroll, true);
          return {
            update(next) {
              sync(next);
            },
            destroy() {
              hidePanel();
              if (panel) {
                panel.remove();
                panel = null;
              }
              if (subPanel) {
                subPanel.remove();
                subPanel = null;
              }
              if (formPanel) {
                formPanel.remove();
                formPanel = null;
              }
              viewRef = null;
              view.dom.removeEventListener('blur', onBlur);
              document.removeEventListener('mousedown', onDocMouseDown, true);
              view.dom.removeEventListener('scroll', onScroll, true);
            }
          };
        },
        props: {
          handleKeyDown: (view, event) => {
            if (!isOpen || !trigger) return false;
            // 中文输入法组合期间不拦截（Enter 上屏、方向键选候选）
            if (event.isComposing || event.key === 'Process') return false;
            // 表单展开时焦点在输入框上，这里收不到键盘事件；保险起见只放行 Esc
            if (formOpen) {
              if (event.key === 'Escape') {
                closeForm();
                return true;
              }
              return false;
            }
            // 二级网格展开时：方向键调整行列，Enter 插入，Esc 先收回网格
            if (subOpen) {
              switch (event.key) {
                case 'ArrowDown':
                  subRows = Math.min(SUB_MAX_ROWS, subRows + 1);
                  renderSub();
                  return true;
                case 'ArrowUp':
                  subRows = Math.max(1, subRows - 1);
                  renderSub();
                  return true;
                case 'ArrowRight':
                  subCols = Math.min(SUB_MAX_COLS, subCols + 1);
                  renderSub();
                  return true;
                case 'ArrowLeft':
                  subCols = Math.max(1, subCols - 1);
                  renderSub();
                  return true;
                case 'Enter':
                  applyTable(view);
                  return true;
                case 'Escape':
                  closeSub();
                  return true;
                default:
                  return false;
              }
            }
            switch (event.key) {
              case 'ArrowDown':
                activeIndex = Math.min(visible.length - 1, activeIndex + 1);
                renderPanel(view);
                return true;
              case 'ArrowUp':
                activeIndex = Math.max(0, activeIndex - 1);
                renderPanel(view);
                return true;
              case 'Enter': {
                const item = visible[activeIndex];
                // 高亮在表格上时 Enter 先展开二级网格（再按确认插入）
                if (item && item.id === TABLE_ID) {
                  openSub();
                  return true;
                }
                // 高亮在链接上时 Enter 展开二级表单
                if (item && item.id === LINK_ID) {
                  closeSub();
                  openForm();
                  return true;
                }
                // 高亮在图片上时 Enter 打开文件选择器
                if (item && item.id === IMAGE_ID) {
                  applyItemImage(view);
                  return true;
                }
                if (item) applyItem(view, item);
                return true;
              }
              case 'Escape':
                hidePanel();
                trigger = null;
                return true;
              default:
                return false;
            }
          }
        }
      })
  );
}

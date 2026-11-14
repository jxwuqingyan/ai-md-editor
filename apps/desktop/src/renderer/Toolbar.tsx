import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { FormatAction } from '@ai-md-editor/editor';
import { isImeKey } from './ime';

/** 底部工具栏属性 */
interface ToolbarProps {
  /** 统一格式化入口（由 App 根据当前视图模式分发） */
  onFormat: (action: FormatAction, payload?: number | string) => void;
  /** 插入链接：表单确认后调用（两种视图模式通用） */
  onInsertLink: (label: string, url: string) => void;
  /** 插入图片：打开系统文件选择器（与斜杠菜单一致） */
  onPickImage: () => void;
  /** 菜单「超链接」发来的展开请求（递增触发，与按钮点击共用同一个表单） */
  linkFormRequest: number;
}

/**
 * 段落类型选项：只放块级文本类型。
 * 引用与代码块已有工具栏按钮、斜杠菜单与原生菜单入口，不再在下拉里重复出现。
 */
const PARAGRAPH_OPTIONS: { label: string; action: FormatAction; level?: number }[] = [
  { label: '正文', action: 'paragraph' },
  { label: '标题 1', action: 'heading', level: 1 },
  { label: '标题 2', action: 'heading', level: 2 },
  { label: '标题 3', action: 'heading', level: 3 },
  { label: '标题 4', action: 'heading', level: 4 }
];

/** 警告框类型（与原生菜单一致） */
const CALLOUT_OPTIONS: { label: string; kind: string }[] = [
  { label: 'NOTE 提示', kind: 'NOTE' },
  { label: 'TIP 技巧', kind: 'TIP' },
  { label: 'IMPORTANT 重要', kind: 'IMPORTANT' },
  { label: 'WARNING 警告', kind: 'WARNING' },
  { label: 'CAUTION 注意', kind: 'CAUTION' }
];

/** 工具栏图标名称 */
type ToolbarIcon =
  | 'code' | 'link' | 'image' | 'quote' | 'bulletList' | 'orderedList'
  | 'taskList' | 'table' | 'formula' | 'hr' | 'callout';

/** 统一的本地 SVG 图标，避免 Emoji 在不同平台缺字、变形或基线不齐 */
function ToolbarSvg({ name }: { name: ToolbarIcon }): JSX.Element {
  const paths: Record<ToolbarIcon, ReactNode> = {
    code: <><path d="m8 6-6 6 6 6" /><path d="m16 6 6 6-6 6" /><path d="m14 4-4 16" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
    quote: <><path d="M3 21c3 0 7-1 7-8V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v6c0 1.1.9 2 2 2h2c0 4-1 5-4 6" /><path d="M15 21c3 0 7-1 7-8V5c0-1.1-.9-2-2-2h-3c-1.1 0-2 .9-2 2v6c0 1.1.9 2 2 2h2c0 4-1 5-4 6" /></>,
    bulletList: <><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" /><path d="M9 6h12M9 12h12M9 18h12" /></>,
    orderedList: <><text x="3" y="9" fontSize="7.5" fill="currentColor" stroke="none" fontFamily="sans-serif">1</text><text x="3" y="19" fontSize="7.5" fill="currentColor" stroke="none" fontFamily="sans-serif">2</text><path d="M10 7h9M10 12h6M10 17h9" /></>,
    taskList: <><rect x="3.5" y="5" width="7" height="7" rx="1.5" /><path d="m5 8.4 1.8 1.8 3-3.4" /><path d="M14 8.5h6M14 16h6" /><rect x="3.5" y="12.5" width="7" height="7" rx="1.5" /></>,
    table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9.5h18M3 15h18M9.5 4v16M15.5 4v16" /></>,
    formula: <path d="M18 5H8l6 7-6 7h10" />,
    hr: <path d="M3 12h18" />,
    callout: <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 9v5" /><path d="M12 17.5h.01" /></>
  };
  return (
    <svg className="tb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/**
 * 编辑区底部浮动工具栏。
 * 与斜杠菜单对齐：图片走文件选择器、链接走表单、列表/表格/公式一键插入。
 * wysiwyg 模式走 Milkdown 命令；源码模式在 textarea 选区包裹语法。
 */
export default function Toolbar({
  onFormat,
  onInsertLink,
  onPickImage,
  linkFormRequest
}: ToolbarProps): JSX.Element {
  // 段落下拉展开状态
  const [paraOpen, setParaOpen] = useState(false);
  // 警告框类型下拉展开状态
  const [calloutOpen, setCalloutOpen] = useState(false);
  // 链接表单展开状态
  const [linkOpen, setLinkOpen] = useState(false);
  // 链接表单内容
  const [linkText, setLinkText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  // 工具栏根元素（点击外部关闭下拉）
  const rootRef = useRef<HTMLDivElement>(null);
  // 链接文本输入框（打开表单时聚焦）
  const linkTextRef = useRef<HTMLInputElement>(null);

  // 点击工具栏外部时关闭所有下拉
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setParaOpen(false);
        setCalloutOpen(false);
        setLinkOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  // 打开链接表单时聚焦文本框
  useEffect(() => {
    if (linkOpen) linkTextRef.current?.focus();
  }, [linkOpen]);

  // 菜单「超链接」(Cmd/Ctrl+K)：收到请求展开同一个表单，按钮点击走下面的本地 toggle
  useEffect(() => {
    if (linkFormRequest === 0) return;
    setParaOpen(false);
    setCalloutOpen(false);
    setLinkOpen(true);
  }, [linkFormRequest]);

  /** 应用格式：统一交给 App 分发，菜单与工具栏共享同一入口 */
  const apply = (action: FormatAction, payload?: number | string): void => {
    setParaOpen(false);
    setCalloutOpen(false);
    setLinkOpen(false);
    onFormat(action, payload);
  };

  /** 通用按钮（不关链接表单——表单有自己的提交路径）；payload 供 snippet 类动作使用 */
  const btn = (
    label: ReactNode,
    title: string,
    action: FormatAction,
    payload?: number | string
  ): JSX.Element => (
    <button
      className="tb-btn"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => apply(action, payload)}
    >
      {label}
    </button>
  );

  /** 提交链接表单：地址必填，文本缺省用地址 */
  const submitLink = (): void => {
    const url = linkUrl.trim();
    if (!url) return;
    const label = linkText.trim() || url;
    setLinkOpen(false);
    setLinkText('');
    setLinkUrl('');
    onInsertLink(label, url);
  };

  /** 表单输入框按键：Enter 提交（先判输入法组合态）、Esc 关闭 */
  const onFormKeyDown = (e: React.KeyboardEvent): void => {
    if (isImeKey(e)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      submitLink();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setLinkOpen(false);
    }
  };

  return (
    <div className="toolbar" ref={rootRef}>
      {/* 段落类型下拉 */}
      <div className="tb-dd-wrap">
        <button
          className="tb-btn tb-dd-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setParaOpen((v) => !v);
            setCalloutOpen(false);
            setLinkOpen(false);
          }}
        >
          段落 <span className="tb-caret">▾</span>
        </button>
        {paraOpen && (
          <div className="tb-menu tb-menu-up">
            {PARAGRAPH_OPTIONS.map((opt) => (
              <div
                key={opt.label}
                className="tb-menu-item"
                onClick={() => apply(opt.action, opt.level)}
              >
                {opt.label}
              </div>
            ))}
          </div>
        )}
      </div>

      <span className="tb-sep" />

      {btn(<strong>B</strong>, '加粗 (Cmd/Ctrl+B)', 'bold')}
      {btn(<em>I</em>, '斜体 (Cmd/Ctrl+I)', 'italic')}
      {btn(<ToolbarSvg name="code" />, '代码块', 'codeBlock')}

      {/* 链接：弹出文本/地址表单 */}
      <div className="tb-dd-wrap">
        <button
          className="tb-btn"
          title="链接 (Cmd/Ctrl+K)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setLinkOpen((v) => !v);
            setParaOpen(false);
            setCalloutOpen(false);
          }}
        >
          <ToolbarSvg name="link" />
        </button>
        {linkOpen && (
          <div className="tb-link-form">
            <div className="slash-form-title">链接</div>
            <label className="slash-form-field">
              <span className="slash-form-label">文本</span>
              <input
                ref={linkTextRef}
                className="slash-form-input"
                data-form="text"
                value={linkText}
                placeholder="链接文本"
                onChange={(e) => setLinkText(e.target.value)}
                onKeyDown={onFormKeyDown}
              />
            </label>
            <label className="slash-form-field">
              <span className="slash-form-label">链接</span>
              <input
                className="slash-form-input"
                data-form="url"
                value={linkUrl}
                placeholder="链接地址"
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={onFormKeyDown}
              />
            </label>
            <button
              type="button"
              className="slash-form-submit"
              disabled={!linkUrl.trim()}
              onClick={submitLink}
            >
              确定
            </button>
          </div>
        )}
      </div>

      <span className="tb-sep" />

      <button
        className="tb-btn"
        title="图片（选择本地文件）"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setParaOpen(false);
          setCalloutOpen(false);
          setLinkOpen(false);
          onPickImage();
        }}
      >
        <ToolbarSvg name="image" />
      </button>
      {btn(<ToolbarSvg name="quote" />, '引用', 'quote')}

      {/* 警告框：类型下拉，插入后光标直接落在「内容」占位文字上 */}
      <div className="tb-dd-wrap">
        <button
          className="tb-btn"
          title="警告框"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setCalloutOpen((v) => !v);
            setParaOpen(false);
            setLinkOpen(false);
          }}
        >
          <ToolbarSvg name="callout" />
        </button>
        {calloutOpen && (
          <div className="tb-menu tb-menu-up">
            {CALLOUT_OPTIONS.map((opt) => (
              <div
                key={opt.kind}
                className="tb-menu-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => apply('insertCallout', opt.kind)}
              >
                {opt.label}
              </div>
            ))}
          </div>
        )}
      </div>

      <span className="tb-sep" />

      {btn(<ToolbarSvg name="bulletList" />, '无序列表', 'bulletList')}
      {btn(<ToolbarSvg name="orderedList" />, '有序列表', 'orderedList')}
      {btn(<ToolbarSvg name="taskList" />, '任务列表', 'taskList')}
      {btn(<ToolbarSvg name="table" />, '表格（3 行 × 3 列）', 'insertTable')}
      {btn(<ToolbarSvg name="formula" />, '公式', 'snippet', '$$\nE = mc^2\n$$')}
      {btn(<ToolbarSvg name="hr" />, '分割线', 'hr')}
    </div>
  );
}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { FormatAction } from '@ai-md-editor/editor';

/** 底部工具栏属性 */
interface ToolbarProps {
  /** 统一格式化入口（由 App 根据当前视图模式分发） */
  onFormat: (action: FormatAction, level?: number) => void;
  /** 插入链接占位 */
  onInsertLink: () => void;
  /** 插入图片占位（图片走粘贴/拖拽，这里插入占位语法） */
  onInsertImage: () => void;
}

/** 段落类型选项 */
const PARAGRAPH_OPTIONS: { label: string; action: FormatAction; level?: number }[] = [
  { label: '正文', action: 'paragraph' },
  { label: '标题 1', action: 'heading', level: 1 },
  { label: '标题 2', action: 'heading', level: 2 },
  { label: '标题 3', action: 'heading', level: 3 },
  { label: '标题 4', action: 'heading', level: 4 },
  { label: '引用', action: 'quote' },
  { label: '代码块', action: 'codeBlock' }
];

/** 工具栏图标名称 */
type ToolbarIcon = 'code' | 'link' | 'image' | 'quote' | 'bulletList';

/** 统一的本地 SVG 图标，避免 Emoji 在不同平台缺字、变形或基线不齐 */
function ToolbarSvg({ name }: { name: ToolbarIcon }): JSX.Element {
  const paths: Record<ToolbarIcon, ReactNode> = {
    code: <><path d="m8 6-6 6 6 6" /><path d="m16 6 6 6-6 6" /><path d="m14 4-4 16" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
    quote: <><path d="M3 21c3 0 7-1 7-8V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v6c0 1.1.9 2 2 2h2c0 4-1 5-4 6" /><path d="M15 21c3 0 7-1 7-8V5c0-1.1-.9-2-2-2h-3c-1.1 0-2 .9-2 2v6c0 1.1.9 2 2 2h2c0 4-1 5-4 6" /></>,
    bulletList: <><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" /><path d="M9 6h12M9 12h12M9 18h12" /></>
  };
  return (
    <svg className="tb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/**
 * 编辑区底部浮动工具栏（贴合 Typora 风格）。
 * wysiwyg 模式走 Milkdown 命令；源码模式在 textarea 选区包裹语法。
 */
export default function Toolbar({
  onFormat,
  onInsertLink,
  onInsertImage
}: ToolbarProps): JSX.Element {
  // 段落下拉展开状态
  const [paraOpen, setParaOpen] = useState(false);
  // 更多菜单展开状态
  const [moreOpen, setMoreOpen] = useState(false);
  // 工具栏根元素（点击外部关闭下拉）
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击工具栏外部时关闭所有下拉
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setParaOpen(false);
        setMoreOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  /** 应用格式：统一交给 App 分发，菜单与工具栏共享同一入口 */
  const apply = (action: FormatAction, level?: number): void => {
    setParaOpen(false);
    setMoreOpen(false);
    onFormat(action, level);
  };

  /** 行内包裹按钮通用 */
  const wrapBtn = (label: ReactNode, title: string, action: FormatAction): JSX.Element => (
    <button
      className="tb-btn"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => apply(action)}
    >
      {label}
    </button>
  );

  /** 插入链接占位 */
  const insertLink = (): void => {
    setMoreOpen(false);
    onInsertLink();
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
            setMoreOpen(false);
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

      {wrapBtn(<strong>B</strong>, '加粗 (Cmd/Ctrl+B)', 'bold')}
      {wrapBtn(<em>I</em>, '斜体 (Cmd/Ctrl+I)', 'italic')}
      {wrapBtn(<ToolbarSvg name="code" />, '行内代码', 'code')}
      <button
        className="tb-btn"
        title="链接"
        onMouseDown={(e) => e.preventDefault()}
        onClick={insertLink}
      >
        <ToolbarSvg name="link" />
      </button>

      <span className="tb-sep" />

      <button
        className="tb-btn"
        title="图片（或直接粘贴）"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setMoreOpen(false);
          onInsertImage();
        }}
      >
        <ToolbarSvg name="image" />
      </button>
      {wrapBtn(<ToolbarSvg name="quote" />, '引用', 'quote')}
      {wrapBtn(<ToolbarSvg name="bulletList" />, '无序列表', 'bulletList')}

      {/* 更多菜单 */}
      <div className="tb-dd-wrap">
        <button
          className="tb-btn"
          title="更多"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setMoreOpen((v) => !v);
            setParaOpen(false);
          }}
        >
          ⋯
        </button>
        {moreOpen && (
          <div className="tb-menu tb-menu-up">
            <div className="tb-menu-item" onClick={() => apply('orderedList')}>
              有序列表
            </div>
            <div className="tb-menu-item" onClick={() => apply('codeBlock')}>
              代码块
            </div>
            <div className="tb-menu-item" onClick={() => apply('hr')}>
              分割线
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

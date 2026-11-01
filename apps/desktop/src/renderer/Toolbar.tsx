import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EditorInstance, FormatAction } from '@ai-md-editor/editor';

/** 底部工具栏属性 */
interface ToolbarProps {
  /** 编辑器实例（源码模式为 null，工具栏隐藏或降级） */
  editor: EditorInstance | null;
  /** 视图模式：wysiwyg 用命令，source 用语法包裹 */
  viewMode: 'wysiwyg' | 'source';
  /** 源码模式：对 textarea 选区包裹语法 */
  onSourceWrap: (before: string, after: string) => void;
  /** 源码模式：设置行前缀（标题/引用/列表） */
  onSourceLinePrefix: (prefix: string) => void;
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

/**
 * 编辑区底部浮动工具栏（贴合 Typora 风格）。
 * wysiwyg 模式走 Milkdown 命令；源码模式在 textarea 选区包裹语法。
 */
export default function Toolbar({
  editor,
  viewMode,
  onSourceWrap,
  onSourceLinePrefix,
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

  /** 应用格式：wysiwyg 走命令，source 走选区包裹/行前缀 */
  const apply = (action: FormatAction, level?: number): void => {
    setParaOpen(false);
    setMoreOpen(false);
    if (viewMode === 'wysiwyg' && editor) {
      editor.format(action, level);
      editor.focus();
      return;
    }
    // 源码模式降级：行前缀 / 选区包裹
    switch (action) {
      case 'heading':
        onSourceLinePrefix('#'.repeat(level ?? 1) + ' ');
        break;
      case 'paragraph':
        onSourceLinePrefix('');
        break;
      case 'quote':
        onSourceLinePrefix('> ');
        break;
      case 'codeBlock':
        onSourceWrap('\n```\n', '\n```\n');
        break;
      case 'bold':
        onSourceWrap('**', '**');
        break;
      case 'italic':
        onSourceWrap('*', '*');
        break;
      case 'code':
        onSourceWrap('`', '`');
        break;
      case 'bulletList':
        onSourceLinePrefix('- ');
        break;
      case 'orderedList':
        onSourceLinePrefix('1. ');
        break;
      case 'hr':
        onSourceWrap('\n---\n', '');
        break;
      default:
        break;
    }
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

  /** 源码模式插入链接/图片占位 */
  const insertLink = (): void => {
    setMoreOpen(false);
    if (viewMode === 'wysiwyg' && editor) {
      editor.insertAtCursor('[链接文字](url)');
      editor.focus();
    } else {
      onSourceWrap('[', '](url)');
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
      {wrapBtn('&lt;&gt;', '行内代码', 'code')}
      <button
        className="tb-btn"
        title="链接"
        onMouseDown={(e) => e.preventDefault()}
        onClick={insertLink}
      >
        🔗
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
        🖼
      </button>
      {wrapBtn('❝', '引用', 'quote')}
      {wrapBtn('≔', '无序列表', 'bulletList')}

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

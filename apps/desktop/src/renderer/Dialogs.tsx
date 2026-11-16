/**
 * 菜单动作对应的轻量浮层：查找替换、快速打开、重命名、字数统计、大纲窗口。
 * 全部使用本地状态与白名单 IPC，不依赖任何 UI 组件库。
 */
import { useEffect, useRef, useState } from 'react';
import type { OutlineItem } from '@ai-md-editor/markdown-core';
import { isImeKey } from './ime';
import OutlineList, { type OutlineDropPosition } from './OutlineList';
import type { DocIssue } from './types';

/** 查找栏属性 */
export interface FindBarProps {
  query: string;
  onQuery: (value: string) => void;
  replaceText: string;
  onReplaceText: (value: string) => void;
  showReplace: boolean;
  onToggleReplace: () => void;
  matchCount: number;
  currentMatch: number;
  onNext: () => void;
  onPrev: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}

/**
 * 查找 / 替换栏：固定在编辑区顶部的一行，展开替换后变两行（桌面写法）。
 *
 *   查找  [____________]  3/12  ↑  ↓  替换   ×
 *   替换  [____________]           替换  全部替换
 */
export function FindBar(props: FindBarProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 展开替换后直接把焦点放到替换框，省一次点击
  useEffect(() => {
    if (props.showReplace) replaceInputRef.current?.focus();
  }, [props.showReplace]);

  const countText = props.query
    ? props.matchCount === 0
      ? '无结果'
      : `${props.currentMatch + 1}/${props.matchCount}`
    : '';
  const noMatch = props.matchCount === 0;

  return (
    <div className="find-bar" role="search">
      <div className="find-fields">
        <div className="find-row">
          <span className="find-label">查找</span>
          <input
            ref={inputRef}
            className="find-input"
            data-find-input="query"
            value={props.query}
            placeholder="输入要查找的文字"
            spellCheck={false}
            onChange={(event) => props.onQuery(event.target.value)}
            onKeyDown={(event) => {
              // 输入法上屏用的 Enter 不能当成「下一个」，否则中文查询会提前跳转
              if (isImeKey(event)) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                if (event.shiftKey) props.onPrev();
                else props.onNext();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                props.onClose();
              }
            }}
          />
          <span className="find-count">{countText}</span>
          <button
            className="find-nav"
            title="上一个（Shift+Enter）"
            disabled={noMatch}
            onClick={props.onPrev}
          >
            ↑
          </button>
          <button className="find-nav" title="下一个（Enter）" disabled={noMatch} onClick={props.onNext}>
            ↓
          </button>
          <button
            className={`find-action find-toggle${props.showReplace ? ' find-action-on' : ''}`}
            data-find-action="toggle"
            title={props.showReplace ? '收起替换' : '展开替换'}
            onClick={props.onToggleReplace}
          >
            替换
          </button>
          <button className="find-close" title="关闭（Esc）" onClick={props.onClose}>
            ×
          </button>
        </div>
        {props.showReplace && (
          <div className="find-row">
            <span className="find-label">替换</span>
            <input
              ref={replaceInputRef}
              className="find-input"
              data-find-input="replace"
              value={props.replaceText}
              placeholder="替换为…（留空即删除）"
              spellCheck={false}
              onChange={(event) => props.onReplaceText(event.target.value)}
              onKeyDown={(event) => {
                if (isImeKey(event)) return;
                if (event.key === 'Enter') {
                  event.preventDefault();
                  props.onReplace();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  props.onClose();
                }
              }}
            />
            <button
              className="find-action"
              data-find-action="replace"
              disabled={noMatch}
              onClick={props.onReplace}
            >
              替换
            </button>
            <button
              className="find-action"
              data-find-action="replace-all"
              disabled={noMatch}
              onClick={props.onReplaceAll}
            >
              全部替换
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 快速打开的文件条目 */
export interface QuickEntry {
  path: string;
  name: string;
}

/** 快速打开面板属性 */
export interface QuickOpenProps {
  recent: QuickEntry[];
  treeFiles: QuickEntry[];
  onPick: (path: string) => void;
  onClose: () => void;
}

/** 「检查链接与图片」结果对话框属性 */
export interface CheckDocDialogProps {
  /** 查出的问题清单（按行号升序） */
  issues: DocIssue[];
  /** 未保存文档中无法解析的相对图片数 */
  uncheckableImages: number;
  /** 点击某条问题：跳转到对应行 */
  onJump: (issue: DocIssue) => void;
  /** 关闭对话框 */
  onClose: () => void;
}

/**
 * 「检查链接与图片」结果对话框。
 * 只读诊断：列出空链接与找不到的本地图片，点击条目跳转到对应行。
 * 不修改文档内容。
 */
export function CheckDocDialog({ issues, uncheckableImages, onJump, onClose }: CheckDocDialogProps): JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay-shade" onMouseDown={onClose}>
      <div className="check-doc" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-label="检查链接与图片">
        <div className="check-doc-title">
          检查结果
          <button type="button" className="check-doc-close" title="关闭（Esc）" onClick={onClose}>
            ×
          </button>
        </div>
        {uncheckableImages > 0 && (
          <div className="check-doc-note">
            有 {uncheckableImages} 张相对路径图片尚未检查；先保存文档后才能确认文件是否存在。
          </div>
        )}
        <div className="check-doc-list">
          {issues.length === 0 ? (
            <div className="quick-open-empty">
              {uncheckableImages > 0 ? '没有发现可确认的问题' : '没有发现空链接或失效的本地图片'}
            </div>
          ) : (
            issues.map((issue, index) => (
              <button
                key={`${issue.line}-${index}`}
                type="button"
                className="check-doc-item"
                onClick={() => onJump(issue)}
                title="点击跳转到这一行"
              >
                <span className={`check-doc-kind check-doc-kind-${issue.kind}`}>
                  {issue.kind === 'empty-link' ? '空链接' : '图片丢失'}
                </span>
                <span className="check-doc-line">第 {issue.line} 行</span>
                <span className="check-doc-text">
                  {issue.kind === 'empty-link'
                    ? issue.isImage
                      ? '![' + issue.label + ']()'
                      : '[' + (issue.label || '（无文字）') + ']()'
                    : '![' + issue.label + '](' + issue.target + ')'}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}


/** 快速打开：模糊匹配最近文件与文件树中的 Markdown 文件 */
export function QuickOpen({ recent, treeFiles, onPick, onClose }: QuickOpenProps): JSX.Element {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const merged = [...recent, ...treeFiles.filter((f) => !recent.some((r) => r.path === f.path))];
  const keyword = query.trim().toLowerCase();
  const entries = merged
    .filter((entry) => !keyword || entry.name.toLowerCase().includes(keyword) || entry.path.toLowerCase().includes(keyword))
    .slice(0, 12);

  return (
    <div className="overlay-shade" onMouseDown={onClose}>
      <div className="quick-open" onMouseDown={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="quick-open-input"
          value={query}
          placeholder="按文件名搜索，回车打开…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            else if (event.key === 'Enter' && !isImeKey(event) && entries[0]) onPick(entries[0].path);
          }}
        />
        <div className="quick-open-list">
          {entries.length === 0 ? (
            <div className="quick-open-empty">没有匹配的文件</div>
          ) : (
            entries.map((entry) => (
              <button key={entry.path} className="quick-open-item" onClick={() => onPick(entry.path)}>
                <span className="quick-open-name">{entry.name}</span>
                <span className="quick-open-path">{entry.path}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** 重命名对话框属性 */
export interface RenameDialogProps {
  initialName: string;
  /** 标题文案（默认「重新命名」；新建文件时传「新建文件」） */
  title?: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

/** 重命名当前文档 / 新建文件时命名 */
export function RenameDialog({ initialName, title = '重新命名', onSubmit, onClose }: RenameDialogProps): JSX.Element {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  // 输入法组合状态单独记一份：部分输入法用 Enter 上屏时 nativeEvent.isComposing 已经回落，
  // 只看它会把还没上屏的拼音当成确认提交（中文名改出来半截）。
  const composingRef = useRef(false);
  useEffect(() => inputRef.current?.select(), []);

  const submit = (): void => {
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <div className="overlay-shade" onMouseDown={onClose}>
      <div className="rename-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="rename-title">{title}</div>
        <input
          ref={inputRef}
          className="rename-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              onClose();
              return;
            }
            if (event.key !== 'Enter') return;
            if (composingRef.current || isImeKey(event)) return;
            submit();
          }}
        />
        <div className="rename-actions">
          <button className="dialog-btn" onClick={onClose}>取消</button>
          <button className="dialog-btn dialog-btn-primary" onClick={submit}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

/** 文档统计信息 */
export interface DocStats {
  lineCount: number;
  wordCount: number;
  charCount: number;
  paragraphCount: number;
  readMinutes: number;
}

/** 浮动窗口属性 */
export interface FloatPanelsProps {
  stats: DocStats;
  outline: OutlineItem[];
  wordCountVisible: boolean;
  outlineWindowVisible: boolean;
  onOutlineClick: (line: number, index: number) => void;
  /** 独立大纲窗口同样支持拖动重排 */
  onOutlineMove: (fromIndex: number, toIndex: number, position: OutlineDropPosition) => void;
  onCloseWordCount: () => void;
  onCloseOutline: () => void;
}

/** 字数统计窗口与独立大纲窗口 */
export function FloatPanels(props: FloatPanelsProps): JSX.Element | null {
  if (!props.wordCountVisible && !props.outlineWindowVisible) return null;
  return (
    <div className="float-panels">
      {props.wordCountVisible && (
        <div className="float-panel">
          <div className="float-panel-head">
            <span>字数统计</span>
            <button onClick={props.onCloseWordCount} title="关闭">×</button>
          </div>
          <div className="stat-grid">
            <span>行数</span><strong>{props.stats.lineCount}</strong>
            <span>字符</span><strong>{props.stats.charCount}</strong>
            <span>非空白字符</span><strong>{props.stats.wordCount}</strong>
            <span>段落</span><strong>{props.stats.paragraphCount}</strong>
            <span>预计阅读</span><strong>{props.stats.readMinutes} 分钟</strong>
          </div>
        </div>
      )}
      {props.outlineWindowVisible && (
        <div className="float-panel float-panel-outline">
          <div className="float-panel-head">
            <span>大纲窗口</span>
            <button onClick={props.onCloseOutline} title="关闭">×</button>
          </div>
          <OutlineList
            items={props.outline}
            variant="float"
            onClick={props.onOutlineClick}
            onMove={props.onOutlineMove}
          />
        </div>
      )}
    </div>
  );
}

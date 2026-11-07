/**
 * 菜单动作对应的轻量浮层：查找替换、快速打开、重命名、字数统计、大纲窗口。
 * 全部使用本地状态与白名单 IPC，不依赖任何 UI 组件库。
 */
import { useEffect, useRef, useState } from 'react';
import type { OutlineItem } from '@ai-md-editor/markdown-core';

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

/** 查找 / 替换浮动栏 */
export function FindBar(props: FindBarProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [props.showReplace]);

  return (
    <div className="find-bar" role="search">
      <button className="find-toggle" onClick={props.onToggleReplace} title={props.showReplace ? '收起替换' : '展开替换'}>
        {props.showReplace ? '⌄' : '›'}
      </button>
      <div className="find-fields">
        <div className="find-row">
          <input
            ref={inputRef}
            className="find-input"
            value={props.query}
            placeholder="查找"
            onChange={(event) => props.onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (event.shiftKey) props.onPrev();
                else props.onNext();
              } else if (event.key === 'Escape') {
                props.onClose();
              }
            }}
          />
          <span className="find-count">
            {props.matchCount === 0 ? '无结果' : `${props.currentMatch + 1}/${props.matchCount}`}
          </span>
          <button className="find-nav" title="上一个 (Shift+Enter)" onClick={props.onPrev}>↑</button>
          <button className="find-nav" title="下一个 (Enter)" onClick={props.onNext}>↓</button>
          <button className="find-close" title="关闭 (Esc)" onClick={props.onClose}>×</button>
        </div>
        {props.showReplace && (
          <div className="find-row">
            <input
              className="find-input"
              value={props.replaceText}
              placeholder="替换为"
              onChange={(event) => props.onReplaceText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') props.onReplace();
                else if (event.key === 'Escape') props.onClose();
              }}
            />
            <button className="find-action" onClick={props.onReplace}>替换</button>
            <button className="find-action" onClick={props.onReplaceAll}>全部</button>
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
            else if (event.key === 'Enter' && entries[0]) onPick(entries[0].path);
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
  onSubmit: (name: string) => void;
  onClose: () => void;
}

/** 重命名当前文档 */
export function RenameDialog({ initialName, onSubmit, onClose }: RenameDialogProps): JSX.Element {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.select(), []);

  return (
    <div className="overlay-shade" onMouseDown={onClose}>
      <div className="rename-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="rename-title">重新命名</div>
        <input
          ref={inputRef}
          className="rename-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            else if (event.key === 'Enter' && name.trim()) onSubmit(name.trim());
          }}
        />
        <div className="rename-actions">
          <button className="dialog-btn" onClick={onClose}>取消</button>
          <button className="dialog-btn dialog-btn-primary" onClick={() => name.trim() && onSubmit(name.trim())}>
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
          <div className="float-outline-list">
            {props.outline.length === 0 ? (
              <div className="quick-open-empty">暂无标题</div>
            ) : (
              props.outline.map((item) => (
                <button
                  key={`${item.line}-${item.index}`}
                  className="float-outline-item"
                  style={{ paddingLeft: 10 + (item.level - 1) * 12 }}
                  onClick={() => props.onOutlineClick(item.line, item.index)}
                >
                  {item.text}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

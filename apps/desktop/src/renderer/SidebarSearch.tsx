import { useEffect, useRef, useState } from 'react';
import type { SearchFileResult } from '@ai-md-editor/shared';

/** 侧栏搜索面板属性 */
interface SidebarSearchProps {
  /** 搜索根目录（null = 未打开文件夹） */
  rootDir: string | null;
  /** 点击某条匹配：打开文件并跳到该行 */
  onOpenMatch: (path: string, name: string, line: number, column: number, length: number, text: string) => void;
  /** 关闭搜索面板 */
  onClose: () => void;
}

/**
 * 侧栏搜索面板：在当前打开的目录内搜索所有 Markdown 文件内容。
 * 支持 区分大小写（Aa）/ 全单词（|“|）/ 正则表达式（.*）三个开关，
 * 输入变化 300ms 防抖后自动搜索，结果按文件分组。
 */
export default function SidebarSearch({ rootDir, onOpenMatch, onClose }: SidebarSearchProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [results, setResults] = useState<SearchFileResult[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时聚焦输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 查询条件变化：300ms 防抖自动搜索
  useEffect(() => {
    if (!rootDir || query.trim().length === 0) {
      setResults([]);
      setError(null);
      setTruncated(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        const result = await window.api.searchFolder({
          root: rootDir,
          query,
          caseSensitive,
          wholeWord,
          regex
        });
        setSearching(false);
        if (!result.ok) {
          setError(result.error ?? '搜索失败');
          setResults([]);
          setTruncated(false);
          return;
        }
        setError(null);
        setResults(result.files);
        setTruncated(result.truncated);
      })();
    }, 300);
    return () => clearTimeout(timer);
  }, [rootDir, query, caseSensitive, wholeWord, regex]);

  /** 在高亮行里渲染匹配片段 */
  const renderLine = (text: string, column: number, length: number, key: string): JSX.Element => {
    const before = text.slice(0, column);
    const hit = text.slice(column, column + length);
    const after = text.slice(column + length);
    return (
      <span className="search-line-text" key={key}>
        {before}
        <mark className="search-hit">{hit}</mark>
        {after}
      </span>
    );
  };

  /** 选项切换按钮 */
  const renderToggle = (
    active: boolean,
    label: string,
    title: string,
    onToggle: () => void
  ): JSX.Element => (
    <button
      type="button"
      className={`search-option ${active ? 'search-option-active' : ''}`}
      aria-label={title}
      title={title}
      aria-pressed={active}
      onClick={onToggle}
    >
      {label}
    </button>
  );

  if (!rootDir) {
    return (
      <div className="sidebar-search">
        <div className="search-input-row">
          <input className="search-input" placeholder="先打开文件夹才能搜索" disabled />
          <button type="button" className="search-close" aria-label="关闭搜索" title="关闭搜索" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>
    );
  }

  const totalMatches = results.reduce((sum, file) => sum + file.matches.length, 0);

  return (
    <div className="sidebar-search">
      {/* 单行布局：输入框 + 三个选项开关 + 关闭，选项与输入框同行避免占用纵向空间 */}
      <div className="search-input-row">
        <input
          ref={inputRef}
          className="search-input"
          placeholder="查找内容…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
          }}
          spellCheck={false}
        />
        <div className="search-options" role="toolbar" aria-label="搜索选项">
          {renderToggle(caseSensitive, 'Aa', '区分大小写', () => setCaseSensitive((v) => !v))}
          {renderToggle(wholeWord, '|“|', '查找整个单词', () => setWholeWord((v) => !v))}
          {renderToggle(regex, '(.*)', '正则表达式', () => setRegex((v) => !v))}
        </div>
        <button type="button" className="search-close" aria-label="关闭搜索" title="关闭搜索" onClick={onClose}>
          ✕
        </button>
      </div>
      {(error || searching || query.trim().length > 0) && (
        <div className="search-status-row">
          {error ? '正则表达式无效' : searching ? '搜索中…' : `${results.length} 个文件 · ${totalMatches} 处匹配`}
        </div>
      )}
      {error && <div className="search-error">{error}</div>}
      {truncated && !error && (
        <div className="search-truncated">结果较多，仅显示前一部分（打开文件夹根目录可缩小范围）</div>
      )}
      <div className="search-results">
        {results.map((file) => (
          <div key={file.path} className="search-file">
            <div className="search-file-name" title={file.path}>
              {file.name}
              <span className="search-file-count">{file.matches.length}</span>
            </div>
            {file.matches.map((match, index) => (
              <button
                type="button"
                key={`${match.line}-${index}`}
                className="search-match"
                title={`第 ${match.line} 行`}
                onClick={() => onOpenMatch(file.path, file.name, match.line, match.column, match.length, match.text)}
              >
                <span className="search-line-no">{match.line}</span>
                {renderLine(match.text, match.column, match.length, `${match.line}-${index}`)}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { SearchFileResult } from '@ai-md-editor/shared';

/** 侧栏搜索面板属性 */
interface SidebarSearchProps {
  /** 搜索根目录（null = 未打开文件夹） */
  rootDir: string | null;
  /** 点击某条匹配：打开文件并跳到该行（rawColumn 是原始行列号，缩进行也能定位准） */
  onOpenMatch: (
    path: string,
    name: string,
    line: number,
    column: number,
    length: number,
    text: string,
    rawColumn: number
  ) => void;
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
  // 请求序号：快速改关键词时，先发出去的请求可能后返回，不能让它覆盖新结果
  const requestSeq = useRef(0);
  // 进行中的主进程搜索请求 id：换关键词 / 点取消时中止磁盘扫描
  const inflightId = useRef<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cancelled, setCancelled] = useState(false);

  // 打开时聚焦输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /** 中止主进程里还在跑的搜索（如果它还没来得及回包） */
  const cancelInflight = (): void => {
    const requestId = inflightId.current;
    if (requestId) {
      void window.api.cancelSearch(requestId).catch(() => undefined);
      inflightId.current = null;
    }
  };

  /** 手动取消当前搜索：同时取消尚未开始的防抖任务，并清掉旧结果 */
  const handleCancel = (): void => {
    requestSeq.current += 1;
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    cancelInflight();
    setResults([]);
    setTruncated(false);
    setError(null);
    setSearching(false);
    setCancelled(true);
  };

  // 卸载时取消进行中的搜索
  useEffect(() => () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    cancelInflight();
  }, []);

  // 查询条件变化：300ms 防抖自动搜索
  useEffect(() => {
    requestSeq.current += 1;
    const seq = requestSeq.current;
    cancelInflight();
    setCancelled(false);
    if (!rootDir || query.trim().length === 0) {
      setResults([]);
      setError(null);
      setTruncated(false);
      setSearching(false);
      return;
    }
    setResults([]);
    setError(null);
    setTruncated(false);
    setSearching(true);
    const timer = setTimeout(() => {
      debounceTimer.current = null;
      const requestId = 'search-' + seq + '-' + Date.now();
      inflightId.current = requestId;
      void (async () => {
        try {
          const result = await window.api.searchFolder({
            root: rootDir,
            query,
            caseSensitive,
            wholeWord,
            regex,
            requestId
          });
          if (inflightId.current === requestId) inflightId.current = null;
          if (seq !== requestSeq.current) return;
          setSearching(false);
          if (result.cancelled) return;
          if (!result.ok) {
            setError(result.error ?? '搜索失败');
            setResults([]);
            setTruncated(false);
            return;
          }
          setError(null);
          setResults(result.files);
          setTruncated(result.truncated);
        } catch (err) {
          if (seq !== requestSeq.current) return;
          setSearching(false);
          setError(err instanceof Error ? err.message : '搜索失败');
          setResults([]);
          setTruncated(false);
        }
      })();
    }, 300);
    debounceTimer.current = timer;
    return () => {
      clearTimeout(timer);
      if (debounceTimer.current === timer) debounceTimer.current = null;
    };
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
          <button type="button" className="search-close" aria-label="关闭搜索" title="关闭搜索" onClick={onClose}>
            ←
          </button>
          <input className="search-input" placeholder="先打开文件夹才能搜索" disabled />
        </div>
      </div>
    );
  }

  const totalMatches = results.reduce((sum, file) => sum + file.matches.length, 0);

  return (
    <div className="sidebar-search">
      {/* 下划线式搜索条：← 返回在左，无边框输入框，选项为纯文字开关，整行共用一条底部下划线 */}
      <div className="search-input-row">
        <button type="button" className="search-close" aria-label="关闭搜索" title="关闭搜索" onClick={onClose}>
          ←
        </button>
        <input
          ref={inputRef}
          className="search-input"
          placeholder="查找"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
          }}
          spellCheck={false}
        />
        <div className="search-options" role="toolbar" aria-label="搜索选项">
          {renderToggle(caseSensitive, 'Aa', '区分大小写', () => setCaseSensitive((v) => !v))}
          {renderToggle(wholeWord, '「」', '查找整个单词', () => setWholeWord((v) => !v))}
          {renderToggle(regex, '(.*)', '正则表达式', () => setRegex((v) => !v))}
        </div>
      </div>
      {(error || searching || query.trim().length > 0) && (
        <div className="search-status-row">
          {error ? (
            error
          ) : cancelled ? (
            '已取消'
          ) : searching ? (
            <>
              <span>搜索中…</span>
              <button
                type="button"
                className="search-cancel"
                aria-label="取消搜索"
                title="取消搜索"
                onClick={handleCancel}
              >
                ×
              </button>
            </>
          ) : (
            `${results.length} 个文件 · ${totalMatches} 处匹配`
          )}
        </div>
      )}
      {error && <div className="search-error">{error}</div>}
      {truncated && !error && (
        <div className="search-truncated">结果可能不完整，已截断；请缩小搜索范围或调整关键词。</div>
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
                onClick={() =>
                  onOpenMatch(
                    file.path,
                    file.name,
                    match.line,
                    match.column,
                    match.length,
                    match.text,
                    match.rawColumn
                  )
                }
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

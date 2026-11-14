/**
 * 界面显示状态（主题 / 侧栏 / 视图模式 / 阅读与写作开关 / 缩放 / 窗口状态）。
 *
 * 同时负责把界面状态同步给主进程，让原生菜单的勾选项与置灰状态和界面一致。
 * 只在真正变化时才发送（React 依赖数组保证），避免频繁重建原生菜单。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { themes, tokensToCssVars, type ThemeId } from '@ai-md-editor/theme';
import type { TableContext } from '@ai-md-editor/editor';
import { DEFAULT_SETTINGS, type MenuViewState } from '@ai-md-editor/shared';
import { NO_TABLE_CONTEXT } from '../constants';

/** useDisplayState 的入参 */
interface UseDisplayStateOptions {
  /** 当前文档是否已关联磁盘路径（决定菜单项是否可用） */
  hasPath: boolean;
}

/** 界面显示状态 hook */
export function useDisplayState({ hasPath }: UseDisplayStateOptions) {
  // ===== 主题与布局 =====
  const [themeId, setThemeId] = useState<ThemeId>('light');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarPanel, setSidebarPanel] = useState<'files' | 'outline'>('files');
  const [viewMode, setViewMode] = useState<'wysiwyg' | 'source'>('wysiwyg');

  // ===== 阅读与写作模式开关 =====
  const [tabbarVisible, setTabbarVisible] = useState(true);
  const [readOnly, setReadOnly] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [wordCountVisible, setWordCountVisible] = useState(false);
  const [outlineWindowVisible, setOutlineWindowVisible] = useState(false);

  // ===== 窗口状态 =====
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);

  // ===== 光标表格上下文（表格菜单项置灰用） =====
  const [tableContext, setTableContext] = useState<TableContext>(NO_TABLE_CONTEXT);

  // 设置是否已从磁盘读回（读回之前不要把默认值写回去，否则会覆盖用户偏好）
  const [settingsReady, setSettingsReady] = useState(false);

  // 供事件回调使用的即时值，避免闭包过期
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const alwaysOnTopRef = useRef(alwaysOnTop);
  alwaysOnTopRef.current = alwaysOnTop;

  const tokens = themes[themeId];
  const cssVars = useMemo(() => tokensToCssVars(tokens), [tokens]);

  // 启动时应用持久化设置（主题 / 侧栏 / 标签栏 / 工具栏 / 缩放）
  useEffect(() => {
    void window.api
      .getSettings()
      // 读取失败时也放开落盘，但用默认值，避免界面卡在未初始化状态
      .catch(() => ({ ...DEFAULT_SETTINGS }))
      .then((settings) => {
        setThemeId(settings.themeId);
        setSidebarOpen(settings.sidebarOpen);
        setSidebarPanel(settings.sidebarPanel);
        setTabbarVisible(settings.tabbarVisible);
        setToolbarVisible(settings.toolbarVisible);
        setSettingsReady(true);
        // 无条件同步一次：Chromium 会自行记忆页面缩放，若与设置文件不一致会出现
        // 「状态栏 100%、实际 125%」的漂移，也会让鼠标坐标与布局不对齐。
        void window.api.setZoom(settings.zoomPercent).then(setZoomPercent);
      });
  }, []);

  // 设置变化时落盘（防抖；窗口尺寸由主进程单独记录）
  useEffect(() => {
    if (!settingsReady) return;
    const timer = setTimeout(() => {
      void window.api.updateSettings({
        themeId,
        sidebarOpen,
        sidebarPanel,
        tabbarVisible,
        toolbarVisible,
        zoomPercent
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [settingsReady, themeId, sidebarOpen, sidebarPanel, tabbarVisible, toolbarVisible, zoomPercent]);

  // 应用主题到 <html>，保证全局 CSS 变量生效
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeId);
  }, [themeId]);

  /** 切换源码 / 渲染模式（切换后旧的文本快照不再对应，由调用方清空撤销栈） */
  const toggleViewMode = useCallback(() => {
    setViewMode((current) => (current === 'wysiwyg' ? 'source' : 'wysiwyg'));
  }, []);

  /** 切换窗口置顶 */
  const toggleAlwaysOnTop = useCallback(() => {
    const next = !alwaysOnTopRef.current;
    alwaysOnTopRef.current = next;
    setAlwaysOnTop(next);
    void window.api.setAlwaysOnTop(next);
  }, []);

  /** 切换窗口全屏（主进程返回切换后的状态） */
  const toggleFullScreen = useCallback(() => {
    void window.api.toggleFullScreen().then(setFullscreen);
  }, []);

  /** 界面缩放：主进程返回新的百分比 */
  const zoom = useCallback((action: 'in' | 'out' | 'reset') => {
    void window.api.zoom(action).then(setZoomPercent);
  }, []);

  // 初始化并跟随窗口全屏状态（用户也可能用系统绿灯按钮进入全屏）
  useEffect(() => {
    void window.api.isFullScreen().then(setFullscreen);
    const onResize = (): void => {
      void window.api.isFullScreen().then(setFullscreen);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 同步界面状态到主进程，让原生菜单勾选项与界面一致
  useEffect(() => {
    const state: MenuViewState = {
      tabbarVisible,
      sourceMode: viewMode === 'source',
      readOnly,
      focusMode,
      // 专注模式与只读模式会临时隐藏工具栏/侧栏，菜单勾选状态跟随实际可见性
      toolbarVisible: toolbarVisible && !readOnly,
      sidebarVisible: sidebarOpen && !focusMode,
      sidebarPanel,
      wordCountVisible,
      outlineWindowVisible,
      alwaysOnTop,
      fullscreen,
      hasPath,
      inTable: tableContext.inTable,
      inTableHeader: tableContext.inHeader,
      zoomPercent
    };
    window.api.updateMenuState(state);
  }, [
    tabbarVisible, viewMode, readOnly, focusMode, toolbarVisible,
    sidebarOpen, sidebarPanel, wordCountVisible, outlineWindowVisible, alwaysOnTop,
    fullscreen, hasPath, tableContext, zoomPercent
  ]);

  return {
    themeId,
    setThemeId,
    sidebarOpen,
    setSidebarOpen,
    sidebarPanel,
    setSidebarPanel,
    viewMode,
    viewModeRef,
    tabbarVisible,
    setTabbarVisible,
    readOnly,
    readOnlyRef,
    setReadOnly,
    focusMode,
    setFocusMode,
    toolbarVisible,
    setToolbarVisible,
    wordCountVisible,
    setWordCountVisible,
    outlineWindowVisible,
    setOutlineWindowVisible,
    alwaysOnTop,
    fullscreen,
    zoomPercent,
    tableContext,
    setTableContext,
    cssVars,
    toggleViewMode,
    toggleAlwaysOnTop,
    toggleFullScreen,
    zoom
  };
}

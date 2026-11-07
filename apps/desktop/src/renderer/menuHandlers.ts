/**
 * 原生菜单动作分发表（纯函数）。
 *
 * 从根组件拆出，保证 App.tsx 只负责状态与界面组合；
 * 所有菜单动作都调用渲染层提供的回调，不直接触碰主进程 API。
 */
import { MenuActions, type MenuAction } from '@ai-md-editor/shared';
import type { FormatAction } from '@ai-md-editor/editor';

/** 菜单动作回调（payload 用于最近文件路径、警告框类型等） */
export type MenuHandler = (payload?: string) => void;

/** 分发表所需的渲染层能力 */
export interface MenuHandlerDeps {
  /** 新建标签 */
  newTab: () => void;
  /** 新建独立窗口 */
  newWindow: () => void;
  /** 打开文件对话框 */
  openFile: () => void;
  /** 打开最近列表首个文件 */
  openMostRecent: () => void;
  /** 按路径打开文件 */
  openPath: (path: string) => void;
  /** 快速打开面板 */
  quickOpen: () => void;
  /** 关闭当前标签 */
  closeTab: () => void;
  /** 保存当前文档 */
  save: () => void;
  /** 保存全部已修改文档 */
  saveAll: () => void;
  /** 另存为 / 移到 */
  saveAs: () => void;
  /** 复制一份到新路径（原文档保持不变） */
  duplicate: () => void;
  /** 从磁盘重新加载 */
  reloadFromDisk: () => void;
  /** 打开重命名对话框 */
  openRename: () => void;
  /** 在文件管理器中显示 */
  revealInFolder: () => void;
  /** 打印 */
  print: () => void;
  /** 导出 */
  exportAs: (format: 'html' | 'pdf' | 'word') => void;
  /** 复制为指定格式 */
  copyAs: (format: 'plain' | 'markdown' | 'html') => void;
  /** 粘贴为纯文本 */
  pastePlain: () => void;
  /** 统一格式化入口 */
  format: (action: FormatAction, payload?: number | string) => void;
  /** 插入链接占位 */
  insertLink: () => void;
  /** 插入图片占位 */
  insertImage: () => void;
  /** 从本地文件选择图片 */
  chooseImage: () => void;
  /** 打开查找栏 */
  openFind: (withReplace: boolean) => void;
  /** 按方向跳转匹配项 */
  goToMatch: (step: number) => void;
  /** 切换源码 / 渲染模式 */
  toggleMode: () => void;
  /** 切换标签栏 */
  toggleTabbar: () => void;
  /** 切换只读 */
  toggleReadOnly: () => void;
  /** 切换专注模式 */
  toggleFocus: () => void;
  /** 切换打字机模式 */
  toggleTypewriter: () => void;
  /** 切换工具栏 */
  toggleToolbar: () => void;
  /** 切换侧栏 */
  toggleSidebar: () => void;
  /** 显示指定侧栏面板 */
  showPanel: (panel: 'files' | 'outline') => void;
  /** 切换字数统计窗口 */
  toggleWordCount: () => void;
  /** 切换大纲窗口 */
  toggleOutlineWindow: () => void;
  /** 缩放 */
  zoom: (action: 'in' | 'out' | 'reset') => void;
  /** 切换窗口置顶 */
  toggleAlwaysOnTop: () => void;
}

/** 构造完整的菜单动作分发表 */
export function buildMenuHandlers(deps: MenuHandlerDeps): Partial<Record<MenuAction, MenuHandler>> {
  return {
    // ===== 文件 =====
    [MenuActions.NewTab]: deps.newTab,
    [MenuActions.NewWindow]: deps.newWindow,
    [MenuActions.OpenFile]: deps.openFile,
    [MenuActions.OpenRecent]: deps.openMostRecent,
    [MenuActions.OpenRecentPath]: (payload) => { if (payload) deps.openPath(payload); },
    [MenuActions.QuickOpen]: deps.quickOpen,
    [MenuActions.ImportFile]: deps.openFile,
    [MenuActions.CloseTab]: deps.closeTab,
    [MenuActions.Save]: deps.save,
    [MenuActions.SaveAll]: deps.saveAll,
    [MenuActions.SaveAs]: deps.saveAs,
    [MenuActions.RenameFile]: deps.openRename,
    [MenuActions.DuplicateFile]: deps.duplicate,
    [MenuActions.ReloadFromDisk]: deps.reloadFromDisk,
    [MenuActions.RevealInFolder]: deps.revealInFolder,
    [MenuActions.ExportHtml]: () => deps.exportAs('html'),
    [MenuActions.ExportPdf]: () => deps.exportAs('pdf'),
    [MenuActions.ExportWord]: () => deps.exportAs('word'),
    [MenuActions.Print]: deps.print,

    // ===== 编辑 =====
    [MenuActions.CopyMarkdown]: () => deps.copyAs('markdown'),
    [MenuActions.CopyPlainText]: () => deps.copyAs('plain'),
    [MenuActions.CopyHtml]: () => deps.copyAs('html'),
    [MenuActions.PastePlainText]: deps.pastePlain,
    [MenuActions.SelectLine]: () => deps.format('selectLine'),
    [MenuActions.MoveLineUp]: () => deps.format('moveLineUp'),
    [MenuActions.MoveLineDown]: () => deps.format('moveLineDown'),
    [MenuActions.DeleteLine]: () => deps.format('deleteLine'),
    [MenuActions.InsertHardBreak]: () => deps.format('hardBreak'),
    [MenuActions.InsertMathInline]: () => deps.format('snippet', '$x$'),
    [MenuActions.InsertMathBlock]: () => deps.format('snippet', '\n$$\n\n$$\n'),
    [MenuActions.Find]: () => deps.openFind(false),
    [MenuActions.Replace]: () => deps.openFind(true),
    [MenuActions.FindNext]: () => deps.goToMatch(1),
    [MenuActions.FindPrev]: () => deps.goToMatch(-1),

    // ===== 段落 =====
    [MenuActions.FormatParagraph]: () => deps.format('paragraph'),
    [MenuActions.FormatHeading1]: () => deps.format('heading', 1),
    [MenuActions.FormatHeading2]: () => deps.format('heading', 2),
    [MenuActions.FormatHeading3]: () => deps.format('heading', 3),
    [MenuActions.FormatHeading4]: () => deps.format('heading', 4),
    [MenuActions.FormatHeading5]: () => deps.format('heading', 5),
    [MenuActions.FormatHeading6]: () => deps.format('heading', 6),
    [MenuActions.UpgradeHeading]: () => deps.format('upgradeHeading'),
    [MenuActions.DowngradeHeading]: () => deps.format('downgradeHeading'),
    [MenuActions.InsertTable]: () => deps.format('insertTable'),
    [MenuActions.TableAddRow]: () => deps.format('tableAddRow'),
    [MenuActions.TableAddCol]: () => deps.format('tableAddCol'),
    [MenuActions.TableDeleteRow]: () => deps.format('tableDeleteRow'),
    [MenuActions.TableDeleteCol]: () => deps.format('tableDeleteCol'),
    [MenuActions.FormatCodeBlock]: () => deps.format('codeBlock'),
    [MenuActions.FormatQuote]: () => deps.format('quote'),
    [MenuActions.FormatBulletList]: () => deps.format('bulletList'),
    [MenuActions.FormatOrderedList]: () => deps.format('orderedList'),
    [MenuActions.FormatTaskList]: () => deps.format('taskList'),
    [MenuActions.TaskDone]: () => deps.format('taskDone'),
    [MenuActions.TaskUndone]: () => deps.format('taskUndone'),
    [MenuActions.TaskClear]: () => deps.format('taskClear'),
    [MenuActions.IndentList]: () => deps.format('indentList'),
    [MenuActions.OutdentList]: () => deps.format('outdentList'),
    [MenuActions.InsertParagraphAbove]: () => deps.format('insertParagraphAbove'),
    [MenuActions.InsertParagraphBelow]: () => deps.format('insertParagraphBelow'),
    [MenuActions.InsertLinkReference]: () => deps.format('snippet', '[链接文字][ref]\n\n[ref]: https://example.com'),
    [MenuActions.InsertFootnote]: () => deps.format('snippet', '正文[^1]\n\n[^1]: 脚注内容'),
    [MenuActions.InsertCallout]: (payload) => deps.format('snippet', `\n> [!${payload ?? 'NOTE'}]\n> 内容\n`),
    [MenuActions.InsertToc]: () => deps.format('snippet', '\n[TOC]\n'),
    [MenuActions.InsertFrontMatter]: () => deps.format('snippetAtStart', '---\ntitle: 未命名\ndate: \n---\n'),
    [MenuActions.FormatHorizontalRule]: () => deps.format('hr'),

    // ===== 格式 =====
    [MenuActions.FormatBold]: () => deps.format('bold'),
    [MenuActions.FormatItalic]: () => deps.format('italic'),
    [MenuActions.FormatUnderline]: () => deps.format('underline'),
    [MenuActions.FormatCode]: () => deps.format('code'),
    [MenuActions.FormatStrikethrough]: () => deps.format('strikethrough'),
    [MenuActions.InsertComment]: () => deps.format('snippet', '<!-- 注释 -->'),
    [MenuActions.InsertLink]: deps.insertLink,
    [MenuActions.InsertImage]: deps.insertImage,
    [MenuActions.ChooseImage]: deps.chooseImage,
    [MenuActions.ClearFormat]: () => deps.format('clearFormat'),

    // ===== 显示 =====
    [MenuActions.ToggleTabbar]: deps.toggleTabbar,
    [MenuActions.ToggleMode]: deps.toggleMode,
    [MenuActions.ToggleReadOnly]: deps.toggleReadOnly,
    [MenuActions.ToggleFocusMode]: deps.toggleFocus,
    [MenuActions.ToggleTypewriter]: deps.toggleTypewriter,
    [MenuActions.ToggleToolbar]: deps.toggleToolbar,
    [MenuActions.ToggleSidebar]: deps.toggleSidebar,
    [MenuActions.ShowFiles]: () => deps.showPanel('files'),
    [MenuActions.ShowOutline]: () => deps.showPanel('outline'),
    [MenuActions.ToggleWordCount]: deps.toggleWordCount,
    [MenuActions.ToggleOutlineWindow]: deps.toggleOutlineWindow,
    [MenuActions.ToggleSearch]: () => deps.openFind(false),
    [MenuActions.ZoomIn]: () => deps.zoom('in'),
    [MenuActions.ZoomOut]: () => deps.zoom('out'),
    [MenuActions.ZoomReset]: () => deps.zoom('reset'),
    [MenuActions.ToggleAlwaysOnTop]: deps.toggleAlwaysOnTop
  };
}

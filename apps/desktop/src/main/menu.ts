/**
 * 原生应用菜单（文件 / 编辑 / 段落 / 格式 / 显示）。
 * - macOS 菜单位于屏幕顶部，不占用应用窗口；Windows 上隐藏窗口内菜单但保留快捷键。
 * - 菜单动作经白名单 IPC 转发到渲染层执行，主进程只负责菜单结构与系统级动作。
 * - 界面勾选项状态由渲染层通过 MenuStateChannel 同步，保持菜单与界面一致。
 */
import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import {
  MenuActionChannel,
  MenuActions,
  type MenuAction,
  type MenuActionMessage,
  type MenuViewState,
  DEFAULT_MENU_VIEW_STATE
} from '@ai-md-editor/shared';
import { getRecent } from './recent';
import { createWindow } from './window';

/** 当前界面状态（渲染层同步） */
let viewState: MenuViewState = { ...DEFAULT_MENU_VIEW_STATE };

/** 平台差异快捷键：macOS 与 Windows 各取一套合法的 accelerator */
function key(mac: string, win: string): string {
  return process.platform === 'darwin' ? mac : win;
}

/** 向当前窗口发送菜单动作（带可选参数） */
function sendMenuAction(action: MenuAction, payload?: string): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const message: MenuActionMessage = payload === undefined ? { action } : { action, payload };
  win?.webContents.send(MenuActionChannel, message);
}

/** 菜单项构造选项 */
interface ActionOptions {
  /** 快捷键 */
  accelerator?: string;
  /** 动作参数（如最近文件路径、警告框类型） */
  payload?: string;
  /** 是否显示勾选 */
  checked?: boolean;
  /** 是否启用 */
  enabled?: boolean;
  /** 菜单悬停说明（macOS 显示；用于解释不直观的动作语义） */
  toolTip?: string;
}

/** 构造带动作的菜单项 */
function item(label: string, action: MenuAction, options: ActionOptions = {}): MenuItemConstructorOptions {
  return {
    label,
    accelerator: options.accelerator,
    enabled: options.enabled ?? true,
    ...(options.toolTip ? { toolTip: options.toolTip } : {}),
    ...(options.checked === undefined ? {} : { type: 'checkbox' as const, checked: options.checked }),
    click: () => sendMenuAction(action, options.payload)
  };
}

/** 分隔线 */
const sep: MenuItemConstructorOptions = { type: 'separator' };

/** 最近文件子菜单（每次重建菜单时读取最新列表） */
function recentSubmenu(): MenuItemConstructorOptions[] {
  const recent = getRecent().slice(0, 12);
  if (recent.length === 0) {
    return [{ label: '（暂无最近文件）', enabled: false }];
  }
  return recent.map((file) => ({
    label: file.name,
    toolTip: file.path,
    click: () => sendMenuAction(MenuActions.OpenRecentPath, file.path)
  }));
}

/** 构造完整菜单模板 */
function buildTemplate(): MenuItemConstructorOptions[] {
  const isMac = process.platform === 'darwin';
  const s = viewState;

  return [
    // macOS 应用菜单：关于、隐藏、退出等系统标准项（不属于「帮助」菜单）
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),

    // ==================== 文件 ====================
    {
      label: '文件',
      submenu: [
        item('新建', MenuActions.NewTab, { accelerator: 'CommandOrControl+N' }),
        // Ctrl/Cmd+T 保留为「新建标签页」快捷键，但不在菜单里重复列一项
        {
          label: '新建标签页',
          accelerator: 'CommandOrControl+T',
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: () => sendMenuAction(MenuActions.NewTab)
        },
        {
          label: '新建窗口',
          accelerator: 'Shift+CommandOrControl+N',
          click: () => createWindow()
        },
        sep,
        item('打开…', MenuActions.OpenFile, { accelerator: 'CommandOrControl+O' }),
        { label: '打开最近文件', submenu: recentSubmenu() },
        item('快速打开…', MenuActions.QuickOpen, { accelerator: 'Shift+CommandOrControl+O' }),
        sep,
        item('在文件管理器中显示', MenuActions.RevealInFolder, { enabled: s.hasPath }),
        item('在文件树中显示', MenuActions.ShowFiles, { enabled: s.hasPath }),
        // 未落盘的文档也能改名（只改标签名），因此不按 hasPath 置灰
        item('重新命名…', MenuActions.RenameFile),
        item('复制一份到…', MenuActions.DuplicateFile),
        item('从磁盘重新加载', MenuActions.ReloadFromDisk, { enabled: s.hasPath }),
        sep,
        item('关闭', MenuActions.CloseTab, { accelerator: 'CommandOrControl+W' }),
        item('保存', MenuActions.Save, { accelerator: 'CommandOrControl+S' }),
        item('保存全部打开的文件', MenuActions.SaveAll, {
          accelerator: key('Ctrl+Command+S', 'Ctrl+Alt+S')
        }),
        item('另存为…', MenuActions.SaveAs, { accelerator: 'Shift+CommandOrControl+S' }),
        sep,
        {
          label: '导出',
          submenu: [
            item('HTML…', MenuActions.ExportHtml),
            item('PDF…', MenuActions.ExportPdf),
            item('Word…', MenuActions.ExportWord)
          ]
        },
        sep,
        item('打印…', MenuActions.Print, { accelerator: 'CommandOrControl+P' }),
        ...(!isMac ? [{ role: 'quit', label: '退出' } as MenuItemConstructorOptions] : [])
      ]
    },

    // ==================== 编辑 ====================
    {
      label: '编辑',
      submenu: [
        // 不用 role: 'undo'：role 走的是 webContents 的 DOM 撤销，
        // 对 ProseMirror 编辑器无效，必须由渲染层调用编辑器自己的历史命令
        item('撤消', MenuActions.Undo, { accelerator: 'CommandOrControl+Z' }),
        item('重做', MenuActions.Redo, { accelerator: 'Shift+CommandOrControl+Z' }),
        // Windows / Linux 习惯用 Ctrl+Y 重做，用隐藏项注册第二组快捷键
        {
          label: '重做',
          accelerator: 'CommandOrControl+Y',
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: () => sendMenuAction(MenuActions.Redo)
        },
        sep,
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
        sep,
        item('复制为纯文本', MenuActions.CopyPlainText),
        item('复制为 Markdown', MenuActions.CopyMarkdown, {
          accelerator: 'Shift+CommandOrControl+C'
        }),
        item('复制为 HTML 代码', MenuActions.CopyHtml),
        item('粘贴为纯文本', MenuActions.PastePlainText, {
          accelerator: 'Shift+CommandOrControl+V'
        }),
        sep,
        item('选择当前行', MenuActions.SelectLine),
        item('上移该行', MenuActions.MoveLineUp, { accelerator: key('Ctrl+Up', 'Alt+Up') }),
        item('下移该行', MenuActions.MoveLineDown, { accelerator: key('Ctrl+Down', 'Alt+Down') }),
        item('删除当前行', MenuActions.DeleteLine, {
          accelerator: 'Shift+CommandOrControl+Backspace'
        }),
        sep,
        {
          label: '数学工具',
          submenu: [
            item('内联公式', MenuActions.InsertMathInline),
            item('公式块', MenuActions.InsertMathBlock)
          ]
        },
        item('插入换行符', MenuActions.InsertHardBreak),
        sep,
        {
          label: '查找',
          submenu: [
            item('查找…', MenuActions.Find, { accelerator: 'CommandOrControl+F' }),
            item('查找下一个', MenuActions.FindNext, { accelerator: 'CommandOrControl+G' }),
            item('查找上一个', MenuActions.FindPrev, { accelerator: 'Shift+CommandOrControl+G' }),
            item('替换…', MenuActions.Replace, { accelerator: 'Shift+CommandOrControl+H' })
          ]
        }
      ]
    },

    // ==================== 段落 ====================
    {
      label: '段落',
      submenu: [
        item('一级标题', MenuActions.FormatHeading1, { accelerator: 'CommandOrControl+1' }),
        item('二级标题', MenuActions.FormatHeading2, { accelerator: 'CommandOrControl+2' }),
        item('三级标题', MenuActions.FormatHeading3, { accelerator: 'CommandOrControl+3' }),
        item('四级标题', MenuActions.FormatHeading4, { accelerator: 'CommandOrControl+4' }),
        item('五级标题', MenuActions.FormatHeading5, { accelerator: 'CommandOrControl+5' }),
        item('六级标题', MenuActions.FormatHeading6, { accelerator: 'CommandOrControl+6' }),
        item('段落', MenuActions.FormatParagraph, { accelerator: 'CommandOrControl+0' }),
        sep,
        item('提升标题级别', MenuActions.UpgradeHeading, { accelerator: 'CommandOrControl+=' }),
        item('降低标题级别', MenuActions.DowngradeHeading, { accelerator: 'CommandOrControl+-' }),
        sep,
        {
          label: '表格',
          submenu: [
            item('插入 3×3 表格', MenuActions.InsertTable),
            sep,
            // 增删行列只在光标位于表格内时可用：渲染层把光标上下文同步到 inTable / inTableHeader
            item('在下方插入行', MenuActions.TableAddRow, { enabled: s.inTable }),
            item('在右侧插入列', MenuActions.TableAddCol, { enabled: s.inTable }),
            // 表头行也能删：编辑器会删掉旧表头并把首个数据行升级为新表头。
            // 语义不直观，菜单文案与悬停说明都写清楚，避免用户以为会删掉整张表。
            item(s.inTableHeader ? '删除当前表格行（表头）' : '删除当前表格行', MenuActions.TableDeleteRow, {
              enabled: s.inTable,
              toolTip: s.inTableHeader
                ? '删除表头行后，首个数据行会成为新表头；表格只有表头时会删除整张表'
                : undefined
            }),
            item('删除当前表格列', MenuActions.TableDeleteCol, { enabled: s.inTable }),
            sep,
            // 整表删除：文档末尾的表格后面没有可选中的光标位置，必须提供显式动作
            item('删除整个表格', MenuActions.TableDelete, { enabled: s.inTable })
          ]
        },
        item('公式块', MenuActions.InsertMathBlock, {
          accelerator: key('Ctrl+Command+B', 'Ctrl+Alt+B')
        }),
        {
          label: '代码工具',
          submenu: [
            item('行内代码', MenuActions.FormatCode),
            item('代码块', MenuActions.FormatCodeBlock, {
              accelerator: key('Ctrl+Command+C', 'Ctrl+Alt+C')
            }),
            item('插入注释', MenuActions.InsertComment)
          ]
        },
        {
          label: '警告框',
          submenu: [
            item('NOTE 提示', MenuActions.InsertCallout, { payload: 'NOTE' }),
            item('TIP 技巧', MenuActions.InsertCallout, { payload: 'TIP' }),
            item('IMPORTANT 重要', MenuActions.InsertCallout, { payload: 'IMPORTANT' }),
            item('WARNING 警告', MenuActions.InsertCallout, { payload: 'WARNING' }),
            item('CAUTION 注意', MenuActions.InsertCallout, { payload: 'CAUTION' })
          ]
        },
        sep,
        item('引用', MenuActions.FormatQuote, {
          accelerator: key('Ctrl+Command+Q', 'Ctrl+Alt+Q')
        }),
        sep,
        item('有序列表', MenuActions.FormatOrderedList, {
          accelerator: key('Ctrl+Command+O', 'Ctrl+Alt+O')
        }),
        item('无序列表', MenuActions.FormatBulletList, {
          accelerator: key('Ctrl+Command+U', 'Ctrl+Alt+U')
        }),
        item('任务列表', MenuActions.FormatTaskList, {
          accelerator: key('Ctrl+Command+X', 'Ctrl+Alt+X')
        }),
        {
          label: '任务状态',
          submenu: [
            item('标记为完成', MenuActions.TaskDone),
            item('标记为未完成', MenuActions.TaskUndone),
            item('取消任务状态', MenuActions.TaskClear)
          ]
        },
        {
          label: '列表缩进',
          submenu: [
            item('增加缩进', MenuActions.IndentList),
            item('减少缩进', MenuActions.OutdentList)
          ]
        },
        sep,
        item('在上方插入段落', MenuActions.InsertParagraphAbove),
        item('在下方插入段落', MenuActions.InsertParagraphBelow),
        sep,
        item('链接引用', MenuActions.InsertLinkReference, {
          accelerator: key('Ctrl+Command+L', 'Ctrl+Alt+L')
        }),
        item('脚注', MenuActions.InsertFootnote, {
          accelerator: key('Ctrl+Command+R', 'Ctrl+Alt+R')
        }),
        sep,
        item('水平分割线', MenuActions.FormatHorizontalRule, {
          accelerator: key('Ctrl+Command+-', 'Ctrl+Alt+-')
        }),
        item('内容目录', MenuActions.InsertToc)
      ]
    },

    // ==================== 格式 ====================
    {
      label: '格式',
      submenu: [
        item('加粗', MenuActions.FormatBold, { accelerator: 'CommandOrControl+B' }),
        item('斜体', MenuActions.FormatItalic, { accelerator: 'CommandOrControl+I' }),
        item('下划线', MenuActions.FormatUnderline, { accelerator: 'CommandOrControl+U' }),
        item('代码', MenuActions.FormatCode, {
          accelerator: key('Ctrl+Shift+K', 'Alt+Shift+K')
        }),
        sep,
        item('内联公式', MenuActions.InsertMathInline, {
          accelerator: key('Ctrl+M', 'Alt+M')
        }),
        item('删除线', MenuActions.FormatStrikethrough, {
          accelerator: key('Ctrl+Shift+X', 'Alt+Shift+X')
        }),
        item('注释', MenuActions.InsertComment, {
          accelerator: key('Ctrl+Shift+/', 'Alt+Shift+/')
        }),
        sep,
        item('超链接', MenuActions.InsertLink, { accelerator: 'CommandOrControl+K' }),
        {
          label: '图像',
          submenu: [
            item('插入图片占位', MenuActions.InsertImage),
            item('从本地文件插入…', MenuActions.ChooseImage)
          ]
        },
        sep,
        item('清除样式', MenuActions.ClearFormat, { accelerator: 'CommandOrControl+Alt+C' })
      ]
    },

    // ==================== 显示 ====================
    {
      label: '显示',
      submenu: [
        item(s.tabbarVisible ? '隐藏标签页栏' : '显示标签页栏', MenuActions.ToggleTabbar, {
          accelerator: 'Shift+CommandOrControl+T',
          checked: s.tabbarVisible
        }),
        sep,
        item('源码模式', MenuActions.ToggleMode, {
          accelerator: 'CommandOrControl+/',
          checked: s.sourceMode
        }),
        item('只读模式', MenuActions.ToggleReadOnly, { checked: s.readOnly }),
        sep,
        item('专注模式', MenuActions.ToggleFocusMode, { accelerator: 'F8', checked: s.focusMode }),
        item('打字机模式', MenuActions.ToggleTypewriter, {
          accelerator: 'F9',
          checked: s.typewriterMode
        }),
        item('工具栏', MenuActions.ToggleToolbar, { checked: s.toolbarVisible }),
        sep,
        item('显示 / 隐藏侧边栏', MenuActions.ToggleSidebar, {
          accelerator: 'Shift+CommandOrControl+L',
          checked: s.sidebarVisible
        }),
        item('大纲', MenuActions.ShowOutline, {
          accelerator: key('Ctrl+Command+1', 'Ctrl+Alt+1'),
          checked: s.sidebarVisible && s.sidebarPanel === 'outline'
        }),
        item('文件树', MenuActions.ShowFiles, {
          accelerator: key('Ctrl+Command+3', 'Ctrl+Alt+3'),
          checked: s.sidebarVisible && s.sidebarPanel === 'files'
        }),
        item('搜索…', MenuActions.ToggleSearch, {
          accelerator: 'Shift+CommandOrControl+F'
        }),
        sep,
        item('字数统计窗口', MenuActions.ToggleWordCount, { checked: s.wordCountVisible }),
        item('大纲窗口', MenuActions.ToggleOutlineWindow, { checked: s.outlineWindowVisible }),
        sep,
        {
          // 缩放档位由主进程统一维护（离散百分比），当前比例在菜单里直接可见
          label: '缩放',
          submenu: [
            { label: `当前缩放 ${s.zoomPercent}%`, enabled: false },
            sep,
            item('放大', MenuActions.ZoomIn, { accelerator: 'Shift+CommandOrControl+=' }),
            item('缩小', MenuActions.ZoomOut, { accelerator: 'Shift+CommandOrControl+-' }),
            item('实际大小', MenuActions.ZoomReset, { accelerator: 'Shift+CommandOrControl+0' })
          ]
        },
        sep,
        // 以下三项统一用自定义菜单项，不用系统 role：
        // role 版（togglefullscreen / minimize）由 macOS 注入图标与额外缩进，
        // 与上面的菜单文字不对齐，且会出现重复的「全屏」
        item('保持窗口在最前端', MenuActions.ToggleAlwaysOnTop, { checked: s.alwaysOnTop }),
        item(s.fullscreen ? '退出全屏' : '进入全屏', MenuActions.ToggleFullScreen, {
          accelerator: key('Ctrl+Command+F', 'F11'),
          checked: s.fullscreen
        }),
        item('最小化', MenuActions.MinimizeWindow, { accelerator: 'CommandOrControl+M' })
      ]
    }
  ];
}

/** 重建应用菜单（状态或最近文件变化后调用） */
function rebuildMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate()));
}

/**
 * 上一次重建菜单时的界面状态签名。
 * 渲染层每次界面变化都会同步状态，但其中相当一部分（例如只有缩放百分比以外的
 * 字段抖动、或是重复上报同一个值）并不影响菜单内容。整棵菜单有近百项，
 * 无脑重建会带来可感知的卡顿，因此用签名做一次廉价短路。
 */
let lastSignature = '';

/** 渲染层同步界面状态，刷新菜单勾选项 */
export function updateMenuState(next: MenuViewState): void {
  const merged = { ...DEFAULT_MENU_VIEW_STATE, ...next };
  const signature = JSON.stringify(merged);
  if (signature === lastSignature) return;
  lastSignature = signature;
  viewState = merged;
  rebuildMenu();
}

/** 最近文件列表变化后刷新「打开最近文件」子菜单 */
export function refreshRecentMenu(): void {
  // 状态签名没变但最近文件变了，必须强制重建
  lastSignature = '';
  rebuildMenu();
}

/** 安装原生应用菜单 */
export function setupApplicationMenu(): void {
  lastSignature = '';
  rebuildMenu();
}

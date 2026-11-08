# 待办与未验证项

> 记录遗留工作，下次从这里继续。
> 最后更新：2026-11-08（0.12.0）

## 一、已自动化验证（0.12.0 补齐）

0.11.0 时这些项因为「沙箱跑不了 GUI」被留成人工验证，本轮用真实 Electron 主进程 + preload + 渲染层
搭了自动化测试，逐条复测通过：

- [x] **窗口类**：显示 → 进入全屏 / 退出全屏、最小化（`isFullScreen` 与 `isMinimized` 均返回 true）
- [x] **剪贴板**：复制为纯文本 / Markdown / HTML 代码（三种格式内容逐字核对）
- [x] **缩放**：实际大小 / 放大 / 缩小（离散档位，状态栏与菜单同步显示百分比）
- [x] **打印**：文件 → 打印（替换掉阻塞的系统对话框后，确认 IPC 链路确实调到 `webContents.print`）
- [x] **文件树定位**：打开深层目录中的文件，「在文件树中显示」从根目录逐级展开并滚动到高亮项
- [x] **表格上下文**：光标不在表格时表格菜单项置灰，进入表头/数据行后恢复可用
- [x] **表头行删除**：WYSIWYG 与源码模式都能删，删除后表格仍然合法
- [x] **撤销栈**：源码模式连续键入合并为一条记录，撤销回到这段输入之前
- [x] **偏好持久化**：侧栏开关 / 窗口尺寸写入设置文件，新窗口启动后恢复主题、工具栏可见性与缩放比例
- [x] **拖拽**：图片复制到 `img/` 并插入、文件夹设为文件树根、`statPath` 类型判断
- [x] **图片扩展名兜底**：非图片后缀、无后缀或目录名含点时统一回退 `.png`，不会把路径片段写进文件名
- [x] **测试环境隔离**：E2E 启动器自动剔除宿主注入的变量；临时 profile 每次清空，缩放与点击坐标不再受上次运行影响

> 复跑命令：`npm test`（快捷键静态检查 + E2E）。`test/run-e2e.cjs` 会自动处理注入的
> `ELECTRON_RUN_AS_NODE` / `NODE_OPTIONS`，普通终端与受限沙箱都无需手动设置环境。

## 二、仍需实机验证（环境限制，无法自动化）

- [ ] **Windows 端整体**：`Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` 重做、`F11` 全屏、
      `Alt+↑↓` 移动行、`Ctrl+Alt+*` 系列段落快捷键、`Alt+Shift+K` 行内代码。
      已用 `test/menuAccelerators.cjs` 静态校验两套快捷键的写法与唯一性（62 项无冲突），
      但真实的键盘事件分发只能在 Windows 上验证。

## 三、已知行为不完美（不算 bug，但可以更好）

- [ ] **表头行删除的语义**：当前是「删掉旧表头，第一个数据行升级为表头」，行数减一。
      同类工具在表头执行删除时多为不响应，若用户反馈别扭可改为置灰。
- [ ] **源码模式表格置灰依赖光标位置事件**：监听 `keyup` / `click` / `input` / `select`，
      用鼠标拖选时能覆盖，但通过程序化 `setSelectionRange` 且不派发 `select` 的场景不会刷新。
- [x] **缩放档位持久化**：主题/侧栏/缩放/窗口尺寸已写入 `userData/settings.json`，重启原样恢复。

## 四、历史遗留的重构（已完成）

- [x] `App.tsx` 980 → 470 行，按职责拆到 `renderer/hooks/`（`useTabs` / `useDisplayState` /
      `useEditorRuntime` / `useEditing` / `useFindReplace` / `useSourceTableContext` / `useMenuBridge`），
      侧栏拆成 `Sidebar.tsx`
- [x] `packages/editor/src/index.ts` 692 → 37 行，拆成 `types` / `highlight` / `commands` / `selection` / `instance`

## 五、已知限制（设计取舍，非缺陷）

- 引用式链接 `[文字][ref]` 会被 Milkdown 归一为行内链接 `[文字](url)`，链接语义不变。
- 导出 HTML / PDF / Word 由 marked 渲染，Mermaid 图表与 KaTeX 公式按源码文本输出。
- 关闭标签不提示未保存改动（依赖 1.5s 自动保存兜底）。
- 源码模式快照栈上限 200 条，超出后丢弃最早的记录；WYSIWYG 用 ProseMirror 默认深度。

## 六、0.12.0 发布记录

- [x] 版本号升到 **0.12.0**（根 `package.json`、`apps/desktop/package.json`、`package-lock.json` 三处，
      注意 lock 文件里只改 workspace 的三处，不要全局替换版本号——`@pkgjs/parseargs` 的版本号恰好也是 0.11.0）
- [x] `CHANGELOG.md` 增加 0.12.0 小节
- [x] 推 main + 打 tag `v0.12.0` 触发 GitHub Actions 出三平台包（macOS arm64 / macOS x64 / Windows）
- [ ] 装包后按第二节在 Windows 上过一遍快捷键

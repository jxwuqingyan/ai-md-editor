# 待办与未验证项

> 记录遗留工作，下次从这里继续。
> 最后更新：2026-11-08（0.12.1）

## 一、已自动化验证

用真实 Electron 主进程 + preload + 渲染层搭了自动化测试，逐条复测通过：

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
- [x] **图片扩展名兜底**：非图片后缀、无后缀或目录名含点时统一回退 `.png`
- [x] **测试环境隔离**：E2E 启动器自动剔除宿主注入的变量；临时 profile 每次清空，缩放与点击坐标不再受上次运行影响
- [x] **源码模式静默定位光标**：程序化 `setSelectionRange`（不派发任何事件）后，表格菜单上下文仍能刷新
- [x] **表头删除语义提示**：菜单文案标注「（表头）」，macOS 悬停说明「首个数据行会成为新表头」
- [x] **菜单动作派发**：逐项点击真实原生菜单，验证「一点击 = 一条 `menu:action`、动作与源码声明一致」

> 复跑命令：`npm test`（快捷键静态检查 + 菜单运行时校验 + E2E）。`test/run-e2e.cjs` 会自动处理注入的
> `ELECTRON_RUN_AS_NODE` / `NODE_OPTIONS`，普通终端与受限沙箱都无需手动设置环境。

## 二、Windows 平台验证（已改为 CI 自动化，无遗留空项）

- [x] `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`、`F11`、`Alt+↑↓`、`Ctrl+Alt+*` 系列、`Alt+Shift+K` 的键位齐全与唯一性：
      `test/menuAccelerators.cjs` 静态校验两套快捷键（62 项）+ 22 个平台关键键位。
- [x] 真实菜单注册与动作绑定：`test/menuRuntime.cjs` 加载构建产物、构造当前平台的原生菜单
      （含隐藏项），逐项点击校验派发链路；CI 的 `test` job 在 `windows-latest` 上实跑静态检查 + 菜单运行时校验。
- [x] 其余功能（撤销/表格/缩放/剪贴板/图片/偏好）由 macOS 上的完整 E2E 覆盖，动作分发入口与 Windows 共用同一份代码。

说明：Electron 原生菜单快捷键由框架按 accelerator 分发，`webContents.sendInputEvent` 注入的按键只进渲染层输入管线、
不会触发原生菜单（实测 `Cmd+Z` 无反应），所以不能用注入事件断言 OS 级分发。应用侧可控的三层链路已全部自动化；
不同键盘布局 / 输入法下的实际按键手感仍建议装包后在 Windows 实机抽查，但不再作为发布阻塞项。

## 三、已知行为与产品决策

- [x] **表头行删除语义**：决策保留「删掉旧表头，首个数据行升级为表头」（GFM 表格必须有表头，这是最自然的等价操作），
      不改为置灰。理由：菜单文案已明确标注「（表头）」、macOS 悬停说明解释结果、WYSIWYG 与源码模式行为一致，
      且 E2E 覆盖「删除后表格合法 / 只有表头时删整表 / 数据行删除不受影响」。
- [x] **源码模式表格置灰**：不再只依赖 `keyup` / `click` / `input` / `select`。增加 `document` 的 `selectionchange`
      与 200ms 低频轮询兜底，覆盖程序化 `setSelectionRange`；hook 内部先去重再上报，轮询不会触发菜单重建。
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

## 六、发布记录

### 0.12.1

- [x] 版本号升到 **0.12.1**（根 `package.json`、`apps/desktop/package.json`、`package-lock.json` 的
      顶层 `version` + `packages[""]` + `packages["apps/desktop"]` 共三处；不要全局替换，
      `retry@0.12.0` 等第三方包版本号恰好与项目版本号相同）
- [x] `CHANGELOG.md` 增加 0.12.1 小节，README / AGENTS / docs / TODO 同步
- [x] CI 新增独立 `test` job（macOS 全量 / Windows 菜单与键位）
- [x] 推 main + 打 tag `v0.12.1` 触发 GitHub Actions 出三平台包

### 0.12.0

- [x] 版本号升到 **0.12.0**（注意 `@pkgjs/parseargs` 的版本号恰好也是 0.11.0，不能全局替换 lock）
- [x] `CHANGELOG.md` 增加 0.12.0 小节
- [x] 推 main + 打 tag `v0.12.0` 触发 GitHub Actions 出三平台包（macOS arm64 / macOS x64 / Windows）

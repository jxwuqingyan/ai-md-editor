# AGENTS.md — ai-md-editor 项目协作规范

> 本文件是 AI 助手在本仓库协作时的行为准则与项目约定。所有功能开发必须遵守。

---

## 1. 语言要求

- **始终使用简体中文**回答与沟通。
- 代码注释、文档、提交说明一律使用简体中文。
- **文档用语**：不出现第三方产品名、品牌标识或竞品内部组件名，也不用「对标 XX」这类表述；统一用中性描述（如「跨平台本地 Markdown 编辑器」「常见扩展语法」）。

## 2. 核心理念与原则

- **简洁至上（KISS）**：恪守 KISS 原则，避免过度工程化。用最少的代码解决问题，不做过度推测与提前抽象。沟通简洁，直抒重点。
- **深度分析**：基于第一性原理、金字塔原理拆解问题，先想清楚「为什么」再动手。
- **事实为本**：实事求是，务实胜于教条，直言不讳。如果方案是在做蠢事，直接指出。
- **收集信息**：遇到不确定的事情，优先与用户讨论、充分收集信息后再行动，而非擅自假设。
- **主动行动**：在前置条件充分时，独立思考、主动动手验证可行性、得出结论，而非被动等待。

## 3. 项目定位（务必牢记）

- **跨平台（macOS + Windows）Markdown 编辑器与预览器**，所见即所得。
- **纯本地单机应用**：无登录、无账户、无云同步、无后端、无数据库、无自动更新。
- 核心体验：**WYSIWYG 所见即所得**（输入即渲染，光标所在行才显示源码标记）。
- 设计基调：**现代极简 + 克制动效**，去 AI 味。详见 `docs/UI-UX设计规范.md`。

## 4. 技术栈（本项目实际，非通用后端）

| 层 | 选型 |
|----|------|
| 应用框架 | Electron 45 + React 18 + TypeScript |
| 编辑器内核 | Milkdown 7（ProseMirror + remark，`@milkdown/kit` 统一入口） |
| 构建 | Vite（electron-vite）+ electron-builder + npm workspaces（Monorepo） |
| 动效 | CSS 过渡（克制使用；未引入第三方动画库） |
| 数学公式 | KaTeX（v1.1） |
| 图表 | Mermaid + ZenUML（v1.1） |
| 代码高亮 | Shiki（v1.1 已实现，`@milkdown/plugin-highlight` + CSS 变量主题） |
| 搜索 | ripgrep（v1.2） |

> ⚠️ 本项目**不是** Python/FastAPI/Vue 后端项目，不使用 MVC 后端目录结构、不用 MySQL/Redis/DashScope。不要套用后端约定。

> 注：已从 pnpm 迁移到 npm workspaces（2026-10-25），依赖安装用 `npm install`。

## 5. 项目目录结构（Monorepo）

```
ai-md-editor/
├── apps/
│   └── desktop/              # Electron 桌面端
│       ├── src/main/         # 主进程（窗口 window.ts、IPC、文件 I/O、编码识别、外部修改监听 fileWatcher.ts、最近文件、原生菜单 menu.ts）
│       ├── src/preload/      # preload 桥接（contextBridge 白名单 API）
│       ├── src/renderer/     # 渲染进程（React + Milkdown）
│       │   ├── hooks/            # 状态按职责拆分的自定义 Hook
│       │   │   ├── useTabs.ts            # 标签/文档/文件读写/自动保存/会话恢复
│       │   │   ├── useDisplayState.ts    # 主题/侧栏/显示开关/缩放/窗口状态 + 菜单状态同步
│       │   │   ├── useEditorRuntime.ts   # 编辑器实例生命周期
│       │   │   ├── useEditing.ts         # 格式化/撤销重做/粘贴/复制导出
│       │   │   ├── useFindReplace.ts     # 查找替换
│       │   │   ├── useSourceTableContext.ts # 源码模式表格上下文
│       │   │   ├── useSourceHistory.ts   # 源码模式撤销栈
│       │   │   └── useMenuBridge.ts      # 原生菜单动作分发（分发表只构造一次）
│       │   ├── App.tsx           # 根组件（编排 hooks + 布局 + 状态栏提示）
│       │   ├── ErrorBoundary.tsx # 渲染层异常兜底（避免整窗白屏）
│       │   ├── constants.ts      # 渲染层小常量（避免入口静态依赖编辑器内核）
│       │   ├── Sidebar.tsx       # 左侧文件树 / 大纲面板
│       │   ├── menuHandlers.ts   # 原生菜单动作分发表（纯函数）
│       │   ├── sourceActions.ts  # 源码模式格式化（纯函数，含表格增删行列）
│       │   └── Dialogs.tsx       # 查找/快速打开/重命名/字数统计/大纲浮层
│       ├── test/             # 自动化测试（run-unit.cjs + unit.ts / run-e2e.cjs / e2e.cjs / menuRuntime.cjs / menuAccelerators.cjs）
│       ├── build/            # 应用图标（icon.svg/png/icns）
│       └── electron-builder.json  # 打包配置（官方识别文件名）
├── packages/
│   ├── editor/               # Milkdown 编辑器封装
│   │   ├── index.ts          # 出口转发（只 re-export）
│   │   ├── instance.ts       # createEditor + 命令分发
│   │   ├── commands.ts       # 自定义 ProseMirror 命令（行操作/表格/片段插入）
│   │   ├── selection.ts      # 光标表格上下文监听插件
│   │   ├── types.ts          # FormatAction / EditorInstance / TableContext
│   │   ├── highlight.ts      # Shiki 高亮初始化
│   │   ├── underline.ts      # <u> 下划线 mark
│   │   ├── frontmatter.ts    # YAML Front Matter 节点
│   │   ├── stringify.ts      # remark-stringify handler 汇总
│   │   └── decorations.ts    # 警告框 / [TOC] 目录渲染装饰
│   ├── markdown-core/        # 解析/序列化/大纲（纯函数）
│   ├── theme/                # 主题系统（design tokens）
│   └── shared/               # 跨进程共享类型（IPC 契约）+ 纯函数工具（text.ts：编码/路径/文本）
├── .github/workflows/        # CI 打包（macOS x64+arm64 / Windows x64）
├── docs/                     # 文档（技术方案、设计规范）
└── package.json              # npm workspaces
```

## 6. 代码风格

- **命名规范**：
  - 类型 / 接口 / 组件：`PascalCase`（如 `UserManager`、`EditorView`）
  - 函数 / 方法 / 变量：`camelCase`（如 `getUserById`、`docTitle`）
  - 常量：`UPPER_SNAKE_CASE`（如 `MAX_ATTEMPTS`）
  - 文件名：组件用 `PascalCase`，普通模块用 `camelCase` 或 `kebab-case`
- **缩进**：2 个空格（前端/TS 惯例），禁止 Tab。
- **文件长度**：单文件不超过 500 行，复杂逻辑拆分为多个模块。
- **注释**：
  - 输出代码时增加**清晰的中文注释**。
  - 每个公共函数、类、方法、自定义 Hook 都需中文注释，说明用途、关键参数、返回值。
  - 复杂算法、非显而易见的逻辑必须注释「为什么」而非「是什么」。
- **类型**：开启 TypeScript 严格模式，避免 `any`，公共 API 必须有明确类型标注。

## 7. Electron 安全基线（必做）

- 开启 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- 渲染进程禁用 `remote`，所有原生能力经 `contextBridge` 暴露的白名单 API。
- 只加载本地资源，**不加载任何远程内容**；`CSP` 限制 `script-src 'self'`，并保持
  `object-src 'none'` / `base-uri 'self'` / `form-action 'none'`；`img-src` 额外放行 `file:` 供本地图片显示。
- 所有文件 I/O 走主进程，渲染进程不直接碰文件系统。

## 8. 功能更新记录（CHANGELOG.md）

- 变更记录文件名固定为 **`CHANGELOG.md`**（全大写，位于仓库根目录）。
- **重要功能更新必须记录到 `CHANGELOG.md`**。
- 后期编写整体功能说明时，必须参考该文件。
- 记录格式：日期 + 功能点摘要 + 影响范围。

## 9. 版本管理

- 每次功能更新完成后，同步更新以下位置的版本号：
  1. 根 `package.json` 的 `version` 字段。
  2. `apps/desktop/package.json` 的 `version` 字段。
  3. `package-lock.json` 中的 **顶层 `version`、`packages[""].version`、`packages["apps/desktop"].version` 三处**
     （只改这三处，**不要全局替换**：`@pkgjs/parseargs@0.11.0`、`retry@0.12.0` 这类第三方包版本号可能与项目版本号相同）。
  4. `CHANGELOG.md` 记录本次更新摘要。
- 版本号格式：`主版本.次版本.修订号`（如 `1.2.1`）。
  - 主版本：重大架构变更或里程碑功能
  - 次版本：新增功能模块
  - 修订号：Bug 修复、小优化

## 10. 网络搜索

- 需要联网搜索时，使用可用的 Web 搜索能力（如 WebSearch / domain_search）。

## 11. 时区

- 本应用为纯本地工具，涉及时间展示时，直接使用**用户本地时区**（东八区）展示，不做 UTC 转换。
- 若未来涉及跨时区数据，再统一约定存储格式。

## 12. 关键设计决策（已确认，不可随意推翻）

| # | 决策 |
|---|------|
| 1 | 图片粘贴：存到文档同级 `img/` 目录，Markdown 用相对路径 `img/xxx.png` 引用（文档 + img 目录整体可移植） |
| 2 | 数学公式：v1.1 引入（不在第一版） |
| 3 | 自动更新：不做 |
| 4 | 中文输入法（IME）：需专项适配，M1 纳入 |
| 5 | 编辑体验：WYSIWYG 所见即所得（Milkdown） |
| 6 | 视觉：现代极简，动效克制（CSS 过渡），去 AI 味 |
| 7 | 包管理器：npm workspaces（已从 pnpm 迁移） |
| 8 | 编辑器实例：多标签页采用「单实例 + 切换内容」架构 |
| 9 | 分发：CI 打包 macOS（x64 + arm64）dmg + Windows x64 安装包 |
| 10 | 顶部导航：macOS 原生应用菜单 + 标签栏右侧动作区，窗口内不保留独立功能顶栏 |
| 11 | 原生菜单只保留「文件/编辑/段落/格式/显示」五组；主题走右上角按钮，不设主题/窗口/帮助菜单 |
| 12 | 菜单勾选项由渲染层经 `menu:state` 同步到主进程，主进程重建菜单；动作经 `menu:action` 白名单转发 |
| 13 | 格式化命令 WYSIWYG 走 ProseMirror，源码模式走 `sourceActions.ts`，两者共用同一 MenuAction 分发入口 |
| 14 | 非 CommonMark 语法（下划线、YAML Front Matter、`[TOC]`、`> [!NOTE]`）通过自定义 remark 插件 / Milkdown 节点 / 装饰器实现，不在文本层做字符串替换 |
| 15 | 撤销/重做：WYSIWYG 走 ProseMirror history 命令，源码模式用自建快照栈。**不用** Electron 的 `role: 'undo'`——它作用于 DOM，对 ProseMirror 完全无效 |
| 16 | 「显示」菜单的窗口项（置顶/全屏/最小化）一律用自定义菜单项，**不用**系统 `role`（`togglefullscreen` / `minimize`）：role 会被 macOS 再注入一份系统项导致「全屏」重复，且带图标使文字与其他项不对齐 |
| 17 | 菜单项要与真实能力对齐：做不到的删除，重复的合并，无磁盘路径时不可用的项按 `MenuViewState.hasPath` 置灰 |
| 18 | 上下文相关的菜单项（表格增删行列）按 `MenuViewState.inTable` / `inTableHeader` 置灰：WYSIWYG 由 ProseMirror 插件上报，源码模式按 textarea 光标所在行推断，上报前先去重，避免每次按键重建原生菜单 |
| 19 | 表格必须保留表头：删除表头行 = 移除旧表头 + 首个数据行升级为表头；**必须整表重建后一次替换**，不能分「删表头 + 提升新表头」两步（两步会让文档短暂非法，后续坐标错位） |
| 20 | 缩放用 `setZoomFactor` + 固定档位（50%…300%），当前百分比随 `MenuViewState.zoomPercent` 同步到菜单与状态栏；不要用 `setZoomLevel` 的浮点步进（会出现 110%、132% 之类怪比例） |
| 21 | 自动化测试直接加载构建产物（`out/main/index.js`）跑真实主进程，经 `menu:action` 通道派发动作；修改菜单/表格/缩放行为后必须跑 `npm test` |
| 22 | 用户偏好持久化到 `userData/settings.json`（主题 / 侧栏 / 标签栏 / 工具栏 / 缩放 / 窗口尺寸），主进程 `settings.ts` 读写、300ms 防抖、退出前强制落盘；渲染层启动后拉取应用，读取前不得回写默认值 |
| 23 | 编辑区是纵向 flex 占位布局：`.editor-wrap`（查找栏 / `.editor-scroll` 滚动区 / 工具栏），工具栏与查找栏都固定成行、**不覆盖内容**；不要再改回 `position:absolute` 浮动（正文会从其下方穿过）。E2E 有「工具栏不与编辑内容区重叠」断言守门 |
| 39 | 命名对话框复用 `RenameDialog`，用 `title` 区分「新建文件」与「重新命名」；新建文件走 `createFile(root, name)`（补 `.md`、清非法字符、重名加序号），重命名走 `renameFile`（未写扩展名时沿用原扩展名，避免产出无后缀文件）。侧栏搜索的三个开关必须和输入框同一行（E2E 有同行断言） |
| 23 | 拖拽取文件真实路径必须走 preload 暴露的 `webUtils.getPathForFile`：Electron 32+ 的 `File` 已不再带 `path` 属性 |
| 24 | 源码模式表格上下文必须覆盖程序化 `setSelectionRange`（不派发任何事件）：监听 `selectionchange` + 200ms 低频轮询兜底，hook 内先去重再上报，避免反复重建菜单 |
| 25 | 菜单快捷键验证分三层：`menuAccelerators.cjs` 静态校验写法/唯一性/平台关键键位，`menuRuntime.cjs` 校验真实菜单注册与 click→动作派发，CI 的 Windows runner 实跑前两层。`sendInputEvent` 注入的按键不会触发原生菜单 accelerator，别用它做快捷键断言 |
| 26 | 表头删除语义保留「删旧表头 + 首个数据行升级为表头」（GFM 表格必须有表头），但菜单文案标注「（表头）」并给 macOS 悬停说明，避免用户以为会删整表 |
| 27 | CI 新增独立 `test` job：macOS 跑完整 `npm test`，Windows 跑单元测试 + 静态检查 + 菜单运行时校验；测试 job 不设 `needs`，不会阻塞 Release 上传 |
| 28 | 会话恢复只持久化**路径**（`settings.lastSession`），不存未落盘文档的内容：内容保存是退出确认的职责，设置文件不做隐式草稿 |
| 29 | 关闭窗口前必须问渲染层要「未保存汇总」（`app:unsaved-ask` / `app:unsaved-reply`），只有「无路径且有改动」才拦人；确认后先 `app:flush-before-close` 立即写盘再关 |
| 30 | 编码识别顺序固定为 BOM（UTF-8/UTF-16LE/BE）→ 严格 UTF-8 → GBK；保存统一写 UTF-8（`TextEncoder` 无法编码 GBK/UTF-16），带 BOM 的保留 BOM，并同步标签编码 |
| 31 | 编辑器内核必须动态 `import`：入口 chunk 只留壳与文档状态（当前 ~0.59 MB），编辑器作为独立 chunk 按需加载；渲染层不要从 `@ai-md-editor/editor` 直接导入**值**（`NO_TABLE_CONTEXT` 放在 `renderer/constants.ts`） |
| 32 | 外部修改监听由渲染层按「当前活动文档」登记（`fs:watch` / `fs:unwatch`）；主进程自身写盘前 `markSelfWrite`，1.5s 宽限期内忽略事件，否则会出现「自己保存后提示文件被修改」 |
| 33 | 原生菜单重建前比较 `MenuViewState` 签名，未变化直接跳过；`useMenuBridge` 的分发表只构造一次并用代理读取最新回调 |
| 34 | 导出公式渲染：`extractMath` 先把 `$...$` / `$$...$$` 换成占位符再交给 marked（防止 TeX 里的 `*`/`_` 被当 Markdown），渲染后用 KaTeX 还原；代码段用掩码保护；`katex.min.css` 与 woff2 字体 data URI 内联（仅含公式的文档才嵌入）；Word 保留 TeX 原文 |
| 35 | 侧栏是纵向 flex：树区/大纲区自身滚动（`flex:1; min-height:0; overflow-y:auto`），`.sidebar` 本身 `overflow:hidden`；「打开文件夹」固定在底部，不要移回顶部 |
| 36 | 主题按钮是**单击直接切换**浅色/深色（不做下拉选择），写回 `settings.themeId` 并同步 `data-theme` |
| 37 | 侧栏搜索在主进程执行（`main/searcher.ts`）：渲染层只发 `search:folder` IPC；扫描跳过 node_modules/.git/隐藏目录/img，单文件 2MB、结果 50 文件/每文件 20 行上限；行匹配器是纯函数（`buildLineMatcher`，可单测），全单词用第 1 个捕获组修正列与长度 |
| 38 | 文件树 ⋮ 菜单依赖 `rootDir`（未打开目录不显示）；「刷新」走 `refreshToken` 计数信号驱动 FileTree 重读**所有已展开目录**（不只根目录），否则深层的新建/改名会留在树里显示旧名字 |
| 40 | 所有输入框的 Enter 都要先判输入法组合态（`renderer/ime.ts` 的 `isImeKey` + `compositionstart/end` 记录）：中文输入法用 Enter 上屏时 `keydown` 也带 `Enter`，不判会让改名/搜索用到还没上屏的拼音 |
| 41 | 重命名语义：有路径走 `renameFile`（同目录改名、未写文本扩展名沿用原扩展名、**目标已存在直接报错不覆盖**、大小写改名放行）；无路径的未命名标签只改标签名，不再中途弹「另存为」。改名成功必须补写未保存改动到新路径并刷新文件树；失败要在状态栏给出原因并保留对话框 |
| 42 | 搜索匹配同时带两个列号：`column` 是裁剪缩进后的展示列（高亮用），`rawColumn` 是原始行列（源码模式定位用）。缩进行如果按 `column` 定位光标，会偏到缩进之前；WYSIWYG 侧按行号估算位置后挑最近的片段，不能直接 `indexOf` |
| 43 | 导出 HTML/PDF/Word 必须把文档内的本地图片内联为 data URI（`main/exportAssets.ts`）：`img/xxx.png` 是相对文档的路径，导出文件换目录就全裂；单图 8MB、总量 30MB 上限，读不到或超限保持原样 |
| 44 | 主进程必须 `app.requestSingleInstanceLock()`，否则 `second-instance` 事件永远不触发，二次启动会另起进程、文件也开不到已有窗口 |
| 45 | 斜杠菜单（`packages/editor/src/slash.ts`）是自包含 ProseMirror 插件：触发要求光标在文本块、无选区、不在代码块/行内代码，且「/」前一字符不是字母数字/冒号/斜杠（防网址、路径误弹）；确认时先删「/过滤词」再统一走 `format()`（实例经 `formatRef` 延迟接线，不能用 callCommand 直调——插件内拿不到 Milkdown 上下文）；面板 mousedown 必须 preventDefault，否则编辑器 blur 先把菜单关掉；**面板必须挂在 `.app` 下**——主题 CSS 变量经 React style 注入在 `.app` 上，挂 body 下 `var(--bg-panel)` 解析失败会变透明底 |
| 46 | 表格二级行列网格：`format('insertTable', '列数x行数')` 由 `instance.ts` 的 `buildTableSnippet` 动态构造片段（上限 10×20，默认 3×3）；子面板随主面板同挂 `.app`，**点行尾的 › 才展开、再点收起**（悬停不做任何事），键盘 Enter 展开后 ↑↓←→ 调行列、Esc 先收回子面板再关菜单 |
| 47 | E2E 用 `sendInputEvent` 注入方向键时 keyCode 必须用 Chromium 键名 `Down`/`Up`/`Left`/`Right`——写 `ArrowDown` 会被静默忽略（无报错、无效果），排查注入「没生效」先查键名 |
| 48 | 任务列表不启用 Milkdown 的 Vue 列表组件（`@milkdown/components/list-item-block`），复选框由 CSS 依据 `li[data-item-type="task"]` / `[data-checked]` 自绘，点击勾选在 `packages/editor/src/task.ts` 插件里做（mousedown 落在 li 左 padding 区才拦截）；任务项里 Enter 须重置新条目 `checked=false`（splitListItem 会原样复制勾选态），空条目 Enter 清 checked 退出任务态 |
| 49 | E2E 里 `getBoundingClientRect` 返回 CSS 像素而 `sendInputEvent` 走 DIP 坐标，窗口 zoomFactor 非 1 时坐标注入按比例错位——任何改过 zoomPercent 的用例结束必须恢复 100%，否则后续窄目标点击（复选框、格子）稳定失败且宽目标（段落）带病通过 |
| 50 | 斜杠菜单的链接二级表单是唯一允许焦点离开编辑器的浮层：面板 mousedown 只对**非输入框**元素 preventDefault；表单展开期（`formOpen`）编辑器 blur 不作为关闭信号，改靠 document 捕获阶段的 mousedown 关闭（点面板外整体收起）。其余浮层（菜单 / 网格）仍整体 preventDefault |
| 51 | 斜杠菜单「图片」条目走 `onPickImage` 回调（`SlashMenuOptions` ← `CreateEditorOptions` ← `MarkdownEditor` ref 转发 ← 渲染层 `chooseImage`）：原生文件对话框无法自动化，E2E 尝试给 `window.api.chooseImage` 打桩，contextBridge 对象只读导致桩不上时**跳过点击**而不是硬等（原生对话框会卡死测试进程） |
| 52 | E2E 斜杠用例的锚点段落会被块级插入（表格片段）吞进单元格：后续用例若继续点首个 `p`，光标落在「列 1」单元格里，「/」前一字符是数字按设计不触发菜单——「最近使用」等用例要**单独开新文档**，别在插过表格的文档里复用首段锚点 |
| 53 | **本地 electron-builder 打包会改写 `apps/desktop/package.json`**：剥掉全部 `scripts` 与 `devDependencies`（只留生产依赖），打包后必须 `git checkout -- apps/desktop/package.json` 恢复，否则 `npm run build` / `npm test` 直接报 Missing script |
| 54 | 链接打开走「⌘/Ctrl + 点击」（`packages/editor/src/link.ts`）：普通单击保留光标定位；平台判定用 `navigator.userAgent`（沙箱渲染进程没有完整 process）；主进程 `shell:open-external` 只放行 http/https（渲染内容可被任意文档注入）；E2E 在主进程侧替换 `shell.openExternal` 收集调用即可断言（与 `dialog` stub 同理，别在 renderer 侧桩 contextBridge） |
| 55 | E2E 断言 DOM 元素别假设「第一个匹配」等于「先插入的」：行内 snippet 插入会拆/并段落，多个同类元素的 DOM 顺序与插入顺序不保证一致，按文本 / href 等内容特征精确匹配目标 |
| 56 | 编辑器内链接「⌘/Ctrl + 点击打开」必须拦在 **mousedown**：放到 click 再 preventDefault 就晚了——macOS 上修饰键点击的默认行为在 mousedown 阶段已让 ProseMirror 建出 NodeSelection（整段 `ProseMirror-selectednode` 描边框 + 文字选区，打开后残留）。另外 `getComputedStyle().outlineWidth` 在 `outline-style: none` 时也报非零值，截图诊断别把它当真边框来源 |

### 14.1 扩展语法的实现位置（改动前务必先读）

| 语法 | 实现文件 | 要点 |
|------|----------|------|
| `<u>…</u>` 下划线 | `packages/editor/src/underline.ts` | remark 折叠 html 节点 + mark schema + stringify handler |
| YAML Front Matter | `packages/editor/src/frontmatter.ts` | `$remark(..., 'yaml')` 必须传第三个参数 `initialOptions`，否则 remark-frontmatter 抛 `Missing type in matter {}` |
| 序列化 handler 汇总 | `packages/editor/src/stringify.ts` | `underline` / `yaml` / `text` 三个 handler 统一注册；`text` 仅放行 `[TOC]` 与 `[!NOTE]` 的方括号 |
| 警告框 / 目录渲染 | `packages/editor/src/decorations.ts` | 纯 ProseMirror 装饰，不改 Markdown 文本；目录块在文档变化时重建 |
| 大纲解析 | `packages/markdown-core/src/index.ts` | 必须启用 remark-frontmatter，否则文件头 `---` 会被当 Setext 标题 |
| 片段插入 | `packages/editor/src/commands.ts` `insertSnippet` | 行内片段替换选区；块级片段插到当前顶层块之后（空段落直接替换），否则定义类节点会拆坏段落 |
| 表格行/列增删 | `packages/editor/src/commands.ts` | 删行：正文行直接删，表头行整表重建；删列：`table_row` 与 `table_header_row` 都要遍历 |
| 表格上下文上报 | `packages/editor/src/selection.ts` | ProseMirror 插件监听选区变化，仅在「是否在表格/表头」变化时回调；编辑器创建时先上报一次 |
| 图片显示路径解析 | `packages/editor/src/images.ts` | 只改 DOM 的 `src`（转绝对 `file://`），Markdown 节点属性保持相对路径；切标签时 `setImageBaseDir` 重新解析 |
| 图片落盘 | `apps/desktop/src/main/ipc.ts` `saveImageToDocDir` | 传文档绝对路径，主进程 `dirname` 算同级 `img/`；**禁止**在渲染层拼相对目录（空目录会写到进程 cwd） |
| 设置持久化 | `apps/desktop/src/main/settings.ts` | `loadSettings()` 启动读入内存、`updateSettings()` 防抖写盘、`flushSettings()` 退出前落盘；字段做了越界与损坏校验；`lastSession` 只保留非空路径且最多 40 条 |
| 会话恢复 | `renderer/hooks/useTabs.ts` | 挂载时读设置 → 逐条 `readPathQuiet`（失败静默跳过）→ 替换标签并选中 `activePath`；`sessionReady` 之前禁止回写，否则默认标签会覆盖上次会话 |
| 关闭前确认 | `main/window.ts` `confirmClose` | `close` 事件先 `preventDefault`，向渲染层要汇总；确认后发 `app:flush-before-close` 并等待 120ms 再真正 `close()` |
| 编码识别 | `packages/shared/src/text.ts` | `decodeBytes` 按 BOM → 严格 UTF-8 → GBK；`writeEncoding` 除 BOM 外统一 UTF-8；主进程读写都走这两个函数 |
| 外部修改监听 | `main/fileWatcher.ts` | 按文件登记 watcher，250ms 去抖、自身写入 1.5s 宽限；`rename` 事件后重建 watcher（保存常是「写临时文件 + rename」） |
| 编辑器动态加载 | `renderer/MarkdownEditor.tsx` | `await import('@ai-md-editor/editor')`，卸载时判 `disposed` 后销毁；加载期间渲染 `.editor-loading` 占位 |
| 文件树无障碍 | `renderer/FileTree.tsx` | 条目为 `<button>`（Enter/Space 生效），容器 `onKeyDown` 处理 ↑↓←→/Home/End，`data-depth` 用于「回父级」 |
| 自动保存范围 | `renderer/hooks/useTabs.ts` | 防抖到点写入**所有**「有路径且 dirty」的标签，按内容快照清 dirty；只写当前标签会在切标签时丢稿 |
| 打开文件校验 | `apps/desktop/src/main/ipc.ts` `readTextFile` | 先 `stat`：> 20 MB 或含 NUL 字节（二进制）直接拒绝并弹窗说明；不要静默返回「已取消」 |
| 拖拽取路径 | `apps/desktop/src/preload/index.ts` | `getPathForFile(file)` = `webUtils.getPathForFile`；渲染层据此区分 图片 / 文件夹 / 文档 |
| 导出公式 | `main/mathExport.ts` + `main/export.ts` | 提取/还原纯函数（可单测）；块级公式先于行内提取；`throwOnError:false` 下非法 TeX 渲染成 `katex-error` 标记而非抛异常 |
| 侧栏搜索 | `main/searcher.ts` + `renderer/SidebarSearch.tsx` | 主进程扫描返回按文件分组的匹配（行/列/长度）；面板 300ms 防抖自动搜索；点击结果经 App 的挂起跳转定位（源码模式设光标，WYSIWYG 用 `selectTextRange`） |

> 变更上述决策需先与用户确认，不得擅自调整。

### 14.2 菜单动作实现要点（踩坑记录，改动前先读）

| 问题 | 原因 | 正确做法 |
|------|------|----------|
| `Cmd+Z` 无效 | 从未 `use(history)` 注册 Milkdown 历史插件 | `packages/editor/src/instance.ts` 里 `.use(history)`，菜单项调 `undoCommand` / `redoCommand` |
| 「全屏」出现两次 | `role: 'togglefullscreen'` 与 macOS 注入的系统项并存 | 改为自定义 item，调 `win.setFullScreen(!win.isFullScreen())` |
| 底部三项不对齐 | `role: 'minimize'` 由系统加图标与额外缩进 | 三项（置顶/全屏/最小化）全部自定义，样式与上方菜单一致 |
| 「上移该行」在引用块内失效 | `$from.index(1)` 取的是父容器内序号 | 取文档顶层块用 `$from.index(0)` |
| 删除表格列无反应 | 只处理 `table_row`，漏掉 `table_header_row`，列数不一致被 prosemirror-tables 自动补齐 | 两种行类型都要遍历 |
| 删除表头行后表头被清空、凭空多一行 | 事务里「先删表头行、再 replaceWith 提升新表头」，中途文档违反「表格必须以表头行开头」的内容表达式，第二步坐标错位 | 按新的行序列构造整张表，`replaceWith` 一次替换（见 `commands.ts` `deleteTableRow`） |
| 表格菜单项不按上下文置灰 | 光标上下文从未同步到主进程 | 编辑器插件 + 源码模式行判断 → `MenuViewState.inTable` / `inTableHeader` |
| 插入图片失败 / 图片落到奇怪位置 | 渲染层传「文档目录」，未保存文档传空串，主进程 `join('.', 'img')` 写到进程 cwd（打包后不可写） | 传文档绝对路径，主进程 `dirname` 计算；无路径先另存为 |
| 粘贴的图片在编辑器里不显示 | `<img src="img/x.png">` 按渲染页基址解析到应用目录 | 插件把 `src` 换成绝对 `file://`，文本仍是相对路径；CSP `img-src` 放行 `file:` |
| 拖拽文件毫无反应 | 旧代码读 `File.path`，Electron 32+ 已移除该属性 | 改用 preload 的 `webUtils.getPathForFile` |
| 偏好每次启动都丢失 | 设置只存在渲染层内存 | 主进程 `settings.json` 持久化，启动读取、变更防抖写盘 |
| `npm test` 报 `bad option: --no-sandbox` | 宿主终端注入 `ELECTRON_RUN_AS_NODE=1` / `NODE_OPTIONS`，Electron 退化成 Node，把开关当 Node 参数 | 由 `test/run-e2e.cjs` 派生子进程时剔除这两个变量，不要写进 npm script 的 `env -u`（不跨平台） |
| E2E 缩放/表格断言莫名错位 | 固定 profile 里 Chromium 记住了上次运行的页面缩放，点击坐标随之偏移 | 每次运行前清空测试专用 `userData`；渲染层启动时无条件 `setZoom(settings.zoomPercent)` 纠正漂移 |
| 图片文件名混入路径片段 | 用 `路径.split('.').pop()` 取后缀，目录名含点或文件无后缀时会拿到非法值 | `extname` + 扩展名白名单，非法值统一回退 `.png` |
| 程序化定位光标后表格菜单没刷新 | `setSelectionRange` 不派发 `select`/`keyup`/`click`，原实现只监听这三种事件 | `document` 的 `selectionchange` + 200ms 轮询兜底，变化才上报 |
| 用 `sendInputEvent` 测快捷键毫无反应 | 注入的按键只进渲染层输入管线，不经过原生菜单的 accelerator 分发（实测 Cmd+Z 不触发） | 改为 `MenuItem.click()` 验证派发链路；OS 级按键手感留给真机 |
| CI 的 Windows job 命令报错 | PowerShell 把 `--workspace @ai-md-editor/desktop` 里的 `@` 当 splatting | workspace 名一律加双引号 |
| 升版本后第三方依赖版本被误改 | 全局替换 lock 里的版本号，命中 `retry@0.12.0` 等同号第三方包 | 只精确改 lock 顶层 `version` 与两个 workspace 条目 |
| CI 上「窗口尺寸写入设置文件」断言失败 | 硬编码请求值 `1000×700`，macOS runner 工作区较小会裁剪成 `1000×684` | 与 `win.getBounds()` 实际值比对，请求值只做容差检查 |
| Intel job 打 dmg 偶发 `hdiutil detach` 失败（exit 16） | runner 上磁盘镜像卸载冲突，非代码问题，重试 5 次仍可能失败 | `gh run rerun --failed` 重跑失败 job，或等下次 push 重新触发 |
| 敲完立刻切标签，改动没落盘 | 自动保存只写「当前活动标签」，切走后计时器被清理且不再重排 | 防抖到点遍历所有 `path && dirty` 的标签批量写入 |
| 拖入二进制/超大文件后窗口卡死 | `readFile(path, 'utf-8')` 无体积与类型校验，几百 MB 直接进内存 | 打开前 `stat` 校验体积上限，内容含 NUL 视为非文本 |
| 大文档导出 PDF 得到空白页 | 用 `data:text/html,<整篇 HTML>` 导航，超过 Chromium 的 URL 长度上限 | 先写临时 HTML 文件再 `win.loadFile`，导出后删除 |
| Windows 图片显示不出来 | `encodeURIComponent` 把盘符编成 `C%3A`，`file:///C%3A/...` 不是合法地址 | 盘符段（`/^[A-Za-z]:$/`）跳过编码 |
| 启动后上次会话被示例文档覆盖 | 恢复是异步的，默认标签先写入 `lastSession` 就会顶掉真实会话 | 恢复完成前 `sessionReady=false`，期间禁止回写；恢复后整体替换标签而非追加 |
| 自己保存后立刻提示「文件被外部修改」 | `fs.watch` 把自身写入也当成外部变更 | 主进程写盘前 `markSelfWrite`，1.5s 宽限期内忽略事件 |
| 外部改动只提示一次，之后不再触发 | 编辑器保存是「写临时文件 + rename」，watcher 盯着旧 inode | 收到 `rename` 事件后关闭并重建 watcher |
| 关闭窗口的 E2E 断言偶发失败 | 关闭前多了异步询问流程，固定 sleep 不够 | 用 `waitFor` 等窗口真正消失（本次已改）；不要在有 dirty 未命名标签时关窗（会弹系统对话框阻塞测试） |
| GBK 文档保存后变乱码 | 用 `TextEncoder` 原样写回 GBK 是不可能的（只支持 UTF-8） | 保存统一转 UTF-8，并把标签编码与状态栏同步更新为 UTF-8 |
| 导出 PDF 公式显示成 `$...$` 原文 | marked 不认识 TeX，`$...$` 原样输出且 TeX 里的 `*`/`_` 还会被当 Markdown 改写 | 导出前用 `extractMath` 换占位符，marked 后用 KaTeX 还原；代码段掩码保护；CSS+字体 data URI 内联（`main/export.ts`） |
| 冒烟脚本里 `require.resolve('katex/...')` 报找不到 | `require.resolve` 相对**模块文件位置**解析，/tmp 下的脚本解析不到项目 node_modules（真实主进程产物在项目内，不受影响） | 冒烟脚本用 `NODE_PATH=<项目>/node_modules` 或放到项目目录内运行 |
| E2E 后段搜索/⋮ 菜单断言莫名失败 | 编码测试打开过别的目录的文档，`treeRoot` 被切到 tmpdir，搜索扫不到测试目录 | 测试前重新 stub `dialog.showOpenDialog` 返回测试根目录并点击 `.filetree-open-btn`；断言「落盘」要用 `waitFor` 轮询而不是单击后立即 `existsSync` |
| 编辑器内行内公式上标顶进上一行 | KaTeX 默认 1.21em，行内公式的上标/根号高度超过 1.75 行距的行框 | `.katex` 压到 1.05em，含公式的行用 `:has([data-type='math_inline'])` 放大行距（`global.css`） |
| 入口 chunk 3 MB，冷启动慢 | 入口静态 `import` 了编辑器包（含 Milkdown/Shiki/Mermaid/KaTeX），连 `NO_TABLE_CONTEXT` 这种小常量都会把整包拉进来 | 编辑器改为 `await import(...)`；渲染层常量放 `constants.ts`，只从编辑器包导入**类型** |
| 纯函数单测在 Windows CI 跑不起来 | 直接用 Node 跑 `.ts` 依赖运行器/版本 | `test/run-unit.cjs` 用 esbuild（随 vite 安装）打包成 CJS 再执行 |
| 只有竖线的普通段落被当成表格 | `findTableBlock` 只检查行首 `\|`，没要求 GFM 分隔行 | 第二行必须是合法分隔行（`isTableSeparator`），否则不算表格 |
| 文档末尾是表格/代码块时，下方点不进去、写不了字 | ProseMirror 在最后一个块之后没有合法文本位置；代码块虽然是 textblock，但它是封闭块，Enter 换不出普通段落 | `packages/editor/src/trailing.ts` 在末尾补一个空段落：非 textblock 或 `type.spec.code === true` 的块都补，标题/正文/引用/列表不补；补段落只用尾部空白差异，`handleChange` 不置 dirty |
| 列表项开头按退格会并进上一行，删不回文档最前面 | 退格走基础键位表的 `joinTextblockBackward`，对列表项就是「与上一项合并」 | `listBackspace.ts` 用 `$shortcut` 注册 `Backspace` 且 `priority: 80`（高于基础键位表 50 才能抢先）；摘项变段落、剩余项靠 `order` 续号；连续退格靠插件状态 `MDNOTE_LIST_UNLIST_PENDING` 继续拆上方列表，打字/移光标即失效；嵌套列表先 `liftListItem` 降级 |
| 斜杠菜单里表格的行列网格「鼠标很难选不中格子」 | 曾经做成悬停「表格」就展开、悬停别处就收回：网格跟着指针闪，指针从条目滑向格子途中稍一偏移就被收回，格子几乎点不中 | 改成**点和链接一样的显式点击**：只监听 `click`，不监听 `mouseover`/`mouseleave`；点行尾 `.slash-item-arrow` 展开、再点收起（点行内其它位置只展开，不误插 3×3）；网格水平按**整个菜单**的右边缘定位（菜单右侧那一列条目不会压住格子），垂直与点的那一行对齐；行元素必须带 `data-slash-id` 才能做定位锚点 |
| 公式编辑态需要一个「帮助文档 + 确定」的底部条 | 公式是 atom 节点，自绘 NodeView，没有现成的编辑器外壳 | `mathView.ts` 里给块级公式加 `.md-math-footer`：左侧链接走 `configureMathView({ openLink })` 注入的外部打开通道（`shell:open-external` 白名单），右侧「确定（⌘ / Ctrl + Enter）」点击即 `commit()`；行内公式不加（空间不足） |
| 公式插入后只有一个蓝色框、改不了 | 公式插件的 `math_inline` / `math_block` 是 **atom** 节点，只有 `toDOM` 渲染 KaTeX，没有编辑界面；点击只能拿到 NodeSelection | `mathView.ts` 提供 NodeView：点击换成文本框编辑原始 TeX、失焦或 ⌘/Ctrl+Enter 提交、Esc 取消、清空即删除；行内写节点文本、块级写 `attrs.value`；插入公式时经 `requestMathAutoEdit()` 自动进入编辑；刚展开 250ms 内的 blur 只重新聚焦（否则点开就被抢焦点关掉） |
| 编辑行内公式提交后段落被切成两段、源码里多出 `&#x20;` | 回车/退格分支只 `preventDefault()` 没 `stopPropagation()`，事件冒泡到键位链，`baseKeymap` 的 Enter → `splitBlock` 在公式后面分段；`preventDefault()` 对 `cancelable=false` 的合成事件无效，所以偶发 | `mathView.ts` 两个提交分支都补 `stopPropagation()`；`stopEvent()` 对键盘事件无条件返回 `true`（提交后 `editing` 已为 `false`，只按编辑态判断会漏掉仍在传播的那次按键） |
| 改完内容立刻切源码/切标签，改动丢失 | 编辑器 → 标签状态的回写走 Milkdown 变更监听，**200ms 防抖**；切模式/切标签/关标签会卸载编辑器，监听 destroy 时 `debouncedHandler.cancel()`，那次回写被取消 | 新增 `EditorInstance.flushMarkdown()`（`serializerCtx` 同步序列化当前 doc），切模式、切标签、关标签、保存 / 另存为 / 全部保存前先 flush，不能用带缓存的 `getMarkdown()` |

## 13. 开发交付约定（用户明确要求，必须遵守）

1. **测试**：每完成一个功能，都必须做一遍测试（类型检查 `tsc --noEmit` + 构建 `npm run build` + 功能验证）。受沙箱限制无法跑 GUI 时，明确告知用户需在系统终端验证的具体步骤。
   - 改到菜单 / 表格 / 缩放 / 剪贴板 / 文件树 / 编码 / 文件读写行为时，跑 `npm test`
     （`test/unit.ts` 纯函数单测 → 静态快捷键校验 → `test/menuRuntime.cjs` 真实菜单校验 → `test/e2e.cjs` 端到端）。
   - Electron 测试统一由 `test/run-e2e.cjs` 启动（可传脚本名复用），会自动剔除宿主注入的 `ELECTRON_RUN_AS_NODE` / `NODE_OPTIONS`；无需再手动 `env -u`。
   - 纯函数（编码、路径、文本、源码格式化）优先补 `test/unit.ts`：不需要 GUI、跑得快，Windows CI 也能覆盖。
   - 改快捷键后除 `npm test` 外，还要确认 CI 的 Windows `test` job 通过（平台专属键位与动作绑定只在 Windows runner 上实跑）。
2. **文档同步**：开发功能的同时，同步更新 `README.md`（项目说明）、`AGENTS.md`（协作规范）与 `docs/` 下的设计与方案文档，不得等到最后一次性补。文档中如与实际实现不符（依赖未引入、主题数量、包管理器等），一并订正。
3. **提交前检查**（每次 `git commit` 前逐条确认）：
   - 文档已同步：`README.md`、`AGENTS.md`、`docs/*.md`、`CHANGELOG.md`；版本号四处一致（见第 9 节）。
   - 删除无用文件：构建临时配置（`electron.vite.config.*.mjs`）、`*.tsbuildinfo`、空的 `release/`、游离的测试产物与截屏、`.DS_Store`；`out/` 可整体重建后再构建，避免残留旧 chunk。
   - 全仓库检索确认无第三方产品名/品牌标识（含注释、界面示例文案、包描述）。
4. **CI 打包**：仓库需配置 GitHub Actions workflow，自动打包 **macOS（x64 与 arm64 两种架构的 dmg）** 与 **Windows（x64 安装包）**。

## 14. 参考文档

- `docs/技术方案文档.md` — 完整技术方案（架构/模块/WYSIWYG 方案/里程碑/风险）
- `docs/UI-UX设计规范.md` — UI/UX 设计规范（原则/去 AI 味清单/design tokens/动效/检查清单）
- `CHANGELOG.md` — 功能更新记录

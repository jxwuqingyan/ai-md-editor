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
│       ├── src/main/         # 主进程（窗口 window.ts、IPC、文件 I/O、最近文件、原生菜单 menu.ts）
│       ├── src/preload/      # preload 桥接（contextBridge 白名单 API）
│       ├── src/renderer/     # 渲染进程（React + Milkdown）
│       │   ├── hooks/            # 状态按职责拆分的自定义 Hook
│       │   │   ├── useTabs.ts            # 标签/文档/文件读写/自动保存
│       │   │   ├── useDisplayState.ts    # 主题/侧栏/显示开关/缩放/窗口状态 + 菜单状态同步
│       │   │   ├── useEditorRuntime.ts   # 编辑器实例生命周期
│       │   │   ├── useEditing.ts         # 格式化/撤销重做/粘贴/复制导出
│       │   │   ├── useFindReplace.ts     # 查找替换
│       │   │   ├── useSourceTableContext.ts # 源码模式表格上下文
│       │   │   ├── useSourceHistory.ts   # 源码模式撤销栈
│       │   │   └── useMenuBridge.ts      # 原生菜单动作分发
│       │   ├── App.tsx           # 根组件（编排 hooks + 布局）
│       │   ├── Sidebar.tsx       # 左侧文件树 / 大纲面板
│       │   ├── menuHandlers.ts   # 原生菜单动作分发表（纯函数）
│       │   ├── sourceActions.ts  # 源码模式格式化（纯函数，含表格增删行列）
│       │   └── Dialogs.tsx       # 查找/快速打开/重命名/字数统计/大纲浮层
│       ├── test/             # 自动化测试（e2e.cjs / menuAccelerators.cjs）
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
│   └── shared/               # 跨进程共享类型（IPC 契约）
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
- 只加载本地资源，**不加载任何远程内容**；`CSP` 限制 `script-src 'self'`。
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
  3. `package-lock.json` 中的 **root 与 `apps/desktop` 两条**（只改这两处，**不要全局替换**：第三方包版本号可能与项目版本号相同）。
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
| 1 | 图片粘贴：默认存相对路径 `assets/` 目录 |
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

## 13. 开发交付约定（用户明确要求，必须遵守）

1. **测试**：每完成一个功能，都必须做一遍测试（类型检查 `tsc --noEmit` + 构建 `npm run build` + 功能验证）。受沙箱限制无法跑 GUI 时，明确告知用户需在系统终端验证的具体步骤。
   - 改到菜单 / 表格 / 缩放 / 剪贴板 / 文件树行为时，跑 `npm test`（`test/menuAccelerators.cjs` 静态校验快捷键 + `test/e2e.cjs` 真实 Electron 端到端）。
   - 受限沙箱（无 GUI 会话）里需摘掉注入的环境变量：`env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS npm test`。
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

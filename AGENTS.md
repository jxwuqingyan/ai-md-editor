# AGENTS.md — ai-md-editor 项目协作规范

> 本文件是 AI 助手在本仓库协作时的行为准则与项目约定。所有功能开发必须遵守。

---

## 1. 语言要求

- **始终使用简体中文**回答与沟通。
- 代码注释、文档、提交说明一律使用简体中文。

## 2. 核心理念与原则

- **简洁至上（KISS）**：恪守 KISS 原则，避免过度工程化。用最少的代码解决问题，不做过度推测与提前抽象。沟通简洁，直抒重点。
- **深度分析**：基于第一性原理、金字塔原理拆解问题，先想清楚「为什么」再动手。
- **事实为本**：实事求是，务实胜于教条，直言不讳。如果方案是在做蠢事，直接指出。
- **收集信息**：遇到不确定的事情，优先与用户讨论、充分收集信息后再行动，而非擅自假设。
- **主动行动**：在前置条件充分时，独立思考、主动动手验证可行性、得出结论，而非被动等待。

## 3. 项目定位（务必牢记）

- **对标 Typora 的跨平台 Markdown 编辑器与预览器**，支持 macOS 与 Windows。
- **纯本地单机应用**：无登录、无账户、无云同步、无后端、无数据库、无自动更新。
- 核心体验：**WYSIWYG 所见即所得**（输入即渲染，光标所在行才显示源码标记）。
- 设计基调：**现代极简 + 克制动效**，去 AI 味。详见 `docs/UI-UX设计规范.md`。

## 4. 技术栈（本项目实际，非通用后端）

| 层 | 选型 |
|----|------|
| 应用框架 | Electron 45 + React 18 + TypeScript |
| 编辑器内核 | Milkdown 7（ProseMirror + remark，`@milkdown/kit` 统一入口） |
| 构建 | Vite（electron-vite）+ electron-builder + npm workspaces（Monorepo） |
| 动效 | Motion (Framer Motion)（v1.1 引入） |
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
│       │   ├── menuHandlers.ts   # 原生菜单动作分发表（纯函数）
│       │   ├── sourceActions.ts  # 源码模式格式化（纯函数）
│       │   └── Dialogs.tsx       # 查找/快速打开/重命名/字数统计/大纲浮层
│       ├── build/            # 应用图标（icon.svg/png/icns）
│       └── electron-builder.json  # 打包配置（官方识别文件名）
├── packages/
│   ├── editor/               # Milkdown 编辑器封装（createEditor + 下划线 mark + ProseMirror 命令）
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

## 8. 功能更新记录（change_log.md）

- **重要功能更新必须记录到 `change_log.md`**。
- 后期编写整体功能说明时，必须参考该文件。
- 记录格式：日期 + 功能点摘要 + 影响范围。

## 9. 版本管理

- 每次功能更新完成后，同步更新以下位置的版本号：
  1. 根 `package.json` 的 `version` 字段。
  2. `change_log.md` 记录本次更新摘要。
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
| 6 | 视觉：现代极简，动效用 Motion，去 AI 味 |
| 7 | 包管理器：npm workspaces（已从 pnpm 迁移） |
| 8 | 编辑器实例：多标签页采用「单实例 + 切换内容」架构 |
| 9 | 分发：CI 打包 macOS（x64 + arm64）dmg + Windows x64 安装包 |
| 10 | 顶部导航：macOS 原生应用菜单 + 标签栏右侧动作区，窗口内不保留独立功能顶栏 |
| 11 | 原生菜单只保留「文件/编辑/段落/格式/显示」五组；主题走右上角按钮，不设主题/窗口/帮助菜单 |
| 12 | 菜单勾选项由渲染层经 `menu:state` 同步到主进程，主进程重建菜单；动作经 `menu:action` 白名单转发 |
| 13 | 格式化命令 WYSIWYG 走 ProseMirror，源码模式走 `sourceActions.ts`，两者共用同一 MenuAction 分发入口 |
| 14 | 非 CommonMark 语法（下划线、YAML Front Matter、`[TOC]`、`> [!NOTE]`）通过自定义 remark 插件 / Milkdown 节点 / 装饰器实现，不在文本层做字符串替换 |

### 14.1 Typora 兼容语法的实现位置（改动前务必先读）

| 语法 | 实现文件 | 要点 |
|------|----------|------|
| `<u>…</u>` 下划线 | `packages/editor/src/underline.ts` | remark 折叠 html 节点 + mark schema + stringify handler |
| YAML Front Matter | `packages/editor/src/frontmatter.ts` | `$remark(..., 'yaml')` 必须传第三个参数 `initialOptions`，否则 remark-frontmatter 抛 `Missing type in matter {}` |
| 序列化 handler 汇总 | `packages/editor/src/stringify.ts` | `underline` / `yaml` / `text` 三个 handler 统一注册；`text` 仅放行 `[TOC]` 与 `[!NOTE]` 的方括号 |
| 警告框 / 目录渲染 | `packages/editor/src/decorations.ts` | 纯 ProseMirror 装饰，不改 Markdown 文本；目录块在文档变化时重建 |
| 大纲解析 | `packages/markdown-core/src/index.ts` | 必须启用 remark-frontmatter，否则文件头 `---` 会被当 Setext 标题 |
| 片段插入 | `packages/editor/src/index.ts` `insertSnippet` | 行内片段替换选区；块级片段插到当前顶层块之后（空段落直接替换），否则定义类节点会拆坏段落 |

> 变更上述决策需先与用户确认，不得擅自调整。

## 13. 开发交付约定（用户明确要求，必须遵守）

1. **测试**：每完成一个功能，都必须做一遍测试（类型检查 `tsc --noEmit` + 构建 `npm run build` + 功能验证）。受沙箱限制无法跑 GUI 时，明确告知用户需在系统终端验证的具体步骤。
2. **文档同步**：开发功能的同时，同步更新 `README.md`（项目说明）与 `AGENTS.md`（协作规范），不得等到最后一次性补。
3. **CI 打包**：仓库需配置 GitHub Actions workflow，自动打包 **macOS（x64 与 arm64 两种架构的 dmg）** 与 **Windows（x64 安装包）**。

## 14. 参考文档

- `docs/技术方案文档.md` — 完整技术方案（架构/模块/WYSIWYG 方案/里程碑/风险）
- `docs/UI-UX设计规范.md` — UI/UX 设计规范（原则/去 AI 味清单/design tokens/动效/检查清单）
- `change_log.md` — 功能更新记录

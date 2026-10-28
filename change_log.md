# 变更记录（change_log）

> 项目功能更新记录，编写整体功能说明时需参考本文件。

## 0.6.0 - 2026-10-27

### M5 补充：大纲点击跳转 + 最近文件 UI

- 大纲点击跳转：点击侧边栏大纲条目，编辑器平滑滚动到对应标题并聚焦
- 编辑器新增 `scrollToHeading` 接口（按标题文本定位 ProseMirror heading 节点）
- 源码模式下大纲点击同样可用：按行号估算滚动源码 textarea
- 最近文件下拉菜单：顶部栏「最近」按钮，列出最近打开的文件，点击快速打开
- 大纲条目补全可访问性（role/tabIndex/title 提示）

### M5：打包配置与图标

- 补齐打包配置：固定 electron 版本（45.0.0）、补 author/description 字段
- 生成应用图标：手绘 SVG 图标 → icon.png/icon.icns（圆角蓝底 + 白色 M 字标）
- electron-builder 配置完善：buildResources 目录、dmg 内容布局（应用 + Applications 链接）
- 更新 README：项目简介、特性、技术栈、目录结构、开发/打包说明

### M4：源码/渲染模式切换

- 新增视图模式切换：wysiwyg（Milkdown 所见即所得）与 source（源码 textarea）
- 顶部栏「源码/渲染」切换按钮 + 快捷键 Cmd/Ctrl+/
- 源码模式：等宽字体 textarea 直接编辑 Markdown 源码，实时同步大纲与字数
- 渲染模式：Milkdown WYSIWYG 编辑，切换时内容双向同步（经 tabs 状态中转）
- 状态栏第一项动态显示当前模式（Markdown / 源码）

## 0.5.0 - 2026-10-27

### M3 补充：自动保存 + 最近文件 + 拖拽打开

- 自动保存：编辑内容变化后防抖 1.5s 自动写入（仅当标签有路径且 dirty）
- 最近文件：主进程持久化到 userData/recent.json（最多 20 条，去重置顶），新增 GetRecent/AddRecent IPC
- 拖拽打开：把 .md 文件拖到窗口内打开；macOS 拖到 Dock 图标 / Finder「打开方式」也支持（open-file 事件）
- 新增 OpenPath IPC：按路径读取文件并记录最近文件

## 0.4.0 - 2026-10-27

### M3 里程碑：多标签页

- 新增 `Tabs` 组件：标签栏 UI（活动态高亮、关闭按钮、dirty 圆点标记、新建按钮）
- App 引入标签状态管理：tabs 数组（id/path/name/content/dirty）+ 活动标签
- 架构：单编辑器实例 + 切换内容，切换标签时载入对应内容
- 打开文件新建标签（同路径复用已有标签）、保存/另存为更新对应标签、关闭标签自动切换相邻标签
- 关闭最后一个标签时保留空文档，避免编辑器无内容

## 0.3.0 - 2026-10-26

### M2 里程碑：文件操作 + 图片粘贴

- 新增文件系统 IPC（主进程 `ipc.ts`）：打开/保存对话框、读写文件、保存图片
- 扩展 preload 白名单 API：openFile / saveFileAs / readFile / writeFile / saveImage
- 共享 IPC 契约类型（`packages/shared`）：通道名枚举 + 请求/响应类型
- 渲染层接入：打开文件、Cmd/Ctrl+S 保存、另存为、标题栏显示当前文件名
- 图片粘贴：写入文档同级 `assets/` 目录，用相对路径引用（时间戳 + 随机后缀命名）
- 图片粘贴暂采用「追加到文档末尾」简化实现，后续优化为光标处插入

## 0.2.0 - 2026-10-26

### M1 里程碑：接入 Milkdown 实现 WYSIWYG 编辑

- 接入 Milkdown 7.22.3（`@milkdown/kit` + `@milkdown/react`）编辑器内核
- 封装 `createEditor` 接口（`packages/editor`）：getMarkdown / setMarkdown / destroy / onChange
- 启用 CommonMark + GFM 预设（标题、列表、任务列表、表格、代码块、引用、链接等）
- 新增 `MarkdownEditor` React 组件，命令式管理编辑器生命周期
- 打通数据流：编辑器内容 ↔ 状态栏（行数/字数）↔ 侧边栏大纲（实时提取）
- 自定义 Milkdown 主题样式，贴合 UI-UX 设计规范（克制动效、极简排版）
- 中文 IME 适配：基于 ProseMirror 内置 composition 事件，拼音组合输入正常
- 补齐缺失的 `@types/react`、`@types/react-dom` 类型包

## 0.1.0 - 2026-10-25

### 工程初始化（M0 里程碑）

- 搭建 pnpm Monorepo 工程骨架
- 建立 `apps/desktop`（Electron 主进程 + preload + React 渲染进程）
- 建立 `packages/{editor,markdown-core,theme,shared}` 四个基础包
- 落地 UI-UX 设计规范的 design tokens（`packages/theme`）
- 实现应用骨架：顶部栏 / 侧边栏大纲 / 编辑区 / 状态栏，支持明暗主题切换
- 遵循 Electron 安全基线（contextIsolation / sandbox / CSP）

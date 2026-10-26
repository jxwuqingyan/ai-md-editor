# 变更记录（change_log）

> 项目功能更新记录，编写整体功能说明时需参考本文件。

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

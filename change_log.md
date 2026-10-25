# 变更记录（change_log）

> 项目功能更新记录，编写整体功能说明时需参考本文件。

## 0.1.0 - 2026-10-25

### 工程初始化（M0 里程碑）

- 搭建 pnpm Monorepo 工程骨架
- 建立 `apps/desktop`（Electron 主进程 + preload + React 渲染进程）
- 建立 `packages/{editor,markdown-core,theme,shared}` 四个基础包
- 落地 UI-UX 设计规范的 design tokens（`packages/theme`）
- 实现应用骨架：顶部栏 / 侧边栏大纲 / 编辑区 / 状态栏，支持明暗主题切换
- 遵循 Electron 安全基线（contextIsolation / sandbox / CSP）

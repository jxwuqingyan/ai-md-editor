# MarkdownNote

对标 Typora 的跨平台 Markdown 编辑器，纯本地单机应用，所见即所得（WYSIWYG）。

## 特性

- **所见即所得**：输入即渲染，无需分屏预览（基于 Milkdown / ProseMirror + remark）
- **多标签页**：同时编辑多个 `.md` 文档，标签切换、dirty 标记
- **源码/渲染模式切换**：`Cmd/Ctrl + /` 在源码与 WYSIWYG 视图间无缝切换
- **文件树**：左侧文件面板浏览目录，懒加载展开、点击打开文档
- **底部工具栏**：段落/加粗/斜体/代码/链接/图片/引用/列表等常用排版操作
- **导出**：一键导出 PDF / HTML / Word（单文件内联样式）
- **文件操作**：打开、保存、另存为、自动保存（防抖）、最近文件、拖拽打开
- **大纲导航**：侧边栏「文档结构」实时提取标题，点击跳转，支持收缩
- **图片粘贴**：粘贴图片自动保存到文档同级 `assets/` 目录，光标处插入并相对路径引用
- **代码高亮**：代码块按语言语法高亮（Shiki，28 种语言，明暗主题自动适配）
- **数学公式**：LaTeX（KaTeX），`$行内$` 与 `$$块级$$`
- **Mermaid 图表**：```` ```mermaid ```` 代码块渲染为 SVG 图表
- **主题**：明暗主题切换，现代极简视觉（克制动效，去 AI 味）
- **中文友好**：IME 组合输入适配，中文排版优化
- **本地优先**：无登录、无云同步、无后端，数据完全留在本地

## 技术栈

- **Electron** + **React 18** + **TypeScript** + **Vite**（electron-vite）
- **Milkdown**（ProseMirror + remark）编辑器内核
- **npm workspaces** Monorepo 结构
- **Motion（Framer Motion）** 动效（v1.1 引入）

## 目录结构

```
ai-md-editor/
├── apps/
│   └── desktop/          # Electron 桌面端
│       ├── src/main/     # 主进程（窗口、文件 I/O、最近文件）
│       ├── src/preload/  # 预加载脚本（contextBridge 白名单 API）
│       └── src/renderer/ # 渲染进程（React + Milkdown）
├── packages/
│   ├── editor/           # Milkdown 编辑器封装
│   ├── markdown-core/    # Markdown 解析/序列化/大纲（纯函数）
│   ├── theme/            # 主题系统（design tokens）
│   └── shared/           # 跨进程共享类型（IPC 契约）
└── docs/                 # 设计规范、技术方案
```

## 开发

```bash
# 安装依赖（国内可配置镜像加速 Electron 下载）
npm install

# 启动开发模式（热更新）
npm run dev

# 构建产物
npm run build

# 打包（本地）
cd apps/desktop
npx electron-builder --mac --arm64      # macOS Apple Silicon (arm64) dmg
# Windows x64 安装包需在 Windows 环境或 CI 中打包
```

> 国内环境下载 Electron 二进制较慢，可设置镜像：
> ```bash
> export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
> ```

## 打包与分发

- **本地打包**：macOS 本机只打 `arm64` dmg（Apple Silicon）；Windows x64 安装包由 CI 打包
- **CI 自动打包**：推送 `main` 或打 `v*` tag 时，GitHub Actions 自动产出三架构：
  - macOS x64（Intel）dmg
  - macOS arm64（Apple Silicon）dmg
  - Windows x64 安装包（nsis exe）
- 打 `v*` tag 时自动创建 GitHub Release 并上传所有产物

## 版本

- 主.次.修订号 语义化版本
- 功能更新记录见 [change_log.md](./change_log.md)

## 文档

- [技术方案文档](./docs/技术方案文档.md)
- [UI-UX 设计规范](./docs/UI-UX设计规范.md)

# MarkdownNote

对标 Typora 的跨平台 Markdown 编辑器，纯本地单机应用，所见即所得（WYSIWYG）。

## 特性

- **所见即所得**：输入即渲染，无需分屏预览（基于 Milkdown / ProseMirror + remark）
- **多标签页**：同时编辑多个 `.md` 文档，标签切换、dirty 标记
- **源码/渲染模式切换**：`Cmd/Ctrl + /` 在源码与 WYSIWYG 视图间无缝切换
- **文件树**：左侧文件面板浏览目录，懒加载展开、点击打开文档
- **原生菜单栏**：macOS 顶部系统菜单收纳文件/编辑/段落/格式/显示五组功能，不占用编辑窗口；主题、窗口、帮助类菜单已移除
- **紧凑顶栏**：标签栏右上角集中主题选择与侧栏开关，取消独立功能顶栏
- **底部工具栏**：段落/加粗/斜体/代码/链接/图片/引用/列表等常用排版操作
- **完整排版能力**：一至六级标题、标题升降级、表格增删行列、任务列表与状态、列表缩进、上下插入段落、行移动/删除、脚注、链接引用、警告框、内容目录、YAML Front Matter、下划线、删除线、清除样式
- **Typora 语法渲染**：`> [!NOTE]` 等警告框渲染成带色条的提示块（5 种类型），`[TOC]` 渲染成可点击的实时目录，文件头 YAML Front Matter 以独立区块呈现且往返不丢失
- **编辑辅助**：撤销/重做（`Cmd/Ctrl+Z`、`Shift+Cmd/Ctrl+Z`，Windows 支持 `Ctrl+Y`）、查找/替换（下一处/上一处/全部替换）、复制为 Markdown / 纯文本 / HTML 代码、粘贴为纯文本
- **文件辅助**：快速打开、打开最近文件、重命名、复制一份、从磁盘重新加载、保存全部、打印、在文件管理器/文件树中显示、从本地文件插入图片
- **显示模式**：只读、专注、打字机、工具栏/标签栏/侧栏开关、字数统计窗口、大纲窗口、缩放、窗口置顶
- **导出**：一键导出 PDF / HTML / Word（单文件内联样式；导出时自动去掉 Front Matter，`[TOC]` 展开为带锚点的目录）
- **文件操作**：打开、保存、另存为、自动保存（防抖）、最近文件、拖拽打开
- **大纲导航**：基于 remark AST 实时提取标题，支持 ATX/Setext 标题与重复标题精确跳转
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
│       ├── src/main/     # 主进程（窗口、文件 I/O、最近文件、原生菜单、剪贴板/缩放）
│       ├── src/preload/  # 预加载脚本（contextBridge 白名单 API）
│       └── src/renderer/ # 渲染进程（React + Milkdown；菜单分发、源码变换、查找浮层独立成模块）
├── packages/
│   ├── editor/           # Milkdown 编辑器封装（含自定义下划线 mark 与 ProseMirror 排版命令）
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

# MarkdownNote

对标 Typora 的跨平台 Markdown 编辑器，纯本地单机应用，所见即所得（WYSIWYG）。

## 特性

- **所见即所得**：输入即渲染，无需分屏预览（基于 Milkdown / ProseMirror + remark）
- **多标签页**：同时编辑多个 `.md` 文档，标签切换、dirty 标记
- **源码/渲染模式切换**：`Cmd/Ctrl + /` 在源码与 WYSIWYG 视图间无缝切换
- **文件操作**：打开、保存、另存为、自动保存（防抖）、最近文件、拖拽打开
- **图片粘贴**：粘贴图片自动保存到文档同级 `assets/` 目录，用相对路径引用
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

# 打包（macOS dmg / Windows nsis）
npm run dist
```

> 国内环境下载 Electron 二进制较慢，可设置镜像：
> ```bash
> export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
> ```

## 版本

- 主.次.修订号 语义化版本
- 功能更新记录见 [change_log.md](./change_log.md)

## 文档

- [技术方案文档](./docs/技术方案文档.md)
- [UI-UX 设计规范](./docs/UI-UX设计规范.md)

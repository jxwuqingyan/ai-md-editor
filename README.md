# MarkdownNote

跨平台（macOS + Windows）本地 Markdown 编辑器，纯本地单机应用，所见即所得（WYSIWYG）。

## 特性

- **所见即所得**：输入即渲染，无需分屏预览（基于 Milkdown / ProseMirror + remark）
- **多标签页**：同时编辑多个 `.md` 文档，标签切换、dirty 标记；关闭未落盘且已改动的标签会二次确认
- **源码/渲染模式切换**：`Cmd/Ctrl + /` 在源码与 WYSIWYG 视图间无缝切换
- **文件树**：左侧文件面板浏览目录，懒加载展开、点击打开文档
- **原生菜单栏**：macOS 顶部系统菜单收纳文件/编辑/段落/格式/显示五组功能，不占用编辑窗口；主题、窗口、帮助类菜单已移除
- **紧凑顶栏**：标签栏右上角集中主题选择与侧栏开关，取消独立功能顶栏
- **底部工具栏**：段落/加粗/斜体/代码/链接/图片/引用/列表等常用排版操作
- **完整排版能力**：一至六级标题、标题升降级、表格增删行列、任务列表与状态、列表缩进、上下插入段落、行移动/删除、脚注、链接引用、警告框、内容目录、YAML Front Matter、下划线、删除线、清除样式
- **表格体验**：表格增删行列菜单项随光标上下文自动置灰（不在表格内不可点）；表头行也能删除（移除旧表头、首个数据行升级为新表头），不会产出非法表格
- **扩展语法渲染**：`> [!NOTE]` 等警告框渲染成带色条的提示块（5 种类型），`[TOC]` 渲染成可点击的实时目录，文件头 YAML Front Matter 以独立区块呈现且往返不丢失
- **编辑辅助**：撤销/重做（`Cmd/Ctrl+Z`、`Shift+Cmd/Ctrl+Z`，Windows 支持 `Ctrl+Y`）、查找/替换（下一处/上一处/全部替换）、复制为 Markdown / 纯文本 / HTML 代码、粘贴为纯文本
- **文件辅助**：快速打开、打开最近文件、重命名、复制一份、从磁盘重新加载、保存全部、打印、在文件管理器/文件树中显示、从本地文件插入图片
- **显示模式**：只读、专注、打字机、工具栏/标签栏/侧栏开关、字数统计窗口、大纲窗口、缩放（离散档位，菜单与状态栏显示当前百分比）、窗口置顶
- **偏好记忆**：主题、侧栏、标签栏/工具栏可见性、缩放比例、窗口尺寸与位置自动保存，下次启动原样恢复
- **会话恢复**：上次打开的文档随窗口一起恢复（文件已删除的条目自动跳过），状态栏提示恢复数量
- **退出确认**：关闭窗口时汇总未保存文档，未落盘的会弹确认框；确认退出前立即把有路径的改动写盘
- **编码兼容**：自动识别 UTF-8（含 BOM）/ UTF-16 / GBK，GBK 文档不再乱码；保存统一转 UTF-8 并同步状态栏编码
- **外部修改感知**：文档被其它程序改动时状态栏提示，没有未保存改动时可一键「重新加载」
- **文件夹搜索**：侧栏搜索面板在打开的目录内递归查找 Markdown 内容，支持区分大小写 / 全单词 / 正则表达式，点击结果直达对应行
- **文件树操作**：底部 ⋮ 菜单提供 新建文件 / 搜索 / 在 Finder（资源管理器）中显示 / 打开文件夹 / 刷新；「打开文件夹」固定在侧栏底部
- **快速启动**：编辑器内核按需动态加载，入口脚本从 3.18 MB 降到 0.59 MB，加载期间有占位提示
- **导出**：一键导出 PDF / HTML / Word（单文件内联样式；导出时自动去掉 Front Matter，`[TOC]` 展开为带锚点的目录；
  数学公式渲染成 KaTeX 并内联字体，PDF/HTML 离线可看，Word 保留 TeX 原文）
- **文件操作**：打开、保存、另存为、自动保存（1.5s 防抖，覆盖所有已落盘标签，不只当前标签）、最近文件、拖拽打开；打开前校验体积（20 MB 上限）与二进制内容，避免误开大文件卡死
- **大纲导航**：基于 remark AST 实时提取标题，支持 ATX/Setext 标题与重复标题精确跳转
- **图片插入**：粘贴 / 拖入 / 从本地选择三种方式，图片自动存到文档同级 `img/` 目录并在编辑器内直接显示；Markdown 写相对路径，文档与 `img/` 目录一起拷贝即可带走图片
- **拖拽增强**：拖图片进窗口即插入；拖文件夹设为文件树根；拖 `.md` 直接打开
- **代码高亮**：代码块按语言语法高亮（Shiki，28 种语言，明暗主题自动适配）
- **数学公式**：LaTeX（KaTeX），`$行内$` 与 `$$块级$$`
- **Mermaid 图表**：```` ```mermaid ```` 代码块渲染为 SVG 图表
- **主题**：明暗主题切换，现代极简视觉（克制动效，去 AI 味）
- **中文友好**：IME 组合输入适配，中文排版优化
- **键盘可达**：文件树条目是真正的按钮，支持 Enter/Space 打开与 ↑↓←→ 导航，焦点环可见
- **本地优先**：无登录、无云同步、无后端，数据完全留在本地
- **异常兜底**：渲染层错误边界在界面出错时给出「重新加载 / 复制错误详情」，不会只剩一片白屏

## 技术栈

- **Electron** + **React 18** + **TypeScript** + **Vite**（electron-vite）
- **Milkdown**（ProseMirror + remark）编辑器内核
- **npm workspaces** Monorepo 结构
- **动效**：CSS 过渡（克制使用，高频交互零动画）

## 目录结构

```
ai-md-editor/
├── apps/
│   └── desktop/          # Electron 桌面端
│       ├── src/main/     # 主进程（窗口、文件 I/O、编码识别、外部修改监听、设置持久化、最近文件、原生菜单、导出）
│       ├── src/preload/  # 预加载脚本（contextBridge 白名单 API）
│       ├── src/renderer/ # 渲染进程（React + Milkdown）
│       │   ├── hooks/    # 状态按职责拆分：文档、显示、编辑器、编辑动作、查找、菜单桥接
│       │   ├── App.tsx   # 根组件：编排 hooks 与布局
│       │   ├── ErrorBoundary.tsx # 渲染层异常兜底
│       │   ├── constants.ts      # 渲染层小常量（避免入口静态依赖编辑器内核）
│       │   ├── Sidebar.tsx / FileTree.tsx / Tabs.tsx / Toolbar.tsx
│       │   ├── menuHandlers.ts   # 原生菜单动作分发表（纯函数）
│       │   ├── sourceActions.ts  # 源码模式格式化（纯函数，含表格列操作）
│       │   └── Dialogs.tsx       # 查找/快速打开/重命名/字数统计/大纲浮层
│       └── test/         # 自动化测试（单元测试 + E2E + 菜单快捷键静态/运行时检查）
├── packages/
│   ├── editor/           # Milkdown 编辑器封装（commands / selection / 语法插件）
│   ├── markdown-core/    # Markdown 解析/序列化/大纲（纯函数）
│   ├── theme/            # 主题系统（design tokens）
│   └── shared/           # 跨进程共享类型（IPC 契约）与纯函数工具（编码/路径/文本）
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

## 测试

```bash
# 单元测试 + 快捷键静态检查 + 菜单运行时校验 + Electron 端到端测试
npm test

# 只跑其中一项
npm run test:unit --workspace @ai-md-editor/desktop
npm run test:menu --workspace @ai-md-editor/desktop
npm run test:menu-runtime --workspace @ai-md-editor/desktop
npm run test:e2e --workspace @ai-md-editor/desktop
```

- `test/unit.ts`（由 `test/run-unit.cjs` 用 esbuild 打包执行）：纯函数单测 41 项——
  编码识别（UTF-8 / BOM / UTF-16 / GBK）、`file://` 地址生成、Markdown 简化、
  源码模式表格上下文与格式化、导出用公式提取/还原（代码掩码、货币文本不误判、渲染失败兜底）、
  侧栏搜索的行匹配器（大小写 / 全单词 / 正则）。
  纯 Node，无需 GUI，Windows CI 也能跑
- `test/menuAccelerators.cjs`：校验 macOS / Windows 两套快捷键的写法与唯一性，以及平台关键键位是否齐全（纯 Node，无需 GUI）
- `test/menuRuntime.cjs`：加载构建产物构造真实原生菜单，断言当前平台的关键快捷键（含隐藏项）已注册，
  并逐项点击菜单验证「一点击 = 一条 `menu:action`、动作与源码声明一致」
- `test/e2e.cjs`：启动真实主进程（`out/main/index.js`）+ preload + 渲染层，经原生菜单通道派发动作，
  覆盖 69 项断言：表格上下文置灰（含程序化定位光标）、表头行删除语义、缩放、三种复制格式、打印、
  全屏/最小化、深层目录文件树定位与键盘导航、源码撤销合并、图片相对路径与拖拽复制、
  偏好持久化与窗口尺寸记忆、后台标签自动保存、GBK 文档读取与转存 UTF-8、外部修改提示与重新加载、
  关闭前未保存汇总与立即写盘、会话恢复、主题单击切换、文件树 ⋮ 菜单与新建文件落盘、
  侧栏搜索（大小写 / 全单词 / 正则开关与点击跳转）。需先 `npm run build`（测试直接加载构建产物）。
- `test/run-e2e.cjs`：通用 Electron 测试启动器（默认 `e2e.cjs`，可传脚本名复用），自动剔除宿主终端注入的
  `ELECTRON_RUN_AS_NODE` / `NODE_OPTIONS` 并附加无 GUI 会话所需的开关。
- CI 的 `test` job：macOS 跑完整 `npm test`，Windows runner 跑单元测试 + 静态检查 + 菜单运行时校验，
  让 Windows 专属键位与菜单动作绑定每次提交都被验证；测试 job 与打包 job 相互独立。
- 测试使用独立的临时 `userData` 目录（不读写真实应用配置），每次运行前清空，
  避免 Chromium 记住的页面缩放污染下一轮断言。

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
- 功能更新记录见 [CHANGELOG.md](./CHANGELOG.md)

## 文档

- [技术方案文档](./docs/技术方案文档.md)
- [UI-UX 设计规范](./docs/UI-UX设计规范.md)

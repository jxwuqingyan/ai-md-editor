# 变更记录（change_log）

> 项目功能更新记录，编写整体功能说明时需参考本文件。

## 0.10.0 - 2026-11-07

### 菜单功能完整性复查与修复

逐项核对「菜单定义 → 原生菜单项 → 渲染层分发 → 编辑器实现」四层，确认 92 个菜单动作全部接线，35 个格式化动作在 WYSIWYG 与源码模式双通道均已实现，并修复复查中发现的真实缺陷：

- **YAML Front Matter 内容损坏**：此前插入后被当成分割线 + 段落，写回时变成 `***` / `-----`，文档被改写。新增 `frontmatter.ts`（remark-frontmatter 解析 + Milkdown 节点 + `yaml` stringify handler），现在渲染为独立的元信息区块，往返保持 `---` 包夹原文
- **大纲被 Front Matter 干扰**：文件头两条 `---` 会被 remark 判成 Setext 标题，导致大纲出现幽灵条目。`markdown-core` 同步启用 remark-frontmatter，front matter 文档的大纲只剩真实标题
- **目录 / 警告框语法被转义**：`[TOC]` 与 `> [!WARNING]` 写回时变成 `\[TOC]`、`> \[!WARNING]`，语法失效。新增定向解除转义的 `text` stringify handler，只放行这两类标记，其余文本仍按默认规则转义
- **警告框与目录只有文字没有呈现**：新增 `decorations.ts`，警告框渲染为带类型色条的提示块（NOTE/TIP/IMPORTANT/WARNING/CAUTION，源码标记隐藏），`[TOC]` 下方实时生成可点击的标题目录
- **「复制一份到…」错误绑定为另存为**：原来会把当前文档改到新路径；现在写入副本并在新标签打开，原文档与标签保持不变
- **打印输出整窗界面**：新增 `@media print` 规则，隐藏标签栏、侧栏、工具栏、状态栏、浮层，仅输出正文
- **表格插入空表头**：改为插入带「列 1/2/3」表头的 3×3 表格
- **块级片段插入破坏段落结构**：含定义块（链接引用、脚注）或块级结构的片段原先在段落中间替换会把标题拆成空标题。现在按「行内 / 块级」分别插入：行内片段替换选区，块级片段插入到当前顶层块之后（空段落则直接替换）
- **编辑器初始化失败只留空白**：`MarkdownEditor` 增加失败捕获与错误提示，不再静默
- **关闭标签在 setState 回调内做副作用**：改为先算后更新，避免 React 严格模式下重复触发
- 序列化默认值改为 `bullet: '-'` / `rule: '-'`，保存时不再把 `-` 列表改写成 `*`
- 导出 HTML/PDF/Word 时自动剔除 Front Matter，`[TOC]` 展开为带锚点的目录

### 验证

- Web / Node `tsc --noEmit`、`npm run build` 通过
- 富文本往返测试：Front Matter、下划线、删除线、任务列表、表格、公式、脚注、警告框、`[TOC]` 全部保持语义一致（仅表格单元格对齐空格不同）
- 渲染测试：Front Matter 区块、2 个警告框（class 正确、源码标记 `display:none`）、目录块 2 个可点击条目、大纲只含真实标题
- 交互测试：只读模式切换、查找匹配计数与跳转、标签栏/工具栏/专注/打字机开关、字数统计与大纲窗口、大纲点击跳转滚动
- 55 个菜单动作在 WYSIWYG 与源码模式批量触发零运行时异常

### 已知限制

- 引用式链接（`[文字][ref]`）会被 Milkdown 归一为行内链接（`[文字](url)`），链接语义不变
- 导出的 HTML / PDF / Word 由 marked 渲染，Mermaid 图表与 KaTeX 公式按源码文本输出

## 0.9.0 - 2026-11-07

### 原生功能菜单全面补全（对标 Typora 五组菜单）

- 移除「主题 / 窗口 / 帮助」菜单，只保留文件、编辑、段落、格式、显示五组；主题仍由标签栏右上角按钮控制
- 主进程 `menu.ts` 按 Typora 截图重建完整菜单层级（共 100+ 菜单项），新增动态「打开最近文件」子菜单与菜单勾选状态
- 新增 `menu:state` 通道：渲染层把只读、专注、打字机、工具栏、侧栏、源码模式等状态同步到主进程，菜单勾选项与实际界面一致
- `menu:action` 升级为 `{ action, payload? }` 消息，支持最近文件路径、警告框类型等参数

### 文件 / 编辑能力

- 新增：新建窗口、快速打开（最近文件 + 文件树两层模糊搜索）、打开最近文件子菜单、重命名、复制一份、从磁盘重新加载、保存全部、在文件管理器/文件树中显示、打印、从本地文件选择图片并存入 `assets/`
- 新增：复制为 Markdown / 纯文本 / HTML 代码、粘贴为纯文本、选择当前行、上移/下移/删除行、插入换行符
- 新增：应用内查找替换栏（匹配计数、上一处/下一处、替换、全部替换），WYSIWYG 与源码模式均可定位选区

### 段落 / 格式能力

- 新增：五/六级标题、标题升降级、表格插入与增删行列、公式块/内联公式、代码工具、警告框（NOTE/TIP/IMPORTANT/WARNING/CAUTION）
- 新增：任务列表与任务状态（完成/未完成/取消）、列表缩进与反缩进、上下插入段落、链接引用、脚注、内容目录、YAML Front Matter
- 新增：下划线（自定义 Milkdown mark + remark 转换 + stringify handler，`<u>…</u>` 往返不丢）、删除线、注释、清除样式
- 编辑器内核扩展 `FormatAction` 至 30+ 命令；预设没有的能力下沉到 ProseMirror transaction（行移动、任务状态、表格行列、清除 marks 等）
- 新增 `sourceActions.ts` 纯函数模块，保证源码模式下所有菜单动作与 WYSIWYG 等价

### 显示模式

- 新增：只读、专注、打字机模式（光标居中）、标签栏/工具栏显隐、字数统计窗口、大纲窗口、窗口置顶
- 新增：实际大小 / 放大 / 缩小（Electron webContents 缩放），显示菜单保留全屏与最小化
- 渲染层拆出 `menuHandlers.ts`（动作分发）、`Dialogs.tsx`（查找/快速打开/重命名/浮层）与 `sourceActions.ts`，避免根组件承担全部逻辑

### 验证

- Web / Node `tsc --noEmit` 通过，`npm run build` 通过
- Electron 冒烟测试：75 个菜单 accelerator 全部合法；真实主进程成功构建五组菜单（文件 22 / 编辑 22 / 段落 34 / 格式 14 / 显示 24 项）
- 55 个菜单动作在 WYSIWYG 与源码模式批量触发均无运行时异常
- 下划线往返验证：DOM 生成 `<u>`，序列化回 `<u>Mark</u>downNote`

## 0.8.0 - 2026-11-07

### 顶部界面与原生菜单

- 新增 Typora 风格 macOS 原生应用菜单：文件/编辑/段落/格式/显示/主题/窗口/帮助，菜单不占用应用窗口
- 删除窗口内独立功能顶栏，减少 40px 纵向占用；标签栏改为可滚动标签 + 固定右侧动作区
- 深浅主题合并为右上角单个主题按钮与下拉，支持明确选择浅色/深色
- 侧栏收缩/展开统一到右上角按钮，侧栏折叠时宽度归零，编辑区获得完整宽度
- 主进程、preload、共享类型新增 `menu:action` 白名单事件链路，工具栏与系统菜单共用统一格式化入口
- 快捷键改由原生菜单加速器统一注册，避免与渲染层重复触发；补充按钮 `:focus-visible` 键盘焦点样式

## 0.7.1 - 2026-11-02

### 大纲与工具栏修复

- 大纲改用 remark AST 提取，修复 C#、下划线、HTML 实体、Setext 标题及代码块标题识别异常
- 大纲按标题序号定位 ProseMirror 节点，修复特殊文本和重复标题点击跳转失败
- 修复编辑器异步初始化期间打开文件可能丢失内容的问题
- 源码模式大纲跳转改为按行号定位选区，兼容自动换行
- 底部工具栏统一使用本地 SVG 图标，修复行内代码显示为 `&lt;&gt;` 及 Emoji 跨平台显示异常
- 大纲条目补充 Enter/空格键触发，完善键盘可访问性

## Unreleased - 2026-11-01

### 五项功能开发（对标 Typora）

#### 功能1：文件树 / 文件管理器

- 新增左侧「文件」面板：浏览目录、懒加载展开/折叠、点击打开 `.md/.markdown/.txt` 文件
- 主进程新增 `handleReadDir`（readdir + withFileTypes，过滤隐藏文件/node_modules，目录优先排序）与 `handleChooseFolder`（showOpenDialog openDirectory）
- 打开文件时自动将文件树定位到该文件所在目录

#### 功能2：底部常用工具栏

- 新增 `Toolbar.tsx` 底部浮动工具栏：段落下拉（正文/H1-H4/引用/代码块）、加粗/斜体/行内代码/链接/图片/引用/无序列表、更多菜单（有序列表/分割线）
- wysiwyg 模式走 `editor.format`（callCommand 分发），源码模式走选区降级

#### 功能3：导出 PDF / HTML / Word

- 新增 `export.ts`：`buildHtml`（marked 渲染 + 内联样式单文件）、`exportHtml`、`exportWord`（加 Word ProgId meta）、`exportPdf`（隐藏窗口 + printToPDF，A4）
- 顶栏「导出」下拉菜单：HTML / PDF / Word 三种格式

#### 功能4：数学公式（LaTeX）

- 接入 `@milkdown/plugin-math` + KaTeX，支持 `$行内$` 与 `$$块级$$`
- 引入 `katex.min.css` 样式

#### 功能5：Mermaid 图表

- 接入 `@milkdown/plugin-diagram`（7.7.0）+ mermaid（10.9.0），```` ```mermaid ```` 代码块渲染为 SVG
- 编辑器新增 `diagram` 插件，与 `math` 同签名（`MilkdownPlugin[]`）

### 顶栏布局调整

- 功能按钮（打开/最近/保存/另存为/源码/侧栏/深色）从右侧移到左侧
- 应用名「MarkdownNote」移到顶栏右侧，颜色弱化为次要文字色

### 构建配置

- renderer 构建目标改为 `esnext`（Electron 45 / Chrome 126+ 原生支持）
- 构建不再由 vite 清空输出目录（`emptyOutDir: false`），规避沙箱环境的 rmSync 拦截

## 0.6.0 - 2026-10-27

### v1.1 引入：代码块语法高亮（Shiki）

- 接入 `@milkdown/plugin-highlight` + Shiki 4.x，代码块按语言高亮
- 用 Shiki CSS 变量主题：token 颜色输出为 `var(--s-token-*)`，明暗切换零成本（无需重建编辑器）
- 主题系统新增 `syntax` token 集（GitHub Light / Dark 配色），`tokensToCssVars` 输出 `--s-*` 变量
- 支持 28 种常用语言（JS/TS/JSX/Python/Go/Rust/Java/C/C++/Shell/SQL/YAML/Docker 等）
- 代码块背景跟随 `--s-background`，明暗主题自动适配

### M5 补充：图片光标处插入 + 大纲点击跳转 + 最近文件 UI

- 图片光标处插入：粘贴图片时在光标位置插入 markdown 图片语法（原为追加文档末尾）
- 编辑器新增 `insertAtCursor` 接口：解析 markdown 片段并在光标选区替换插入
- 源码模式下同样支持光标处插入（基于 textarea selectionStart/End 选区替换）
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

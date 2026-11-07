# 待办与未验证项

> 记录本轮（0.11.0 菜单审计）遗留的工作，下次从这里继续。
> 最后更新：2026-11-07

## 一、需要真实环境手工验证（沙箱里跑不了）

本轮自动化测试在 `show: false` 的 Electron 窗口中进行，以下项因环境限制未能自动复测，
需要在打包后的真实应用里点一遍：

- [ ] **窗口类**：显示 → 进入全屏 / 退出全屏、最小化。
      沙箱里 `win.setFullScreen(true)` 与 `win.minimize()` 都返回 false（无真实 WindowServer 会话），
      代码链路本身是标准 API 调用。
- [ ] **剪贴板**：编辑 → 复制为纯文本 / 复制为 Markdown / 复制为 HTML 代码。
      注意 Electron 45 没有 `clipboard.writeHTML`，当前「复制为 HTML 代码」写入的是
      **纯文本的 HTML 源码**（与菜单文案一致），不是富文本剪贴板。
- [ ] **缩放**：显示 → 实际大小 / 放大 / 缩小（走 `webContents.setZoomLevel`，范围 -3 ~ 3）。
- [ ] **打印**：文件 → 打印（会弹系统打印对话框，自动化会卡住）。
- [ ] **Windows 端整体**：`Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` 重做、`F11` 全屏、
      `Alt+↑↓` 移动行、`Ctrl+Alt+*` 系列段落快捷键，均未在 Windows 上实测。
- [ ] **文件树定位**：打开一个深层目录中的文件，确认「在文件树中显示」能逐级展开并滚动到高亮项；
      当前只在「文件父目录 = 树根」的场景下验证过。

## 二、已知行为不完美（不算 bug，但可以更好）

- [ ] **表格菜单项不按上下文置灰**：光标不在表格内时，「表格 → 在下方插入行 / 删除当前表格列」仍可点击，
      只是没有反应。要真正置灰需要把「当前选区是否在表格内」同步给主进程，扩展 `MenuViewState`。
- [ ] **表头行不能删除**：光标在表头时「删除当前表格行」无反应。
      GFM 表格必须保留表头，可选方案是自动删除第一个数据行，或直接置灰该菜单项。
- [ ] **菜单只有「进入全屏 / 退出全屏」一个入口**，没有「缩放」的百分比显示（Typora 有）。
- [ ] **撤销栈上限**：源码模式快照栈深 200，超出后丢最早的记录；WYSIWYG 用 ProseMirror 默认深度。

## 三、历史遗留的重构

- [ ] `apps/desktop/src/renderer/App.tsx` 已超过 900 行，`packages/editor/src/index.ts` 约 660 行，
      都超出 AGENTS.md 约定的 500 行。建议按「文件操作 / 查找替换 / 视图状态 / 格式化」拆 hook。
      `menuHandlers.ts` 已拆出，可参照这个粒度继续。

## 四、已知限制（设计取舍，非缺陷）

- 引用式链接 `[文字][ref]` 会被 Milkdown 归一为行内链接 `[文字](url)`，链接语义不变。
- 导出 HTML / PDF / Word 由 marked 渲染，Mermaid 图表与 KaTeX 公式按源码文本输出。
- 关闭标签不提示未保存改动（依赖 1.5s 自动保存兜底）。

## 五、0.11.0 发布记录

- [x] 版本号升到 **0.11.0**（根 `package.json`、`apps/desktop/package.json`、`package-lock.json` 三处），`change_log.md` 的「未发布」小节已转正为 0.11.0。
- [x] 推 main + 打 tag `v0.11.0` 触发 GitHub Actions 出三平台包（macOS arm64 / macOS x64 / Windows）。
      注意 runner 用 `macos-15`（arm64）与 `macos-15-intel`（x64），dmg 已带 `${arch}` 后缀。
- [ ] 装 arm64 dmg 后，按第一节逐条手工验证，把「未验证」改成「已验证」。

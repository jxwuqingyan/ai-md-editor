/**
 * 构建前清空 `out/`。
 *
 * 为什么要单独做：渲染层的 `build.emptyOutDir` 是关闭的（本机沙箱里 vite 内部的
 * rmSync 曾被打断），结果每次构建都会留下上一版带 hash 的 `index-<hash>.js`。
 * 这些历史产物会被 `electron-builder` 一起打进 `app.asar`——实测堆了 2336 个文件、
 * asar 涨到 517M、dmg 从 250M 变 271M。
 *
 * 清理失败只告警不中断：`index.html` 引用的始终是新产物，留着旧文件只会让包变大。
 */
const { rmSync } = require('node:fs');
const { join } = require('node:path');

const outDir = join(__dirname, '..', 'out');

try {
  rmSync(outDir, { recursive: true, force: true });
} catch (err) {
  console.warn(`清理 out/ 失败（继续构建）：${err instanceof Error ? err.message : String(err)}`);
}

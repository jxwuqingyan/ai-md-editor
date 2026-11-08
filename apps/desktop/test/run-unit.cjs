/**
 * 纯函数单测启动器。
 *
 * 测试用例写在 test/unit.ts 里（与源码共享类型），这里用 esbuild 打成 CJS 后直接执行：
 * - 不依赖 GUI，可在任何平台的 CI runner 上跑
 * - 不需要额外的 TS 运行器（esbuild 随 vite 一起安装）
 */
const { buildSync } = require('esbuild');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const outfile = join(tmpdir(), `mdnote-unit-${process.pid}.cjs`);

try {
  buildSync({
    entryPoints: [join(__dirname, 'unit.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    outfile,
    logLevel: 'warning'
  });
} catch (err) {
  console.error('单元测试打包失败：', err instanceof Error ? err.message : err);
  process.exit(1);
}

require(outfile);

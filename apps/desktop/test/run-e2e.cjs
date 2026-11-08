/**
 * 通用 Electron 测试启动器：以干净环境启动真实 Electron 主进程。
 *
 * 部分宿主终端会注入 ELECTRON_RUN_AS_NODE=1 与 NODE_OPTIONS，
 * 这会让 electron 二进制退化成普通 Node，把 --no-sandbox / --disable-gpu
 * 当成 Node 参数并报 bad option。这里在派生子进程前剔除这两个变量，
 * 让 `npm test` 无需手动设置环境即可跨平台运行。
 *
 * 默认运行 test/e2e.cjs；传入脚本文件名即可复用（如 menuRuntime.cjs）。
 */
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const electronPath = require('electron');
if (typeof electronPath !== 'string' || !existsSync(electronPath)) {
  console.error('找不到 Electron 可执行文件，请先执行 npm install');
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;

const script = process.argv[2] ?? 'e2e.cjs';
const result = spawnSync(
  electronPath,
  ['--no-sandbox', '--disable-gpu', join(__dirname, script)],
  { cwd: join(__dirname, '..'), env, stdio: 'inherit' }
);
if (result.error) console.error(result.error.message);
process.exit(typeof result.status === 'number' ? result.status : 1);

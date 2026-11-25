#!/usr/bin/env node
/**
 * 发布前版本校验脚本的自检。
 *
 * 这个脚本守的是「tag 与安装包版本必须一致」这条线，它自己出错等于守卫失效，
 * 所以用子进程把它当黑盒跑几种输入，只断言退出码：
 *   - 当前仓库 5 处版本号一致（每次 `npm test` 都会顺带检查有没有漏改）
 *   - 打了与版本一致的 tag → 通过
 *   - tag 与版本错位 → 拦下
 *   - tag 缺 v 前缀（不会触发 workflow）→ 拦下
 */
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const repoRoot = resolve(__dirname, '../../..');
const script = resolve(repoRoot, 'scripts/check-release-version.mjs');
const version = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')).version;

let pass = 0;
const failures = [];

function check(name, args, expectedCode) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (r.status === expectedCode) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`✗ ${name} — 期望退出码 ${expectedCode}，实际 ${r.status}`);
    console.log(`${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').map((l) => `    ${l}`).join('\n'));
  }
}

check('当前仓库库内版本号一致', [], 0);
check(`tag v${version} 与包版本一致`, [`v${version}`], 0);
check('tag 与包版本错位时拦下', ['v0.0.0'], 1);
check('tag 缺 v 前缀时拦下', [version], 1);

console.log(`\n结果：${pass}/${pass + failures.length} 通过`);
if (failures.length > 0) {
  console.error(`失败项：${failures.join('、')}`);
  process.exit(1);
}

#!/usr/bin/env node
/**
 * 发布前版本一致性校验。
 *
 * 解决的问题：打 `v*` tag 时 CI 会自动把安装包挂到 Release 上，而安装包文件名里的
 * `${version}` 来自 package.json。如果 tag 写的是 v1.0.1、package.json 还停在 1.0.0，
 * Release 标签和包内版本就会错位，下载的人会以为拿错了文件。这里把校验前置：
 * 版本号不一致直接失败，不产出半个包。
 *
 * 用法：
 *   node scripts/check-release-version.mjs v1.0.0   # 校验指定 tag（CI 里传 GITHUB_REF_NAME）
 *   node scripts/check-release-version.mjs          # 取 HEAD 上的 v* tag；没有则只校验各处版本是否一致
 *
 * 退出码：0 通过；1 不一致或不合法。
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 读取某个 JSON 文件的 version 字段。 */
function readVersion(relativePath) {
  const full = resolve(repoRoot, relativePath);
  return JSON.parse(readFileSync(full, 'utf8')).version;
}

/** 版本号必须出现且彼此一致的位置（两处 package.json + package-lock 的三处）。 */
function collectVersions() {
  const lock = JSON.parse(readFileSync(resolve(repoRoot, 'package-lock.json'), 'utf8'));
  return [
    { where: 'package.json', value: readVersion('package.json') },
    { where: 'apps/desktop/package.json', value: readVersion('apps/desktop/package.json') },
    { where: 'package-lock.json（root）', value: lock.version },
    { where: 'package-lock.json（packages[""]）', value: lock.packages?.['']?.version },
    {
      where: 'package-lock.json（packages["apps/desktop"]）',
      value: lock.packages?.['apps/desktop']?.version,
    },
  ];
}

/** 取 HEAD 上的 v* tag；工作区不在 git 仓库或没有 tag 时返回 null。 */
function tagAtHead() {
  try {
    const out = execFileSync('git', ['tag', '--points-at', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const tags = out.split('\n').filter((t) => /^v\d/.test(t));
    if (tags.length === 0) return null;
    // 多个 tag 指向同一提交时取版本号最大的那个
    return tags.sort((a, b) =>
      a.localeCompare(b, 'en', { numeric: true }),
    )[tags.length - 1];
  } catch {
    return null;
  }
}

const tag = (process.argv[2] ?? tagAtHead() ?? '').trim();
const versions = collectVersions();
const problems = [];

// 1. 各处版本必须存在且完全一致
const empty = versions.filter((v) => !v.value);
for (const v of empty) problems.push(`${v.where} 缺少 version 字段`);
const distinct = [...new Set(versions.map((v) => v.value).filter(Boolean))];
if (distinct.length > 1) {
  problems.push(
    `各处版本号不一致：${versions.map((v) => `${v.where}=${v.value ?? '(缺失)'}`).join('、')}`,
  );
}

const current = distinct.length === 1 ? distinct[0] : null;

// 2. 有 tag 时，tag 去掉前缀 v 必须与版本完全相同
if (!tag) {
  console.log('ℹ 未指定 tag，且 HEAD 上没有 v* tag：只校验各处版本号是否一致。');
} else {
  if (!/^v\d/.test(tag)) {
    problems.push(`tag "${tag}" 不是 v 开头，不会触发打包 workflow（规则为 tags: ['v*']）`);
  } else {
    const tagVersion = tag.replace(/^v/, '');
    if (current && tagVersion !== current) {
      problems.push(
        `tag 与包版本错位：tag "${tag}" → ${tagVersion}，package.json → ${current}`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error('✖ 发布前校验未通过，已中止：');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\n修复方式：把版本号统一后重新提交，再打与版本一致的 tag。');
  console.error('  需要改动的 5 处：package.json、apps/desktop/package.json、');
  console.error('  package-lock.json 的 version / packages[""].version / packages["apps/desktop"].version。');
  process.exit(1);
}

console.log(
  tag
    ? `✔ tag ${tag} 与包版本 ${current} 一致（已校验 5 处版本号）`
    : `✔ 各处版本号一致：${current}（已校验 5 处）`,
);

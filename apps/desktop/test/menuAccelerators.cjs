/**
 * 菜单快捷键静态检查（纯 Node，无需 Electron）。
 *
 * 目的：在只有 macOS 的环境下，尽可能验证 Windows 那一套快捷键是自洽的。
 * 检查项：
 * 1. macOS / Windows 两套 accelerator 内部不能有重复绑定（同一快捷键触发两个动作）；
 * 2. 每个 accelerator 的修饰键与主键必须是我们支持的写法（避免拼错导致快捷键静默失效）；
 * 3. 平台差异项必须同时给出两套值（key(mac, win)）。
 *
 * 运行：node apps/desktop/test/menuAccelerators.cjs
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const SOURCE = readFileSync(join(__dirname, '../src/main/menu.ts'), 'utf-8');

/** 允许的修饰键 */
const MODIFIERS = new Set(['Command', 'Cmd', 'Control', 'Ctrl', 'CommandOrControl', 'CmdOrCtrl', 'Alt', 'Option', 'Shift', 'Super', 'Meta']);

/** 允许的主键写法 */
const KEY_PATTERN = /^(?:[A-Z0-9]|F\d{1,2}|Plus|Space|Tab|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc|\/|\-|=|\[|\]|,|\.|;|'|`)$/i;

/** 收集结果 */
const failures = [];

/** 校验单个 accelerator 写法是否合法 */
function validate(accelerator) {
  const parts = accelerator.split('+');
  if (parts.length === 1) return KEY_PATTERN.test(parts[0]);
  const mainKey = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  return KEY_PATTERN.test(mainKey) && modifiers.every((mod) => MODIFIERS.has(mod));
}

/** 记录一个平台的全部快捷键 */
const bindings = { mac: [], win: [] };

function add(platform, accelerator, label) {
  bindings[platform].push({ accelerator, label });
}

// 1) key('mac 快捷键', 'win 快捷键')
for (const match of SOURCE.matchAll(/key\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)) {
  add('mac', match[1], 'key()');
  add('win', match[2], 'key()');
}

// 2) accelerator: 'xxx'（两个平台通用）
for (const match of SOURCE.matchAll(/accelerator:\s*'([^']+)'/g)) {
  add('mac', match[1], '直接值');
  add('win', match[1], '直接值');
}

// 3) 检查写法与重复
for (const platform of ['mac', 'win']) {
  const seen = new Map();
  for (const { accelerator } of bindings[platform]) {
    if (!validate(accelerator)) {
      failures.push(`[${platform}] 非法快捷键写法：${accelerator}`);
      continue;
    }
    // 规范化后比较：Ctrl 与 Control 等价
    const normalized = accelerator
      .split('+')
      .map((part) => (part === 'Ctrl' ? 'Control' : part))
      .join('+');
    if (seen.has(normalized)) {
      failures.push(`[${platform}] 快捷键重复：${accelerator}`);
    }
    seen.set(normalized, true);
  }
}

// 4) 平台差异项必须成对出现
const macOnly = bindings.mac.length;
const winOnly = bindings.win.length;
if (macOnly !== winOnly) {
  failures.push(`两平台快捷键数量不一致：mac=${macOnly} win=${winOnly}`);
}

const total = new Set(bindings.mac.map((b) => b.accelerator)).size;
console.log(`检查 ${total} 个快捷键（mac ${macOnly} 项 / win ${winOnly} 项）`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}
console.log('✓ 快捷键写法与唯一性检查通过');

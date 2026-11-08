/**
 * 纯函数单元测试（Node 侧，不需要 Electron / GUI）。
 *
 * 覆盖那些「逻辑一旦写错很难在界面上发现」的纯函数：编码识别、路径转地址、
 * Markdown 简化、源码模式表格上下文与格式化。由 test/run-unit.cjs 用 esbuild
 * 打包后直接执行，因此在 CI 的 Windows runner 上也能跑。
 */

import {
  baseNameOf,
  decodeBytes,
  dirNameOf,
  encodeText,
  stripMarkdown,
  toFileUrl
} from '@ai-md-editor/shared';
import { applySourceFormat, sourceTableContext } from '../src/renderer/sourceActions';
import { extractMath, restoreMath } from '../src/main/mathExport';

let total = 0;
let failed = 0;

/** 断言值相等（对象按 JSON 比较） */
function equal(name: string, actual: unknown, expected: unknown): void {
  total += 1;
  const a = typeof actual === 'object' ? JSON.stringify(actual) : String(actual);
  const b = typeof expected === 'object' ? JSON.stringify(expected) : String(expected);
  if (a === b) {
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.log(`✗ ${name} — 期望 ${b}，实际 ${a}`);
  }
}

/** 断言为真 */
function ok(name: string, condition: boolean, detail = ''): void {
  total += 1;
  if (condition) {
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ===== 编码识别 =====
const utf8Bytes = new TextEncoder().encode('中文 abc');
equal('UTF-8 正常解码', decodeBytes(utf8Bytes), { text: '中文 abc', encoding: 'utf-8' });

const bomBytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8Bytes]);
equal('UTF-8 BOM 被识别并剥离', decodeBytes(bomBytes), { text: '中文 abc', encoding: 'utf-8-bom' });

// 「你好」的 GBK 字节：不是合法 UTF-8，应回退到 GBK
const gbkBytes = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]);
equal('GBK 自动识别', decodeBytes(gbkBytes), { text: '你好', encoding: 'gbk' });

// 「你」的 UTF-16LE 字节 + BOM
const utf16Bytes = new Uint8Array([0xff, 0xfe, 0x60, 0x4f]);
equal('UTF-16LE BOM 识别', decodeBytes(utf16Bytes), { text: '你', encoding: 'utf-16le' });

const utf8Out = encodeText('abc', 'utf-8');
equal('encodeText 无 BOM 时不加前缀', Array.from(utf8Out), [0x61, 0x62, 0x63]);
const bomOut = encodeText('abc', 'utf-8-bom');
equal('encodeText 保留 BOM', Array.from(bomOut), [0xef, 0xbb, 0xbf, 0x61, 0x62, 0x63]);

// ===== 相对路径 → file:// =====
equal('POSIX 路径拼接', toFileUrl('/Users/me/docs', 'img/a.png'), 'file:///Users/me/docs/img/a.png');
equal(
  '中文与空格逐段编码',
  toFileUrl('/Users/me/我的文档', 'img/a b.png'),
  'file:///Users/me/%E6%88%91%E7%9A%84%E6%96%87%E6%A1%A3/img/a%20b.png'
);
equal(
  'Windows 盘符不编码',
  toFileUrl('C:\\docs', 'img\\a.png'),
  'file:///C:/docs/img/a.png'
);
equal('尾部斜杠被归一', toFileUrl('/docs/', './img/a.png'), 'file:///docs/img/a.png');

// ===== 路径片段 =====
equal('baseNameOf 兼容反斜杠', baseNameOf('C:\\docs\\a.md'), 'a.md');
equal('baseNameOf 纯文件名', baseNameOf('a.md'), 'a.md');
equal('dirNameOf 取父目录', dirNameOf('/docs/sub/a.md'), '/docs/sub');
equal('dirNameOf 无分隔符返回空串', dirNameOf('a.md'), '');

// ===== Markdown 简化 =====
// 说明：单个 * 号既可能是斜体也可能是乘号，简化时不做猜测，只去掉成对的强调标记
equal('标题与加粗被剥离', stripMarkdown('# 标题\n\n**加粗**写作'), '标题\n\n加粗写作');
equal('链接与图片取文字', stripMarkdown('[文字](https://a.com) ![图](img/a.png)'), '文字 图');
equal('代码块去掉围栏保留内容', stripMarkdown('```js\nconst a = 1;\n```'), 'const a = 1;');
equal('引用与列表前缀被移除', stripMarkdown('> 引用\n\n- 一\n- 二'), '引用\n一\n二');

// ===== 源码模式表格上下文 =====
const table = '前言\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n结尾';
const headerCaret = table.indexOf('| A');
equal('光标在表头行', sourceTableContext(table, headerCaret), { inTable: true, inHeader: true });

const bodyCaret = table.indexOf('| 1');
equal('光标在数据行', sourceTableContext(table, bodyCaret), { inTable: true, inHeader: false });

const outsideCaret = table.indexOf('结尾');
equal('光标在表格外', sourceTableContext(table, outsideCaret), { inTable: false, inHeader: false });

// 缺少分隔行时不是合法表格
const noSeparator = '| A | B |\n| 1 | 2 |';
equal(
  '缺少分隔行不算表格',
  sourceTableContext(noSeparator, 3),
  { inTable: false, inHeader: false }
);

// ===== 源码模式格式化 =====
const bolded = applySourceFormat('bold', undefined, {
  content: 'abc',
  selectionStart: 0,
  selectionEnd: 3
});
ok(
  '加粗包裹选区',
  bolded.content === '**abc**' && bolded.selectionStart === 2 && bolded.selectionEnd === 5,
  JSON.stringify(bolded)
);

const heading = applySourceFormat('heading', 2, { content: 'abc', selectionStart: 0, selectionEnd: 0 });
equal('标题加前缀', heading.content, '## abc');

const cleared = applySourceFormat('paragraph', undefined, {
  content: '## abc',
  selectionStart: 4,
  selectionEnd: 4
});
equal('段落去掉标题前缀', cleared.content, 'abc');

// ===== 导出用数学公式提取/还原 =====
const math1 = extractMath('行内 $a^2+b^2$ 与块级 $$\\int_0^1 x dx$$ 混排');
// 块级公式先于行内公式提取，所以索引在前
equal(
  '提取行内+块级公式',
  math1.items,
  [
    { tex: '\\int_0^1 x dx', display: true },
    { tex: 'a^2+b^2', display: false }
  ]
);
ok(
  '正文只剩占位符',
  math1.text === '行内 %%MATH1%% 与块级 %%MATH0%% 混排',
  JSON.stringify(math1.text)
);

const math2 = extractMath('代码 `$not_math$` 与围栏：\n```js\nconst x = "$a$";\n```\n结束');
equal('代码里的 $ 不算公式', math2.items, []);
ok(
  '代码段原样还原',
  math2.text.includes('`$not_math$`') && math2.text.includes('const x = "$a$";'),
  JSON.stringify(math2.text)
);

const math3 = extractMath('价格 $5, $10 与 $x$');
equal(
  '货币文本不误判（首尾空白约束）',
  math3.items,
  [{ tex: 'x', display: false }]
);

const math4 = extractMath('$$\nE = mc^2\n$$');
equal('块级公式允许跨行', math4.items, [{ tex: 'E = mc^2', display: true }]);

const restored = restoreMath('<p>%%MATH0%%</p>', [{ tex: 'a^2', display: false }]);
ok(
  '占位符还原为 KaTeX HTML',
  restored.includes('class="katex"') && !restored.includes('%%MATH0%%'),
  restored.slice(0, 80)
);

const fallback = restoreMath('<p>%%MATH0%%</p>', []);
equal('无对应条目时占位符原样保留', fallback, '<p>%%MATH0%%</p>');

const badTex = restoreMath('%%MATH0%%', [{ tex: '\\notacommand{', display: false }]);
// throwOnError:false 时 KaTeX 不抛异常，而是渲染成醒目的 katex-error 标记
ok(
  '非法 TeX 渲染为错误标记（不中断导出）',
  badTex.includes('katex-error'),
  badTex.slice(0, 80)
);

// ===== 结果 =====
console.log(`\n单元测试：${total - failed}/${total} 通过`);
if (failed > 0) process.exitCode = 1;

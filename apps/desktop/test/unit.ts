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
  localImagePath,
  encodeText,
  stripMarkdown,
  toFileUrl,
  moveOutlineSection,
  scanDocLinks
} from '@ai-md-editor/shared';
import { applySourceFormat, sourceTableContext } from '../src/renderer/sourceActions';
import { extractMath, restoreMath } from '../src/main/mathExport';
import { buildLineMatcher, finalizeMatches } from '../src/main/searcher';
import { inlineLocalImages } from '../src/main/exportAssets';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

// ===== 侧栏搜索的行匹配器 =====
const makeInput = (overrides: Partial<Parameters<typeof buildLineMatcher>[0]> = {}) => ({
  root: '',
  query: 'AI',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  ...overrides
});

const plain = buildLineMatcher(makeInput())?.('MAIL 里含 AI 智能体') ?? [];
equal('默认不区分大小写且字面量匹配', plain.length, 2);

const caseSensitive = buildLineMatcher(makeInput({ caseSensitive: true }))?.('mail 里含 AI 智能体') ?? [];
equal('区分大小写只命中大写 AI', caseSensitive.length, 1);

const wholeWord = buildLineMatcher(makeInput({ wholeWord: true }))?.('MAIL AI') ?? [];
equal('全单词不命中 MAIL 里的 AI', wholeWord.length, 1);
ok(
  '全单词命中的列指向独立单词',
  wholeWord[0]?.column === 5 && wholeWord[0]?.length === 2,
  JSON.stringify(wholeWord)
);

const literal = buildLineMatcher(makeInput({ query: 'a.b' }))?.('axb a.b') ?? [];
equal('普通文本把 . 当字面量', literal.length, 1);

const regexMode = buildLineMatcher(makeInput({ query: 'b[ao]na', regex: true }))?.('banana') ?? [];
ok(
  '正则模式命中 banana 里的 bana',
  regexMode[0]?.column === 0 && regexMode[0]?.length === 4,
  JSON.stringify(regexMode)
);

const invalidRegex = buildLineMatcher(makeInput({ query: '[', regex: true }));
equal('非法正则返回 null', invalidRegex, null);

// 正则模式支持 Unicode 属性转义（需要 u 标志，不能直接判非法）
const unicodeRegex = buildLineMatcher(makeInput({ query: '\\p{Script=Han}+', regex: true }))?.('abc 中文 def') ?? [];
ok(
  '正则支持 \\p{Script=Han}（自动带 u 标志）',
  unicodeRegex.length === 1 && unicodeRegex[0]?.column === 4,
  JSON.stringify(unicodeRegex)
);

// 缩进行：展示列号去掉缩进，rawColumn 保留原始位置（源码模式靠它精确定位）
const indentedLine = '  - AI 笔记';
const indented = finalizeMatches(
  buildLineMatcher(makeInput({ query: 'AI' }))?.(indentedLine) ?? [],
  3,
  indentedLine
);
ok(
  '缩进行同时给出展示列与原始列',
  indented[0]?.column === 2 && indented[0]?.rawColumn === 4 && indented[0]?.text === '- AI 笔记',
  JSON.stringify(indented)
);

// ===== 导出：本地图片内联 =====
const assetDir = mkdtempSync(join(tmpdir(), 'mdnote-assets-'));
mkdirSync(join(assetDir, 'img'), { recursive: true });
writeFileSync(join(assetDir, 'img', 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
const inlined = inlineLocalImages(
  '<p><img src="img/a.png" alt="x"><img src="https://example.com/b.png"></p>',
  assetDir
);
ok('导出时把本地图片内联为 data URI', inlined.includes('src="data:image/png;base64,'), inlined);
ok('导出时保留远程图片地址', inlined.includes('src="https://example.com/b.png"'), inlined);
equal(
  '未落盘文档不改动图片地址',
  inlineLocalImages('<img src="img/a.png">', null),
  '<img src="img/a.png">'
);

// ===== 源码模式：删除整个表格 =====
const tailTable = '# 标题\n\n| 列 1 | 列 2 |\n| --- | --- |\n| a | b |\n\n正文';
const tailTableCaret = tailTable.indexOf('| a | b |') + 2;
const deletedTailTable = applySourceFormat('tableDelete', undefined, {
  content: tailTable,
  selectionStart: tailTableCaret,
  selectionEnd: tailTableCaret
});
ok('源码模式删除整表后不再有表格分隔行', !deletedTailTable.content.includes('| --- |'), deletedTailTable.content);
ok(
  '源码模式删除整表后保留表格以外的正文',
  deletedTailTable.content.includes('# 标题') && deletedTailTable.content.includes('正文'),
  deletedTailTable.content
);
equal(
  '光标不在表格内时删除整表保持原样',
  applySourceFormat('tableDelete', undefined, { content: tailTable, selectionStart: 0, selectionEnd: 0 }).content,
  tailTable
);
const onlyTable = '| A | B |\n| --- | --- |\n| 1 | 2 |';
const deletedOnlyTable = applySourceFormat('tableDelete', undefined, {
  content: onlyTable,
  selectionStart: onlyTable.indexOf('| 1 | 2 |') + 2,
  selectionEnd: onlyTable.indexOf('| 1 | 2 |') + 2
});
ok('文档末尾的表格同样能整表删除', !deletedOnlyTable.content.includes('| --- |'), deletedOnlyTable.content);

// ===== 大纲拖动：标题连同整节内容一起搬运 =====
const chapterDoc = [
  '# 第一章',
  '正文一',
  '',
  '## 1.1',
  '小节内容',
  '',
  '### 1.1.1',
  '细节 A',
  '',
  '### 1.1.2',
  '细节 B',
  '',
  '## 1.2',
  '小节二',
  '',
  '# 第二章',
  '正文二',
  ''
].join('\n');
const chapterOutline: { level: number; line: number; index: number; text: string }[] = [
  { level: 1, line: 1, index: 0, text: '第一章' },
  { level: 2, line: 4, index: 1, text: '1.1' },
  { level: 3, line: 7, index: 2, text: '1.1.1' },
  { level: 3, line: 10, index: 3, text: '1.1.2' },
  { level: 2, line: 13, index: 4, text: '1.2' },
  { level: 1, line: 16, index: 5, text: '第二章' }
];
const toFirst = moveOutlineSection(chapterDoc, chapterOutline, 3, 0, 'before');
ok('三级标题能整节搬到文档最前', toFirst.moved && toFirst.text.startsWith('### 1.1.2\n细节 B\n\n# 第一章'), toFirst.text.slice(0, 40));
ok('搬走后原位置不再残留该标题', toFirst.text.indexOf('### 1.1.2') === toFirst.text.lastIndexOf('### 1.1.2'), toFirst.text);
ok('搬运不丢正文', toFirst.text.includes('正文一') && toFirst.text.includes('细节 A') && toFirst.text.includes('正文二'), toFirst.text);
ok('搬运保留结尾换行', toFirst.text.endsWith('\n'), JSON.stringify(toFirst.text.slice(-6)));

const swapSiblings = moveOutlineSection(chapterDoc, chapterOutline, 4, 1, 'before');
ok(
  '同级标题能插到另一个章节之前',
  swapSiblings.moved && swapSiblings.text.indexOf('## 1.2') < swapSiblings.text.indexOf('## 1.1'),
  swapSiblings.text.slice(0, 60)
);

const wholeSection = moveOutlineSection(chapterDoc, chapterOutline, 1, 5, 'after');
ok(
  '带子标题的整节一起搬运',
  wholeSection.moved &&
    wholeSection.text.includes('### 1.1.1') &&
    wholeSection.text.indexOf('# 第二章') < wholeSection.text.indexOf('## 1.1'),
  wholeSection.text.slice(0, 60)
);
ok(
  '整节搬运后子标题紧跟父标题',
  wholeSection.text.includes('## 1.1\n小节内容\n\n### 1.1.1\n细节 A\n\n### 1.1.2\n细节 B'),
  wholeSection.text.slice(-90)
);

equal('拖到自己不改变文档', moveOutlineSection(chapterDoc, chapterOutline, 3, 3, 'after'), {
  text: chapterDoc,
  moved: false
});
equal('拖进自己的父章节内部不改变文档', moveOutlineSection(chapterDoc, chapterOutline, 3, 1, 'after'), {
  text: chapterDoc,
  moved: false
});
equal('越界下标不改变文档', moveOutlineSection(chapterDoc, chapterOutline, 99, 0, 'before'), {
  text: chapterDoc,
  moved: false
});

const frontMatterDoc = '---\ntitle: 示例\n---\n\n# 开头\n\n正文\n\n# 结尾\n';
const frontMatterOutline = [
  { level: 1, line: 5, index: 0, text: '开头' },
  { level: 1, line: 9, index: 1, text: '结尾' }
];
const frontMatterMoved = moveOutlineSection(frontMatterDoc, frontMatterOutline, 1, 0, 'before');
ok(
  'front matter 之后插入而不破坏 YAML 头',
  frontMatterMoved.text.startsWith('---\ntitle: 示例\n---\n\n# 结尾'),
  frontMatterMoved.text.slice(0, 40)
);

// ===== 文档链接 / 图片扫描（「检查链接与图片」的纯函数部分） =====

const scanDoc = [
  '# 标题',
  '',
  '正常链接 [官网](https://example.com) 和 [空链接]() 并排',
  '',
  '![本地图](img/photo.png)',
  '',
  '![远程图](https://example.com/a.png) 与 ![data图](data:image/png;base64,xx)',
  '',
  '```md',
  '代码块里的 [假链接]() 不该被扫到',
  '```',
  '',
  '行内代码 `[也不该扫]()` 外面的 [真空]() 要扫到',
  '',
  '[ref]: https://example.com 引用式定义行跳过',
  '',
  '- 列表里的 ![缩进图片](img/inside.png)'
].join('\n');
const scanResult = scanDocLinks(scanDoc);

equal(
  '空链接扫出 2 处（行内代码里的不算）',
  scanResult.emptyTargets.map((r) => `${r.line}:${r.label}`),
  ['3:空链接', '13:真空']
);
equal(
  '本地图片只含相对路径（远程/data/代码块不进来）',
  scanResult.localImages.map((r) => `${r.line}:${r.target}`),
  ['5:img/photo.png', '17:img/inside.png']
);
{
  const ref = scanResult.localImages[0];
  equal('图片引用的行文本与行号', [ref.line, ref.text], [5, '![本地图](img/photo.png)']);
  ok('空 alt 图片用文件名做定位锚', scanResult.localImages[1].rawColumn > 4, `rawColumn=${scanResult.localImages[1].rawColumn}`);
}
{
  // 绝对路径图片也要进待检查列表（Windows 盘符与 POSIX 根路径都算）
  const absScan = scanDocLinks('![mac](/tmp/a.png)\n![win](C:\\img\\b.png)\n');
  equal('绝对路径图片同样待检查', absScan.localImages.length, 2);
}
equal(
  '带空格尖括号图片路径去掉查询参数后待检查',
  scanDocLinks('![空格](<img/missing image.png?raw=1#view>)').localImages.map((ref) => ref.target),
  ['img/missing image.png?raw=1#view']
);
equal('图片目标解析会去掉查询参数与片段', localImagePath('img/photo%20one.png?raw=1#view'), 'img/photo one.png');
equal('协议相对图片不当作本地文件', localImagePath('//cdn.example.com/photo.png'), null);
equal('远程图片地址不当作本地文件', localImagePath('https://example.com/photo.png'), null);
equal('空文档扫描结果为空', scanDocLinks(''), { emptyTargets: [], localImages: [] });

// ===== 结果 =====
console.log(`\n单元测试：${total - failed}/${total} 通过`);
if (failed > 0) process.exitCode = 1;

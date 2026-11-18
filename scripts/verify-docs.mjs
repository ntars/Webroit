/**
 * README 事实校验。
 *
 * 文档里的数字会随代码漂移：加了几个文件、改了几行、产物变大变小，
 * README 不会自动跟着变，读者拿到的就是错的。这个脚本在 CI 里跑，
 * 把「可以从仓库现状重新算出来」的数字全部核对一遍，不一致就让构建失败。
 *
 * 只校验能确定性重算的事实。主观描述、性能体感、外部链接状态不在范围内。
 *
 * 用法：node scripts/verify-docs.mjs [--json]
 * 退出码：0 全部一致；1 有不一致
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = join(ROOT, 'README.md');
const README_EN = join(ROOT, 'README_EN.md');
const JSON_OUT = process.argv.includes('--json');

/* ─────────────── 采集事实 ─────────────── */

/** 源文件与总行数。口径：src 下所有 .ts / .tsx / .css，排除 dev-preview 调试入口 */
function sourceStats() {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|css)$/.test(name)) files.push(full);
    }
  };
  walk(join(ROOT, 'src'));

  const counted = files.filter((f) => !f.endsWith('dev-preview.tsx'));
  // 行数按 wc -l 口径：只数换行符，文件末尾没换行的最后一行不计。
  // 与开发者在终端里 `wc -l` 看到的结果保持一致，避免同一事实两个数。
  const lines = counted.reduce(
    (sum, f) => sum + (readFileSync(f, 'utf8').match(/\n/g) ?? []).length,
    0,
  );
  return { files: counted.length, lines };
}

/** 构建产物：文件数、总字节、各条目 gzip 字节 */
function distStats() {
  const dir = join(ROOT, 'dist');
  if (!existsSync(dir)) return null;

  const all = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else all.push(full);
    }
  };
  walk(dir);

  const total = all.reduce((s, f) => s + statSync(f).size, 0);

  const byPattern = (re) => all.find((f) => re.test(f));
  const entry = byPattern(/assets\/index-.*\.js$/);
  const css = byPattern(/assets\/index-.*\.css$/);
  const adb = byPattern(/assets\/adb-.*\.js$/);
  const html = byPattern(/index\.html$/);

  const gz = (f) => (f ? gzipSync(readFileSync(f)).length : 0);
  const raw = (f) => (f ? statSync(f).size : 0);

  return {
    count: all.length,
    totalBytes: total,
    entryRaw: raw(entry),
    entryGz: gz(entry),
    cssRaw: raw(css),
    cssGz: gz(css),
    adbRaw: raw(adb),
    adbGz: gz(adb),
    htmlRaw: raw(html),
    htmlGz: gz(html),
    firstScreenRaw: raw(entry) + raw(css) + raw(html),
    firstScreenGz: gz(entry) + gz(css) + gz(html),
  };
}

/**
 * 工具数量。
 *
 * 直接读源码数 `id: '` 会漏掉品牌工具的模板字符串（`vendor.${v}.scan`），
 * 所以用 esbuild 打成 bundle 后取运行时数组长度，得到的是真实注册数。
 */
async function toolStats() {
  const out = join(ROOT, '.verify-tools.tmp.bundle.mjs');
  try {
    execFileSync(
      join(ROOT, 'node_modules/.bin/esbuild'),
      ['src/tools/builtin.ts', '--bundle', '--format=esm', '--platform=node', `--outfile=${out}`, '--log-level=error'],
      { cwd: ROOT, stdio: 'pipe' },
    );
    const mod = await import(`file://${out}?t=${Date.now()}`);
    const all = mod.BUILTIN_TOOLS ?? [];
    const vendorTools = all.filter((t) => t.module === 'vendor');
    const brands = [...new Set(vendorTools.map((t) => t.vendor))];
    const generic = all.length - vendorTools.length;
    return { total: all.length, generic, perBrand: generic + 2, brands: brands.length };
  } finally {
    if (existsSync(out)) unlinkSync(out);
  }
}

/**
 * 单元测试用例数。
 *
 * 直接数源码里的 `it(` 不可靠（循环、`it.each`、跳过都会算错），
 * 所以真跑一遍 vitest 取 JSON 报告里的总数 —— 这个数字才是 CI 里实际通过的用例数。
 * 代价是多跑一次测试（约 0.2 秒），换来文档里的数字永远等于真实结果。
 */
function testStats() {
  const out = join(tmpdir(), `webroit-vitest-${process.pid}.json`);
  try {
    execFileSync(
      join(ROOT, 'node_modules/.bin/vitest'),
      ['run', '--reporter=json', `--outputFile=${out}`],
      { cwd: ROOT, stdio: 'pipe' },
    );
    const report = JSON.parse(readFileSync(out, 'utf8'));
    return {
      files: report.testResults?.length ?? 0,
      total: report.numTotalTests ?? 0,
      passed: report.numPassedTests ?? 0,
    };
  } catch (error) {
    // 测试跑挂时既可能没有报告也可能有部分报告：都当作「无法重算」处理
    return { error: error instanceof Error ? error.message.split('\n')[0] : String(error) };
  } finally {
    rmSync(out, { force: true });
  }
}

/** any 使用分布。先剥掉注释再数，避免文档里提到 `as any` 被误算 */
function anyStats() {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name)) files.push(full);
    }
  };
  walk(join(ROOT, 'src'));

  const re = /(?::\s*any\b)|(?:<any>)|(?:\bas\s+any\b)|(?:\bany\[\])/g;
  const stripComments = (code) =>
    code
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:\\])\/\/.*$/gm, '$1');

  const perFile = new Map();
  for (const f of files) {
    const n = (stripComments(readFileSync(f, 'utf8')).match(re) ?? []).length;
    if (n) perFile.set(f.replace(ROOT + '/', ''), n);
  }
  const total = [...perFile.values()].reduce((a, b) => a + b, 0);
  return { total, perFile, cleanFiles: files.length - perFile.size, files: files.length };
}

/* ─────────────── 校验 ─────────────── */

const checks = [];
/** real = 从仓库重新算出的值，doc = README 里写的值 */
const fail = (name, real, doc, note) => checks.push({ ok: false, name, real, doc, note });
const pass = (name, value) => checks.push({ ok: true, name, value });

const readme = readFileSync(README, 'utf8');
const readmeEn = existsSync(README_EN) ? readFileSync(README_EN, 'utf8') : '';

const near = (a, b, tol = 0.06) => Math.abs(a - b) / Math.max(b, 1) <= tol;
const kb = (bytes) => (bytes / 1024).toFixed(1);

// 1. 源文件数与行数
{
  const { files, lines } = sourceStats();
  const m = readme.match(/代码规模 \| (\d+) 个源文件、([\d,]+) 行/);
  if (!m) fail('README 代码规模条目', '存在', '未找到');
  else {
    m[1] === String(files)
      ? pass('源文件数', files)
      : fail('源文件数', files, m[1], 'README 表格「代码规模」');
    const claimed = Number(m[2].replace(/,/g, ''));
    near(claimed, lines)
      ? pass('代码总行数', `${lines}（README 记 ${claimed}）`)
      : fail('代码总行数', lines, claimed);
  }
}

// 2. 产物规模
{
  const d = distStats();
  if (!d) fail('dist 存在', '已构建', '缺失', 'CI 里须在 build 之后运行');
  else {
    const m = readme.match(/产物规模 \| (\d+) KB \/ (\d+) 个文件/);
    if (!m) fail('README 产物规模条目', '存在', '未找到');
    else {
      near(Number(m[1]), d.totalBytes / 1024, 0.05)
        ? pass('产物总 KB', kb(d.totalBytes))
        : fail('产物总 KB', kb(d.totalBytes), m[1]);
      m[2] === String(d.count)
        ? pass('产物文件数', d.count)
        : fail('产物文件数', d.count, m[2]);
    }

    // 12.1 表格里的 gzip 数字
    const rows = [
      [/`index-\*\.js` \| ([\d.]+) KB \| ([\d.]+) KB/, d.entryRaw, d.entryGz, 'index-*.js'],
      [/`index-\*\.css` \| ([\d.]+) KB \| ([\d.]+) KB/, d.cssRaw, d.cssGz, 'index-*.css'],
      [/`adb-\*\.js` \| ([\d.]+) KB \| ([\d.]+) KB/, d.adbRaw, d.adbGz, 'adb-*.js'],
      [/`index\.html` \| ([\d.]+) KB \| ([\d.]+) KB/, d.htmlRaw, d.htmlGz, 'index.html'],
    ];
    for (const [re, rawB, gzB, label] of rows) {
      const mm = readme.match(re);
      if (!mm) { fail(`${label} 性能行`, '存在', '未找到'); continue; }
      const okRaw = near(Number(mm[1]), rawB / 1024, 0.05);
      const okGz = near(Number(mm[2]), gzB / 1024, 0.05);
      okRaw && okGz
        ? pass(`${label} 体积`, `${kb(rawB)} / ${kb(gzB)} KB`)
        : fail(`${label} 体积`, `${kb(rawB)} / ${kb(gzB)} KB`, `${mm[1]} / ${mm[2]} KB`);
    }
  }
}

// 3. 工具数量
{
  const t = await toolStats();
  if (!/当前 26 项功能/.test(readme)) fail('README 工具总数声明', 26, null, '未找到「当前 26 项功能」');
  else if (t.perBrand === 26) pass('品牌设备工具数', 26);
  else fail('品牌设备工具数', t.perBrand, 26);

  if (!/原生 Android 设备显示 24 项/.test(readme)) fail('24 项分支说明', 24, null, '未找到');
  else if (t.generic === 24) pass('通用设备工具数', 24);
  else fail('通用设备工具数', t.generic, 24);

  if (!/34 个 `Tool` 对象/.test(readme)) fail('Tool 对象总数声明', t.total, null, '未找到「34 个 Tool 对象」');
  else if (t.total === 34) pass('Tool 对象总数', 34);
  else fail('Tool 对象总数', t.total, 34);

  if (t.brands !== 5) fail('品牌数', t.brands, 5, '文档按 5 个品牌描述');
  else pass('品牌数', 5);
}

// 4. any 分布
{
  const a = anyStats();
  const driverAny = a.perFile.get('src/core/transport/driver.ts') ?? 0;

  // 文档措辞：只有 driver.ts 用 any，共 N 处，其余 M 个文件零 any
  const m = readme.match(/共 (\d+) 处`?/) ?? readme.match(/(\d+) 处 `any`/);
  const m2 = readme.match(/其余 (\d+) 个文件零 `any`/);

  if (!m) fail('driver any 处数声明', driverAny, null, '未找到「共 N 处」');
  else if (Number(m[1]) === driverAny) pass('driver any 处数', driverAny);
  else fail('driver any 处数', driverAny, Number(m[1]), '新增 any 要么修掉、要么同步文档');

  if (!m2) fail('零 any 文件数声明', a.cleanFiles, null, '未找到「其余 N 个文件零 any」');
  else if (Number(m2[1]) === a.cleanFiles) pass('零 any 文件数', a.cleanFiles);
  else fail('零 any 文件数', a.cleanFiles, Number(m2[1]));

  if (!/只有 `src\/core\/transport\/driver\.ts` 一个文件用了 `any`/.test(readme)) {
    fail('any 仅限 driver.ts 的声明', '存在', null, '未找到该句');
  } else if (a.total === driverAny) pass('any 仅存在于 driver.ts', a.total);
  else {
    const others = [...a.perFile.entries()]
      .filter(([f]) => f !== 'src/core/transport/driver.ts')
      .map(([f, n]) => `${f}: ${n}`)
      .join('、');
    fail('any 仅存在于 driver.ts', others || '无', '仅 driver.ts');
  }
}

// 5. 单元测试用例数
{
  const t = testStats();
  if (t.error) {
    fail('单元测试', '可运行', `运行失败：${t.error}`);
  } else {
    const zh = readme.match(/共 (\d+) 个文件、(\d+) 个用例/);
    if (!zh) fail('README 单元测试用例数声明', t.total, null, '未找到「共 N 个文件、M 个用例」');
    else {
      Number(zh[1]) === t.files
        ? pass('测试文件数', t.files)
        : fail('测试文件数', t.files, Number(zh[1]), 'README「共 N 个文件」');
      Number(zh[2]) === t.total
        ? pass('单元测试用例数', t.total)
        : fail('单元测试用例数', t.total, Number(zh[2]), 'README「M 个用例」');
    }

    if (readmeEn) {
      const en = readmeEn.match(/(\d+) files, (\d+) cases/);
      if (!en) fail('README_EN 单元测试声明', t.total, null, '未找到「N files, M cases」');
      else if (Number(en[1]) === t.files && Number(en[2]) === t.total) pass('README_EN 单元测试用例数', t.total);
      else fail('README_EN 单元测试用例数', `${t.files} 文件 / ${t.total} 用例`, `${en[1]} / ${en[2]}`);
    }

    if (t.passed !== t.total) fail('单元测试全部通过', `${t.passed}/${t.total}`, '全部通过');
    else pass('单元测试全部通过', `${t.passed}/${t.total}（${t.files} 个文件）`);
  }
}

// 6. 中英文档章节数一致
if (readmeEn) {
  const count = (text, re) => (text.match(re) ?? []).length;
  const h2zh = count(readme, /^## /gm);
  const h2en = count(readmeEn, /^## /gm);
  const h3zh = count(readme, /^### /gm);
  const h3en = count(readmeEn, /^### /gm);
  h2zh === h2en ? pass('中英文二级标题数', h2zh) : fail('中英文二级标题数', `${h2zh} vs ${h2en}`, '');
  h3zh === h3en ? pass('中英文三级标题数', h3zh) : fail('中英文三级标题数', `${h3zh} vs ${h3en}`, '');
} else fail('README_EN.md', '存在', '缺失');

/* ─────────────── 输出 ─────────────── */

const failed = checks.filter((c) => !c.ok);

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
} else {
  console.log('README 事实校验\n');
  for (const c of checks) {
    console.log(
      c.ok
        ? `  ✓ ${c.name}：${c.value}`
        : `  ✗ ${c.name}：文档写 ${c.doc}，实际 ${c.real}${c.note ? `（${c.note}）` : ''}`,
    );
  }
  console.log(
    `\n${checks.length} 项，通过 ${checks.length - failed.length}，失败 ${failed.length}`,
  );
  if (failed.length) {
    console.log('\n文档与代码不一致。请更新 README.md 后重新提交。');
  }
}

process.exit(failed.length === 0 ? 0 : 1);

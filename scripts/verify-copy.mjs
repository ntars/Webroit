/**
 * 界面文案审计。
 *
 * 这个脚本守的是一条很具体的规矩：**任何一处失败提示，都必须同时给出
 * 「发生了什么」和「现在做什么」**。只写「操作失败」「未知错误」的红条
 * 等于把问题原样丢回给用户 —— 他不知道该插线、该改参数，还是该换浏览器。
 *
 * 检查分两部分：
 *
 * A. 运行时行为（真跑一遍 src/core/error-copy.ts）
 *    对四类情形的代表作逐条断言：原因非空、出口是动作、无零信息短语、
 *    同一原文不会同时命中两条互斥的出口。
 *
 * B. 静态扫描（读源码文本）
 *    找两类会绕过翻译层的写法：直接把异常原样塞进界面的 `<p>{error}</p>`，
 *    以及自己拼 `instanceof Error ? x.message : String(x)`。
 *    后者本身不错，但散落各处就意味着没有人负责「翻译成出口」这一步。
 *
 * 用法：node scripts/verify-copy.mjs [--json]
 * 退出码：0 全过；1 有不达标项
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_OUT = process.argv.includes('--json');

const checks = [];
const pass = (name, value) => checks.push({ ok: true, name, value });
const fail = (name, detail, note) => checks.push({ ok: false, name, detail, note });

/* ─────────────── A. 运行时：翻译层的行为 ─────────────── */

/**
 * 四类情形 × 代表性原文。
 *
 * 原文全部取自真实可能出现的文本（包内错误类、adb 输出、我们自己抛的错），
 * 不是编的：写脚本验证不存在的东西毫无意义。
 */
const SCENARIOS = [
  {
    label: '未连接设备',
    samples: [
      '当前浏览器不支持 WebUSB',
      '未选择设备',
      '当前 ADB 接口被占用，请结束本机 adb.exe 进程或其他 WebADB 页面后重试',
      'error: device unauthorized',
    ],
  },
  {
    label: '无工具结果',
    // 空结果不是异常，走的是组件里的空态文案；翻译层对应「设备没返回内容」
    samples: ['设备没有返回命令退出状态', '设备返回了无效退出状态'],
  },
  {
    label: '命令失败',
    samples: [
      'Permission denied',
      'sh: dumpsys: inaccessible or not found',
      'Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]',
      'INSTALL_FAILED_UPDATE_INCOMPATIBLE',
      'Failure [INSTALL_FAILED_TEST_ONLY]',
      'ETIMEDOUT',
      '完全没见过的一条厂商私有报错 0x7f',
    ],
  },
  {
    label: '设备断开',
    samples: ['设备已断开', 'error: closed', 'device offline', '用户已取消'],
  },
];

async function loadCopyModule() {
  const out = join(ROOT, '.verify-copy.tmp.bundle.mjs');
  try {
    execFileSync(
      join(ROOT, 'node_modules/.bin/esbuild'),
      [
        'src/core/error-copy.ts',
        '--bundle',
        '--format=esm',
        '--platform=node',
        `--outfile=${out}`,
        '--log-level=error',
      ],
      { cwd: ROOT, stdio: 'pipe' },
    );
    return await import(`file://${out}?t=${Date.now()}`);
  } finally {
    if (existsSync(out)) unlinkSync(out);
  }
}

const copy = await loadCopyModule();
const { explainError, VAGUE_PHRASES } = copy;

if (typeof explainError !== 'function') {
  fail('翻译层可加载', '缺少 explainError 导出', 'src/core/error-copy.ts');
} else {
  let total = 0;
  const problems = [];

  for (const scenario of SCENARIOS) {
    for (const sample of scenario.samples) {
      total++;
      const result = explainError(new Error(sample));

      // 1. 原因必须有内容，且不能是零信息短语
      if (!result.reason || result.reason.trim().length < 4) {
        problems.push(`[${scenario.label}] 「${sample}」原因为空`);
      }
      // 2. 出口必须是句子（带动作），不是名词
      if (!result.next || result.next.trim().length < 12) {
        problems.push(`[${scenario.label}] 「${sample}」出口太短，未给出可执行动作`);
      }
      // 3. 两句都不能含零信息短语
      for (const vague of VAGUE_PHRASES) {
        if (result.reason.includes(vague) || result.next.includes(vague)) {
          problems.push(`[${scenario.label}] 「${sample}」出现零信息短语「${vague}」`);
        }
      }
      // 4. 原文必须保留（认不出的错误也靠它排查）
      if (result.raw === undefined || result.raw === null) {
        problems.push(`[${scenario.label}] 「${sample}」丢失原始报错`);
      }
    }
  }

  problems.length === 0
    ? pass('四种情形均有原因与出口', `${SCENARIOS.length} 类 / ${total} 条原文`)
    : fail('四种情形文案', `${problems.length} 处不达标`, problems.join('；'));

  /*
   * 互斥性：同一个原文不能既说「重连」又说「改参数」。
   * 这里挑的是几组最容易串味的情况 —— 它们原文里都含 error/permission，
   * 规则顺序一错就会互相覆盖。
   */
  const conflicts = [
    ['Permission denied', 'inaccessible or not found'],
    ['error: device offline', 'unauthorized'],
    ['用户已取消', 'error: closed'],
  ];
  const bad = [];
  for (const [a, b] of conflicts) {
    const ea = explainError(new Error(a));
    const eb = explainError(new Error(b));
    if (ea.next === eb.next) bad.push(`「${a}」与「${b}」出口相同`);
    if (ea.kind === eb.kind) bad.push(`「${a}」与「${b}」被判为同一类（${ea.kind}）`);
  }
  bad.length === 0
    ? pass('相邻错误类别不串味', `${conflicts.length} 组对照`)
    : fail('错误类别互斥', bad.length, bad.join('；'));

  // 兜底也必须可执行：随便给一个垃圾字符串，出口不能退化
  const fallback = explainError(new Error('zzz'));
  fallback.kind === 'unknown' && fallback.next.length >= 12
    ? pass('未知错误兜底可执行', fallback.next.slice(0, 24) + '…')
    : fail('未知错误兜底', fallback.next, '兜底未给出可执行动作');
}

/* ─────────────── B. 静态：界面是否绕过翻译层 ─────────────── */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

const uiFiles = walk(join(ROOT, 'src/ui'));

/**
 * 违规写法：把异常原文直接当正文渲染。
 *
 * 允许的例外是没有异常语义的路径 —— 「读取失败」这类标题 + `{error}` 正文
 * 若 error 已经是 Explanation 对象，Form 结构就不一样了，不会命中这条正则。
 */
const BARE_RENDER = /<p>\s*\{error\}\s*<\/p>/;
const INLINE_STRINGIFY = /caught instanceof Error \? caught\.message : String\(caught\)/;

const bareHits = [];
const stringifyHits = [];
for (const file of uiFiles) {
  const text = readFileSync(file, 'utf8');
  const rel = file.replace(ROOT + '/', '');
  // 逐行判断，避免多行 JSX 被整块吞掉
  text.split('\n').forEach((line, index) => {
    if (BARE_RENDER.test(line)) bareHits.push(`${rel}:${index + 1}`);
    if (INLINE_STRINGIFY.test(line)) stringifyHits.push(`${rel}:${index + 1}`);
  });
}

bareHits.length === 0
  ? pass('无裸异常直出', `${uiFiles.length} 个 tsx 文件`)
  : fail('裸异常直出界面', bareHits.length, bareHits.join('、'));

stringifyHits.length === 0
  ? pass('无手写错误字符串化', `${uiFiles.length} 个 tsx 文件`)
  : fail('手写错误字符串化', stringifyHits.length, stringifyHits.join('、'));

/* 四类情形的落点必须都在：找到承载它们的组件才算闭环 */
const REQUIRED = [
  ['未连接设备', 'src/ui/components/NeedsDevice.tsx', /浏览器不支持 WebUSB/],
  ['无工具结果', 'src/ui/components/ResultView.tsx', /没有返回任何条目/],
  ['命令失败', 'src/ui/components/ErrorNotice.tsx', /error-notice__next/],
  ['设备断开', 'src/ui/App.tsx', /连接已中断/],
];

const missing = [];
for (const [label, rel, re] of REQUIRED) {
  const full = join(ROOT, rel);
  if (!existsSync(full)) missing.push(`${label}：缺少 ${rel}`);
  else if (!re.test(readFileSync(full, 'utf8'))) missing.push(`${label}：${rel} 里没有对应文案`);
}
missing.length === 0
  ? pass('四类情形均有承载组件', REQUIRED.map((r) => r[0]).join(' / '))
  : fail('四类情形承载组件', missing.length, missing.join('；'));

/* ─────────────── 输出 ─────────────── */

const failed = checks.filter((c) => !c.ok);

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
} else {
  console.log('界面文案审计\n');
  for (const c of checks) {
    console.log(
      c.ok
        ? `  ✓ ${c.name}：${c.value}`
        : `  ✗ ${c.name}：${c.detail}${c.note ? `（${c.note}）` : ''}`,
    );
  }
  console.log(`\n${checks.length} 项，通过 ${checks.length - failed.length}，失败 ${failed.length}`);
}

process.exit(failed.length === 0 ? 0 : 1);

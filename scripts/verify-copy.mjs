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

function walk(dir, out = [], pattern = /\.tsx$/) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out, pattern);
    else if (pattern.test(name)) out.push(full);
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

/* ─────────────── C. 反馈通路：toast 必须有出口 ─────────────── */

/*
 * A 段守的是「提示写得清不清楚」，C 段守的是「提示到底出不出得来」。
 *
 * 这两件事曾经同时是坏的：`toast()` 写得好好的，18 处调用点分布在 8 个文件里，
 * 但 `toasts` 信号没有任何订阅者。文案再清楚，进了内存就等于没写 ——
 * 用户点「卸载应用」，界面毫无变化，他只能再点一次。
 *
 * 所以这里断言的是一条链，三环缺一不可：
 *   1. 有人发（`toast(` 调用点数 > 0）
 *   2. 有人收（存在读 `toasts` 信号的组件）
 *   3. 收的人被挂上了（`App.tsx` 里真的渲染了它）
 *
 * 第 3 环最容易断：组件写好了、测试也过了，但忘了挂到外壳上，
 * 或者只在正常分支挂、漏了应急页分支 —— 后者是真实踩过的坑。
 */

/** 数出真正发消息的调用点：排除 `dismissToast(` 与函数自身定义 */
function countToastCalls() {
  let calls = 0;
  const perFile = [];
  for (const file of walk(join(ROOT, 'src'), [], /\.tsx?$/)) {
    const text = readFileSync(file, 'utf8');
    let hits = 0;
    for (const line of text.split('\n')) {
      // 跳过注释行：本仓库的注释会引用 `toast()` 说明设计意图，不该计入
      const t = line.trim();
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue;
      // `export function toast(` 是定义，不是调用
      if (/export function toast\s*\(/.test(line)) continue;
      if (/\btoast\s*\(/.test(line)) hits++;
    }
    if (hits > 0) {
      calls += hits;
      perFile.push(`${file.replace(ROOT + '/', '')}(${hits})`);
    }
  }
  return { calls, perFile };
}

/** 找出订阅了 `toasts` 信号的组件（从 app-state 导入并读取） */
function findToastConsumer() {
  for (const file of walk(join(ROOT, 'src/ui'))) {
    const text = readFileSync(file, 'utf8');
    const importsToasts = /\btoasts\b/.test(text) && /from\s+'@\/ui\/state\/app-state'/.test(text);
    if (!importsToasts) continue;    // 消费 = 把信号交给订阅原语，而不是只 import 了名字
    if (/useSignal\s*\(\s*toasts\s*\)/.test(text)) return file;
  }
  return null;
}

const { calls, perFile } = countToastCalls();
const consumer = findToastConsumer();

if (calls === 0) {
  // 一条提示都不发时，「有出口」无从谈起，但也不该判失败 —— 记录事实即可
  pass('提示调用点', '0 处（无提示文案需要出口）');
} else if (!consumer) {
  fail(
    '提示有出口',
    `${calls} 处调用但无消费组件`,
    `没有任何组件用 useSignal(toasts) 订阅提示队列，用户看不到这些提示：${perFile.join('、')}`,
  );
} else {
  const rel = consumer.replace(ROOT + '/', '');
  const appText = readFileSync(join(ROOT, 'src/ui/App.tsx'), 'utf8');
  // 组件名从文件名推：ToastHost.tsx → ToastHost
  const name = rel.split('/').pop().replace(/\.tsx$/, '');

  if (!appText.includes(`<${name}`)) {
    fail('提示已挂载', `${rel} 未被 App.tsx 渲染`, `外壳里找不到 <${name} />`);
  } else {
    /*
     * 应急页分支必须单独确认。
     *
     * 这一页 return 得早（`if (emergency) return <EmergencyReset />`），
     * 外壳末尾挂的提示层根本走不到。而它自己就有 2 处 toast 调用 ——
     * 「重置分辨率」这种救命操作的结果提示，恰恰是最不能丢的那条。
     */
    const earlyReturn = /if\s*\(\s*emergency\s*\)\s*\{?\s*return\s*\(?([\s\S]{0,200})/.exec(appText);
    const covered = earlyReturn ? earlyReturn[1].includes(`<${name}`) : false;
    covered
      ? pass('提示有出口', `${calls} 处调用 → ${rel}，含应急页分支`)
      : fail(
          '应急页提示通路',
          `${rel} 未覆盖 emergency 分支`,
          '应急页提前 return，尾部挂载的提示层走不到，而该页有 toast 调用',
        );
  }
}

/* ─────────────── D. 进度通路：传输进度必须有出口 ─────────────── */

/*
 * 与 C 段同构，但守的是另一种缺陷：**上报口存在、信号存在、渲染层不存在**。
 *
 * 这轮的实况正是如此：`progress` 信号与 `setProgress()` 都写好了，
 * 注释里也写着「用于安装 / 推送的进度条」，但全仓没有一处订阅它，
 * 而 `use-connect` 把逐块回调拼成终端文本行 —— 100 MB 的包约 1600 次回调，
 * 80 ms 的合并窗口把它们全塞进同一个 DOM 文本节点，宽度撑到几万像素。
 *
 * 于是「有进度」和「看得到进度」是两件事。这里断言三环：
 *   1. 有人发（`reportProgress(` / `progressSink` 被真实调用）
 *   2. 有人收（组件里 `useSignal(progress)`）
 *   3. 收的人被挂上了（`App.tsx` 渲染了它）
 *
 * 第四环单独断言：进度不能再回到终端文本里。这条最容易被「顺手加一行
 * pushOutput 显示百分比」重新破坏，而那正是本轮要修掉的东西。
 */

/** 数出真正推进度的调用点 */
function countProgressCalls() {
  const perFile = [];
  let calls = 0;
  for (const file of walk(join(ROOT, 'src'), [], /\.tsx?$/)) {
    const rel = file.replace(ROOT + '/', '');
    // 定义处不算调用；降频层自己是纯函数，不碰信号
    if (rel === 'src/ui/state/app-state.ts' || rel.startsWith('src/ui/state/progress')) continue;
    const text = readFileSync(file, 'utf8');
    let hits = 0;
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue;
      if (/\breportProgress\s*\(/.test(line)) hits++;
      if (/\bprogressSink\b/.test(line) && !/import\b/.test(line)) hits++;
    }
    if (hits > 0) {
      calls += hits;
      perFile.push(`${rel}(${hits})`);
    }
  }
  return { calls, perFile };
}

/** 找出订阅了 `progress` 信号的组件 */
function findProgressConsumer() {
  for (const file of walk(join(ROOT, 'src/ui/components'))) {
    const text = readFileSync(file, 'utf8');
    if (!/from\s+'@\/ui\/state\/app-state'/.test(text)) continue;
    if (/useSignal\s*\(\s*progress\s*\)/.test(text)) return file;
  }
  return null;
}

const progressCalls = countProgressCalls();
const progressConsumer = findProgressConsumer();

if (progressCalls.calls === 0) {
  fail(
    '进度有上报',
    '全仓无进度上报调用',
    'services 层会逐块回调进度，但界面侧没有任何人接它 —— 传输过程对用户不可见',
  );
} else if (!progressConsumer) {
  fail(
    '进度有出口',
    `${progressCalls.calls} 处上报但无消费组件`,
    `没有组件用 useSignal(progress) 订阅进度：${progressCalls.perFile.join('、')}`,
  );
} else {
  const rel = progressConsumer.replace(ROOT + '/', '');
  const name = rel.split('/').pop().replace(/\.tsx$/, '');
  const appText = readFileSync(join(ROOT, 'src/ui/App.tsx'), 'utf8');

  if (!appText.includes(`<${name}`)) {
    fail('进度已挂载', `${rel} 未被 App.tsx 渲染`, `外壳里找不到 <${name} />`);
  } else {
    pass('进度有出口', `${progressCalls.calls} 处上报 → ${rel}，已挂载外壳`);
  }
}

/*
 * 反向断言：进度不许再走终端文本。
 *
 * 判据是「同一行里既出现进度相关字样、又出现 pushOutput」——
 * 上一版正是 `pushOutput('info', `${label}：${done} / ${total}`)`。
 * 注释行与 doc 引用不算（本仓库注释会引用旧写法说明为什么要改）。
 */
function findProgressInTerminal() {
  const hits = [];
  for (const file of walk(join(ROOT, 'src'), [], /\.tsx?$/)) {
    const rel = file.replace(ROOT + '/', '');
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim();
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue;
      if (!/pushOutput\s*\(/.test(line)) continue;
      // 只抓「把 done/total/百分比写进终端」这一种写法
      if (/\$\{\s*(done|total|percent)\b|done\s*\/\s*total/.test(line)) {
        hits.push(`${rel}: ${t.slice(0, 80)}`);
      }
    }
  }
  return hits;
}

const progressInTerminal = findProgressInTerminal();
progressInTerminal.length === 0
  ? pass('进度不进终端文本', '逐块回调已全部走进度条')
  : fail(
      '进度不进终端文本',
      progressInTerminal,
      '逐块进度拼进终端会被 80 ms 合并窗口塞进同一个 DOM 节点，宽度撑爆面板',
    );

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

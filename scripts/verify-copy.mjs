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

/*
 * 扫描范围分两套。
 *
 * `BARE_RENDER` 是 JSX 形状（`<p>{error}</p>`），只可能出现在 `.tsx` 里。
 * 而手写字符串化是纯 TS 写法 —— 本轮就在 `src/ui/hooks/use-connect.ts`
 * 里发现了一处，原脚本只扫 `.tsx`，于是它一直没被抓住。
 * 「界面层绕过翻译层」与文件扩展名无关，`.ts` 里的 hook 一样会往界面写文案。
 */
const uiTsxFiles = walk(join(ROOT, 'src/ui'), [], /\.tsx$/);
const uiFiles = walk(join(ROOT, 'src/ui'), [], /\.tsx?$/);

/**
 * 违规写法：把异常原文直接当正文渲染。
 *
 * 允许的例外是没有异常语义的路径 —— 「读取失败」这类标题 + `{error}` 正文
 * 若 error 已经是 Explanation 对象，Form 结构就不一样了，不会命中这条正则。
 */
const BARE_RENDER = /<p>\s*\{error\}\s*<\/p>/;
/*
 * 手写字符串化。
 *
 * 原来的正则写死了变量名 `caught`，于是 `error instanceof Error ? error.message : String(error)`
 * 这类换名写法全都漏过去了 —— 本轮在 `use-connect` 里就发现一处。
 * 现在按形状匹配：任意标识符 + `instanceof Error` + `.message`，名字不限。
 */
const INLINE_STRINGIFY = /\b\w+\s+instanceof\s+Error\s*\?\s*\w+\.message\s*:\s*String\s*\(/;

const bareHits = [];
const stringifyHits = [];
for (const file of uiFiles) {
  const text = readFileSync(file, 'utf8');
  const rel = file.replace(ROOT + '/', '');
  const isTsx = file.endsWith('.tsx');
  // 逐行判断，避免多行 JSX 被整块吞掉
  text.split('\n').forEach((line, index) => {
    // JSX 形状只可能在 .tsx 里出现；在 .ts 里搜它是白费力气，还会误报字符串里的示例
    if (isTsx && BARE_RENDER.test(line)) bareHits.push(`${rel}:${index + 1}`);
    if (INLINE_STRINGIFY.test(line)) stringifyHits.push(`${rel}:${index + 1}`);
  });
}

bareHits.length === 0
  ? pass('无裸异常直出', `${uiTsxFiles.length} 个 tsx 文件`)
  : fail('裸异常直出界面', bareHits.length, bareHits.join('、'));

stringifyHits.length === 0
  ? pass('无手写错误字符串化', `${uiFiles.length} 个 ts/tsx 文件`)
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

/* ─────────────── E. 渲染异常：出错时必须有兜底块而不是白屏 ─────────────── */

/*
 * A~D 守的都是「有结果之后」的事：提示怎么写、提示出不出得来、进度出不出得来。
 * E 段守的是更前面的一步：**渲染本身就炸了的时候，用户看到什么**。
 *
 * 实况：Preact 在渲染期抛错时一路向上抛，找不到边界就把整棵子树从 DOM 卸掉。
 * 实测向 `AppsView` 注入一次 `throw`，切进去后 `.content` 只剩一张连接提示条，
 * 分区内容整块消失、没有一句说明；再切到「文件传输」，导航标题变了、
 * 内容区还是那张空壳 —— 用户会以为整个工具坏了，唯一的想法是刷新或换浏览器。
 *
 * 所以要断言四环：
 *   1. 存在错误边界组件，且它实现了 Preact 认的钩子（`getDerivedStateFromError` / `componentDidCatch`）
 *   2. 分区渲染被包在里面（`App.tsx` 里 `<ErrorBoundary>` 包着 `<ModuleView`）
 *   3. 外壳级也有边界（`main.tsx` 渲染 `<App />` 时同样包着）—— 外壳自己炸了不该是纯白页
 *   4. 全局兜底监听在（`unhandledrejection` / `error`），否则 `void xxx()` 的失败彻底静默
 *
 * 外加一条反向禁令：兜底块不得绕过翻译层自己拼一句话。
 */

/** 读一份源码，并剥掉注释 —— 「源码里禁止出现某种写法」的断言必须先剥注释 */
function codeOf(rel) {
  const full = join(ROOT, rel);
  if (!existsSync(full)) return null;
  return readFileSync(full, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const boundaryRel = 'src/ui/components/ErrorBoundary.tsx';
const boundaryCode = codeOf(boundaryRel);

if (!boundaryCode) {
  fail('渲染错误边界', '存在', '缺失', `没有 ${boundaryRel}：渲染期抛错会整块卸载子树`);
} else {
  const hasDerived = /getDerivedStateFromError\s*\(/.test(boundaryCode);
  const hasCatch = /componentDidCatch\s*\(/.test(boundaryCode);
  if (!hasDerived || !hasCatch) {
    fail(
      '错误边界钩子',
      hasDerived && hasCatch ? '齐全' : `getDerivedStateFromError ${hasDerived} / componentDidCatch ${hasCatch}`,
      '两个都要',
      'Preact 的 _catchError 依次看这两个钩子，只写一个在某些路径上接不住',
    );
  } else {
    // 兜底块要能自己恢复：必须有重试与复位键两条路
    const hasRetry = /onRetry|重试/.test(boundaryCode);
    const hasResetKey = /resetKey/.test(boundaryCode);
    if (!hasRetry || !hasResetKey) {
      fail(
        '错误边界可恢复',
        `重试 ${hasRetry} / 复位键 ${hasResetKey}`,
        '两条都要',
        '只清 error 不让子树重建，同一个 vnode 再 diff 一遍仍会抛同样的错',
      );
    } else {
      pass('渲染错误边界', `${boundaryRel}：双钩子 + 重试 + 复位键`);
    }
  }
}

/** 分区级：`<ErrorBoundary ...>` 与 `<ModuleView` 之间不得有 `</ErrorBoundary>` 提前闭合 */
const appCode = codeOf('src/ui/App.tsx');
if (!appCode) {
  fail('分区渲染兜底', 'App.tsx 存在', '缺失');
} else {
  const wrapped = /<ErrorBoundary[\s\S]*?<ModuleView[\s\S]*?<\/ErrorBoundary>/.test(appCode);
  if (!wrapped) {
    fail(
      '分区渲染兜底',
      'ModuleView 包在 ErrorBoundary 里',
      '未包裹',
      '一个分区算错字段会让整块内容永久空白，切分区也不恢复',
    );
  } else if (!/resetKey\s*=/.test(appCode)) {
    fail('分区渲染兜底', '有 resetKey', '缺 resetKey', '切分区时不会自动清错，坏的那块会一直停着');
  } else {
    pass('分区渲染兜底', 'ModuleView 已包，带 resetKey 自动复位');
  }
}

/** 外壳级：main.tsx 渲染 App 时也要包一层 */
const mainCode = codeOf('src/main.tsx');
if (!mainCode) {
  fail('外壳渲染兜底', 'main.tsx 存在', '缺失');
} else if (!/<ErrorBoundary[\s\S]*?<App\s*\/>/.test(mainCode)) {
  fail(
    '外壳渲染兜底',
    'App 包在 ErrorBoundary 里',
    '未包裹',
    '外壳自身抛错时页面是纯白，连提示都没有',
  );
} else {
  pass('外壳渲染兜底', 'main.tsx 的 <App /> 已包边界');
}

/** 全局兜底：两个事件都要听 */
if (!mainCode) {
  fail('全局异常兜底', 'main.tsx 存在', '缺失');
} else {
  const hasRejection = /addEventListener\s*\(\s*['"]unhandledrejection['"]/.test(mainCode);
  const hasError = /addEventListener\s*\(\s*['"]error['"]/.test(mainCode);
  if (!hasRejection || !hasError) {
    fail(
      '全局异常兜底',
      hasRejection && hasError ? '齐全' : `unhandledrejection ${hasRejection} / error ${hasError}`,
      '两个都要',
      '`void xxx()` 的失败只会走 unhandledrejection，同步回调异常只走 error',
    );
  } else {
    pass('全局异常兜底', 'unhandledrejection + error 均已监听');
  }
}

/*
 * 反向禁令：兜底块不许说「未知错误」。
 *
 * 这一块是「界面已经坏了」时才出现的，此时文案质量比平时更要紧 ——
 * 用户唯一能看到的就是这几行字。写「出了点问题」等于什么都没说。
 */
if (boundaryCode) {
  const vagueInBoundary = VAGUE_PHRASES.filter((phrase) => boundaryCode.includes(phrase));
  vagueInBoundary.length === 0
    ? pass('兜底文案不空洞', `无零信息短语（${VAGUE_PHRASES.length} 个黑名单词均未出现）`)
    : fail('兜底文案不空洞', vagueInBoundary, '兜底块不得使用零信息短语');
}

/* ─────────────── F. 变更治理：确认门与审计留底必须同源 ─────────────── */

/*
 * E 段守的是「渲染炸了用户看到什么」，F 段守的是更常见的一类：
 * **同一件事从不同入口进来，门槛不一样**。
 *
 * 实况（本轮实测）：工具卡片里的「卸载与恢复」是 risk 3，要求手打「确认」，
 * 执行前后都写审计；而应用列表的「批量卸载」`onClick` 直接调
 * `apps.batch(names, 'uninstall')` —— 勾两个应用点一下，装的东西就没了，
 * 既没有确认也没有记录。品牌专区的「停用选中」同样裸调。
 *
 * 更糟的是两边都"看起来对"：卡片那套逻辑写得很完整，问题只在另一条路上
 * 没人复用。所以断言不能是「有没有确认组件」，必须是：
 *   1. 门槛判定只有一处（`gateFor`），卡片与视图层都调它
 *   2. 变更动作必须经 `runMutation`（内部串 `askConfirm` + `audited`）
 *   3. 视图层不得出现直调变更服务方法的写法（反向禁令）
 *   4. 确认层被挂到外壳，且应急分支也覆盖
 */

/** 读一份源码并剥注释 —— 反向禁令必须先剥注释，注释里会引用旧写法 */
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const confirmCode = codeOf('src/ui/state/confirm.ts');
const actionsCode = codeOf('src/ui/state/actions.ts');

if (!confirmCode || !actionsCode) {
  fail(
    '变更治理层',
    `confirm.ts ${confirmCode ? '有' : '缺'} / actions.ts ${actionsCode ? '有' : '缺'}`,
    '两个都要',
    '门槛与留底没有单一入口，各视图只能自己实现一遍',
  );
} else {
  /*
   * 环 1：门槛判定必须是可复用的纯函数，且 runMutation 真的用它。
   *
   * 只断言「存在 gateFor」不够 —— 定义了没人调，两处照旧各写一遍。
   */
  const hasGate = /export function gateFor\s*\(/.test(confirmCode);
  const gateUsed = /gateFor\s*\(/.test(actionsCode);

  // 环 1b：工具卡片也调同一个判定，否则「卡片一套、列表一套」会重新长出来
  const cardCode = codeOf('src/ui/components/ToolCard.tsx');
  const cardUsesGate = cardCode ? /gateFor\s*\(/.test(cardCode) : false;
  // 卡片里不得再出现自己算风险门槛的写法
  const cardOwnGate = cardCode ? /risk\s*>=\s*2\s*&&/.test(cardCode) : false;

  if (!hasGate) {
    fail('确认门槛单一判定', 'gateFor 存在', '缺失', '门槛判定散在各处，改阈值必漏一处');
  } else if (!gateUsed) {
    fail('确认门槛单一判定', 'runMutation 调 gateFor', '未调用', '定义了判定但不复用，等于没有收敛');
  } else if (!cardUsesGate || cardOwnGate) {
    fail(
      '确认门槛单一判定',
      cardUsesGate && !cardOwnGate ? '两处同源' : `卡片调 gateFor ${cardUsesGate} / 自带判定 ${cardOwnGate}`,
      '工具卡片也须走同一判定',
      '卡片与列表各写一遍 threshold，正是本轮修掉的分裂',
    );
  } else {
    pass('确认门槛单一判定', 'gateFor() 同时被 ToolCard 与 runMutation 使用');
  }

  /*
   * 环 2：runMutation 内部必须真的接上两个动作。
   *
   * 「有确认组件」不等于「执行前问了」：`askConfirm()` 定义了没人 await，
   * 弹层永远不会出现。同理 `audited()` 写了没包住 run，等于没记。
   */
  const asksBefore = /await askConfirm\s*\(/.test(actionsCode);
  /*
   * `audited()` 必须把要执行的那个动作包在里面。
   *
   * 判据不能写成 `run()` —— 实际写法是把函数引用当第二个实参传进去
   * （`audited(meta, run)`）。首版就写成了 `run\s*\(\)`，于是明明包对了也判失败。
   * 这里改成「audited 调用内部出现了 run」，两种写法都认。
   */
  const auditedCall = /audited\s*\(([\s\S]{0,400}?)\)\s*;/.exec(actionsCode);
  const auditedWrap = Boolean(auditedCall && /\brun\b/.test(auditedCall[1]));
  const cancelsQuietly = /status:\s*'cancelled'/.test(actionsCode);

  if (!asksBefore || !auditedWrap || !cancelsQuietly) {
    fail(
      '变更动作先问后记',
      `askConfirm ${asksBefore} / audited 包住 run ${auditedWrap} / 取消可区分 ${cancelsQuietly}`,
      '三项都要',
      '少了任何一项，批量入口就会退回「点一下直接执行且无记录」',
    );
  } else {
    pass('变更动作先问后记', 'runMutation：askConfirm → audited(run) → 取消可区分');
  }

  /*
   * 环 2b：不可逆动作的风险等级不得被填低。
   *
   * 这是反向探针逼出来的一条。首版只断言「runMutation 有没有调 gateFor」，
   * 于是把批量卸载的 `risk: 3` 改成 `risk: 1` 之后，脚本照样全绿 ——
   * 门槛函数确实被调用了，只是喂进去的数被人改小了，确认弹层根本不会出现。
   *
   * 判据放在动作规格表上：凡是名字里带卸载 / 清数据的动作，
   * 必须写 `risk: 3`。这条会随着新增动作自动生效，不需要维护白名单。
   */
  const mutationsCode = codeOf('src/ui/state/mutations.ts') ?? '';
  const irreversible = [];
  // 按「action 名 → 后面 400 字符内的 risk 值」逐块取，避免跨动作串味
  for (const match of mutationsCode.matchAll(/action:\s*'([\w.]+)'([\s\S]{0,400}?)risk:\s*(\d)/g)) {
    const [, action, , risk] = match;
    if (/(uninstall|clearData)/.test(action) && Number(risk) < 3) {
      irreversible.push(`${action} 记为 risk ${risk}`);
    }
  }
  const hasIrreversible = /action:\s*'[\w.]*uninstall/.test(mutationsCode);
  if (!hasIrreversible) {
    fail('不可逆动作不分级降级', '规格表含卸载类动作', '未找到', '规格表里连卸载动作都没有，这条断言失去意义');
  } else if (irreversible.length > 0) {
    fail(
      '不可逆动作不分级降级',
      irreversible.join('、'),
      '卸载 / 清数据必须 risk 3',
      '降到 2 级后用户关掉偏好开关就能一键卸载，降到 1 级连问都不问',
    );
  } else {
    pass('不可逆动作不分级降级', '卸载类动作均为 risk 3');
  }
}

/*
 * 环 3：反向禁令 —— 视图层不得直调「会改设备状态」的服务方法。
/*
 * 环 3：反向禁令 —— 视图层不得直调「会改设备状态」的服务方法。
 *
 * 首版用的是「变更方法白名单」（uninstall / disable / clearData…），
 * 反向探针立刻把它证伪了：把批量卸载改回 `current.apps.batch(names, 'uninstall')`
 * **没有被拦住** —— 因为 `batch` 这个动词本身看不出会改状态，它既能冻结也能卸载。
 *
 * 白名单法还有个更根本的毛病：服务层以后新增任何变更方法，都得记得回来补一行。
 * 漏一次就等于放行一条无确认、无审计的路径。
 *
 * 所以反过来做：只允许调用一张**只读白名单**，名单外一律算违规。
 * 新增方法时默认是「不许在视图里直接调」，逼着作者去想该不该走治理层。
 */
const READONLY_METHODS = new Set([
  // 应用：读
  'listWithState',
  'listPackages',
  'paths',
  'detail',
  'isSystemPackage',
  // 设备：读
  'snapshot',
  'cpuFreq',
  'foreground',
  // 电池：读与采样
  'summary',
  'watchPower',
  'exportCsv',
  // 品牌：扫描清单（只读）
  'scan',
  'readSetting',
  // 文件：列目录与拉取
  'list',
  'pull',
  // 终端分区：命令要由用户亲手敲，取消 log 走 shell.text 是刻意的
  'text',
  'probe',
  'commandsSince',
  'commandMark',
]);

const callRe = /\bcurrent\s*\.\s*(\w+)\s*\.\s*(\w+)\s*\(/g;
const directCalls = [];
for (const file of walk(join(ROOT, 'src/ui'), [], /\.tsx?$/)) {
  const rel = file.replace(ROOT + '/', '');
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(callRe)) {
      const [, service, method] = match;
      if (READONLY_METHODS.has(method)) continue;
      directCalls.push(`${rel}:${index + 1} ${service}.${method}`);
    }
  });
}

directCalls.length === 0
  ? pass('视图层无直调变更', `${READONLY_METHODS.size} 个只读方法之外一律经 runMutation`)
  : fail(
      '视图层绕过治理层',
      directCalls.length,
      `${directCalls.join('、')}。这些调用不弹确认、不写审计 —— 批量卸载曾因此点一下就把应用卸了`,
    );

/*
 * 环 4：确认层必须挂在外壳，含应急分支。
 *
 * 与 C 段同构：应急页 `if (emergency) return <EmergencyReset />` 提前返回，
 * 尾部挂载走不到。这一页将来接任何变更类入口，没有确认层就是裸的。
 */
const confirmSheetRel = 'src/ui/components/ConfirmSheet.tsx';
const confirmSheetCode = codeOf(confirmSheetRel);

if (!confirmSheetCode) {
  fail('确认弹层', confirmSheetRel, '缺失', 'askConfirm 没有渲染端，Promise 永不兑现');
} else if (!/useSignal\s*\(\s*confirmRequest\s*\)/.test(confirmSheetCode)) {
  fail('确认弹层', '订阅 confirmRequest', '未订阅', '弹层不读信号，请求进来也不会显示');
} else if (!/settleConfirm\s*\(/.test(confirmSheetCode)) {
  fail('确认弹层', '能结算请求', '未调用 settleConfirm', '请求永远挂着，调用方 await 卡死');
} else if (!/word/.test(confirmSheetCode)) {
  fail('确认弹层', '支持手打确认词', '缺失', '高危操作退化成「点一下确认」');
} else {
  const appText = codeOf('src/ui/App.tsx') ?? '';
  const mounted = appText.includes('<ConfirmSheet');
  const earlyReturn = /if\s*\(\s*emergency\s*\)\s*\{?\s*return\s*\(?([\s\S]{0,240})/.exec(appText);
  const covered = earlyReturn ? earlyReturn[1].includes('<ConfirmSheet') : false;

  if (!mounted) {
    fail('确认层已挂载', 'App.tsx 渲染 ConfirmSheet', '未挂载', '组件写好了但外壳没渲染，弹层不会出现');
  } else if (!covered) {
    fail(
      '确认层已挂载',
      '应急分支也覆盖',
      'emergency 分支缺失',
      '应急页提前 return，尾部挂载走不到；该页接变更操作时会绕过门槛',
    );
  } else {
    pass('确认层已挂载', 'App.tsx 正常分支 + 应急分支均已渲染');
  }
}

/* ─────────────── G. 批量播报必须带得上失败明细 ─────────────── */

/*
 * F 段守的是「批量操作会不会先问」，G 段守的是「问完之后，结果说不说得清」。
 *
 * 实况（本轮实测）：`reportBatch(count, ok, label)` 只收两个计数，
 * 提示条写的是「5 个冻结：成功 3 个，失败 2 个。失败项未改动，
 * 逐条原因见下方记录」—— 而**下方没有任何记录**。批量执行在
 * `app.service.ts` 里逐条 try/catch，失败原因塞进 `BatchResult.message`
 * 返回，视图层只数了 `success` 的个数就把数组扔了；终端里只有每条命令的
 * 原始回显，没有「哪几个没成、为什么」。
 *
 * 所以这一段断言三环：
 *   1. 播报层由纯函数产出（`buildBatchReport`），不是拼字符串
 *   2. 视图层的每个调用点交的是完整结果数组，而不是 `.length`
 *   3. 反向禁令：全仓不得再出现「见下方记录」这类指不到东西的说法
 */

const batchReportCode = codeOf('src/ui/state/batch-report.ts');

if (!batchReportCode) {
  fail('批量播报明细', 'src/ui/state/batch-report.ts', '缺失', '播报仍在视图里拼字符串，失败明细无处安放');
} else {
  // 环 1：摘要与明细都从数据得出，且明细的出口是终端
  const hasBuilder = /export function buildBatchReport\s*\(/.test(batchReportCode);
  const hasPick = /export function pickFailures\s*\(/.test(batchReportCode);
  const actionsUses = /buildBatchReport\s*\(/.test(actionsCode ?? '');
  const pushesLines = /pushOutput\s*\(/.test(actionsCode ?? '');

  if (!hasBuilder || !hasPick) {
    fail(
      '批量播报由数据得出',
      `buildBatchReport ${hasBuilder} / pickFailures ${hasPick}`,
      '两项都要',
      '只数成功个数就丢掉结果数组，失败项的名称与原因永远出不来',
    );
  } else if (!actionsUses || !pushesLines) {
    fail(
      '批量播报接到终端',
      `actions 调 buildBatchReport ${actionsUses} / 明细进终端 ${pushesLines}`,
      '两项都要',
      '摘要进了提示条但明细没出口，等于把「见下方记录」换了个说法',
    );
  } else {
    pass('批量播报由数据得出', 'buildBatchReport + pickFailures，摘要进提示条、明细进终端');
  }

  /*
   * 环 1b：摘要必须点名一个界面上真实存在的区域。
   *
   * 不必猜措辞，但必须出现「命令输出」—— 那是终端面板的标题，
   * 写在提示条里用户抬头就能找到。
   */
  /命令输出/.test(batchReportCode)
    ? pass('失败指引可落地', '摘要指向「命令输出」面板')
    : fail('失败指引可落地', '摘要未指向任何界面区域', '缺少可定位的区域名', '用户会被指去一个不存在的地方');
}

/*
 * 环 2：视图层每个调用点都必须交完整数组。
 *
 * 判据是「实参里不得出现 `.length`」—— 这是「只交个数」的最直接特征。
 * 用括号配平取实参而不是正则截断：`reportBatch(outcome.value.map(...), '冻结')`
 * 里 map 的回调本身就带括号，贪婪/非贪婪都会截错位置。
 */
function callArgs(text, callee) {
  const found = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(`${callee}(`, from);
    if (at === -1) break;
    let depth = 0;
    let index = at + callee.length;
    for (; index < text.length; index++) {
      const ch = text[index];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    found.push({ args: text.slice(at + callee.length + 1, index), at });
    from = index + 1;
  }
  return found;
}

const reportCalls = [];
for (const file of walk(join(ROOT, 'src/ui'), [], /\.tsx?$/)) {
  const rel = file.replace(ROOT + '/', '');
  // `import { reportBatch }` 不是调用点，剥注释后仍会命中，用「实参含 length」兜住
  for (const call of callArgs(stripComments(readFileSync(file, 'utf8')), 'reportBatch')) {
    if (/\b\w+\.length\b/.test(call.args)) reportCalls.push(rel);
  }
}

if (reportCalls.length === 0) {
  pass('视图层交完整结果', '所有 reportBatch 调用均传结果数组');
} else {
  fail(
    '视图层只交个数',
    [...new Set(reportCalls)].join('、'),
    '不得把 .length 当播报依据',
    '只交个数就丢掉 name 与 message，失败项既说不清是谁也说不清为什么',
  );
}

/*
 * 环 3：反向禁令 —— 「见下方」后面必须跟一个真实区域名。
 *
 * 这句话本身没有错，错在它指的东西当时并不存在。首版把「原因见下方」整个
 * 列进黑名单，结果把修好之后的正确写法（`逐条原因见下方「命令输出」`）
 * 也拦住了 —— 黑名单太宽会逼着人绕开正确表达。
 *
 * 改成的规则是形状判定：凡出现「见下方」，其后 12 个字符内必须有一个
 * 「」包起来的区域名。这样「见下方记录」被拦下（没引号），
 * 「见下方「命令输出」」放行（点名了用户抬头就能找到的面板）。
 */
const DANGLING_PHRASES = ['见下方记录', '见下方日志', '详见下方'];
const dangling = [];

for (const file of walk(join(ROOT, 'src'), [], /\.tsx?$/)) {
  const rel = file.replace(ROOT + '/', '');
  const text = stripComments(readFileSync(file, 'utf8'));

  for (const phrase of DANGLING_PHRASES) {
    if (text.includes(phrase)) dangling.push(`${rel} 「${phrase}」`);
  }

  // 「见下方」后没有紧接区域名 —— 用户会被指去一个不存在的地方
  for (const match of text.matchAll(/见下方/g)) {
    const after = text.slice(match.index + 3, match.index + 15);
    if (!after.startsWith('「')) dangling.push(`${rel} 「见下方${after.slice(0, 6)}…」`);
  }
}

dangling.length === 0
  ? pass('失败指引不指空', `「见下方」后均带真实区域名（另查 ${DANGLING_PHRASES.length} 个历史短语）`)
  : fail('无着落指代', [...new Set(dangling)].join('、'), '换成一个「」包起来的真实区域名', '提示用户去看一个不存在的地方，比不给提示更糟');

/*
 * 环 4：逐条明细不得被 80 ms 合并窗口吃掉。
 *
 * 这一条是反向探针逼出来的真缺陷：`pushOutput` 会把同频道 80 ms 内的连续
 * 文本合并进同一个 DOM 节点（为底层读回调设计的），而批量失败明细恰恰是
 * 「各自独立的行」。实测 20 条明细只量到 1 个 `.term-line`，20 个包名连成
 * 一片 —— 探针脚本第一版跑出「终端逐条列出失败项：1 行」才发现。
 *
 * 判据：`reportBatch` 里推明细时显式关掉合并。参数名写死是因为它就是
 * `pushOutput` 的契约，改名会同时触发类型检查，不会静默失效。
 */
if (actionsCode) {
  const linePush = /pushOutput\s*\(\s*'stderr'\s*,\s*line\s*,\s*\{\s*merge:\s*false\s*\}\s*\)/.test(
    actionsCode,
  );
  const mergeSupported = /merge\?:\s*boolean/.test(codeOf('src/ui/state/app-state.ts') ?? '');

  if (!mergeSupported) {
    fail('逐条明细不被合并', 'pushOutput 支持 merge 参数', '缺失', '逐条明细只能挤在同一个 DOM 节点里');
  } else if (!linePush) {
    fail(
      '逐条明细不被合并',
      'reportBatch 推明细时 merge: false',
      '未关闭合并',
      '80 ms 内的多条失败会拼成一行，用户没法逐条读',
    );
  } else {
    pass('逐条明细不被合并', 'pushOutput 支持 merge 开关，明细逐条成行');
  }
}

/* ─────────────── H. 断线必须真的让在途操作停手 ─────────────── */

/*
 * G 段守的是「结果说不说得清」，H 段守的是更前面的一步：
 * **说清结果之前，那批操作得先停下来**。
 *
 * 实况（本轮实测）：拔线时 `batch()` 的 for 循环没有任何中断判据。
 * 正在跑的那条命令会失败（底层报 device offline），catch 把它记成一条失败，
 * 然后循环毫不犹豫地开始下一条 —— 后面 7 条命令一条条发往已经死掉的 USB
 * 链路，每条都要等到超时才返回。用户看到「拔线后界面还在转」，
 * 审计里则躺着 7 条注定失败的记录，而不是「7 条没执行」。
 *
 * 更隐蔽的一层：光加布尔检查也不够。真正的卡点是**正在等的那一条** ——
 * 数据线都拔了，谁来兑现底层 spawn 的 Promise？所以除了循环里的开关判断，
 * 还需要把单条调用 race 一次取消信号。
 *
 * 断言四环：
 *   1. 连接收尾时真的调用了 `abort()`（否则信号永远不响）
 *   2. 批量循环里有 `aborted` 判据（两条命令之间停手）
 *   3. 单条调用被 race 过（正在跑的那条也能被打断）
 *   4. 剩余项标 `skipped`，播报不把它算成失败
 */
const shellCode = codeOf('src/core/shell.ts') ?? '';
const stateCode = codeOf('src/ui/state/app-state.ts') ?? '';
const appServiceCode = codeOf('src/services/app.service.ts') ?? '';
const vendorServiceCode = codeOf('src/services/vendor.service.ts') ?? '';

// 环 1：连接重置路径必须先中止再清状态
const abortsOnReset = /services\.value\?\.shell\.abort\s*\(/.test(stateCode);
const resetFn = /export function resetConnection\s*\([^)]*\)\s*:\s*void\s*\{([\s\S]{0,600}?)\n\}/.exec(
  stateCode,
);
const abortBeforeClear = Boolean(
  resetFn && resetFn[1].indexOf('.abort(') >= 0 &&
    resetFn[1].indexOf('.abort(') < resetFn[1].indexOf('services.set(null)'),
);

if (!abortsOnReset || !abortBeforeClear) {
  fail(
    '断线即中止在途命令',
    abortsOnReset ? 'abort() 位置在清空 services 之后' : 'resetConnection 未调用 abort()',
    '先 abort 再清状态',
    'services 一置空，那个 ShellContext 就再没人能触发；在途批量会一路空转到超时',
  );
} else {
  pass('断线即中止在途命令', 'resetConnection 先 abort(shell) 再清状态，三条收尾路径共用');
}

// 环 2：批量循环里有中断判据
const batchAbortedCheck = /this\.#shell\.aborted/.test(appServiceCode);
const vendorAbortedCheck = /this\.#shell\.aborted/.test(vendorServiceCode);
const shellExposesAborted = /get aborted\s*\(\s*\)\s*:\s*boolean/.test(shellCode);

if (!shellExposesAborted) {
  fail('批量循环可判定中断', 'ShellContext 暴露 aborted', '缺失', '循环没有「该不该继续下一条」的判据');
} else if (!batchAbortedCheck || !vendorAbortedCheck) {
  fail(
    '批量循环可判定中断',
    `app.service ${batchAbortedCheck} / vendor.service ${vendorAbortedCheck}`,
    '两处都要有 aborted 判据',
    '少一处，那条批量路径拔线后仍会逐条空转到超时',
  );
} else {
  pass('批量循环可判定中断', 'app.service 与 vendor.service 均在每条前检查 aborted');
}

// 环 3：正在执行的那一条也要能被 race 打断
const shellExposesSignal = /get signal\s*\(\s*\)\s*:\s*AbortSignal/.test(shellCode);
const racesBatch = /raceAbort\s*\(\s*runOne\s*\(/.test(appServiceCode);
const racesVendor = (vendorServiceCode.match(/raceAbort\s*\(/g) ?? []).length >= 2;

if (!shellExposesSignal) {
  fail('在途单条可被打断', 'ShellContext 暴露 signal', '缺失', '没有取消信号，卡住的那条只能等超时');
} else if (!racesBatch || !racesVendor) {
  fail(
    '在途单条可被打断',
    `app.service race ${racesBatch} / vendor.service 两处 race ${racesVendor}`,
    '正在执行的调用也要 race 信号',
    '循环里的开关只在两条之间生效，卡在第 3 条时会永远等下去',
  );
} else {
  pass('在途单条可被打断', 'app.service 与 vendor.service 的批量调用均 race 了取消信号');
}

// 环 4：剩余项标 skipped，播报不混成失败
const marksSkipped = /skipped:\s*true/.test(appServiceCode) && /skipped:\s*true/.test(vendorServiceCode);
const reportKnowsSkipped = /pickSkipped/.test(batchReportCode ?? '');
/*
 * 光有函数名不算数 —— 反向探针把 `pickSkipped` 改成 `return []` 之后，
 * `reportKnowsSkipped` 仍是 true，脚本照旧全绿（只有单测打红）。
 * 所以这里要看函数体里真的按 skipped 筛。
 */
const pickSkippedBody = /export function pickSkipped[\s\S]{0,220}?\n\}/.exec(batchReportCode ?? '');
const pickSkippedFilters = Boolean(pickSkippedBody && /skipped/.test(pickSkippedBody[0]));
const viewsPassSkipped = /skipped:\s*item\.(skipped|success)/.test(
  (codeOf('src/ui/views/AppsView.tsx') ?? '') + (codeOf('src/ui/views/VendorView.tsx') ?? ''),
);

if (!marksSkipped) {
  fail('未执行与失败分开', '批量结果标记 skipped', '缺失', '剩余项会被当成真失败，用户去查包权限而真因是掉线');
} else if (!reportKnowsSkipped || !pickSkippedFilters) {
  fail(
    '未执行与失败分开',
    `播报层识别 skipped ${reportKnowsSkipped} / 真的按 skipped 筛 ${pickSkippedFilters}`,
    '两项都要',
    '函数名叫 pickSkipped 但返回空数组，摘要仍会把未执行算作失败',
  );
} else if (!viewsPassSkipped) {
  fail('未执行与失败分开', '视图层把 skipped 交给播报层', '未透传', '服务层标了但播报看不到，等于没标');
} else {
  pass('未执行与失败分开', '服务层标 skipped、播报层单列、零信息短语不回流');
}

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

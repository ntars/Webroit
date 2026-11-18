/**
 * 配色约束校验。
 *
 * 本项目的配色是「纯黑白灰」体系：背景、文字、边框、强调色全部取自
 * 中性色，信息层级只靠明度差与字重表达。这条约定容易在后续改动里
 * 被无意破坏（随手加一个带色相的蓝、把某个 token 改成彩色的），
 * 所以用一个脚本把它固化成可执行的检查，而不是靠 code review 的记忆。
 *
 * 检查三件事：
 * 1. 所有非语义色 token 的色度（max-min）足够低，即确实是中性灰
 * 2. 不变量：深色主题下强调色必须是浅的，浅色主题下必须是深的
 * 3. 对比度：全部前景 token × 全部背景 token 的矩阵，逐对校验
 *
 * 第 3 项早期只测了 4 对色（正文/导航/卡片标题/主按钮），
 * --text-secondary、--text-tertiary、--success、--warning、--danger、
 * 终端配色与表单控件边框全在盲区里。盲区里恰好藏着真缺陷：
 * 浅色 --text-tertiary 只有 3.9:1、开关关态的滑轨与滑块只有 1.74:1。
 * 所以改成矩阵——前景和背景各自枚举，任意一对不达标就失败，
 * 新增 token 时只要名字进清单就自动被覆盖，不依赖人记得补测。
 *
 * 比值的数学与「要测哪些色对」的清单放在 scripts/lib/contrast.mjs，
 * 与 verify-docs.mjs 共用 —— 否则 README 里的对数与脚本各记一份，必然漂移。
 *
 * 用法：node scripts/verify-theme.mjs [--markdown]
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALL_VARS,
  blend,
  chroma,
  computeMatrix,
  contrast,
  luminance,
  parseRGB,
} from './lib/contrast.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

/** 写入主题偏好后跳转到真实页面，避免依赖 localStorage 的默认值 */
const seed = (theme) =>
  `<!doctype html><meta charset="utf-8"><body style="margin:0"></body>` +
  `<script>localStorage.setItem('webroit:preferences', JSON.stringify({theme:'${theme}'}));` +
  `location.replace('/index.html');</script>`;

const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/__seed')) {
      const t = new URL(req.url, 'http://x').searchParams.get('theme') || 'dark';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(seed(t));
    }
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/' || !extname(p)) p = '/index.html';
    const buf = await readFile(join(DIST, normalize(p)));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('nf');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** 取一个分区的计算样式快照 */
async function inspect(theme) {
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--remote-debugging-port=0',
      '--window-size=1440,960',
      `--user-data-dir=/tmp/chrome-theme-check-${Math.random().toString(36).slice(2)}`,
      `http://127.0.0.1:${port}/__seed?theme=${theme}`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    child.stderr.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve(m[1]);
    });
    setTimeout(() => reject(new Error('等待 Chrome 调试端口超时')), 15000);
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });

  const { result: targets } = await send('Target.getTargets');
  const page = targets.targetInfos.find((t) => t.type === 'page');
  const { result: attached } = await send('Target.attachToTarget', {
    targetId: page.targetId,
    flatten: true,
  });
  const sid = attached.sessionId;

  await new Promise((r) => setTimeout(r, 2200));

  const vars = ALL_VARS;

  const expr = `(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { color: cs.color, bg: cs.backgroundColor };
    };
    const root = getComputedStyle(document.documentElement);
    const v = {};
    for (const n of ${JSON.stringify(vars)}) v[n] = root.getPropertyValue(n).trim();
    return {
      theme: document.documentElement.dataset.theme,
      body: pick('body'),
      sidebar: pick('.sidebar'),
      navText: pick('.nav-item'),
      card: pick('.tool'),
      primaryBtn: pick('.connect-strip .btn--primary'),
      vars: v,
    };
  })()`;

  const { result } = await send('Runtime.evaluate', { expression: expr, returnByValue: true }, sid);
  ws.close();
  child.kill();
  return result.result.value;
}

const SEMANTIC = /success|warning|danger|stderr/;
/** 色度上限：超过 12/255 就已经肉眼可辨为有彩色 */
const CHROMA_LIMIT = 12;

const results = [];
for (const theme of ['dark', 'light']) {
  const data = await inspect(theme);
  const problems = [];

  // 1. 中性检查
  for (const [name, value] of Object.entries(data.vars)) {
    if (!/^#|^rgb/.test(value) || SEMANTIC.test(name)) continue;
    const c = parseRGB(value);
    if (!c) {
      problems.push(`${name} 无法解析：${value}`);
      continue;
    }
    const ch = chroma(c);
    if (ch > CHROMA_LIMIT) {
      problems.push(`${name} 不是中性灰：${value}（色度 ${ch}）`);
    }
  }

  // 2. 强调色方向：深色主题必须浅、浅色主题必须深
  const accent = parseRGB(data.vars['--accent']);
  if (!accent) {
    problems.push('--accent 取色失败');
  } else {
    const accentLum = luminance(accent);
    if (theme === 'dark' && accentLum < 0.5) {
      problems.push(`深色主题的 --accent 过暗（亮度 ${accentLum.toFixed(2)}），强调不出来`);
    }
    if (theme === 'light' && accentLum > 0.5) {
      problems.push(`浅色主题的 --accent 过亮（亮度 ${accentLum.toFixed(2)}），强调不出来`);
    }
  }

  // 3. 对比度矩阵
  const pageBg = parseRGB(data.body.bg);
  const cardBg = parseRGB(data.card.bg);

  // 3a. DOM 实测：真实元素上的计算值，兜住「token 换了但选择器没跟上」
  const domPairs = [
    ['正文 / 页面背景', parseRGB(data.body.color), pageBg],
    ['导航文字 / 侧边栏', parseRGB(data.navText.color), parseRGB(data.sidebar.bg)],
    ['卡片标题 / 卡片背景', parseRGB(data.card.color), cardBg],
    ['主按钮文字 / 按钮底色', parseRGB(data.primaryBtn.color), parseRGB(data.primaryBtn.bg)],
  ];
  for (const [label, fg, bg] of domPairs) {
    if (!fg || !bg) {
      problems.push(`${label} 取色失败`);
      continue;
    }
    const ratio = contrast(blend(fg, bg), bg);
    if (ratio < 4.5) problems.push(`${label} 对比度 ${ratio.toFixed(2)}:1，低于 AA 4.5:1`);
  }

  // 3b. token 矩阵：清单来自共享模块，前景 × 背景逐对算
  const measured = computeMatrix(data.vars, theme);
  for (const m of measured) {
    if (m.ratio === null) {
      problems.push(`${m.fgName} 在 ${m.bgName} 上取色失败`);
      continue;
    }
    if (m.ratio < m.need) {
      const where = m.label ?? `${m.fgName} 在 ${m.bgName} 上`;
      problems.push(`${where}对比度 ${m.ratio.toFixed(2)}:1，低于 AA ${m.need}:1`);
    }
  }

  results.push({ theme, problems, measured });
}

/* ─────────────── 输出 ─────────────── */

const MARKDOWN = process.argv.includes('--markdown');

let failed = 0;
let total = 0;
for (const { theme, problems, measured } of results) {
  total += measured.length;
  const label = theme === 'dark' ? '深色' : '浅色';
  console.log(`\n${label}主题`);
  if (problems.length === 0) {
    console.log('  ✓ 全部检查通过：中性色阶、强调色方向、对比度');
  } else {
    failed += problems.length;
    for (const p of problems) console.log(`  ✗ ${p}`);
  }
}

console.log(`\n对比度实测：${total} 对色，${failed} 项不达标。`);

/* README 用的表格：--markdown 时输出，数字全部来自上面同一批实测值，
   不允许手写，改色后重跑一次脚本粘贴即可。 */
if (MARKDOWN) {
  const short = (n) => n.replace(/^--/, '');
  for (const { theme, measured } of results) {
    console.log(`\n<!-- ${theme} -->`);
    console.log('| 前景 | 背景 | 实测 | 门槛 | 判定 |');
    console.log('|---|---|---|---|---|');
    for (const m of measured) {
      const ok = m.ratio >= m.need ? '✓' : '✗';
      console.log(
        `| \`${short(m.fgName)}\` | \`${short(m.bgName)}\` | ${m.ratio.toFixed(2)}:1 | ${m.need}:1 | ${ok} |`,
      );
    }
  }
}

console.log(failed === 0 ? '\n配色约束全部满足。' : `\n${failed} 项不满足。`);

server.close();
process.exit(failed === 0 ? 0 : 1);

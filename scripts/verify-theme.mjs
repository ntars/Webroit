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
 * 3. 正文、导航、卡片标题、主按钮文字的对比度达到 WCAG AA 4.5:1
 *
 * 用法：node scripts/verify-theme.mjs
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

  const vars = [
    '--bg-base', '--bg-surface', '--bg-sunken', '--bg-raised', '--bg-overlay',
    '--border-subtle', '--border-default', '--border-strong',
    '--text-primary', '--text-secondary', '--text-tertiary',
    '--accent', '--accent-text', '--accent-contrast', '--switch-knob',
    '--success', '--warning', '--danger', '--terminal-command', '--terminal-success',
  ];

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

/** 解析 #rgb / #rrggbb / #rrggbbaa / rgb() / rgba() 三种写法 */
const parseRGB = (s) => {
  if (typeof s !== 'string') return null;
  const v = s.trim();

  if (v.startsWith('#')) {
    const hex = v.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }

  const m = v.match(/(\d+(?:\.\d+)?)/g);
  if (!m) return null;
  return { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] };
};

/** 色度：RGB 最大值与最小值之差。0 表示纯中性灰 */
const chroma = ({ r, g, b }) => Math.max(r, g, b) - Math.min(r, g, b);

const luminance = ({ r, g, b }) => {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const contrast = (a, b) => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};

/** 半透明前景压到背景上，换算成实际可见色再算对比度 */
const blend = (fg, bg) =>
  fg.a >= 1
    ? fg
    : {
        r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
        g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
        b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
        a: 1,
      };

/** 语义色允许带色相，其余必须是中性灰 */
const SEMANTIC = /success|warning|danger|terminal-command|terminal-success/;
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

  // 3. 对比度
  const pageBg = parseRGB(data.body.bg);
  const cardBg = parseRGB(data.card.bg);
  const pairs = [
    ['正文 / 页面背景', parseRGB(data.body.color), pageBg],
    ['导航文字 / 侧边栏', parseRGB(data.navText.color), parseRGB(data.sidebar.bg)],
    ['卡片标题 / 卡片背景', parseRGB(data.card.color), cardBg],
    ['主按钮文字 / 按钮底色', parseRGB(data.primaryBtn.color), parseRGB(data.primaryBtn.bg)],
  ];
  for (const [label, fg, bg] of pairs) {
    if (!fg || !bg) {
      problems.push(`${label} 取色失败`);
      continue;
    }
    const ratio = contrast(blend(fg, bg), bg);
    if (ratio < 4.5) problems.push(`${label} 对比度 ${ratio.toFixed(2)}:1，低于 AA 4.5:1`);
  }

  results.push({ theme, problems });
}

/* ─────────────── 输出 ─────────────── */

let failed = 0;
for (const { theme, problems } of results) {
  const label = theme === 'dark' ? '深色' : '浅色';
  console.log(`\n${label}主题`);
  if (problems.length === 0) {
    console.log('  ✓ 全部检查通过：中性色阶、强调色方向、对比度');
  } else {
    failed += problems.length;
    for (const p of problems) console.log(`  ✗ ${p}`);
  }
}
console.log(failed === 0 ? '\n配色约束全部满足。' : `\n${failed} 项不满足。`);

server.close();
process.exit(failed === 0 ? 0 : 1);

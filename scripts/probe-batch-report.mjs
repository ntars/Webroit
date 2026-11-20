/**
 * 批量播报出口的无头 Chrome 实测。
 *
 * 为什么必须真跑浏览器：
 * 单测能证明 `buildBatchReport()` 拼出的字符串对不对，但证明不了
 * 「这两段东西真的到了用户眼前」。T-010 与 T-012 都是同一个形状的缺陷：
 * 文案/信号写得很完整，最后一环的消费者不存在，界面毫无反应。
 * 所以这里从控制台 import 页面内同一份 `actions.ts`，喂一批构造的结果，
 * 再回读 DOM —— 提示条有没有那一条、终端面板里有没有逐条明细。
 *
 * 用法：node scripts/probe-batch-report.mjs
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!CHROME) {
  console.error('找不到 Chrome，请用 CHROME_PATH 指定');
  process.exit(1);
}

/* ── 起 vite dev ── */
const VITE_PORT = 5198;
const vite = spawn(
  join(ROOT, 'node_modules/.bin/vite'),
  ['--port', String(VITE_PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
);

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('vite 启动超时')), 30000);
  const onData = (chunk) => {
    const text = chunk.toString();
    if (text.includes('ready in') || text.includes('Local:')) {
      clearTimeout(timer);
      resolve();
    }
  };
  vite.stdout.on('data', onData);
  vite.stderr.on('data', onData);
});
await new Promise((r) => setTimeout(r, 800));

/* ── 起 Chrome ── */
const child = spawn(
  CHROME,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=/tmp/probe-batch-report-profile',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

const browserWs = await new Promise((resolve, reject) => {
  let buf = '';
  const timer = setTimeout(() => reject(new Error('Chrome 启动超时')), 15000);
  child.stderr.on('data', (chunk) => {
    buf += chunk.toString();
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
    if (m) {
      clearTimeout(timer);
      resolve(m[1]);
    }
  });
});

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { ok, fail } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
      }
    });
    socket.addEventListener('error', reject);
    socket.addEventListener('open', () =>
      resolve({
        send(method, params = {}, sessionId) {
          const mid = ++id;
          return new Promise((ok, fail) => {
            pending.set(mid, { ok, fail });
            socket.send(JSON.stringify({ id: mid, method, params, sessionId }));
          });
        },
        close: () => socket.close(),
      }),
    );
  });
}

const browser = await connect(browserWs);
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });

async function evaluate(expression) {
  const result = await browser.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? '求值异常');
  }
  return result.result.value;
}

await browser.send('Page.enable', {}, sessionId);
await browser.send('Runtime.enable', {}, sessionId);
// 375px：提示条与终端在这个宽度最容易互相挤压，问题也最容易现形
await browser.send(
  'Emulation.setDeviceMetricsOverride',
  { width: 375, height: 780, deviceScaleFactor: 1, mobile: true },
  sessionId,
);
await browser.send('Page.navigate', { url: `http://127.0.0.1:${VITE_PORT}/` }, sessionId);

for (let i = 0; i < 120; i++) {
  const ready = await evaluate('Boolean(document.querySelector(".app"))');
  if (ready) break;
  await new Promise((r) => setTimeout(r, 100));
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `：${detail}` : ''}`);
};

/** 两帧之后再读 DOM —— Preact 的信号更新是异步的（T-004 的教训） */
const settle = () =>
  evaluate(
    'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))',
  );

/*
 * 未连接时终端面板是 display:none 的（`data-collapsed` 由 connected 决定）。
 * 这不是缺陷，但要在里面量东西就必须先展开 —— T-012 记过这个坑：
 * 挂在折叠面板里的元素量到 0×0，会误判成「没渲染」。
 */
await evaluate(`document.querySelector('.terminal-panel').dataset.collapsed = 'false'`);
await settle();

/* ── 1. 部分失败：摘要进提示条，明细进终端 ── */
await evaluate(`
  window.__probe = import('/src/ui/state/actions.ts').then(m => {
    m.reportBatch([
      { target: 'com.demo.one', ok: true, message: 'Success' },
      { target: 'com.demo.two', ok: false, message: 'Failure [DELETE_FAILED_INTERNAL_ERROR]' },
      { target: 'com.demo.three', ok: false, message: '  device offline\\n  retry later  ' },
    ], '卸载');
    return true;
  })
`);
await evaluate('window.__probe');
await settle();

const partial = await evaluate(`(() => {
  const toast = document.querySelector('.toast');
  const lines = [...document.querySelectorAll('.term-line')].map(el => el.textContent);
  return {
    toastText: toast?.querySelector('.toast__text')?.textContent ?? null,
    toastKind: toast?.getAttribute('data-kind') ?? null,
    toastRole: toast?.getAttribute('role') ?? null,
    lines,
  };
})()`);

check('提示条已渲染', partial.toastText !== null, partial.toastText?.slice(0, 46) ?? '未渲染');
check('语调为失败', partial.toastKind === 'error', partial.toastKind ?? '');
check('读屏按 alert 播报', partial.toastRole === 'alert', partial.toastRole ?? '');
check(
  '摘要含成功/失败计数',
  /成功 1 个，失败 2 个/.test(partial.toastText ?? ''),
  partial.toastText ?? '',
);
check('摘要点名失败目标', (partial.toastText ?? '').includes('com.demo.two'));
check('摘要指向「命令输出」', (partial.toastText ?? '').includes('命令输出'));
check('摘要不再写「见下方记录」', !(partial.toastText ?? '').includes('见下方记录'));

const failLines = partial.lines.filter((line) => line.startsWith('[失败]'));
check('终端逐条列出失败项', failLines.length === 2, `${failLines.length} 行`);
check('明细含包名与原文', failLines[0]?.includes('com.demo.two') && failLines[0]?.includes('DELETE_FAILED'));
check(
  '明细的多行原文压成单行',
  failLines[1] === '[失败] com.demo.three：device offline retry later',
  failLines[1] ?? '',
);

/* ── 2. 全成功：不产生失败明细（不刷屏） ── */
const before = partial.lines.length;
await evaluate(`
  import('/src/ui/state/actions.ts').then(m => {
    m.reportBatch([
      { target: 'com.demo.one', ok: true, message: 'Success' },
      { target: 'com.demo.two', ok: true, message: 'Success' },
    ], '冻结');
    document.querySelectorAll('.toast__close').forEach(b => b.click());
    return true;
  })
`);
await settle();

const full = await evaluate(`(() => {
  const toasts = [...document.querySelectorAll('.toast')];
  const last = toasts[toasts.length - 1];
  const lines = [...document.querySelectorAll('.term-line')].map(el => el.textContent);
  return {
    toastText: last?.querySelector('.toast__text')?.textContent ?? null,
    toastKind: last?.getAttribute('data-kind') ?? null,
    added: lines.length - ${before},
  };
})()`);

check('全成功语调为 success', full.toastKind === 'success', full.toastKind ?? '');
check('全成功摘要只说总量', full.toastText === '2 个冻结完成', full.toastText ?? '');
check('全成功不往终端刷明细', full.added === 0, `新增 ${full.added} 行`);

/* ── 3. 超量失败：折叠并指路操作记录 ── */
await evaluate(`
  import('/src/ui/state/actions.ts').then(m => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      target: 'com.bulk.' + i,
      ok: false,
      message: 'Failure [ERR_' + i + ']',
    }));
    m.reportBatch(many, '冻结');
    return true;
  })
`);
await settle();

const bulk = await evaluate(`(() => {
  const lines = [...document.querySelectorAll('.term-line')].map(el => el.textContent);
  const tail = lines.slice(-1)[0] ?? '';
  const failCount = lines.filter(l => l.startsWith('[失败]')).length;
  return { tail, failCount };
})()`);

check('超 20 条失败时折叠', bulk.tail.includes('另有 5 条'), bulk.tail);
check('折叠后指路操作记录', bulk.tail.includes('操作记录'), bulk.tail);
// 上一段 2 行明细 + 本段 20 行 + 1 行折叠 = 23；不做精确断言，只要没铺满 25 行
check('未逐条铺满全部失败', bulk.failCount < 25, `共 ${bulk.failCount} 行 [失败]`);

/* ── 4. 375px 下提示条不横向溢出 ── */
const overflow = await evaluate(`(() => {
  const toast = document.querySelector('.toast');
  if (!toast) return null;
  const rect = toast.getBoundingClientRect();
  return { left: rect.left, right: rect.right, docWidth: document.documentElement.clientWidth };
})()`);

check(
  '窄屏提示条不出界',
  overflow !== null && overflow.left >= -0.5 && overflow.right <= overflow.docWidth + 0.5,
  overflow ? `left ${Math.round(overflow.left)} / right ${Math.round(overflow.right)} / 视口 ${overflow.docWidth}` : '未测量',
);

/* ── 4. 未成功标记：行级染色与工具条在 375px 下不溢出 ── */
/*
 * 这一段量的是 T-021 新加的两块界面：行级标记（`data-outcome`）与
 * 「只看未成功」工具条。它们只有在真连上设备、真跑一批失败操作时才会
 * 渲染，而探针不连设备 —— 所以这里把同样的结构插进页面再量。
 *
 * 插的是类名与层级，量的是真 CSS：气泡、按钮高度、bar 里的三段文本
 * 在 375px 会不会把内容区撑宽。样式对不对，靠这一段兜。
 */
await evaluate(`(() => {
  const host = document.querySelector('.content') ?? document.body;
  const wrap = document.createElement('div');
  wrap.id = 'probe-marks';
  wrap.innerHTML = \`
    <div class="apps__marks-bar">
      <button type="button" class="btn btn--ghost btn--sm" data-active="false">只看未成功（12）</button>
      <span class="apps__marks-tip">上次操作有 12 个没成功，行内已标出原因</span>
      <button type="button" class="btn btn--ghost btn--sm">清除标记</button>
    </div>
    <div class="apps__list"><table class="table"><tbody>
      <tr data-outcome="failed">
        <td><span class="tag tag--danger" title="Failure [DELETE_FAILED_INTERNAL_ERROR]">失败</span>
            <span class="apps__state-note">运行中</span></td>
        <td class="table__mono">com.example.a.very.long.package.name.for.overflow</td>
      </tr>
      <tr data-outcome="skipped">
        <td><span class="tag tag--neutral">未执行</span>
            <span class="apps__state-note">已冻结</span></td>
        <td class="table__mono">com.example.short</td>
      </tr>
    </tbody></table>\`;
  host.appendChild(wrap);
  return true;
})()`);
await settle();

const marks = await evaluate(`(() => {
  const wrap = document.getElementById('probe-marks');
  const bar = wrap.querySelector('.apps__marks-bar');
  const buttons = [...bar.querySelectorAll('button')];
  const rows = [...wrap.querySelectorAll('tbody tr')];
  const docWidth = document.documentElement.clientWidth;
  const rect = bar.getBoundingClientRect();
  return {
    barOverflow: Math.round(rect.right - docWidth),
    docOverflow: document.documentElement.scrollWidth - docWidth,
    // 工具条里三个控件在窄屏会被压到同一行，实测最矮的那个有多高
    minButtonHeight: Math.min(...buttons.map((b) => Math.round(b.getBoundingClientRect().height))),
    failedBorder: getComputedStyle(rows[0]).boxShadow,
    skippedBorder: getComputedStyle(rows[1]).boxShadow,
    failedBg: getComputedStyle(rows[0]).backgroundColor,
    skippedBg: getComputedStyle(rows[1]).backgroundColor,
  };
})()`);

check('标记条不撑宽内容区', marks.barOverflow <= 0.5, `右边缘超出 ${marks.barOverflow}px`);
check('标记条不引发横向滚动', marks.docOverflow <= 0, `文档溢出 ${marks.docOverflow}px`);
check('标记条按钮仍有 28px 高', marks.minButtonHeight >= 28, `${marks.minButtonHeight}px`);
// 失败与未执行必须看得出区别：一个染底色 + 红边，一个只留灰边
check(
  '失败行染底色并带红边',
  marks.failedBg !== 'rgba(0, 0, 0, 0)' && marks.failedBorder.includes('inset'),
  `${marks.failedBg} / ${marks.failedBorder}`,
);
check(
  '未执行行不染红底，只留灰边',
  marks.skippedBg === 'rgba(0, 0, 0, 0)' && marks.skippedBorder.includes('inset'),
  `${marks.skippedBg} / ${marks.skippedBorder}`,
);

/* ── 输出 ── */
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);

browser.close();
child.kill('SIGTERM');
vite.kill('SIGTERM');
process.exit(failed.length === 0 ? 0 : 1);

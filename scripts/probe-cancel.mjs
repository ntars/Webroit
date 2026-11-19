/**
 * 「断线即中止」的无头 Chrome 实测。
 *
 * 为什么必须真跑浏览器：
 * 这个缺陷的形状是**时间**上的 —— 拔线那一刻，`batch()` 正在 await 第 3 条命令，
 * 后面还有 7 条。单测能证明 `aborted` 为真时循环会 break，但证明不了
 * 「拔线真的会让它变成真」，也证明不了「正在等的这一条真的会被打断」。
 * 后者恰恰是最难的一环：底层 spawn 的 Promise 在链路死掉时可能永远不兑现，
 * 光靠循环里的布尔检查会一直卡在那一条上。
 *
 * 所以这里用页面内**真实的** ShellContext + AppService，配一个「第 3 条开始
 * 永不返回」的假驱动，然后触发 abort —— 量三件事：
 *   1. `batch()` 在取消后极短时间内返回（不等到超时）
 *   2. 剩余项被标成 skipped，而不是 failed
 *   3. 第 4 条之后**一次命令都没再发出去**（假驱动记了发送次数）
 *
 * 用法：node scripts/probe-cancel.mjs
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

/* ── 起 vite dev：必须用 dev，模块注册表按 URL 键，才能拿到页面内同一份实例 ── */
const VITE_PORT = 5197;
const vite = spawn(
  join(ROOT, 'node_modules/.bin/vite'),
  ['--port', String(VITE_PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
);

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('vite 启动超时')), 30000);
  const onData = (chunk) => {
    if (chunk.toString().includes('ready in') || chunk.toString().includes('Local:')) {
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
    '--user-data-dir=/tmp/probe-cancel-profile',
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

/*
 * 装一个假驱动：第 3 条命令（index 2）开始「永不返回」——
 * 这正是拔线的真实形状。数据线拔了，谁来兑现那个 Promise？
 * 其余命令立刻成功，并记录每一条**真的发出去过**的命令。
 */
await evaluate(`
  window.__probeSetup = (async () => {
    const { ShellContext } = await import('/src/core/shell.ts');
    const { AppService } = await import('/src/services/app.service.ts');

    const sent = [];
    let hangingResolve = null;

    const driver = {
      serial: 'PROBE0001',
      label: '探针设备',
      connected: true,
      async exec(command) {
        sent.push(command);
        // 第 3 条起挂住：模拟链路死掉、底层 Promise 永不兑现
        if (sent.length >= 3) {
          return new Promise((resolve) => { hangingResolve = resolve; });
        }
        return { stdout: 'Success', stderr: '', exitCode: 0 };
      },
      async openTerminal() { throw new Error('探针不支持终端'); },
      async write() {},
      async read() { return new Blob(); },
      async control() { return ''; },
      async reboot() {},
      async close() {},
    };

    const shell = new ShellContext({ driver });
    const apps = new AppService(shell, 33);
    // 卸载路径会先查是否系统应用，探针里统一回答「不是」，少一次读
    apps.isSystemPackage = async () => false;

    window.__probe = { shell, apps, sent, releaseHang: () => hangingResolve?.() };
    return true;
  })()
`);
await evaluate('window.__probeSetup');

/* ── 1. 中途 abort：必须立刻返回 ── */
/*
 * 页面内自带超时守卫。
 *
 * 这条不是防御性代码，是被反向探针逼出来的：把 `raceAbort` 去掉之后
 * `batch()` 永不返回，整个探针就**挂死**在那里而不是判失败 —— 一个会挂死的
 * 校验脚本比没有更糟，它既跑不完也报不出原因。所以这里 20 秒等不到结果
 * 就返回 `timedOut: true`，由断言把它判成失败。
 */
const cancelled = await evaluate(`
  (async () => {
    const { shell, apps, sent } = window.__probe;
    const names = Array.from({ length: 10 }, (_, i) => 'com.probe.' + i);

    const started = performance.now();
    const running = apps.batch(names, 'uninstall');

    // 等第 3 条真的发出去了，再模拟拔线
    for (let i = 0; i < 60 && sent.length < 3; i++) {
      await new Promise(r => setTimeout(r, 20));
    }
    const atAbort = sent.length;
    shell.abort(new Error('设备连接已结束'));

    const outcome = await Promise.race([
      running,
      new Promise(r => setTimeout(() => r(null), 20000)),
    ]);
    const elapsed = performance.now() - started;

    if (outcome === null) return { timedOut: true, elapsed, atAbort, totalSent: sent.length, results: [] };

    return {
      timedOut: false,
      elapsed,
      atAbort,
      totalSent: sent.length,
      results: outcome.map(r => ({ name: r.name, success: r.success, skipped: Boolean(r.skipped) })),
    };
  })()
`);

check('batch() 在取消后返回（未挂死）', cancelled.timedOut === false, cancelled.timedOut ? '20 秒内未返回' : '');
// 5 秒是「明显不是等超时」的量级：USB 传输超时按秒计，这里应当毫秒级返回
check(
  '取消后立即返回',
  cancelled.timedOut === false && cancelled.elapsed < 5000,
  `${Math.round(cancelled.elapsed)} ms`,
);

/*
 * 挂死时后面的断言全部没有意义（结果数组是空的）。
 * 与其让它们各自崩一个 TypeError 糊住输出，不如在这里一次性说清。
 */
if (cancelled.timedOut) {
  console.log('  … 因 batch() 未返回，跳过后续明细断言');
} else {
check('结果条数与目标数一致', cancelled.results.length === 10, `${cancelled.results.length} 条`);
check(
  '已完成的前两条如实记成功',
  cancelled.results[0]?.success === true && cancelled.results[1]?.success === true,
  cancelled.results.slice(0, 2).map((r) => r.success).join(','),
);
check(
  '正在跑的第三条被中止，不算成功',
  cancelled.results[2]?.success === false,
  String(cancelled.results[2]?.success),
);
check(
  '剩余 7 条标为「未执行」而不是「失败」',
  cancelled.results.slice(3).every((r) => r.skipped === true),
  `${cancelled.results.slice(3).filter((r) => r.skipped).length} / 7`,
);
check(
  '取消后没有再发一条命令',
  cancelled.totalSent === cancelled.atAbort,
  `发出 ${cancelled.totalSent} 条，取消时 ${cancelled.atAbort} 条`,
);
check(
  '没有朝死链路空转（远少于 10 条）',
  cancelled.totalSent <= 4,
  `${cancelled.totalSent} 条`,
);
}

/* ── 2. 播报把「未执行」说成中断，而不是「失败 7 个」 ── */
const report = await evaluate(`
  (async () => {
    const { buildBatchReport } = await import('/src/ui/state/batch-report.ts');
    const outcomes = ${JSON.stringify(cancelled.results)}.map(r => ({
      target: r.name,
      ok: r.success,
      skipped: r.skipped,
      message: r.skipped ? '连接已中断，这一条没有执行' : 'Failure',
    }));
    return buildBatchReport(outcomes, '卸载');
  })()
`);

check('语调为失败态', report.tone === 'error', report.tone);
check(
  '摘要说明连接中断与剩余数量',
  report.summary.includes('中途连接中断') && report.summary.includes('剩余 7 个没有执行'),
  report.summary.slice(0, 60),
);
check(
  '摘要不把未执行算成失败',
  !/失败 7 个/.test(report.summary),
  report.summary.slice(0, 60),
);
check(
  '摘要指向「重新插线再来一次」',
  report.summary.includes('数据线') && report.summary.includes('不会重复生效'),
  '',
);
check(
  '终端有一行 [未执行] 点名剩余项',
  report.lines.some((line) => line.startsWith('[未执行]') && line.includes('com.probe.3')),
  report.lines[0]?.slice(0, 50) ?? '',
);

/* ── 3. 未取消时行为不变：全成功仍报 success ── */
const normal = await evaluate(`
  (async () => {
    const { ShellContext } = await import('/src/core/shell.ts');
    const { AppService } = await import('/src/services/app.service.ts');
    const driver = {
      serial: 'PROBE0002', label: '正常设备', connected: true,
      async exec() { return { stdout: 'Success', stderr: '', exitCode: 0 }; },
      async openTerminal() { throw new Error('x'); }, async write() {}, async read() { return new Blob(); },
      async control() { return ''; }, async reboot() {}, async close() {},
    };
    const apps = new AppService(new ShellContext({ driver }), 33);
    apps.isSystemPackage = async () => false;
    const out = await apps.batch(['com.probe.a', 'com.probe.b', 'com.probe.c'], 'disable');
    return out.map(r => ({ ok: r.success, skipped: Boolean(r.skipped) }));
  })()
`);

check(
  '未取消时三条全部成功且无 skipped',
  normal.every((r) => r.ok && !r.skipped),
  JSON.stringify(normal),
);

/* ── 输出 ── */
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);

browser.close();
child.kill('SIGTERM');
vite.kill('SIGTERM');
process.exit(failed.length === 0 ? 0 : 1);

/**
 * 浮层焦点的无头 Chrome 实测：Tab 真的被关在弹层里吗。
 *
 * 为什么单测不够：
 * `tabDestination()` 只回答「下标该怎么走」。而这条链上真正的失效点有三个，
 * 它们都看不见源码：
 *   1. hook 装了没有（组件常驻挂载、内部 `return null` 时，effect 可能在
 *      `ref.current === null` 时提前返回，之后再也不会装 —— 看着有 hook，实际没生效）
 *   2. 监听器接的是 `document` 还是某个不冒泡的节点（接错了永远收不到按键）
 *   3. 关闭后焦点回到了哪里（回到 body 等于让用户从头 Tab 一遍）
 *
 * 实测基线（本轮修之前）：偏好面板打开后第一次 Tab 就落在背景顶栏按钮上，
 * 走完面板内 10 个控件后一路沿侧边栏跑；确认弹层第二次 Tab 就跑到背景。
 * 两边都写着 `aria-modal="true"` —— 声明了模态语义，行为上不是模态。
 *
 * 用法：node scripts/probe-focus.mjs
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const VITE_PORT = 5193;
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

/* ── 起 Chrome ──
 *
 * profile 目录每次新建：固定名字的目录在上一轮异常退出时会留下
 * `SingletonLock`，下一次启动直接被判成「已有实例在跑」并秒退，
 * 表现为「Chrome 启动超时」—— 而真正的原因是上一轮的残留。
 */
const PROFILE = mkdtempSync(join(tmpdir(), 'probe-focus-'));
const child = spawn(
  CHROME,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${PROFILE}`,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

const browserWs = await new Promise((resolve, reject) => {
  let buf = '';
  const timer = setTimeout(() => reject(new Error('Chrome 启动超时')), 30000);
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
            // 守卫：CDP 某些调用在页面进入奇怪状态时会永不返回，
            // 没有它探针会静默挂死，比判失败更难查（T-017 的教训）
            const timer = setTimeout(() => {
              pending.delete(mid);
              fail(new Error(`CDP 超时：${method}`));
            }, 15000);
            pending.set(mid, {
              ok: (v) => { clearTimeout(timer); ok(v); },
              fail: (e) => { clearTimeout(timer); fail(e); },
            });
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
  { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false },
  sessionId,
);
await browser.send('Page.navigate', { url: `http://127.0.0.1:${VITE_PORT}/?module=apps` }, sessionId);

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

/**
 * 等渲染落定。
 *
 * 两帧之后再读 DOM —— Preact 的信号更新是异步的（T-004 的教训）。
 *
 * 但**不能只等 `requestAnimationFrame`**：无头 Chrome 在页面被判为不可见时
 * 会把 rAF 掐掉，这时 `await` 一个 rAF Promise 会永远不兑现，探针静默挂死 ——
 * 比判失败更难查。本轮实测就撞上了（关掉偏好面板后那一次 settle 卡住）。
 * 所以给 rAF 配一个 500 ms 兜底，谁先到算谁。
 */
const settle = () =>
  evaluate(`new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(true); } };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 500);
  })`);

/**
 * 真按一次 Tab。
 *
 * 必须走 `Input.dispatchKeyEvent` 而不是在页面里 dispatch 一个伪造事件：
 * 浏览器搬焦点是默认行为，合成事件不会触发它 —— 用合成事件测「焦点去哪了」
 * 永远得到「没动」，看起来像全绿或全红，其实什么都没测。
 */
const pressTab = async (shift = false) => {
  const base = { windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, key: 'Tab', code: 'Tab' };
  const modifiers = shift ? 8 : 0;
  await browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base, modifiers }, sessionId);
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base, modifiers }, sessionId);
  await new Promise((r) => setTimeout(r, 70));
};

const pressEscape = async () => {
  const base = { windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27, key: 'Escape', code: 'Escape' };
  await browser.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base }, sessionId);
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, sessionId);
  await new Promise((r) => setTimeout(r, 120));
};

/** 读当前焦点落在哪个容器里。selector 为空表示不在任何浮层内 */
const activeInfo = (selector) =>
  evaluate(`(() => {
    const el = document.activeElement;
    const scope = document.querySelector(${JSON.stringify(selector)});
    const inside = Boolean(el && scope && scope.contains(el) && el !== scope);
    return {
      tag: el ? el.tagName : null,
      text: el ? (el.textContent || el.getAttribute('aria-label') || el.id || '').trim().slice(0, 20) : '',
      inside,
    };
  })()`);

/* ── 1. 偏好面板：连按 25 次 Tab 全都得落在面板内 ── */
const opened = await evaluate(`(() => {
  const btn = document.querySelector('.titlebar__settings');
  if (!btn) return false;
  btn.focus();
  btn.click();
  return true;
})()`);
await settle();
check('偏好面板能打开', opened && (await evaluate('Boolean(document.querySelector(".settings-sheet"))')));

check(
  '打开即把焦点搬进面板',
  (await activeInfo('.settings-sheet')).inside === true,
  '焦点留在触发按钮上的话，第一次 Tab 会从背景开始走',
);

const sheetTabWalk = [];
for (let i = 0; i < 25; i++) {
  await pressTab();
  sheetTabWalk.push(await activeInfo('.settings-sheet'));
}
const escaped = sheetTabWalk.filter((info) => !info.inside);
check(
  '偏好面板连按 25 次 Tab 焦点不出去',
  escaped.length === 0,
  escaped.length === 0
    ? '25 次全在面板内'
    : `有 ${escaped.length} 次跑到背景（第 ${sheetTabWalk.findIndex((i) => !i.inside) + 1} 次起）`,
);

/* 反向：Shift+Tab 从第一个控件往回也得留在面板内 */
for (let i = 0; i < 3; i++) await pressTab(true);
check(
  '偏好面板 Shift+Tab 也留在面板内',
  (await activeInfo('.settings-sheet')).inside === true,
  '只在正向拦、反向漏掉的话，Shift+Tab 三次就能退出弹层',
);

await pressEscape();
await settle();
check('Esc 关闭偏好面板', (await evaluate('!document.querySelector(".settings-sheet")')) === true);

const restoredTo = await evaluate(`(() => {
  const el = document.activeElement;
  if (!el) return '';
  return el.className?.toString?.() ?? '';
})()`);
check(
  '关闭后焦点回到齿轮按钮',
  restoredTo.includes('titlebar__settings'),
  restoredTo || '焦点落在 body',
);

/* ── 2. 确认弹层：Tab 也必须在弹层内循环 ── */
await evaluate(`
  window.__confirmAnswer = null;
  import('/src/ui/state/confirm.ts').then(m => {
    window.__confirmAnswer = m.askConfirm({
      title: '批量卸载 3 个应用',
      reason: '所选应用将从设备上移除。',
      detail: 'com.demo.one、com.demo.two、com.demo.three',
      confirmLabel: '卸载',
      word: '确认',
    });
  })
`);
await settle();

check('确认弹层已渲染', (await evaluate('Boolean(document.querySelector(".confirm-sheet"))')) === true);
check(
  '确认弹层初始焦点在弹层内',
  (await activeInfo('.confirm-sheet')).inside === true,
  '默认焦点是「不能一路回车就卸掉」的关键，跑出去等于门槛失效',
);

const confirmTabWalk = [];
for (let i = 0; i < 8; i++) {
  await pressTab();
  confirmTabWalk.push(await activeInfo('.confirm-sheet'));
}
const confirmEscaped = confirmTabWalk.filter((info) => !info.inside);
check(
  '确认弹层连按 8 次 Tab 焦点不出去',
  confirmEscaped.length === 0,
  confirmEscaped.length === 0
    ? '8 次全在弹层内'
    : `有 ${confirmEscaped.length} 次跑到背景（第 ${confirmTabWalk.findIndex((i) => !i.inside) + 1} 次起）`,
);

/* 确认词没打时确认键是禁用的，循环里只该有输入框与「取消」两个落点 */
const distinct = new Set(confirmTabWalk.map((info) => info.text));
check(
  '确认弹层内循环落点只有输入框与取消',
  distinct.size === 2 && distinct.has('confirm-word'),
  [...distinct].join(' / '),
);

await pressEscape();
await settle();
check('Esc 关闭确认弹层', (await evaluate('!document.querySelector(".confirm-sheet")')) === true);
check(
  '关闭确认弹层后 Promise 兑现为取消',
  (await evaluate('window.__confirmAnswer')) === false,
);

/* ── 3. 连接步骤弹层：同样得锁住，且 Esc 能关 ── */
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('.connect-strip button')]
    .find(b => b.textContent.trim() === '连接步骤');
  if (!btn) return false;
  btn.focus();
  btn.click();
  return true;
})()`);
await settle();

const guideShown = await evaluate('Boolean(document.querySelector(".guide-sheet"))');
check('连接步骤弹层能打开', guideShown === true);

if (guideShown) {
  check('连接步骤弹层打开即搬焦点', (await activeInfo('.guide-sheet')).inside === true);

  const guideWalk = [];
  for (let i = 0; i < 12; i++) {
    await pressTab();
    guideWalk.push(await activeInfo('.guide-sheet'));
  }
  const guideEscaped = guideWalk.filter((info) => !info.inside);
  check(
    '连接步骤弹层连按 12 次 Tab 焦点不出去',
    guideEscaped.length === 0,
    guideEscaped.length === 0
      ? '12 次全在弹层内'
      : `有 ${guideEscaped.length} 次跑到背景（第 ${guideWalk.findIndex((i) => !i.inside) + 1} 次起）`,
  );

  await pressEscape();
  await settle();
  check('Esc 关闭连接步骤弹层', (await evaluate('!document.querySelector(".guide-sheet")')) === true);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);

browser.close();
child.kill();
vite.kill();
rmSync(PROFILE, { recursive: true, force: true });
process.exit(failed.length === 0 ? 0 : 1);

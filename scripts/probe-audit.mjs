/**
 * 操作记录页的无头 Chrome 实测：清空到底弹的是什么、列表跟不跟着新记录走。
 *
 * 为什么必须真跑浏览器：
 *
 * 1. **`window.confirm` 是阻塞式的**。它在页面里挂起脚本、连 CDP 的
 *    `Runtime.evaluate` 都不返回。本轮探针第一次跑就因此挂死三分钟才被手动掐掉 ——
 *    这个「挂死」本身就是最硬的证据：一个地方调用原生对话框，
 *    自动化和无障碍工具都拿它没办法。断言写成「有没有触发
 *    `Page.javascriptDialogOpening`」，比读源码里有没有那个词可靠。
 * 2. **列表刷新依赖渲染层的引用判等**。`setEntries` 收到同一引用时 Preact 直接跳过，
 *    单测能测「订阅者拿到新引用」，但测不了「DOM 真的多了一行」。
 *    本轮实测：挂载后追加一条，列表从 2 条仍是 2 条。
 *
 * 用法：node scripts/probe-audit.mjs
 * 退出码：0 全过；1 有不达标项
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

const VITE_PORT = 5194;
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

const PROFILE = mkdtempSync(join(tmpdir(), 'probe-audit-'));
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

/** 收到的 CDP 事件，用来判「有没有弹原生对话框」 */
const events = [];

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
      } else if (msg.method) {
        events.push(msg);
      }
    });
    socket.addEventListener('error', reject);
    socket.addEventListener('open', () =>
      resolve({
        send(method, params = {}, sessionId) {
          const mid = ++id;
          return new Promise((ok, fail) => {
            /*
             * 超时守卫是必需的，不是保险。
             *
             * 原生对话框会把页面的执行上下文挂住，`Runtime.evaluate` 永不返回。
             * 没有守卫时探针不报错、不退出，只是一直等 —— 比判失败难查得多。
             */
            const timer = setTimeout(() => {
              pending.delete(mid);
              fail(new Error(`CDP 超时：${method}`));
            }, 15000);
            pending.set(mid, {
              ok: (v) => {
                clearTimeout(timer);
                ok(v);
              },
              fail: (e) => {
                clearTimeout(timer);
                fail(e);
              },
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

/**
 * 等渲染落地。
 *
 * 无头 Chrome 在页面被判为不可见时会掐掉 rAF，`await requestAnimationFrame`
 * 会永不兑现（T-022 踩过）。所以「两帧 OR 500 ms 兜底」。
 */
const settle = () =>
  evaluate(`new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(true); } };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 500);
  })`);

/** 切到「操作记录」分区。`?module=` 不生效，初始分区固定是 device */
await evaluate(
  `[...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes('操作记录'))?.click()`,
);
await settle();

check(
  '操作记录分区能打开',
  (await evaluate(`Boolean(document.querySelector('.audit')) || Boolean(document.querySelector('.empty'))`)) === true,
);

/* ── 1. 列表跟随新记录 ── */
await evaluate(`import('/src/core/audit.ts').then((m) => m.auditLog.whenReady())`);
await new Promise((r) => setTimeout(r, 200));

const seeded = await evaluate(`import('/src/core/audit.ts').then((m) => {
  m.auditLog.record({ module: 'apps', action: 'apps.disable', label: '冻结 探针甲', commands: ['pm disable-user --user 0 com.probe.a'], status: 'ok' });
  m.auditLog.record({ module: 'display', action: 'display.density', label: '改密度 420', commands: ['wm density 420'], status: 'error', error: 'permission denied' });
  return m.auditLog.list().length;
})`);
await settle();

const afterSeed = await evaluate(`document.querySelectorAll('.audit__item').length`);
check(
  '记录写入后列表出现对应行',
  afterSeed === seeded && afterSeed > 0,
  `日志 ${seeded} 条 / DOM ${afterSeed} 行`,
);

/* 页面已经挂着，再写一条 —— 这正是「引用不变」会失效的场景 */
await evaluate(`import('/src/core/audit.ts').then((m) => {
  m.auditLog.record({ module: 'apps', action: 'apps.enable', label: '启用 探针乙', commands: [], status: 'ok' });
  return true;
})`);
await settle();

const afterAppend = await evaluate(`document.querySelectorAll('.audit__item').length`);
check(
  '页面挂载后新增记录，列表跟着涨',
  afterAppend === afterSeed + 1,
  `追加前 ${afterSeed} → 追加后 ${afterAppend}`,
);

/* ── 2. 清空：必须走站内弹层，不得弹原生对话框 ── */
/*
 * 关键判据不是「有没有调用 askConfirm」，而是「浏览器有没有收到一个原生对话框」。
 * 原生对话框出现时页面会整体挂住，所以这里先清掉事件记录、点按钮、
 * 再按事件流判 —— 若改回 `window.confirm`，`Page.javascriptDialogOpening` 必然出现，
 * 且下面第一条 `evaluate` 会直接超时。
 */
events.length = 0;

/*
 * 这一段包在 try 里是必需的，不是防御性编程的洁癖。
 *
 * 若清空改回 `window.confirm`，点击后页面执行上下文被原生对话框挂住，
 * 后面每一个 `evaluate` 都会超时。不兜住的话脚本会以未捕获异常崩掉 ——
 * 退出码虽然是 1，但输出是一段 Node 调用栈，看不出「到底哪条检查不过」。
 * 兜住之后能明确报出「点了之后浏览器没有响应」，指向真正的病灶。
 */
let nativeDialogBlocked = false;
try {
  const clickResult = await Promise.race([
    evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '清空');
      if (!btn) return 'missing';
      if (btn.disabled) return 'disabled';
      btn.click();
      return 'clicked';
    })()`).catch((e) => `error:${e.message}`),
    new Promise((r) => setTimeout(() => r('timedOut'), 8000)),
  ]);

  if (clickResult === 'timedOut') nativeDialogBlocked = true;
  check(
    '清空按钮可点',
    clickResult === 'clicked',
    clickResult === 'timedOut' ? '点击后页面无响应 —— 典型的原生对话框挂起' : `结果 ${clickResult}`,
  );

  await settle();
} catch (error) {
  nativeDialogBlocked = true;
  /*
   * 只有在上面那条 check 还没写过时才补一条。
   * 两条同名的失败项会让人误以为有两个独立缺陷（本轮首版就这样）。
   */
  if (!results.some((r) => r.name === '清空按钮可点')) {
    check('清空按钮可点', false, `点击后 CDP 不再响应：${error.message}`);
  } else {
    const row = results.find((r) => r.name === '清空按钮可点');
    row.detail = `${row.detail}；随后 CDP 超时（${error.message}）`;
  }
}

const nativeDialog = events.find((e) => e.method === 'Page.javascriptDialogOpening');
check(
  '清空不弹浏览器原生对话框',
  !nativeDialog && !nativeDialogBlocked,
  nativeDialog
    ? `弹了 ${nativeDialog.params?.type}：${nativeDialog.params?.message?.slice(0, 40)}`
    : nativeDialogBlocked
      ? '页面被对话框挂住（未收到事件，但 CDP 已无响应）'
      : '无',
);

/*
 * 页面已经被挂住时，后面的检查都不可能成立。
 * 与其逐条超时 15 秒，不如一次性把剩余的判为失败并说明原因。
 */
if (nativeDialogBlocked) {
  for (const name of [
    '清空弹出站内确认弹层',
    '标题点明是清空操作记录',
    '要求手打确认词',
    '未打确认词前确认键禁用',
    '默认焦点在输入框',
    '打对确认词后确认键可用',
    '确认后弹层关闭',
    '清空后只剩一条「已清空」自述',
    '自述记录写明清空了几条',
    '取消后记录一条不减',
    '取消同样不弹原生对话框',
  ]) {
    check(name, false, '页面被原生对话框挂住，无法继续测量');
  }

  const failedBlocked = results.filter((r) => !r.ok);
  console.log(`\n${results.length} 项，通过 ${results.length - failedBlocked.length}，失败 ${failedBlocked.length}`);
  browser.close();
  child.kill();
  vite.kill();
  try {
    rmSync(PROFILE, { recursive: true, force: true });
  } catch {
    // 清理失败无关结论
  }
  process.exit(1);
}

const sheetAfterClick = await evaluate(`(() => {
  const sheet = document.querySelector('.confirm-sheet');
  if (!sheet) return null;
  const okBtn = [...sheet.querySelectorAll('button')].find((b) => b.classList.contains('btn--danger'));
  return {
    title: sheet.querySelector('.confirm-sheet__title')?.textContent ?? '',
    hasInput: Boolean(sheet.querySelector('input')),
    okDisabled: okBtn?.disabled ?? null,
    focused: document.activeElement?.tagName ?? '',
  };
})()`);

check('清空弹出站内确认弹层', sheetAfterClick !== null, sheetAfterClick ? `标题「${sheetAfterClick.title}」` : '未出现');
check('标题点明是清空操作记录', sheetAfterClick?.title?.includes('清空') === true && sheetAfterClick?.title?.includes('操作记录') === true);
check('要求手打确认词', sheetAfterClick?.hasInput === true);
check('未打确认词前确认键禁用', sheetAfterClick?.okDisabled === true);
check('默认焦点在输入框', sheetAfterClick?.focused === 'INPUT', `焦点在 ${sheetAfterClick?.focused}`);

/*
 * 打对确认词再确认。
 *
 * 用 CDP 真敲键盘而不是 `dispatchEvent(new Event('input'))` ——
 * 后者造的假输入不会触发 Preact 的绑定（T-011 踩过）。
 */
const typeWord = async (text) => {
  await browser.send('Input.insertText', { text }, sessionId);
  await settle();
};

await typeWord('确认');

const readyToConfirm = await evaluate(`(() => {
  const sheet = document.querySelector('.confirm-sheet');
  const okBtn = sheet ? [...sheet.querySelectorAll('button')].find((b) => b.classList.contains('btn--danger')) : null;
  return okBtn?.disabled ?? null;
})()`);
check('打对确认词后确认键可用', readyToConfirm === false);

await evaluate(`(() => {
  const sheet = document.querySelector('.confirm-sheet');
  const okBtn = sheet ? [...sheet.querySelectorAll('button')].find((b) => b.classList.contains('btn--danger')) : null;
  okBtn?.click();
  return true;
})()`);
await settle();

const afterClear = await evaluate(`(() => ({
  sheet: document.querySelectorAll('.confirm-sheet').length,
  items: document.querySelectorAll('.audit__item').length,
  firstLabel: document.querySelector('.audit__label')?.textContent ?? '',
}))()`);

check('确认后弹层关闭', afterClear.sheet === 0);
check(
  '清空后只剩一条「已清空」自述',
  afterClear.items === 1,
  `剩余 ${afterClear.items} 条，首条「${afterClear.firstLabel}」`,
);
check(
  '自述记录写明清空了几条',
  afterClear.firstLabel.includes('清空') && /\d/.test(afterClear.firstLabel),
  afterClear.firstLabel,
);

/* ── 3. 取消不清空 ── */
await evaluate(`import('/src/core/audit.ts').then((m) => {
  m.auditLog.record({ module: 'apps', action: 'apps.enable', label: '取消测试用', commands: [], status: 'ok' });
  return true;
})`);
await settle();

const beforeCancel = await evaluate(`document.querySelectorAll('.audit__item').length`);
events.length = 0;
await evaluate(
  `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '清空')?.click()`,
);
await settle();
await evaluate(
  `[...document.querySelectorAll('.confirm-sheet button')].find((b) => b.classList.contains('btn--secondary'))?.click()`,
);
await settle();

const afterCancel = await evaluate(`document.querySelectorAll('.audit__item').length`);
check(
  '取消后记录一条不减',
  afterCancel === beforeCancel,
  `取消前 ${beforeCancel} → 取消后 ${afterCancel}`,
);
check('取消同样不弹原生对话框', !events.find((e) => e.method === 'Page.javascriptDialogOpening'));

/* ── 输出 ── */
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);

browser.close();
child.kill();
vite.kill();
try {
  rmSync(PROFILE, { recursive: true, force: true });
} catch {
  // 清理失败无关结论
}
process.exit(failed.length === 0 ? 0 : 1);

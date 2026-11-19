/**
 * 确认弹层的无头 Chrome 实测：真跑「请求 → 弹层 → 点击 → Promise 兑现」这条主链路。
 *
 * 为什么必须真跑浏览器：
 * 单测只能验证 `gateFor()` 的判定，而这一层的价值全在「请求发出之后界面有没有拦人」。
 * 组件写好了但没挂载、按钮没真禁用、取消后 Promise 没兑现 —— 三件事单测都看不见。
 *
 * **必须用 vite dev 而不是 dist**：ES 模块注册表按 URL 键，dev 下页面自己 import 的
 * `/src/ui/state/confirm.ts` 与从控制台 import 同一个 URL 拿到的是**同一个实例**，
 * 于是能从外面驱动页面里那个 `ConfirmSheet`。打包产物做不到这一点 ——
 * 模块被内联进 chunk，外部拿不到引用。（T-012 记过这个坑的反面：那时是热更新残留导致两个实例。）
 *
 * 用法：node scripts/probe-confirm.mjs
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
const vite = spawn(
  join(ROOT, 'node_modules/.bin/vite'),
  ['--port', '5199', '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
);

const vitePort = 5199;
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
// 再多等一拍，确保端口真的可连
await new Promise((r) => setTimeout(r, 800));

/* ── 起 Chrome ── */
const child = spawn(
  CHROME,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=/tmp/probe-confirm-profile',
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
  { width: 1024, height: 900, deviceScaleFactor: 1, mobile: false },
  sessionId,
);
await browser.send('Page.navigate', { url: `http://127.0.0.1:${vitePort}/?module=apps` }, sessionId);

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

/* ── 1. 初始状态 ── */
check('初始无确认弹层', (await evaluate('document.querySelectorAll(".confirm-sheet").length')) === 0);

/* ── 2. 高风险请求：弹层出现，确认按钮在打对词之前禁用 ── */
await evaluate(`
  window.__probe = import('/src/ui/state/confirm.ts').then(m => {
    window.__c = m;
    window.__answer = m.askConfirm({
      title: '批量卸载 2 个应用',
      reason: '所选应用将从设备上移除，数据一并删除且无法撤销。',
      detail: 'com.demo.one、com.demo.two',
      confirmLabel: '卸载',
      word: '确认',
    });
    return true;
  })
`);
await settle();

const shown = await evaluate(`(() => {
  const sheet = document.querySelector('.confirm-sheet');
  if (!sheet) return null;
  const okBtn = [...sheet.querySelectorAll('button')].find(b => b.classList.contains('btn--danger'));
  const cancelBtn = [...sheet.querySelectorAll('button')].find(b => b.classList.contains('btn--secondary'));
  return {
    title: sheet.querySelector('.confirm-sheet__title')?.textContent,
    detail: sheet.querySelector('.confirm-sheet__detail')?.textContent,
    hasInput: Boolean(sheet.querySelector('input')),
    okDisabled: okBtn?.disabled,
    cancelDisabled: cancelBtn?.disabled,
    focused: document.activeElement?.tagName,
    role: sheet.parentElement?.getAttribute('role'),
    modal: sheet.parentElement?.getAttribute('aria-modal'),
  };
})()`);

check('弹层已出现', shown !== null, shown ? `标题「${shown.title}」` : '未渲染');
check('标题含目标数量', shown?.title?.includes('2 个应用') === true, shown?.title ?? '');
check('列出目标清单', shown?.detail?.includes('com.demo.one') === true);
check('要求手打确认词时出现输入框', shown?.hasInput === true);
check('未打词时确认按钮禁用', shown?.okDisabled === true);
check('取消按钮始终可用', shown?.cancelDisabled === false);
check('默认焦点在输入框而非确认键', shown?.focused === 'INPUT', `焦点在 ${shown?.focused}`);
check('读屏能识别为模态对话框', shown?.role === 'dialog' && shown?.modal === 'true');

/* ── 3. 打错词仍禁用，打对词才放行 ── */
async function typeWord(text) {
  await evaluate(`(() => {
    const input = document.querySelector('.confirm-sheet input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await settle();
  return evaluate(`(() => {
    const okBtn = [...document.querySelectorAll('.confirm-sheet button')].find(b => b.classList.contains('btn--danger'));
    return okBtn?.disabled;
  })()`);
}

check('错词不放行', (await typeWord('确定')) === true);
check('打对词后放行', (await typeWord('确认')) === false);

/* ── 4. 点取消：Promise 兑现 false，弹层消失，什么都没执行 ── */
const cancelResult = await evaluate(`(() => {
  const cancelBtn = [...document.querySelectorAll('.confirm-sheet button')].find(b => b.classList.contains('btn--secondary'));
  cancelBtn.click();
  return window.__answer;
})()`);
await settle();
check('取消兑现为 false', cancelResult === false, String(cancelResult));
check('取消后弹层关闭', (await evaluate('document.querySelectorAll(".confirm-sheet").length')) === 0);

/* ── 5. 点确认：兑现 true ── */
await evaluate(`
  window.__answer2 = null;
  import('/src/ui/state/confirm.ts').then(m => {
    window.__answer2 = m.askConfirm({ title: '停用 1 个组件', reason: '可随时恢复。', confirmLabel: '停用' });
  })
`);
await settle();
check('无确认词的请求不出现输入框', (await evaluate('Boolean(document.querySelector(".confirm-sheet input"))')) === false);

/*
 * 必须先点、再 await —— 顺序反了会死锁：`await` 在同一个表达式里等 Promise，
 * 而 Promise 只有在按钮被点后才兑现，点击那一半永远执行不到。
 * 分两步：先触发点击（同步返回），再单独 await 那个 Promise。
 */
await evaluate(`(() => {
  const okBtn = [...document.querySelectorAll('.confirm-sheet button')].find(b => b.classList.contains('btn--danger'));
  window.__okWasDisabled = okBtn.disabled;
  okBtn.click();
  return true;
})()`);
await settle();

const okWasDisabled = await evaluate('window.__okWasDisabled');
const confirmAnswer = await evaluate('window.__answer2');
check('无确认词时确认键直接可用', okWasDisabled === false);
check('确认兑现为 true', confirmAnswer === true, String(confirmAnswer));

/* ── 6. Esc 取消 ── */
await evaluate(`
  window.__answer3 = null;
  import('/src/ui/state/confirm.ts').then(m => {
    window.__answer3 = m.askConfirm({ title: 'Esc 测试', reason: 'x', confirmLabel: '好' });
  })
`);
await settle();
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await settle();
check('Esc 兑现为 false', (await evaluate('window.__answer3')) === false);

/* ── 7. 并发请求：第二个直接拿到 false，不叠层 ── */
const concurrent = await evaluate(`
  Promise.all([
    import('/src/ui/state/confirm.ts').then(m => {
      const first = m.askConfirm({ title: '第一个', reason: 'x', confirmLabel: '好' });
      const second = m.askConfirm({ title: '第二个', reason: 'y', confirmLabel: '好' });
      return second.then(v => ({ secondAnswer: v, firstPending: true }));
    }),
  ]).then(([r]) => r)
`);
await settle();
const sheetCount = await evaluate('document.querySelectorAll(".confirm-sheet").length');
check('并发时第二请求立即取消', concurrent.secondAnswer === false);
check('并发时不叠第二层弹层', sheetCount === 1, `${sheetCount} 层`);
// 清掉还挂着的第一个
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await settle();

/* ── 8. 窄屏几何 ── */
await browser.send(
  'Emulation.setDeviceMetricsOverride',
  { width: 375, height: 812, deviceScaleFactor: 1, mobile: true },
  sessionId,
);
await new Promise((r) => setTimeout(r, 300));
await evaluate(`
  window.__answer4 = null;
  import('/src/ui/state/confirm.ts').then(m => {
    window.__answer4 = m.askConfirm({ title: '批量卸载 30 个应用', reason: '所选应用将从设备上移除。', detail: Array.from({length:30},(_,i)=>'com.demo.app'+i).join('、'), confirmLabel: '卸载', word: '确认' });
  })
`);
await settle();

const geometry = await evaluate(`(() => {
  const sheet = document.querySelector('.confirm-sheet');
  if (!sheet) return null;
  const btns = [...sheet.querySelectorAll('.btn')];
  const rects = btns.map(b => b.getBoundingClientRect());
  return {
    sheetW: Math.round(sheet.getBoundingClientRect().width),
    btnHeights: rects.map(r => Math.round(r.height)),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    detailScrolls: (() => { const d = sheet.querySelector('.confirm-sheet__detail'); return d ? d.scrollHeight > d.clientHeight : null; })(),
    inViewport: rects.every(r => r.right <= window.innerWidth && r.left >= 0),
  };
})()`);

check('窄屏按钮高度 ≥44px', geometry?.btnHeights?.every((h) => h >= 44) === true, `${geometry?.btnHeights?.join(' / ')}`);
check('窄屏无横向溢出', geometry?.overflow === false, `弹层宽 ${geometry?.sheetW}px`);
check('30 个包名的长清单限高可滚动', geometry?.detailScrolls === true, '避免把确认键顶出视口');
check('按钮全部留在视口内', geometry?.inViewport === true);

/*
 * ── 9. 视口高度扫描：矮屏下标题与两个按钮都必须在视口内 ──
 *
 * 为什么宽度测完还得测高度：`.confirm-sheet` 的 420px 上限管的是横向，
 * 而这一层真正会失控的是纵向 —— 卡片自身高度由文案、输入框、目标清单堆出来，
 * 视口一矮（手机横屏、Safari 工具栏占位、分屏小窗）就会顶出屏幕。
 *
 * 三种症状按严重度递增，所以断言也分三条：
 * 1. 卡片超出视口上下边界 —— 内容被裁
 * 2. 标题不可见 —— 用户不知道自己在确认什么
 * 3. 按钮点不到 —— 连「取消」都够不着，只能刷新页面逃出去
 *
 * 按钮判定用 `elementFromPoint` 而不是 `getBoundingClientRect().top >= 0`：
 * 元素几何上留在视口内、却被别的图层盖住时，只看矩形会判通过。
 * 这是 T-020 之前 `verify-layout` 已经踩过的坑，这里沿用同一套判据。
 */
const HEIGHT_SWEEP = [
  { w: 812, h: 375, label: '手机横屏' },
  { w: 667, h: 320, label: '手机横屏 + 工具栏' },
  { w: 568, h: 320, label: '小屏横屏' },
  { w: 375, h: 300, label: '分屏小窗' },
  // 平板竖屏 / 桌面补进同一轮：420px 上限在这两档是否有意义，此前从未量过
  { w: 768, h: 1024, label: '平板竖屏' },
  { w: 1440, h: 900, label: '桌面' },
];

for (const vp of HEIGHT_SWEEP) {
  await browser.send(
    'Emulation.setDeviceMetricsOverride',
    { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.w <= 768 },
    sessionId,
  );
  await new Promise((r) => setTimeout(r, 260));

  await evaluate(`
    window.__h = null;
    import('/src/ui/state/confirm.ts').then(m => {
      window.__h = m.askConfirm({
        title: '批量卸载 30 个应用',
        reason: '所选应用将从设备上移除，普通应用的数据一并删除且无法撤销。系统应用会保留数据，可用「卸载与恢复」装回。',
        detail: Array.from({length:30},(_,i)=>'com.example.demoapp'+i).join('、'),
        confirmLabel: '卸载',
        word: '确认',
      });
    })
  `);
  await settle();

  const h = await evaluate(`(() => {
    const sheet = document.querySelector('.confirm-sheet');
    if (!sheet) return { missing: true };
    const title = sheet.querySelector('.confirm-sheet__title');
    const tr = title.getBoundingClientRect();
    const th = document.elementFromPoint(tr.left + 4, tr.top + tr.height / 2);
    const body = sheet.querySelector('.confirm-sheet__body');
    const btns = [...sheet.querySelectorAll('.confirm-sheet__actions .btn')];
    const r = sheet.getBoundingClientRect();
    return {
      vh: window.innerHeight,
      vw: window.innerWidth,
      w: Math.round(r.width),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      titleInView: tr.top >= 0 && tr.bottom <= window.innerHeight,
      titleHit: Boolean(th && (th === title || title.contains(th))),
      btnsHittable: btns.every(b => {
        const br = b.getBoundingClientRect();
        const hit = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
        return Boolean(hit && (hit === b || b.contains(hit)));
      }),
      bodyScrolls: body ? body.scrollHeight > body.clientHeight + 1 : false,
    };
  })()`);

  const tag = `${vp.w}×${vp.h} ${vp.label}`;
  check(
    `${tag}：卡片不超出视口`,
    !h.missing && h.top >= -0.5 && h.bottom <= h.vh + 1,
    h.missing ? '未渲染' : `top ${h.top} / bottom ${h.bottom} / 视口 ${h.vh}`,
  );
  check(`${tag}：标题可见且未被遮挡`, h.titleInView === true && h.titleHit === true);
  check(`${tag}：两个按钮都在视口内且点得到`, h.btnsHittable === true);

  /*
   * 420px 宽度上限：宽屏下卡片不许跟着视口一起变宽。
   *
   * 这条是「连续五轮登记未测」的正解 —— 之前一直在猜「768 / 1440 会不会溢出」，
   * 实际量下来宽度从来没出过问题，出问题的是高度。但宽度上限仍需一条断言：
   * 它一旦被误删，宽屏下「取消」与「卸载」会隔着半屏，误点概率直接上升。
   * 窄屏时卡片本来就窄于上限，所以只在视口宽 ≥ 640px 时判定。
   */
  if (vp.w >= 640) {
    check(
      `${tag}：卡片宽度不超过 420px`,
      h.w <= 420,
      `实测 ${h.w}px / 视口 ${h.vw}px`,
    );
  }

  // 收尾：Esc 兑现 false，避免下一条请求被「已有请求在等」挡掉
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await new Promise((r) => setTimeout(r, 160));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);

browser.close();
child.kill();
vite.kill();
process.exit(failed.length === 0 ? 0 : 1);

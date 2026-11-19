/**
 * 多端适配审计。
 *
 * 手工把浏览器拖成四个宽度逐个点导航，靠的是眼睛和记性，改一次样式就得重来。
 * 这个脚本把「适配是否过关」变成可执行的硬指标：
 *
 * 1. 横向溢出 —— 页面出现左右滚动条，内容被挤到屏幕外
 * 2. 越界元素 —— 元素右边缘超出视口（溢出常由它引起，但根元素没滚动时也要抓）
 * 3. 触控目标 —— 窄屏下可点区域小于 44px，手指点不中
 * 4. 抽屉出口 —— 窄屏侧边栏展开后，点遮罩与按 Esc 都要能关掉
 *
 * 只在窄屏（≤ 768px）检查触控目标：桌面端 32px 高的按钮是 Apple HIG 的
 * macOS 常规尺寸，硬拉到 44px 只会让界面变得臃肿。
 *
 * 用法：node scripts/verify-layout.mjs [--json]
 * 前置：先 npm run build（读 dist/），并需要一个可用的 Chrome
 * 退出码：0 全过；1 有 P0 问题（溢出 / 越界 / 遮挡 / 抽屉关不掉）
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const JSON_OUT = process.argv.includes('--json');

/** 四档宽度：手机竖屏 / 平板竖屏 / 平板横屏 / 桌面 */
const WIDTHS = [375, 768, 1024, 1440];
/** 导航里的分区 id，逐个点进去量 */
const MODULES = ['device', 'apps', 'display', 'files', 'system', 'battery', 'vendor', 'terminal', 'audit'];
/** 窄屏判定阈值：低于它才检查触控目标 */
const TOUCH_BREAKPOINT = 768;
/** WCAG 2.5.5 / Apple HIG 的最小可点区域 */
const MIN_TARGET = 44;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

const server = createServer(async (req, res) => {
  try {
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

/*
 * 浏览器路径解析。
 *
 * 只做「找得到就用」：不给用户装浏览器，也不猜版本。
 * 找不到就明确说清该装什么、或用 CHROME_PATH 指过去 ——
 * 静默跳过会让「没测」看起来像「没问题」，那是最坏的结果。
 */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!CHROME) {
  console.error(
    '找不到 Chrome。本脚本需要无头 Chrome 做真实渲染测量，请安装 Chrome，' +
      '或用 CHROME_PATH=/path/to/chrome 指定路径。',
  );
  process.exit(1);
}

/** 起一个 Chrome 并拿到 CDP 连接 */
async function launch(width) {
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--remote-debugging-port=0',
      `--window-size=${width},900`,
      `--user-data-dir=/tmp/chrome-layout-${process.pid}-${width}`,
      `http://127.0.0.1:${port}/index.html`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('等待 Chrome 调试端口超时')), 20000);
    child.stderr.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params, sessionId }));
    });

  const { result: targets } = await send('Target.getTargets');
  const page = targets.targetInfos.find((t) => t.type === 'page');
  const { result: attached } = await send('Target.attachToTarget', {
    targetId: page.targetId,
    flatten: true,
  });
  const sid = attached.sessionId;

  /*
   * 取表达式结果。
   *
   * 这里必须把异常喊出来：CDP 出错时 `result.result` 是 undefined，
   * 静默返回 undefined 会让上层把「量不到」当成「没问题」，
   * 审计脚本自己假通过是最坏的结果。
   */
  const evaluate = async (expression) => {
    // awaitPromise：关闭抽屉这类操作触发的是框架异步重渲染，同步读状态会读到旧值
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
    if (response.error) throw new Error(`CDP 错误：${response.error.message}`);
    if (response.result?.exceptionDetails) {
      const d = response.result.exceptionDetails;
      throw new Error(`页面表达式抛错：${d.exception?.description ?? d.text}`);
    }
    return response.result?.result?.value;
  };

  return { child, ws, send, sid, evaluate };
}

/**
 * 页面测量。
 *
 * 溢出分两种，都要抓：
 * - **滚动型**：文档被撑宽，出现横向滚动条
 * - **裁剪型**：祖先容器是 overflow-x:hidden，超出的内容直接被切掉 ——
 *   这种更隐蔽，页面上看不到滚动条，但那部分内容用户永远看不到。
 *   `.content` 就是 overflow-x:hidden，所以只查 scrollWidth 会漏掉真正的溢出。
 *
 * 触控目标只对窄屏（≤ 768px）判定：桌面端 26 / 32px 高的按钮是 macOS 常规尺寸，
 * 硬拉到 44px 只会让界面变得臃肿；而手指操作下 44px 才是可靠命中区。
 *
 * `scope` 是本次测量的范围选择器（可选）。弹层打开时传 `.guide-sheet`：
 * 那层遮罩本来就该盖住背景，把被盖住的按钮算成「点不到」是审计脚本自己搞错了对象。
 */
const MEASURE = (touchBreakpoint, minTarget, scope) => `(() => {
  const TOUCH_MAX = ${Number(touchBreakpoint)};
  const MIN_TARGET = ${Number(minTarget)};
  const SCOPE = ${scope ? JSON.stringify(scope) : 'null'};
  const vw = window.innerWidth;
  const styleOf = (el) => getComputedStyle(el);
  const root = SCOPE ? document.querySelector(SCOPE) : document.body;
  if (SCOPE && !root) return null;

  /* 找最近的横向裁剪祖先：滚动型返回 'scroll'，裁剪型返回 'clip'，都没有返回 null */
  const clipAncestor = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const ox = styleOf(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return { mode: 'scroll', node: n };
      if (ox === 'hidden' || ox === 'clip') return { mode: 'clip', node: n };
    }
    return null;
  };

  const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;

  const overflowing = [];
  const clipped = [];
  const smallMap = new Map();
  const seen = new Set();

  for (const el of root.querySelectorAll('*')) {
    const cs = styleOf(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (cs.position === 'fixed') continue;

    /*
     * 1. 溢出判定。
     *
     * 基准不是视口，而是「最近裁剪祖先的右边缘」—— 侧边栏占掉左侧 236px 之后，
     * 内容区右边界比视口左移了同样的距离；元素越过内容区、但还没越过视口时，
     * 只按视口比会漏判，而那部分内容已经被 overflow-x:hidden 切掉了。
     */
    const anc = clipAncestor(el);
    const limit = anc ? anc.node.getBoundingClientRect().right : vw;
    if (rect.right > limit + 1) {
      const cls = typeof el.className === 'string' ? el.className : '';
      const key = (cls || el.tagName) + '@' + Math.round(rect.right);
      if (!seen.has(key)) {
        seen.add(key);
        const item = {
          tag: el.tagName.toLowerCase(),
          cls,
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
        // 可滚动容器里的横向滚动是刻意设计（宽表格），不算缺陷；被裁掉才是缺陷
        if (!anc) overflowing.push(item);
        else if (anc.mode === 'clip') {
          clipped.push({
            ...item,
            hidden: Math.round(rect.right - limit),
            by: typeof anc.node.className === 'string' ? anc.node.className : anc.node.tagName,
          });
        }
      }
    }

    // 2. 触控目标（仅窄屏）
    if (vw <= TOUCH_MAX) {
      const clickable =
        el.tagName === 'BUTTON' ||
        el.tagName === 'SELECT' ||
        el.tagName === 'A' ||
        el.getAttribute('role') === 'button' ||
        el.getAttribute('role') === 'switch' ||
        el.classList.contains('switch');
      if (clickable && !el.disabled && rect.height < MIN_TARGET - 0.5) {
        /*
         * 按「类名 + 高度」聚合计数。
         *
         * 一个分区里同样的按钮会重复出现十几次（每个导航项、每张卡片的执行键），
         * 逐条上报只会刷屏。聚合成「哪一类控件、多高、几个」才能直接定位要改哪条 CSS。
         */
        const cls = typeof el.className === 'string' ? el.className : '';
        const key = cls + '|' + Math.round(rect.height);
        const hit = smallMap.get(key);
        if (hit) hit.count++;
        else {
          smallMap.set(key, {
            tag: el.tagName.toLowerCase(),
            cls,
            h: Math.round(rect.height),
            sample: (el.textContent || '').trim().slice(0, 14),
            count: 1,
          });
        }
      }
    }
  }

  const smallTargets = [...smallMap.values()].sort((a, b) => b.count - a.count);
  const smallTotal = smallTargets.reduce((s, t) => s + t.count, 0);

  /*
   * 3. 遮挡判定：中心点命中测试。
   *
   * 「看得到但点不到」是最典型的窄屏事故 —— 抽屉盖住内容、
   * 固定条压住首行按钮。用 elementFromPoint 打中心点，
   * 命中的不是自己也不是自己的后代，就说明它被什么东西挡住了。
   */
  const covered = [];
  const coveredSeen = new Set();
  for (const el of root.querySelectorAll('button, a, select, .switch')) {
    const cs = styleOf(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.disabled) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.top < 0 || r.bottom > window.innerHeight) continue;
    if (r.left < 0 || r.right > vw) continue;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit) continue;
    if (hit === el || el.contains(hit) || hit.contains(el)) continue;
    const key = (typeof el.className === 'string' ? el.className : el.tagName) + '|' +
      (typeof hit.className === 'string' ? hit.className : hit.tagName);
    if (coveredSeen.has(key)) continue;
    coveredSeen.add(key);
    covered.push({
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === 'string' ? el.className : '',
      sample: (el.textContent || '').trim().slice(0, 14),
      by: (typeof hit.className === 'string' && hit.className) || hit.tagName.toLowerCase(),
    });
  }

  return {
    vw,
    docOverflow,
    overflowing: overflowing.slice(0, 12),
    overflowingCount: overflowing.length,
    clipped: clipped.slice(0, 12),
    clippedCount: clipped.length,
    covered: covered.slice(0, 12),
    coveredCount: covered.length,
    smallTargets,
    smallTargetCount: smallTotal,
  };
})()`;

/** 点一个导航项（用文本匹配，比选择器稳） */
const clickModule = (id) => `(() => {
  const btns = [...document.querySelectorAll('.nav-item')];
  const idx = ${JSON.stringify(MODULES)}.indexOf(${JSON.stringify(id)});
  if (btns[idx]) { btns[idx].click(); return true; }
  return false;
})()`;

/**
 * 展开当前分区所有工具卡片。
 *
 * 表单控件、危险确认区、结果预览都只在展开后才存在。
 * 不展开就量，等于只审计了卡片标题。
 */
const expandAll = `(() => {
  let n = 0;
  for (const head of document.querySelectorAll('.tool__head')) {
    if (head.closest('.tool')?.dataset.expanded === 'true') continue;
    if (head.disabled) continue;
    head.click();
    n++;
  }
  return n;
})()`;

/** 打开「连接步骤」弹层 —— 它是唯一的全屏浮层，最容易被忽略 */
const openGuide = `(() => {
  const btn = [...document.querySelectorAll('.connect-strip .btn')].find(
    (b) => (b.textContent || '').includes('连接步骤'),
  );
  if (!btn) return false;
  btn.click();
  return true;
})()`;

const closeGuide = `(() => {
  const sheet = document.querySelector('.guide-sheet__close');
  if (sheet) { sheet.click(); return true; }
  return false;
})()`;

/** 打开「偏好设置」弹层 —— 六项偏好都藏在这里，漏测等于漏掉整个面板 */
const openSettings = `(() => {
  const btn = document.querySelector('.titlebar__settings');
  if (!btn) return false;
  btn.click();
  return true;
})()`;

const closeSettings = `(() => {
  const sheet = document.querySelector('.settings-sheet .settings-head .btn');
  if (sheet) { sheet.click(); return true; }
  return false;
})()`;

/** 切换侧边栏抽屉（窄屏唯一的分区入口，必须单独走查） */
const toggleSidebar = `(() => {
  const btn = document.querySelector('.titlebar__menu');
  // display:none 的元素点不到也没意义，按可见性判断
  if (!btn || btn.getBoundingClientRect().width === 0) return false;
  btn.click();
  return true;
})()`;

/*
 * 抽屉的两个关闭路径 —— 行为级断言，不只是看样式。
 *
 * 两个探针都是 async 并等两帧：点下去之后 Preact 要重新渲染才会把
 * `data-open` 写回 DOM，同步读会永远读到 'true'，把能关的抽屉判成关不掉。
 * 用 requestAnimationFrame 而不是 setTimeout：帧对齐才是渲染完成的信号。
 *
 * 点遮罩：抽屉右侧紧挨着的内容区任意位置取一点，从命中元素核对确实是遮罩
 * 本尊（而不是被别的图层压着），再用真实 click 事件触发。
 */
const closeDrawerByScrim = `(async () => {
  const sb = document.querySelector('.sidebar');
  if (!sb || sb.dataset.open !== 'true') return 'skip';
  const scrim = document.querySelector('.sidebar-scrim');
  if (!scrim) return false;
  const r = scrim.getBoundingClientRect();
  const x = Math.min(r.right - 8, innerWidth - 8);
  const y = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(x, y);
  if (!hit || hit !== scrim) return false;
  scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return sb.dataset.open !== 'true';
})()`;

/* 按 Esc：document 级 keydown，抽屉关闭后才能继续用主区域 */
const closeDrawerByEscape = `(async () => {
  const sb = document.querySelector('.sidebar');
  if (!sb || sb.dataset.open !== 'true') return 'skip';
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return sb.dataset.open !== 'true';
})()`;

const results = [];
/** 抽屉关闭路径的行为断言结果 */
const drawerClose = [];

/*
 * 逐宽度、逐分区测量。
 *
 * 任一环节抛错都直接让整轮失败：审计脚本报不出问题，
 * 比报出问题更危险 —— 它会让「没测」看起来像「没问题」。
 */
try {
  for (const width of WIDTHS) {
    const { child, ws, send, sid, evaluate } = await launch(width);
    try {
      await send(
        'Emulation.setDeviceMetricsOverride',
        { width, height: 900, deviceScaleFactor: 1, mobile: width <= 768 },
        sid,
      );
      await new Promise((r) => setTimeout(r, 1800));

      // 页面没渲染出来就直接失败，不许拿空白页当「无溢出」
      const navCount = await evaluate('document.querySelectorAll(".nav-item").length');
      if (!navCount) throw new Error(`${width}px 下导航未渲染，无法审计`);

      /** 量一次并入库。scope 限定测量范围，避免把「被模态盖住的背景」算成缺陷 */
      const measure = async (moduleId, state, scope = null) => {
        const data = await evaluate(MEASURE(TOUCH_BREAKPOINT, MIN_TARGET, scope));
        if (!data) throw new Error(`${width}px / ${moduleId} / ${state} 测量结果为空`);
        results.push({ width, moduleId, state, ...data });
      };

      for (const moduleId of MODULES) {
        const ok = await evaluate(clickModule(moduleId));
        if (!ok) continue;
        // 给渲染与动画留一帧以上时间
        await new Promise((r) => setTimeout(r, 260));
        await measure(moduleId, '折叠');

        // 展开全部卡片再量一遍：表单、确认区、结果区都藏在展开态里
        const expanded = await evaluate(expandAll);
        if (expanded) {
          await new Promise((r) => setTimeout(r, 200));
          await measure(moduleId, '展开');
          await evaluate(expandAll); // 收起，避免影响下一个分区
          await new Promise((r) => setTimeout(r, 120));
        }
      }

      /*
       * 浮层单独量一次，且只量浮层内部（scope = .guide-sheet）。
       *
       * 遮罩天生要盖住背景 —— 把被盖住的按钮算成「点不到」，
       * 等于要求模态框不许挡内容。真正要验的是浮层自己有没有溢出、
       * 内部按钮够不够大、关闭键能不能点到。
       */
      if (await evaluate(openGuide)) {
        await new Promise((r) => setTimeout(r, 320));
        await measure('guide', '弹层', '.guide-sheet');
        await evaluate(closeGuide);
        await new Promise((r) => setTimeout(r, 160));
      }

      /*
       * 偏好设置弹层：与连接步骤同理，只量面板内部。
       * 这是唯一能从顶栏进入的弹层，此前从未被任何脚本测量过。
       */
      if (await evaluate(openSettings)) {
        await new Promise((r) => setTimeout(r, 320));
        await measure('settings', '弹层', '.settings-sheet');
        await evaluate(closeSettings);
        await new Promise((r) => setTimeout(r, 160));
      }

      /*
       * 侧边栏抽屉：只在窄屏存在（>860px 时汉堡按钮被 display:none）。
       * 抽屉是窄屏下唯一的分区入口，它自身的溢出与触控尺寸必须单独量。
       *
       * 只量 `.sidebar` 内部同理：抽屉展开时正是要盖住主区域和汉堡按钮，
       * 拿背景元素判遮挡只会得到「抽屉不该存在」这种无意义结论。
       */
      if (width <= 860 && (await evaluate(toggleSidebar))) {
        await new Promise((r) => setTimeout(r, 320));
        await measure('sidebar', '抽屉', '.sidebar');

        /*
         * 抽屉必须能关掉 —— 这是本轮抓到的真缺陷。
         *
         * 抽屉盖住了汉堡按钮、又没有遮罩和 Esc 键，打开后除了点导航项
         * 跳到别的分区，用户没有任何退出路径；而点导航项只在「想换分区」时成立，
         * 想留在原分区继续看的用户会被永久困住。
         * 所以这里做行为断言：点遮罩要能关、按 Esc 要能关，缺一即为 P0。
         *
         * 两条路径必须各自从「抽屉已打开」起手，所以要按实际状态复位 ——
         * 遮罩那条失败时抽屉仍然开着，这时再点一次汉堡按钮是「关」而不是「开」，
         * 结果 Esc 那条永远拿到 'skip'，等于漏测。
         */
        const isOpen = () => evaluate(`document.querySelector('.sidebar')?.dataset.open === 'true'`);
        const ensureOpen = async () => {
          if (!(await isOpen())) await evaluate(toggleSidebar);
          await new Promise((r) => setTimeout(r, 320));
        };

        const byScrim = await evaluate(closeDrawerByScrim);
        await ensureOpen();
        const byEscape = await evaluate(closeDrawerByEscape);
        drawerClose.push({ width, byScrim, byEscape });

        // 复位：两条路径都失败时抽屉仍开着，收回去，避免污染后续测量
        if (await isOpen()) {
          await evaluate(toggleSidebar);
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    } finally {
      ws.close();
      child.kill();
    }
  }
} catch (error) {
  console.error(`审计中断：${error instanceof Error ? error.message : String(error)}`);
  server.close();
  process.exit(1);
}

server.close();

/* ─────────────── 判定 ─────────────── */

/**
 * P0：内容被挤出视口、被裁掉、被挡住，或抽屉关不掉 —— 用户看不到、点不到、出不去。
 * P1：窄屏可点区域过小，手指点不中。
 */
const isP0 = (r) => r.docOverflow > 1 || r.overflowingCount > 0 || r.clippedCount > 0 || r.coveredCount > 0;
const p0 = results.filter(isP0);
const p1 = results.filter((r) => r.smallTargetCount > 0);
/** 抽屉关不掉的宽度：true/false/'skip'，只有 false 才算缺陷 */
const drawerStuck = drawerClose.filter((d) => d.byScrim === false || d.byEscape === false);

if (JSON_OUT) {
  console.log(
    JSON.stringify({ results, drawerClose, p0: p0.length, p1: p1.length, drawerStuck: drawerStuck.length }, null, 2),
  );
} else {
  console.log('多端适配审计（宽度 × 分区）\n');
  for (const width of WIDTHS) {
    const rows = results.filter((r) => r.width === width);
    const bad = rows.filter(isP0);
    const small = rows.filter((r) => r.smallTargetCount > 0);
    console.log(
      `${width}px —— ${rows.length} 个分区，溢出 ${bad.length}，触控不达标 ${small.length}`,
    );
    for (const r of bad) {
      console.log(
        `  ✗ ${r.moduleId}（${r.state}）：文档横向溢出 ${r.docOverflow}px，越界 ${r.overflowingCount} 个，被裁 ${r.clippedCount} 个`,
      );
      for (const o of r.overflowing.slice(0, 4)) {
        console.log(`      ${o.tag}.${o.cls || '（无类名）'} 右边缘 ${o.right}px，宽 ${o.width}px`);
      }
      for (const o of r.clipped.slice(0, 4)) {
        console.log(
          `      ${o.tag}.${o.cls || '（无类名）'} 被 .${o.by} 裁掉 ${o.hidden}px（右边缘 ${o.right}px）`,
        );
      }
    }
    if (width <= TOUCH_BREAKPOINT) {
      /*
       * 按宽度合并所有分区、所有状态的同类控件。
       * 同一个侧边栏按钮在每个分区里都会出现一次，按分区报只会看到十条一样的结论。
       */
      const merged = new Map();
      for (const r of small) {
        for (const t of r.smallTargets) {
          const key = t.cls + '|' + t.h;
          const hit = merged.get(key);
          if (hit) hit.count += t.count;
          else merged.set(key, { ...t, count: t.count });
        }
      }
      const list = [...merged.values()].sort((a, b) => b.count - a.count);
      if (list.length) {
        const total = list.reduce((s, t) => s + t.count, 0);
        console.log(`  ! 触控目标：${total} 处低于 ${MIN_TARGET}px，涉及 ${list.length} 类控件`);
        for (const t of list) {
          console.log(
            `      ${t.tag}.${t.cls || '（无类名）'} 高 ${t.h}px × ${t.count}  「${t.sample}」`,
          );
        }
      }
    }
  }
  /*
   * 抽屉关闭路径单独汇总。
   *
   * 单独报而不是并进 P0 计数，是因为它的症状和「溢出」完全不同：
   * 溢出是「看不到」，抽屉关不掉是「出不去」，定位时要看的地方也不一样。
   */
  if (drawerClose.length) {
    console.log('\n抽屉关闭路径：');
    for (const d of drawerClose) {
      const scrim = d.byScrim === 'skip' ? '未打开' : d.byScrim ? '可关' : '关不掉';
      const esc = d.byEscape === 'skip' ? '未打开' : d.byEscape ? '可关' : '关不掉';
      const mark = d.byScrim === false || d.byEscape === false ? '✗' : '✓';
      console.log(`  ${mark} ${d.width}px —— 点遮罩：${scrim}，按 Esc：${esc}`);
    }
  }

  console.log(
    `\nP0（溢出/裁剪/遮挡）${p0.length} 项，P1（触控目标）${p1.length} 项，P0（抽屉关不掉）${drawerStuck.length} 项`,
  );
}

process.exit(p0.length === 0 && drawerStuck.length === 0 ? 0 : 1);

/**
 * PWA 离线能力校验。
 *
 * 校验的是 README 4.7 那句「断网后重新打开页面仍能完整渲染」——
 * 一句话要么能被机器验，要么就不该写进文档。
 *
 * ## 为什么必须「关浏览器 + 关服务器 + 重启浏览器」
 *
 * 这条路上有四个假通过陷阱，每一个都会让结果看起来是绿的：
 *
 * 1. **CDP 的 `Network.emulateNetworkConditions` 不覆盖 Service Worker**。
 *    SW 自己的 fetch 走的是浏览器网络的另一条路径，页面被标记为离线时
 *    它照样能连上服务器。用它测离线，等于在测「页面自己不发请求」。
 * 2. **`Page.reload({ignoreCache:true})` 会绕过 Service Worker**。
 *    硬刷新本就不用缓存，用它测离线必然白屏，但白屏并不代表离线能力坏了。
 * 3. **HTTP 内存缓存会兜住首屏**。同一进程内刷新时，JS 可能直接来自
 *    浏览器的 HTTP 缓存而非 SW —— 换台设备、隔天再开就没有了。
 * 4. **SW 的注册与 Cache Storage 需要落盘**。`SIGTERM` 杀掉进程时可能来不及，
 *    必须用 CDP `Browser.close` 优雅退出，否则「重开」读到的是空缓存。
 *
 * 所以这里的做法就是用户真实路径：访问一次 → 优雅关浏览器 →
 * 关服务器 → 重启浏览器打开同一地址。
 *
 * ## 两段断言
 *
 * A. 离线重开后界面能渲染（导航项数量与在线一致、`#app` 有内容）
 * B. 离线时按需分包能加载（模拟点「连接设备」）
 *
 * 用法：node scripts/verify-offline.mjs [--json]
 * 前置：先 npm run build（读 dist/），并需要可用的 Chrome
 * 退出码：0 全过；1 有缺陷
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const JSON_OUT = process.argv.includes('--json');

/** 固定端口：离线重启后必须访问同一个 origin，否则 Cache Storage 是另一个域 */
const PORT = 41783;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

/* ─────────────── 前置检查 ─────────────── */

if (!existsSync(DIST)) {
  console.error('找不到 dist/。本脚本校验的是构建产物，请先执行 npm run build。');
  process.exit(1);
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!CHROME) {
  // 不允许静默跳过：「没测到」被当成「没问题」是审计脚本最坏的结果
  console.error(
    '找不到 Chrome。本脚本需要无头 Chrome 真实验证离线渲染，请安装 Chrome，' +
      '或用 CHROME_PATH=/path/to/chrome 指定路径。',
  );
  process.exit(1);
}

/* ─────────────── 本地静态服务器 ─────────────── */

let server = createServer(async (req, res) => {
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
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const ORIGIN = `http://127.0.0.1:${PORT}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─────────────── Chrome 会话 ─────────────── */

/** 整个校验共用同一个 user-data-dir，这样 SW 注册与缓存在两次启动间延续 */
const PROFILE = `/tmp/webroit-offline-${process.pid}`;

/**
 * 起一个 Chrome 并连上 CDP。
 *
 * 返回的 close() 走 `Browser.close` 而非 kill：SW 的注册信息与
 * Cache Storage 需要刷盘，硬杀进程会让「重开」读到空缓存，
 * 把修好的离线能力误判成坏的。
 */
async function boot(url) {
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--remote-debugging-port=0',
      '--window-size=1024,900',
      '--disable-application-cache=false',
      `--user-data-dir=${PROFILE}`,
      url,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('等待 Chrome 调试端口超时')), 25000);
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

  /** 取表达式结果。异常必须抛出 —— 静默返回 undefined 会让「量不到」看起来像通过 */
  const evaluate = async (expression) => {
    const response = await send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sid,
    );
    if (response.error) throw new Error(`CDP 错误：${response.error.message}`);
    if (response.result?.exceptionDetails) {
      const d = response.result.exceptionDetails;
      throw new Error(`页面表达式抛错：${d.exception?.description ?? d.text}`);
    }
    return response.result?.result?.value;
  };

  await send('Runtime.enable', {}, sid);

  /*
   * 等页面真正导航到目标地址再开始测量。
   *
   * 刚 attach 时执行上下文可能还停在初始的 about:blank，
   * 那时 `navigator.serviceWorker` 是 undefined —— 直接取会抛
   * 「Cannot read properties of undefined」，看起来像应用坏了，
   * 其实只是问早了一步。
   */
  for (let i = 0; i < 60; i++) {
    try {
      const ready = await evaluate(
        `location.href.startsWith(${JSON.stringify(url.replace(/index\.html$/, ''))}) &&
         document.readyState !== 'loading' &&
         typeof navigator.serviceWorker === 'object'`,
      );
      if (ready) break;
    } catch {
      // 上下文尚未就绪，下一轮再试
    }
    await sleep(200);
  }

  const close = async () => {
    try {
      await send('Browser.close');
    } catch {
      // 关闭阶段出错不值得让校验失败
    }
    await sleep(1200);
    try {
      ws.close();
      child.kill();
    } catch {
      // 同上
    }
  };

  return { send, evaluate, close };
}

/** 等 Service Worker 接管当前页面 */
const WAIT_CONTROLLED = `(async () => {
  if (!('serviceWorker' in navigator)) return false;
  for (let i = 0; i < 100; i++) {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg && reg.active && navigator.serviceWorker.controller) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
})()`;

/** 一次完整的状态快照：SW 状态 + 两个缓存桶的内容 + 渲染结果 */
const SNAPSHOT = `(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const cachesContent = {};
  for (const name of await caches.keys()) {
    const c = await caches.open(name);
    cachesContent[name] = (await c.keys()).map(r => new URL(r.url).pathname).sort();
  }
  return {
    controller: !!navigator.serviceWorker.controller,
    active: reg ? reg.active?.state ?? null : null,
    caches: cachesContent,
    navItems: document.querySelectorAll('.nav-item').length,
    appBytes: (document.getElementById('app')?.innerHTML || '').length,
    text: (document.body.innerText || '').replace(/\\s+/g, ' ').trim(),
  };
})()`;

/* ─────────────── 校验主体 ─────────────── */

const checks = [];
const pass = (name, value) => checks.push({ ok: true, name, value });
const fail = (name, real, doc, note) =>
  checks.push({ ok: false, name, real, doc, note });

const cleanup = async () => {
  await new Promise((r) => server.close(r));
  server = null;
};

let online = null;
let offline = null;
let adbOffline = null;
let adbName = null;
let threw = null;

try {
  /* ── 阶段 1：在线访问一次，让 SW 安装并预缓存 ── */
  const first = await boot(ORIGIN + 'index.html');
  const controlled = await first.evaluate(WAIT_CONTROLLED);

  if (!controlled) {
    fail('Service Worker 接管', '已接管', '未接管', '注册失败则离线能力无从谈起');
  } else {
    // 预缓存是异步的，等它把清单写完（install 事件结束）再取快照
    const before = await first.evaluate(SNAPSHOT);
    let snapshot = before;
    for (let i = 0; i < 40; i++) {
      const total = Object.values(snapshot.caches).reduce((s, l) => s + l.length, 0);
      if (total > 0) break;
      await sleep(250);
      snapshot = await first.evaluate(SNAPSHOT);
    }
    online = snapshot;

    // 预缓存条数必须等于 dist 里除 sw.js 之外的文件数
    const distFiles = (await readdir(DIST, { recursive: true }))
      .map((f) => String(f).split('\\').join('/'))
      .filter((f) => !f.startsWith('.'));

    const precached = new Set(Object.values(online.caches).flat().map((p) => p.replace(/^\//, '')));
    // 目录条目在 readdir recursive 下也会出现，靠扩展名过滤掉
    const expected = distFiles.filter((f) => extname(f) && f !== 'sw.js');

    const missing = expected.filter((f) => !precached.has(f));
    if (missing.length === 0) {
      pass('预缓存覆盖全部产物', `${precached.size} 个文件`);
    } else {
      fail('预缓存覆盖全部产物', `缺 ${missing.length} 个`, '全覆盖', missing.join('、'));
    }

    // 分桶正确性：assets/ 下的文件必须落在 webroit-assets-* 桶
    const assetBucket = Object.entries(online.caches).find(([n]) => n.startsWith('webroit-assets-'));
    const shellBucket = Object.entries(online.caches).find(([n]) => n.startsWith('webroit-shell-'));
    const assetPaths = assetBucket ? assetBucket[1] : [];
    const shellPaths = shellBucket ? shellBucket[1] : [];
    const misplacedShell = shellPaths.filter((p) => p.includes('/assets/'));
    const misplacedAsset = assetPaths.filter((p) => !p.includes('/assets/'));

    if (!assetBucket || !shellBucket) {
      fail('双缓存桶存在', `assets=${!!assetBucket} shell=${!!shellBucket}`, '两个都在');
    } else if (misplacedShell.length || misplacedAsset.length) {
      fail(
        '预缓存分桶正确',
        '分错 ' + (misplacedShell.length + misplacedAsset.length) + ' 个',
        '按 assets/ 前缀分流',
        [...misplacedShell, ...misplacedAsset].join('、'),
      );
    } else {
      pass('预缓存分桶正确', `assets ${assetPaths.length} + shell ${shellPaths.length}`);
    }
  }

  await first.close();
  await cleanup();
  // 服务器关了 = 彻底断网。这比任何 CDP 网络模拟都真实。

  /* ── 阶段 2：断网重开 ── */
  const second = await boot(ORIGIN + 'index.html');
  await sleep(3500);

  offline = await second.evaluate(SNAPSHOT);

  if (!online) {
    fail('离线渲染', '无从比对', '在线基线缺失');
  } else {
    if (offline.navItems === online.navItems && offline.navItems > 0) {
      pass('离线重开渲染完整', `${offline.navItems} 个导航项，与在线一致`);
    } else {
      fail('离线重开渲染完整', `${offline.navItems} 个导航项`, `${online.navItems} 个`, '断网后白屏即此项失败');
    }

    if (offline.appBytes > 0) {
      pass('离线重开有内容', `#app ${offline.appBytes} 字节`);
    } else {
      fail('离线重开有内容', '0 字节', '>0', '入口脚本未执行');
    }
  }

  /* ── 阶段 3：断网下按需分包可用（模拟点「连接设备」）── */
  const distAssets = await readdir(join(DIST, 'assets'));
  adbName = distAssets.find((f) => /^adb-.*\.js$/.test(f));

  if (!adbName) {
    fail('ADB 分包存在', '找不到 assets/adb-*.js', '存在', '构建配置可能变了');
  } else {
    adbOffline = await second.evaluate(`(async () => {
      try {
        await import('./assets/${adbName}');
        return 'ok';
      } catch (e) {
        return 'ERR ' + String(e && e.message || e).slice(0, 80);
      }
    })()`);

    if (adbOffline === 'ok') {
      pass('离线加载 ADB 分包', '动态 import 成功');
    } else {
      fail('离线加载 ADB 分包', adbOffline, 'ok', '离线点「连接设备」会失败');
    }
  }

  await second.close();
} catch (error) {
  threw = error instanceof Error ? error.message : String(error);
} finally {
  if (server) await cleanup();
}

if (threw) {
  fail('校验执行', threw, '无异常');
}

/* ─────────────── 输出 ─────────────── */

const failed = checks.filter((c) => !c.ok);

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
} else {
  console.log('PWA 离线能力校验\n');
  for (const c of checks) {
    console.log(
      c.ok
        ? `  ✓ ${c.name}：${c.value}`
        : `  ✗ ${c.name}：实际 ${c.real}，期望 ${c.doc}${c.note ? `（${c.note}）` : ''}`,
    );
  }
  if (offline?.text) {
    const preview = offline.text.slice(0, 60);
    console.log(`\n  离线页面首段：${preview}${offline.text.length > 60 ? '…' : ''}`);
  }
  console.log(
    `\n${checks.length} 项，通过 ${checks.length - failed.length}，失败 ${failed.length}`,
  );
}

process.exit(failed.length === 0 ? 0 : 1);

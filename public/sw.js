/**
 * Webroit Service Worker
 *
 * 离线策略分三类，区别对待：
 *
 * 1. 导航请求（打开页面）—— 网络优先。用户想要的是最新版本，
 *    只有断网时才回落到缓存里的 index.html。
 * 2. 带内容哈希的构建产物（/assets/xxx-<hash>.js）—— 缓存优先。
 *    内容变了文件名就变了，不存在「拿到旧版本」的风险。
 * 3. 其余同源静态资源（图标、清单）—— 先给缓存再后台更新。
 *
 * 有意不缓存的东西：
 * - 跨域请求。本应用不依赖任何第三方接口，出现跨域请求说明是用户
 *   自己装的扩展或书签脚本发出的，不该由本 Service Worker 接管。
 * - 非 GET 请求。本应用不发起任何非 GET 请求。
 * - chrome-extension:// 等非 http(s) 协议。
 *
 * WebUSB 的设备通信不经过 fetch，因此不受本文件影响 ——
 * 这一点很关键：离线缓存不会把设备通道也一起缓存住。
 */

/** 缓存名带版本号，升级时旧缓存整体丢弃，避免残留过期资源 */
const VERSION = '__SW_VERSION__';

const CACHE_SHELL = `webroit-shell-${VERSION}`;
const CACHE_ASSETS = `webroit-assets-${VERSION}`;

/**
 * 构建期预缓存清单。
 *
 * 由 scripts/build-sw.mjs 在打包后写入具体文件列表；
 * 开发环境下保持为空数组，此时退化为纯运行时缓存。
 */
const PRECACHE = [/* __PRECACHE__ */];

/** Service Worker 自身的路径，用于拼出部署根路径 */
const SCOPE = new URL('./', self.location.href).href;

/** 把可能相对的路径解析成绝对地址 */
function resolve(path) {
  return new URL(path, SCOPE).href;
}

/** 判断是否值得缓存：只处理同源的 http(s) GET */
function isCacheable(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return url.origin === self.location.origin;
}

/** 安装：预缓存核心文件，逐个下载以免单个失败拖垮整体 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_SHELL);
      await Promise.all(
        PRECACHE.map(async (path) => {
          try {
            // 用 reload 绕过浏览器 HTTP 缓存，确保拿到的是本次构建的产物
            await cache.add(new Request(resolve(path), { cache: 'reload' }));
          } catch (error) {
            // 单个文件缺失不应导致整个 Service Worker 安装失败，
            // 否则用户会一直停留在旧版本上
            console.warn('[sw] 预缓存失败', path, error);
          }
        }),
      );
      // 不在此处 skipWaiting：用户可能正在执行设备操作，
      // 资源被中途换掉会导致界面与状态不一致。改由页面提示用户手动刷新。
    })(),
  );
});

/** 激活：清掉旧版本缓存，并立即接管已打开的页面 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('webroit-') && !key.endsWith(VERSION))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/** 导航请求：网络优先，断网时回落缓存 */
async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_SHELL);
      cache.put(resolve('./index.html'), response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(CACHE_SHELL);
    const cached =
      (await cache.match(resolve('./index.html'))) ??
      (await cache.match(resolve('./')));
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>离线</title>' +
        '<body style="font:15px/1.7 system-ui;padding:48px;color:#b3b3b3;background:#141414">' +
        '<h1 style="font-size:17px;color:#ececec;font-weight:600">当前处于离线状态</h1>' +
        '<p>Webroit 的界面文件尚未缓存到本机。请连接网络后重新打开一次。</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

/** 构建产物：缓存优先，命中即返回 */
async function handleAsset(request) {
  const cache = await caches.open(CACHE_ASSETS);
  const cached = await cache.match(request);
  if (cached) {
    // 后台静默更新，下次打开用新的
    fetch(request)
      .then((response) => {
        if (response.ok) cache.put(request, response);
      })
      .catch(() => {});
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

/** 其他静态资源：先给缓存，同时后台更新 */
async function handleStaleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_SHELL);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    // 不等待网络结果，直接返回缓存
    void network;
    return cached;
  }
  const response = await network;
  if (response) return response;
  return new Response('', { status: 504, statusText: '离线且无缓存' });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!isCacheable(request)) return;

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  // 带哈希的构建产物路径固定为 assets/，可以放心长期缓存
  if (url.pathname.includes('/assets/')) {
    event.respondWith(handleAsset(request));
    return;
  }

  event.respondWith(handleStaleWhileRevalidate(request));
});

/** 页面主动要求跳过等待时立即生效 —— 用户点了「刷新」才走这条路径 */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});

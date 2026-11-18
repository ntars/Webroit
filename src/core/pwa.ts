/**
 * PWA 注册与更新提示。
 *
 * 三个约束决定了这里的写法：
 *
 * 1. 只在生产构建注册。开发时 Service Worker 会把 Vite 的模块请求
 *    也一起缓存，改代码不生效，排查起来极其费时。
 * 2. 不用 skipWaiting 自动接管。用户可能正在执行设备操作，
 *    中途换掉资源会造成界面与设备状态不一致。改为提示用户手动刷新。
 * 3. 注册失败必须静默。Service Worker 注册失败（无痕模式、
 *    旧版浏览器、HTTP 环境）不应影响主功能，连接设备与它无关。
 */

/** 是否处于可注册环境 */
function canRegister(): boolean {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  // 非安全上下文下 register 会直接抛错，提前判断省一次异常
  if (!window.isSecureContext) return false;
  return import.meta.env.PROD;
}

/** 把等待中的新版本激活，随后刷新页面 */
function activateWaiting(worker: ServiceWorker): void {
  worker.postMessage('skip-waiting');
  // 等 controllerchange 再刷新，避免刷新后仍是旧版本
  navigator.serviceWorker.addEventListener(
    'controllerchange',
    () => location.reload(),
    { once: true },
  );
}

/**
 * 注册 Service Worker。
 *
 * @param onUpdate 发现新版本时调用，由界面决定如何提示用户
 */
export function registerServiceWorker(onUpdate: (apply: () => void) => void): void {
  if (!canRegister()) return;

  window.addEventListener('load', () => {
    // 相对路径注册，使子目录部署（GitHub Pages 的 /Webroit/）也能正确划定作用域
    navigator.serviceWorker
      .register(new URL('sw.js', document.baseURI).href, {
        scope: new URL('./', document.baseURI).pathname,
      })
      .then((registration) => {
        const notify = (worker: ServiceWorker | null) => {
          if (!worker) return;
          onUpdate(() => activateWaiting(worker));
        };

        // 页面加载时就已经有一个等待中的新版本
        notify(registration.waiting);

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // 有 controller 说明不是首次安装，而是版本更新
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              notify(installing);
            }
          });
        });
      })
      .catch((error) => {
        console.warn('[pwa] Service Worker 注册失败，离线能力不可用', error);
      });
  });
}

/** 当前是否以独立窗口运行（已安装为应用） */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari 的私有属性，标准里没有，只能这样判断
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** 安装提示事件，Chrome 系专有 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installPrompt: InstallPromptEvent | null = null;

/** 可安装状态变化的订阅者 */
const installListeners = new Set<(available: boolean) => void>();

/** 提前捕获安装事件，供界面按需触发 */
export function watchInstallPrompt(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (event) => {
    // 默认的迷你信息条会盖住终端输出，改为自己控制时机
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    // 事件只会触发一次，这里主动通知订阅者，界面无需轮询
    for (const listener of installListeners) listener(true);
  });

  // 用户从浏览器菜单直接安装时，按钮也要及时消失
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    for (const listener of installListeners) listener(false);
  });
}

/**
 * 订阅可安装状态。
 *
 * 用订阅而非轮询：beforeinstallprompt 的触发时机不确定，
 * 但每秒查一次状态会让整个顶栏每秒重渲染一次，没有必要。
 *
 * @returns 取消订阅的函数
 */
export function onInstallAvailable(listener: (available: boolean) => void): () => void {
  installListeners.add(listener);
  // 立即回报当前状态，避免订阅晚于事件触发时漏掉
  if (installPrompt) listener(true);
  return () => installListeners.delete(listener);
}

/** 是否可主动唤起安装 */
export function canInstall(): boolean {
  return installPrompt !== null;
}

/**
 * 唤起安装流程。
 *
 * @returns 用户是否接受安装。不可安装时返回 false。
 */
export async function promptInstall(): Promise<boolean> {
  if (!installPrompt) return false;
  const event = installPrompt;
  // 事件只能用一次，无论用户选什么都作废
  installPrompt = null;
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome === 'accepted';
}

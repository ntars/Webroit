/**
 * 页面路由：正常界面 ⇄ 应急重置页。
 *
 * 为什么单独抽一层：
 * 应急页的唯一职责是「改坏了 DPI 之后还能点到一个还原按钮」。
 * 它有两种入口 —— hash `#/reset-display` 与查询串 `?reset-display`，
 * 而退出时**两处标记都要清掉**。
 *
 * 上一版只清了 hash：从 `?reset-display` 进来的人点「返回主界面」，
 * 地址变成 `/?reset-display#/`，判定条件里的查询串那一支依然成立，
 * 于是页面纹丝不动 —— 进得去、出不来，逃生通道自己锁死。
 *
 * 所以判定与退出都收敛到这里，两个纯函数负责算、`leaveEmergency` 负责写，
 * App 只读 `route` 信号。URL 的语义只有这一份真源。
 */

import { signal } from '@/ui/state/signal';

/** 页面归属 */
export type Route = 'app' | 'emergency';

/** 查询串里表示「进入应急页」的标记 */
export const EMERGENCY_FLAG = 'reset-display';

/** hash 路由形态。`#/reset-display` 与 `?reset-display` 是同一件事的两种写法 */
export const EMERGENCY_HASH = '#/reset-display';

/**
 * 判定当前地址属于哪个页面。
 *
 * 两种入口都认：有些用户改 hash，有些用户改查询串，还有人从别人给的链接进来。
 * 放行成本极低，拒绝的成本是「逃生页打不开」。
 */
export function routeOf(hash: string, search: string): Route {
  if (hash === EMERGENCY_HASH) return 'emergency';
  return new URLSearchParams(search).has(EMERGENCY_FLAG) ? 'emergency' : 'app';
}

/**
 * 去掉查询串里的应急标记，其余参数原样保留。
 *
 * 保留其余参数是有意的：`?module=files&reset-display` 这种地址退出后
 * 仍应回到「文件」分区，而不是被一脚踹回默认页。
 */
export function withoutEmergencyFlag(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(EMERGENCY_FLAG);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/**
 * 退出应急页后的目标地址。
 *
 * 两处标记必须同时清：只清一处就是本轮修的那个缺陷 ——
 * 地址看起来变了，判定条件却仍然成立。
 */
export function appUrl(pathname: string, search: string, hash: string): string {
  const nextSearch = withoutEmergencyFlag(search);
  const nextHash = hash === EMERGENCY_HASH ? '' : hash;
  return `${pathname}${nextSearch}${nextHash}`;
}

/** 读一次当前地址的归属，供模块初始化与事件回调共用 */
function currentRoute(): Route {
  if (typeof location === 'undefined') return 'app';
  return routeOf(location.hash, location.search);
}

/** 当前页面。App 订阅它，地址一变就重渲染 */
export const route = signal<Route>(currentRoute());

/** 重新读地址并广播。hashchange / popstate 都走这里 */
export function syncRoute(): void {
  route.set(currentRoute());
}

/**
 * 离开应急页。
 *
 * 用 replaceState 而不是 pushState：退出应急页是「撤回一个临时视图」，
 * 不该在历史里留一条记录 —— 否则用户按浏览器返回键会被送回逃生页。
 */
export function leaveEmergency(): void {
  if (typeof location === 'undefined') return;
  history.replaceState(null, '', appUrl(location.pathname, location.search, location.hash));
  syncRoute();
}

/**
 * 确认请求：界面上「先问一句再动手」的唯一入口。
 *
 * 为什么要有这一层而不是各视图自己 setState 弹框：
 * 变更类操作散在工具卡片、应用列表、品牌清单、应急页四处。每处自己实现一遍
 * 确认，结果必然是门槛不一致 —— 实测就是这样：同一件事（卸载应用）在工具卡片里
 * 要求手打「确认」，在应用列表的「批量卸载」里点一下就执行了。
 *
 * 所以确认被做成一个「请求 -> 等待 -> 结算」的异步原语：
 * 调用方 `await askConfirm(...)` 拿到布尔值，弹层由外壳统一渲染一份。
 *
 * 串行化：已有请求在等时，新请求直接返回 false（视为取消），不叠第二层弹层。
 * 叠层会让「我到底在确认哪一件事」变得无法判断，而这一层的全部意义就是让人看清。
 */

import { signal } from '@/ui/state/signal';

/** 一次确认请求 */
export interface ConfirmRequest {
  /** 弹层标题，写清要做什么 */
  title: string;
  /** 为什么问：这一步会带来什么后果 */
  reason: string;
  /** 目标清单之类的补充信息（可为空） */
  detail?: string;
  /** 确认按钮文案 */
  confirmLabel: string;
  /**
   * 要求手打确认词才放行。
   *
   * 只在不可逆操作上给：让用户复制粘贴做不到，必须真的读出这两个字。
   */
  word?: string;
}

/** 当前等待结算的请求，弹层据此渲染 */
export const confirmRequest = signal<ConfirmRequest | null>(null);

/** 确认门槛的判定结果 */
export interface ConfirmGate {
  /** 是否要弹确认 */
  needsConfirm: boolean;
  /** 是否要手打确认词 */
  needsWord: boolean;
}

/** 高危操作要求手打的确认词 */
export const CONFIRM_WORD = '确认';

/**
 * 风险等级 -> 门槛。工具卡片与应用列表共用这一份判定。
 *
 * `confirmDangerous` 只影响风险 2 级：用户明说「我知道自己在做什么」时，
 * 冻结 / 停用这类可逆操作不再每次问。风险 3 级（卸载、清数据）
 * 没有撤销路径，一次误点就要重来，这个门槛不能由偏好开关决定。
 */
export function gateFor(risk: number, confirmDangerous: boolean): ConfirmGate {
  return {
    needsConfirm: risk >= 2 && (confirmDangerous || risk >= 3),
    needsWord: risk >= 3,
  };
}

/** 等待中的结算函数。同一时刻最多一个 */
let resolver: ((ok: boolean) => void) | null = null;

/**
 * 问一句，等回答。
 *
 * @returns 用户点了确认返回 true；取消、按 Esc、点遮罩、或被新请求挤掉都返回 false
 */
export function askConfirm(request: ConfirmRequest): Promise<boolean> {
  if (resolver) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    resolver = resolve;
    confirmRequest.set(request);
  });
}

/** 结算当前请求：只有弹层该调它 */
export function settleConfirm(ok: boolean): void {
  const resolve = resolver;
  resolver = null;
  // 先清信号再兑现：兑现后调用方可能立刻弹下一条，顺序反了会看到旧弹层闪一下
  confirmRequest.set(null);
  resolve?.(ok);
}

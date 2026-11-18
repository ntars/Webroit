/**
 * 未连接时的预览画像。
 *
 * 目的：让用户在不插线的情况下也能看清「这个工具能做什么、要填什么、风险几级」。
 *
 * 取值策略是**乐观**的 —— 所有能力位都置为 true。
 * 这不是在假装设备支持，而是把「能力判定」和「是否连接」这两件事分开：
 * - 能力判定回答「这台设备支不支持这个命令」，需要真机才能回答
 * - 是否连接回答「现在能不能执行」，未连接时一律不能
 *
 * 若预览时也按 false 处理，所有工具都会显示成「当前系统不支持」，
 * 用户会误以为自己的手机不兼容 —— 那是最糟的误导。
 * 所以预览期一律按可用渲染，真正的不可用原因等连上后由真实探测覆盖。
 */

import type { DeviceCapabilities } from '@/core/session/device-session';

/** 预览画像：能力位全开，品牌留空 */
export const PREVIEW_CAPABILITIES: DeviceCapabilities = {
  sdk: 0,
  release: '',
  brand: '',
  model: '',
  props: {},

  canWriteSecureSettings: true,
  canUseDumpsys: true,
  canUseWmSize: true,
  canUseWmDensity: true,
  canUseSettings: true,
  canUsePm: true,
  canUseCmdPackage: true,
  canUseScreenshot: true,
  canUseInput: true,
  canUseMonkey: true,
  canUseSync: true,

  vendorNote: null,
};

/**
 * 取渲染与可用性判断要用的能力画像。
 *
 * 已连接用真实探测结果，未连接用预览画像 —— 调用点只关心「该拿哪份」，
 * 不需要各自写一遍三元表达式。
 */
export function capabilitiesFor(current: DeviceCapabilities | null): DeviceCapabilities {
  return current ?? PREVIEW_CAPABILITIES;
}

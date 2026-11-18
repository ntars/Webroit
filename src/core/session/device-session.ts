/**
 * 会话层：设备能力的探测与缓存。
 *
 * 为什么要单独一层（ADR-002）：
 * 大量 ADB 命令是否可用，取决于 Android 版本、厂商 ROM、SELinux 策略。
 * 如果每个工具自己在运行时才发现「这条命令不支持」，用户看到的就是一堆红色报错。
 * 所以在连接建立后一次性探测，把结果存成 DeviceCapabilities，
 * 工具在渲染阶段就能通过 available() 决定自己是否出现/是否置灰。
 */

import type { DeviceDriver } from '@/core/transport/types';
import { parseProps } from '@/core/utils';

/** 设备能力快照 */
export interface DeviceCapabilities {
  /** Android API 等级，如 34 */
  sdk: number;
  /** Android 版本字符串，如 14 */
  release: string;
  /** 厂商，小写 */
  brand: string;
  /** 机型展示名 */
  model: string;
  /** 完整 getprop */
  props: Record<string, string>;

  /** 关键能力的布尔判定，工具用这些字段决定是否可用 */
  canWriteSecureSettings: boolean;
  canUseDumpsys: boolean;
  canUseWmSize: boolean;
  canUseWmDensity: boolean;
  canUseSettings: boolean;
  canUsePm: boolean;
  canUseCmdPackage: boolean;
  canUseScreenshot: boolean;
  canUseInput: boolean;
  canUseMonkey: boolean;
  canUseSync: boolean;

  /** 厂商是否为已知的特殊 ROM（用于 UI 提示额外开关要求） */
  vendorNote: string | null;
}

/** 探测过程中的单条检查 */
interface Probe {
  key: keyof DeviceCapabilities;
  command: string;
}

/**
 * 探针清单。
 *
 * 全部用只读命令，不改动设备状态：
 * - `wm size`        读分辨率，顺带验证 wm 可用
 * - `settings get`   读安全设置，验证 settings 可读（可读不代表可写，写权限另判）
 * - `pm list packages -s`  列系统包，验证 pm 可用
 * - `cmd package --help`   验证 cmd package 子命令存在（Android 7+）
 * - `dumpsys battery`      验证 dumpsys 可用
 * - `which screencap`      验证截图命令存在
 * - `input --help`         验证 input 可用
 * 写权限（WRITE_SECURE_SETTINGS）没法用只读命令探测，
 * 只能按 Android 版本 + 已知厂商策略推断，实际失败时由工具层兜底提示。
 */
const PROBES: Probe[] = [
  { key: 'canUseWmSize', command: 'wm size' },
  { key: 'canUseWmDensity', command: 'wm density' },
  { key: 'canUseSettings', command: 'settings get secure android_id' },
  { key: 'canUsePm', command: 'pm list packages -s' },
  { key: 'canUseCmdPackage', command: 'cmd package help' },
  { key: 'canUseDumpsys', command: 'dumpsys battery' },
  { key: 'canUseScreenshot', command: 'which screencap' },
  { key: 'canUseInput', command: 'input --help' },
  { key: 'canUseMonkey', command: 'which monkey' },
];

/**
 * 厂商补充说明：这些 ROM 有额外开关，不开则部分命令报权限不足。
 */
function vendorHint(brand: string, sdk: number): string | null {
  const normalized = brand.toLowerCase();
  if (/xiaomi|redmi|poco/.test(normalized)) {
    return '小米 / 红米设备需在开发者选项里额外开启「USB 调试（安全设置）」，否则无法修改分辨率、冻结应用';
  }
  if (/oppo|oneplus|realme/.test(normalized)) {
    return 'OPPO / 一加 / 真我设备需在开发者选项里额外开启「禁止权限监控」与「USB 调试（安全设置）」';
  }
  if (/vivo|iqoo/.test(normalized)) {
    return 'vivo / iQOO 设备需在开发者选项里开启「USB 调试（安全设置）」';
  }
  if (/huawei|honor/.test(normalized)) {
    return '华为 / 荣耀设备部分命令受 SELinux 限制，属于系统策略，非工具问题';
  }
  if (sdk < 30) {
    return `当前 Android API ${sdk}，部分功能（如 cmd package install-existing）需要 API 30 及以上`;
  }
  return null;
}

/**
 * 探测设备能力。
 * 所有探针并行跑，单条失败不影响其他条。
 */
export async function probeCapabilities(driver: DeviceDriver): Promise<DeviceCapabilities> {
  const propsText = await driver.exec('getprop').then((r) => r.stdout);
  const props = parseProps(propsText);
  const sdk = Number(props['ro.build.version.sdk']) || 0;

  const results = await Promise.all(
    PROBES.map(async (probe) => {
      try {
        const result = await driver.exec(probe.command);
        return { key: probe.key, ok: result.exitCode === 0 || result.exitCode === undefined };
      } catch {
        return { key: probe.key, ok: false };
      }
    }),
  );

  const caps: DeviceCapabilities = {
    sdk,
    release: props['ro.build.version.release'] || '?',
    brand: props['ro.product.brand'] || 'unknown',
    model: props['ro.product.model'] || '未知机型',
    props,
    canWriteSecureSettings: false,
    canUseDumpsys: false,
    canUseWmSize: false,
    canUseWmDensity: false,
    canUseSettings: false,
    canUsePm: false,
    canUseCmdPackage: false,
    canUseScreenshot: false,
    canUseInput: false,
    canUseMonkey: false,
    // sync 通道在连接时就已建立，恒为 true
    canUseSync: true,
    vendorNote: vendorHint(props['ro.product.brand'] || '', sdk),
  };

  for (const { key, ok } of results) {
    (caps as unknown as Record<string, boolean>)[key] = ok;
  }

  // 能读到 secure 设置且 API >= 23，通常就能申请 WRITE_SECURE_SETTINGS
  // 真正的写权限要靠 adb grant，这里只做「理论上可写」的前置判断
  caps.canWriteSecureSettings = caps.canUseSettings && sdk >= 23;

  return caps;
}

/** 会话状态 */
export type SessionStatus = 'idle' | 'connecting' | 'ready' | 'error' | 'closed';

/**
 * DeviceSession —— 一条设备连接的完整生命周期。
 *
 * 由 session 层持有 Driver 与 Capabilities，
 * services 层通过它拿到 driver 和 caps，不直接碰传输层。
 */
export class DeviceSession {
  readonly driver: DeviceDriver;
  readonly capabilities: DeviceCapabilities;
  readonly connectedAt: Date;

  constructor(driver: DeviceDriver, capabilities: DeviceCapabilities) {
    this.driver = driver;
    this.capabilities = capabilities;
    this.connectedAt = new Date();
  }

  get serial(): string {
    return this.driver.serial;
  }

  get label(): string {
    return this.driver.label;
  }

  get connected(): boolean {
    return this.driver.connected;
  }

  /** 「Android 14 (API 34)」这类展示串 */
  get androidLabel(): string {
    return `Android ${this.capabilities.release} (API ${this.capabilities.sdk})`;
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}

/**
 * 建立会话：连接 → 探测能力 → 返回可用的 DeviceSession。
 */
export async function createSession(
  connect: () => Promise<DeviceDriver>,
): Promise<DeviceSession> {
  const driver = await connect();
  try {
    const capabilities = await probeCapabilities(driver);
    return new DeviceSession(driver, capabilities);
  } catch (error) {
    // 探测失败说明设备状态异常，不能留下半开的连接
    await driver.close().catch(() => {});
    throw error;
  }
}

/**
 * 服务聚合：把散装的服务组成一个对象，挂到会话上。
 *
 * 为什么要有这一层：
 * 每个服务都需要 ShellContext（有的还要 sdk / capabilities），
 * 如果让 UI 自己去 new，一旦构造顺序或依赖变了，要改十几个地方。
 * 这里统一由 createServices(session) 一次建好，UI 只认 `Services` 这一个类型。
 *
 * 同时这里也是分层边界的落点：
 * UI 只能 import 本文件与服务类，永远不 import transport / driver。
 */

import type { DeviceCapabilities } from '@/core/session/device-session';
import type { DeviceSession } from '@/core/session/device-session';
import { ShellContext, type OutputSink, type ProgressSink } from '@/core/shell';
import { detectVendor, type VendorId } from '@/tools/registry';

import { AppService } from '@/services/app.service';
import { BatteryService } from '@/services/battery.service';
import { DeviceService } from '@/services/device.service';
import { DisplayService } from '@/services/display.service';
import { FileService } from '@/services/file.service';
import { RollbackService } from '@/services/rollback.service';
import { SystemService } from '@/services/system.service';
import { VendorService } from '@/services/vendor.service';

export { AppService } from '@/services/app.service';
export { BatteryService } from '@/services/battery.service';
export { DeviceService } from '@/services/device.service';
export { DisplayService, COMMON_KEYS, type KeyOption } from '@/services/display.service';
export { FileService, type InstallOptions, type InstallResult } from '@/services/file.service';
export { RollbackService, type RollbackReport, type RollbackStep } from '@/services/rollback.service';
export { SystemService, STATUS_ICON_SLOTS, type TuningState } from '@/services/system.service';
export { VendorService, type BloatItem, type BloatState, type VendorSetting } from '@/services/vendor.service';

export type { PackageDetail, PackageEntry, BatchResult } from '@/services/app.service';
export type { DeviceSnapshot, RebootMode } from '@/services/device.service';
export type {
  BatterySimulation,
  PowerSample,
  PowerWatchOptions,
  PowerSource,
  ChargeStatus,
} from '@/services/battery.service';

/** 聚合后的服务集合 */
export interface Services {
  shell: ShellContext;
  capabilities: DeviceCapabilities;
  /** 当前设备品牌，UI 与工具过滤都用它 */
  vendor: VendorId;
  device: DeviceService;
  apps: AppService;
  display: DisplayService;
  files: FileService;
  system: SystemService;
  battery: BatteryService;
  vendorService: VendorService;
  rollback: RollbackService;
}

/** 构造参数 */
export interface CreateServicesOptions {
  /** 命令输出回调，用于终端面板实时展示 */
  output?: OutputSink;
  /** 进度回调，用于安装 / 推送的进度条 */
  progress?: ProgressSink;
}

/**
 * 从一个已建立的会话创建全部服务。
 *
 * 所有服务共享同一个 ShellContext —— 这样一次 abort() 能停掉
 * 当前设备上所有正在跑的命令，而不是各服务各管一段。
 */
export function createServices(
  session: DeviceSession,
  options: CreateServicesOptions = {},
): Services {
  const shell = new ShellContext({
    driver: session.driver,
    output: options.output,
    progress: options.progress,
  });

  // 品牌只判定一次：后续工具过滤、UI 分区、品牌服务都用同一个结果，
  // 避免各处各判一次出现不一致
  const vendor = detectVendor(session.capabilities);

  return {
    shell,
    capabilities: session.capabilities,
    vendor,
    device: new DeviceService(shell, session.capabilities),
    apps: new AppService(shell, session.capabilities.sdk),
    display: new DisplayService(shell),
    files: new FileService(shell, session.capabilities.sdk),
    system: new SystemService(shell),
    battery: new BatteryService(shell),
    vendorService: new VendorService(shell, vendor),
    rollback: new RollbackService(shell),
  };
}

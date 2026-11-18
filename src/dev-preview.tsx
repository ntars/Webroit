/**
 * 视图验证入口（仅开发用）。
 *
 * 用假数据把应用推到「已连接」状态，验证各分区视图能否正常渲染。
 * 生产构建不包含此文件。
 */

import { render } from 'preact';

import { BUILTIN_TOOLS, bindServices } from '@/tools/builtin';
import { detectVendor, registerTools, type ModuleId } from '@/tools/registry';
import {
  type Services,
  AppService,
  BatteryService,
  DeviceService,
  DisplayService,
  FileService,
  RollbackService,
  SystemService,
  VendorService,
} from '@/services/index';
import { App } from '@/ui/App';
import { activeModule, phase, services, session } from '@/ui/state/app-state';
import type { ShellContext } from '@/core/shell';
import type { DeviceSession } from '@/core/session/device-session';

import '@/ui/theme/tokens.css';
import '@/ui/theme/base.css';
import '@/ui/theme/components.css';
import '@/ui/theme/layout.css';
import '@/ui/theme/views.css';

/** 小米设备的假 getprop 输出 */
const FAKE_PROPS: Record<string, string> = {
  'ro.product.brand': 'Xiaomi',
  'ro.product.manufacturer': 'Xiaomi',
  'ro.product.model': '23127PN0CC',
  'ro.product.device': 'fuxi',
  'ro.build.version.release': '14',
  'ro.build.version.sdk': '34',
  'ro.product.cpu.abi': 'arm64-v8a',
  'ro.build.fingerprint': 'Xiaomi/fuxi/fuxi:14/UKQ1.231003.002/V816.0.3.0:user/release-keys',
  'ro.product.marketname': 'Xiaomi 13',
  'ro.product.odm.name': 'fuxi',
};

/** 按命令前缀返回预设输出 */
function respond(command: string): string {
  if (command.includes('getprop')) {
    return Object.entries(FAKE_PROPS)
      .map(([key, value]) => `[${key}]: [${value}]`)
      .join('\n');
  }
  if (command.includes('wm size')) return 'Physical size: 1080x2400\nOverride size: 1080x2400';
  if (command.includes('wm density')) return 'Physical density: 440\nOverride density: 440';
  if (command.includes('dumpsys battery')) {
    return [
      'Current Battery Service state:',
      '  AC powered: false',
      '  USB powered: true',
      '  Wireless powered: false',
      '  status: 2',
      '  health: 2',
      '  level: 78',
      '  voltage: 4312',
      '  temperature: 312',
      '  technology: Li-ion',
    ].join('\n');
  }
  if (command.includes('pm list packages -d')) {
    return 'package:com.miui.systemAdSolution\npackage:com.miui.analytics';
  }
  if (command.includes('pm list packages')) {
    return [
      'package:com.miui.systemAdSolution',
      'package:com.miui.analytics',
      'package:com.xiaomi.mipicks',
      'package:com.miui.msa.global',
      'package:com.miui.hybrid',
      'package:com.miui.videoplayer',
      'package:com.miui.player',
      'package:com.xiaomi.gamecenter',
      'package:com.miui.bugreport',
      'package:com.miui.miservice',
      'package:com.android.settings',
      'package:com.tencent.mm',
    ].join('\n');
  }
  if (command.includes('ls -la')) {
    return [
      'drwxrwx--x 4 root sdcard_rw 4096 2026-11-15 10:00 Android',
      'drwxrwx--x 2 root sdcard_rw 4096 2026-11-15 10:00 DCIM',
      '-rw-rw---- 1 root sdcard_rw 204800 2026-11-15 09:12 photo.jpg',
    ].join('\n');
  }
  if (command.includes('scaling_cur_freq')) {
    return '0:1804800\n1:1804800\n2:2419200\n3:2419200\n4:2803200\n5:2803200';
  }
  if (command.includes('uptime')) return '412800.55 1200000.00';
  if (command.includes('uname -m')) return 'aarch64';
  if (command.includes('uname -r')) return '5.15.94-android13-8';
  if (command.includes('ls /dev/block')) return 'sda1\nsda2\nmmcblk0';
  if (command.includes('icon_blacklist')) return 'null';
  if (command.includes('font_scale')) return '1.0';
  if (command.includes('animation_scale')) return '0.5';
  if (command.includes('animator_duration_scale')) return '0.5';
  if (command.includes('screen_off_timeout')) return '60000';
  if (command.includes('current_now')) return 'i:412000\nv:4312000';
  return '';
}

/*
 * 假 shell 只实现 services 真正会调用到的那几个方法，
 * 而 ShellContext 是带私有字段的类，结构上永远「不重叠」。
 * 这里经 unknown 中转，是明确表达「这是刻意的假对象」，
 * 比 as any 保留了 ShellContext 这个目标类型，改名时仍会报错。
 */
const fakeShell = {
  driver: { serial: 'fake1234', label: 'Xiaomi 13', connected: true },
  text: async (command: string) => respond(command),
  shell: async (command: string) => ({ stdout: respond(command), stderr: '', exitCode: 0 }),
  mutation: async (command: string) => respond(command),
  probe: async (command: string) => respond(command),
  info: () => {},
  reportProgress: () => {},
  abort: () => {},
} as unknown as ShellContext;

const params = new URLSearchParams(location.search);
const moduleId = (params.get('module') ?? 'device') as ModuleId;
document.documentElement.dataset.theme = params.get('theme') ?? 'dark';

const capabilities = {
  sdk: 34,
  release: '14',
  brand: 'Xiaomi',
  model: '23127PN0CC',
  props: FAKE_PROPS,
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

const fakeSession = {
  driver: fakeShell.driver,
  capabilities,
  serial: 'fake1234',
  label: 'Xiaomi 13',
  androidLabel: 'Android 14 (API 34)',
  connected: true,
  connectedAt: new Date(),
  close: async () => {},
} satisfies Partial<DeviceSession> as DeviceSession;

registerTools(BUILTIN_TOOLS);

/*
 * 直接用真实服务类 + 假 shell 构造，跳过 createServices ——
 * createServices 会用真实 driver 建 ShellContext，走不通。
 * 各服务把 shell 存在私有字段里，正常途径拿不到，但构造时传什么就用什么，
 * 所以这里传入假 shell 即可，不需要事后替换。
 */
const vendor = detectVendor(capabilities);

const built: Services = {
  shell: fakeShell,
  capabilities,
  vendor,
  device: new DeviceService(fakeShell, capabilities),
  apps: new AppService(fakeShell, 34),
  display: new DisplayService(fakeShell),
  files: new FileService(fakeShell, 34),
  system: new SystemService(fakeShell),
  battery: new BatteryService(fakeShell),
  vendorService: new VendorService(fakeShell, vendor),
  rollback: new RollbackService(fakeShell),
};

bindServices(() => built);

services.set(built);
session.set(fakeSession);
activeModule.set(moduleId);
phase.set('ready');

const root = document.getElementById('app');
if (root) render(<App />, root);

console.log('视图验证模式 —— 品牌:', vendor, '分区:', moduleId);

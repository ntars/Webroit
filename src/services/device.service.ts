/**
 * 设备服务：只读信息采集 + 重启控制。
 *
 * 全部走标准 adb shell，不依赖 root、不依赖厂商私有接口。
 */

import type { DeviceCapabilities } from '@/core/session/device-session';
import type { ShellContext } from '@/core/shell';
import {
  type BatteryInfo,
  type CpuCore,
  type DisplayInfo,
  type FocusInfo,
  formatDuration,
  parseBattery,
  parseCpuFreq,
  parseDisplay,
  parseFocus,
  parseProps,
  pickDeviceName,
} from '@/core/utils';

/** 设备完整信息 */
export interface DeviceSnapshot {
  brand: string;
  model: string;
  device: string;
  android: string;
  sdk: number;
  abi: string;
  fingerprint: string;
  kernel: string;
  arch: string;
  /** 存储类型：UFS / eMMC / 未知 */
  storageType: string;
  /** 主板序列号 */
  boardId: string;
  display: DisplayInfo;
  battery: BatteryInfo;
  uptime: string;
  /** 营销机型名 */
  marketName: string;
}

/** 重启模式 */
export type RebootMode = 'system' | 'recovery' | 'bootloader' | 'fastboot' | 'edl' | 'poweroff';

export class DeviceService {
  #shell: ShellContext;
  #caps: DeviceCapabilities;

  constructor(shell: ShellContext, capabilities: DeviceCapabilities) {
    this.#shell = shell;
    this.#caps = capabilities;
  }

  /** 采集设备快照：一次并发拿全，避免串行等待 */
  async snapshot(): Promise<DeviceSnapshot> {
    const optional = (command: string) =>
      this.#shell.text(command, { log: false, allowFailure: true }).catch(() => '');

    const [propsText, display, battery, uptimeText, archText, kernelText, boardText, blocksText] =
      await Promise.all([
        this.#shell.text('getprop', { log: false }),
        this.display(),
        this.#shell.text('dumpsys battery', { log: false, allowFailure: true }).then(parseBattery),
        optional('cat /proc/uptime'),
        optional('uname -m'),
        optional('uname -r'),
        optional('cat /sys/devices/soc0/serial_number'),
        optional('ls /dev/block'),
      ]);

    const props = parseProps(propsText);

    /**
     * 靠块设备节点名判断存储介质。
     *
     * 注意节点名后面总跟着分区号（sda1、sda17、mmcblk0p3），
     * 所以不能要求 sda 后面是词边界 —— \bsda\b 匹配不到 sda1，
     * 会让所有 UFS 设备被误判成 eMMC。这里只要求前缀匹配。
     * 先判 sda：UFS 设备上也可能同时存在 mmcblk0（外置 SD 卡），
     * 但反过来 eMMC 设备不会有 sda，所以 sda 的优先级更高。
     */
    const storageType = /\bsd[a-z]/.test(blocksText)
      ? 'UFS'
      : /\bmmcblk\d/.test(blocksText)
        ? 'eMMC'
        : '未知';

    return {
      brand: props['ro.product.brand'] || '—',
      model: props['ro.product.model'] || '—',
      device: props['ro.product.odm.name'] || props['ro.product.device'] || '—',
      android: `Android ${props['ro.build.version.release'] || '?'} (API ${props['ro.build.version.sdk'] || '?'})`,
      sdk: this.#caps.sdk,
      abi: props['ro.product.cpu.abi'] || '—',
      fingerprint: props['ro.build.fingerprint'] || '—',
      kernel: kernelText.trim() || '—',
      arch: archText.trim() || '—',
      storageType,
      boardId: boardText.trim() || '—',
      display,
      battery,
      uptime: formatDuration(parseFloat(uptimeText)),
      marketName: pickDeviceName(props),
    };
  }

  /** 读当前分辨率与 DPI */
  async display(): Promise<DisplayInfo> {
    const [size, density] = await Promise.all([
      this.#shell.text('wm size', { log: false, allowFailure: true }).catch(() => ''),
      this.#shell.text('wm density', { log: false, allowFailure: true }).catch(() => ''),
    ]);
    return parseDisplay(size, density);
  }

  /** 读电池 */
  async battery(): Promise<BatteryInfo> {
    return parseBattery(await this.#shell.text('dumpsys battery', { log: false }));
  }

  /** 读各 CPU 核心当前频率 */
  async cpuFreq(): Promise<CpuCore[]> {
    const command =
      'for c in /sys/devices/system/cpu/cpu[0-9]*; do ' +
      'n=${c##*cpu}; ' +
      'f=$(cat "$c/cpufreq/scaling_cur_freq" 2>/dev/null); ' +
      '[ -n "$f" ] && printf "%s:%s\\n" "$n" "$f"; done';
    return parseCpuFreq(await this.#shell.text(command, { log: false, allowFailure: true }));
  }

  /** 读前台应用 */
  async foreground(): Promise<FocusInfo> {
    let result = parseFocus(
      await this.#shell.text('dumpsys window windows', { log: false, allowFailure: true }),
    );
    if (!result.package) {
      result = parseFocus(
        await this.#shell.text('dumpsys activity activities', { log: false, allowFailure: true }),
      );
    }
    return result;
  }

  /** 当前功耗（瓦），读不到则返回 null */
  async powerDraw(): Promise<number | null> {
    const text = await this.#shell.text(
      'printf "current:"; cat /sys/class/power_supply/battery/current_now; ' +
        'printf "voltage:"; cat /sys/class/power_supply/battery/voltage_now',
      { log: false, allowFailure: true },
    );
    const current = text.match(/current:\s*(-?\d+)/);
    const voltage = text.match(/voltage:\s*(\d+)/);
    if (current && voltage) {
      // current_now 单位 µA，voltage_now 单位 µV，相乘得 pW，除以 1e12 得 W
      return (Number(current[1]) * Number(voltage[1])) / 1e12;
    }
    return null;
  }

  /**
   * 重启设备。
   *
   * 注意：进入 bootloader / recovery 之后 ADB 连接会断开，
   * 这是预期行为，不是错误。
   */
  async reboot(mode: RebootMode): Promise<string> {
    const labels: Record<RebootMode, string> = {
      system: '重启系统',
      recovery: '重启到 Recovery',
      bootloader: '重启到 Bootloader',
      fastboot: '重启到 Fastbootd',
      edl: '重启到 EDL（9008）',
      poweroff: '关机',
    };

    if (mode === 'poweroff') {
      this.#shell.info('正在关机…');
      await this.#shell.driver.reboot('poweroff');
      return '关机指令已发送';
    }
    if (mode === 'system') {
      this.#shell.info('正在重启…');
      await this.#shell.driver.reboot('');
      return '重启指令已发送';
    }

    this.#shell.info(`正在${labels[mode]}…`);
    await this.#shell.driver.reboot(mode);
    return `${labels[mode]}指令已发送，设备将断开 ADB 连接`;
  }
}

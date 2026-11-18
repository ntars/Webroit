/**
 * 电池服务：状态读取、参数模拟、功耗采样。
 *
 * 两个容易被忽略的细节：
 *
 * 1. 模拟前自动记录原始状态，提供「精确还原」——
 *    单靠 `dumpsys battery reset` 清不掉已经被 set 过的温度/电压字段，
 *    用户改完温度后点 reset，温度仍然是假值。这里的做法是：
 *    第一次进入模拟前把原始 dumpsys 输出完整存下来，还原时逐字段写回。
 *
 * 2. 功耗采样做成可中止的轮询器，采样结果直接可导 CSV ——
 *    因为 WebUSB 下每条命令都是一次真实往返，采样间隔不能太密，
 *    且必须能在用户切走页面时干净地停下来。
 *
 * 全部能力纯 ADB 实现，不需要 root：`dumpsys battery` 系列命令
 * 在 ADB shell 用户下就能执行，这正是它的用处。
 */

import type { ShellContext } from '@/core/shell';
import {
  type BatteryInfo,
  assertInteger,
  assertNumber,
  checkAbort,
  parseBattery,
  sleep,
  timestamp,
} from '@/core/utils';

/** 充电来源（`dumpsys battery set <type> 1/0` 的 type） */
export type PowerSource = 'ac' | 'usb' | 'wireless';

/** 充电状态码，对应 BatteryManager 常量 */
export type ChargeStatus =
  | 'unknown'
  | 'charging'
  | 'discharging'
  | 'not-charging'
  | 'full';

/** 状态码与数字的双向映射 */
const STATUS_CODE: Record<ChargeStatus, number> = {
  unknown: 1,
  charging: 2,
  discharging: 3,
  'not-charging': 4,
  full: 5,
};

const STATUS_LABEL: Record<ChargeStatus, string> = {
  unknown: '未知',
  charging: '充电中',
  discharging: '放电中',
  'not-charging': '未充电',
  full: '已充满',
};

/** 电池健康度码 */
const HEALTH_LABEL: Record<number, string> = {
  1: '未知',
  2: '良好',
  3: '过热',
  4: '已损坏',
  5: '过压',
  6: '未指定故障',
  7: '过冷',
};

/** 插头类型码 */
const PLUG_LABEL: Record<number, string> = {
  0: '未连接',
  1: '交流电',
  2: 'USB',
  3: '无线',
  4: '底座',
  5: '有线充电',
};

/** 可模拟的电池参数 */
export interface BatterySimulation {
  /** 电量百分比 0-100 */
  level: number | null;
  /** 温度，摄氏度，-50 ~ 150 */
  temperature: number | null;
  /** 电压，毫伏 */
  voltage: number | null;
  /** 充电状态 */
  status: ChargeStatus | null;
  /** 是否处于模拟状态（updates stopped 或已 set） */
  active: boolean;
}

/** 功耗采样点 */
export interface PowerSample {
  /** ISO 时间 */
  time: string;
  /** 距开始采样的毫秒数 */
  elapsed: number;
  /** 功率，瓦 */
  watt: number | null;
  /** 当时电量百分比 */
  level: number | null;
  /** 当时温度 */
  temperature: number | null;
  /** 当时电流，毫安（正为放电） */
  milliamp: number | null;
}

/** 采样选项 */
export interface PowerWatchOptions {
  /** 采样间隔毫秒，默认 3000。WebUSB 下不要低于 1000 */
  interval?: number;
  /** 最大采样点数，默认 200，达到后自动停止 */
  limit?: number;
  signal?: AbortSignal;
  /** 每采集一个点回调一次 */
  onSample?: (sample: PowerSample, all: PowerSample[]) => void;
}

/**
 * 电池服务。
 *
 * 注意 dumpsys 的字段单位陷阱：
 * - temperature 输出的是摄氏度 × 10（如 310 表示 31.0℃）
 * - voltage 输出的是毫伏（如 4300 表示 4.3V）
 * 这两个值在写入时也必须按同样倍数处理，否则设进去的值会差 10 倍。
 */
export class BatteryService {
  #shell: ShellContext;

  /** 模拟前的原始快照，用于精确还原 */
  #baseline: BatteryInfo | null = null;

  constructor(shell: ShellContext) {
    this.#shell = shell;
  }

  /* ─────────────── 读取 ─────────────── */

  /** 读当前电池状态 */
  async status(): Promise<BatteryInfo> {
    return parseBattery(await this.#shell.text('dumpsys battery', { log: false }));
  }

  /** 读当前模拟参数（从 fields 里抽出来） */
  async simulation(): Promise<BatterySimulation> {
    const info = await this.status();
    const statusCode = Number(info.fields['status']);
    const fromCode = (Object.keys(STATUS_CODE) as ChargeStatus[]).find(
      (key) => STATUS_CODE[key] === statusCode,
    );
    const last = info.fields['level'];
    return {
      level: last === undefined ? null : Number(last),
      temperature: info.temperature,
      voltage: info.voltage === null ? null : Math.round(info.voltage * 1000),
      status: fromCode ?? null,
      active: info.updatesStopped,
    };
  }

  /** 电池状态的可读描述，供 UI 直接展示 */
  async summary(): Promise<{
    level: number | null;
    temperature: number | null;
    voltage: number | null;
    status: string;
    health: string;
    plug: string;
    simulated: boolean;
  }> {
    const info = await this.status();
    const statusCode = Number(info.fields['status']);
    const healthCode = Number(info.fields['health']);
    const plugCode = Number(info.fields['plugged']);
    const fromCode = (Object.keys(STATUS_CODE) as ChargeStatus[]).find(
      (key) => STATUS_CODE[key] === statusCode,
    );

    /**
     * 供电来源优先看 plugged 数字字段，但它并非所有 ROM 都有 ——
     * 部分设备只给 ac/usb/wireless powered 三个布尔值。
     * 缺 plugged 时按这三个布尔回退推断，否则界面上会显示「未知（?）」，
     * 而用户明明插着 USB。
     */
    const plugText =
      PLUG_LABEL[plugCode] ??
      (info.acPowered
        ? '交流电'
        : info.usbPowered
          ? 'USB'
          : info.wirelessPowered
            ? '无线'
            : info.fields['plugged'] === undefined
              ? '未连接'
              : `未知（${plugCode || '?'}）`);

    return {
      level: info.level,
      temperature: info.temperature,
      voltage: info.voltage,
      status: fromCode ? STATUS_LABEL[fromCode] : `未知（${statusCode || '?'}）`,
      health: HEALTH_LABEL[healthCode] ?? `未知（${healthCode || '?'}）`,
      plug: plugText,
      simulated: info.updatesStopped,
    };
  }

  /**
   * 读瞬时电流与功率。
   *
   * 走 sysfs 而不是 dumpsys，因为 dumpsys 的 current now 字段
   * 在不少 ROM 上恒为 0 或直接缺失；sysfs 的 current_now 更可靠。
   * 单位：current_now 是 µA，voltage_now 是 µV，乘积除以 1e12 得瓦。
   */
  async power(): Promise<{ milliamp: number | null; watt: number | null }> {
    const text = await this.#shell.text(
      'printf "i:"; cat /sys/class/power_supply/battery/current_now 2>/dev/null; ' +
        'printf "\\nv:"; cat /sys/class/power_supply/battery/voltage_now 2>/dev/null',
      { log: false, allowFailure: true },
    );

    const current = text.match(/i:\s*(-?\d+)/);
    const voltage = text.match(/v:\s*(\d+)/);
    if (!current) return { milliamp: null, watt: null };

    const microAmp = Number(current[1]);
    // current_now 的符号约定各厂商不一致，统一取绝对值表示「电流大小」，
    // 方向另由充电状态判断，避免 UI 上出现负功耗的困惑
    const milliamp = Math.abs(microAmp) / 1000;

    const watt = voltage ? (Math.abs(microAmp) * Number(voltage[1])) / 1e12 : null;
    return { milliamp, watt };
  }

  /* ─────────────── 模拟 ─────────────── */

  /**
   * 修改单个电池参数。
   *
   * @param key   level / temperature / voltage / status
   * @param value 用户输入值（单位是用户视角的自然单位）
   */
  async set(key: 'level' | 'temperature' | 'voltage' | 'status', value: unknown): Promise<BatterySimulation> {
    await this.#captureBaseline();

    let wire: number;
    switch (key) {
      case 'level':
        wire = assertInteger(value, 0, 100, '电量');
        break;
      case 'temperature':
        // 用户填 31.5℃，设备要 315
        wire = Math.round(assertNumber(value, -50, 150, '温度') * 10);
        break;
      case 'voltage':
        // 用户填 4300 mV，设备要 4300（dumpsys 单位就是 mV）
        wire = Math.round(assertNumber(value, 3000, 5000, '电压'));
        break;
      case 'status': {
        const name = String(value) as ChargeStatus;
        if (!(name in STATUS_CODE)) {
          throw new Error(`无效充电状态：${String(value)}`);
        }
        wire = STATUS_CODE[name];
        break;
      }
      default:
        throw new Error('无效电池参数');
    }

    await this.#shell.mutation(`dumpsys battery set ${key} ${wire}`);
    return this.simulation();
  }

  /**
   * 设置充电来源。
   *
   * @param source  来源类型；'unplugged' 表示拔掉所有电源
   * @param enabled true 接上该来源，false 还原
   *
   * 实现要点：设备同时接受 ac/usb/wireless 三个独立开关，
   * 直接 set usb 1 而不把另外两个置 0，会出现「同时插着两种电源」的矛盾状态，
   * 部分 ROM 会因此不触发充电动画。所以先全关，再单开。
   */
  async setSource(
    source: PowerSource | 'unplugged',
    enabled: boolean,
  ): Promise<BatterySimulation> {
    await this.#captureBaseline();

    if (!enabled) {
      await this.#shell.mutation('dumpsys battery reset');
      return this.simulation();
    }

    if (source === 'unplugged') {
      await this.#shell.mutation('dumpsys battery unplug');
      // dumpsys battery unplug 只拔电源，状态码不会自动改成放电，
      // 手动补一条 status 3，否则系统仍认为在充电
      await this.#shell.mutation('dumpsys battery set status 3');
      return this.simulation();
    }

    if (!['ac', 'usb', 'wireless'].includes(source)) {
      throw new Error(`无效充电类型：${String(source)}`);
    }

    for (const type of ['ac', 'usb', 'wireless'] as PowerSource[]) {
      await this.#shell.mutation(`dumpsys battery set ${type} ${source === type ? 1 : 0}`);
    }
    // 接上电源后状态应为充电中
    await this.#shell.mutation('dumpsys battery set status 2');
    return this.simulation();
  }

  /** 暂停电量统计（模拟时避免真机电量自然变化干扰观察） */
  async stopUpdates(): Promise<string> {
    return this.#shell.mutation('dumpsys battery set ac 0; dumpsys battery unplug');
  }

  /**
   * 精确还原到模拟前的状态。
   *
   * `dumpsys battery reset` 只清掉「updates stopped」标记，
   * 之前 set 过的 level / temperature 不会回退到真实值 ——
   * 这是很多人用了模拟功能后觉得「电量一直是假的」的原因。
   * 所以这里拿基线快照逐字段写回。
   */
  async restore(): Promise<string> {
    const base = this.#baseline;
    await this.#shell.mutation('dumpsys battery reset');

    if (!base) {
      return '已还原电池状态（无基线快照，仅执行 reset）';
    }

    const writes: string[] = [];
    const level = Number(base.fields['level']);
    if (Number.isFinite(level)) {
      writes.push(`dumpsys battery set level ${level}`);
    }
    const temp = Number(base.fields['temperature']);
    if (Number.isFinite(temp)) {
      writes.push(`dumpsys battery set temp ${temp}`);
    }
    const voltage = Number(base.fields['voltage']);
    if (Number.isFinite(voltage)) {
      writes.push(`dumpsys battery set voltage ${voltage}`);
    }
    const status = Number(base.fields['status']);
    if (Number.isFinite(status)) {
      writes.push(`dumpsys battery set status ${status}`);
    }

    for (const command of writes) {
      await this.#shell.mutation(command);
    }

    this.#baseline = null;
    return `已还原 ${writes.length} 项电池参数`;
  }

  /** 首次修改前存一份原始 dumpsys，后续修改不覆盖它 */
  async #captureBaseline(): Promise<void> {
    if (this.#baseline) return;
    const info = await this.status();
    // 已经处于模拟状态的设备没有「干净基线」可言，不存
    if (!info.updatesStopped) {
      this.#baseline = info;
    }
  }

  /** 是否已捕获基线 */
  get hasBaseline(): boolean {
    return this.#baseline !== null;
  }

  /* ─────────────── 功耗采样 ─────────────── */

  /**
   * 轮询功耗，边采边回调。
   *
   * 为什么不放在 UI 里 setInterval：
   * 每条采样都是一次 WebUSB 往返，UI 层用定时器很容易在命令没回来时
   * 又发下一条，造成命令堆积把设备拖死。这里用「跑完一条等一会儿再跑下一条」
   * 的串行节奏，天然不会堆积。
   */
  async watchPower(options: PowerWatchOptions = {}): Promise<PowerSample[]> {
    const { interval = 3000, limit = 200, signal, onSample } = options;
    assertInteger(interval, 500, 60000, '采样间隔');
    assertInteger(limit, 1, 5000, '采样上限');

    const samples: PowerSample[] = [];
    const startedAt = Date.now();

    while (samples.length < limit) {
      checkAbort(signal);

      const [power, info] = await Promise.all([
        this.power(),
        // 电量与温度不用每轮都读完整 dumpsys，抽两行就够
        this.#shell.text('dumpsys battery | grep -E "level|temperature"', {
          log: false,
          allowFailure: true,
          signal,
        }),
      ]);

      const levelMatch = info.match(/level:\s*(\d+)/);
      const tempMatch = info.match(/temperature:\s*(-?\d+)/);

      const sample: PowerSample = {
        time: new Date().toISOString(),
        elapsed: Date.now() - startedAt,
        watt: power.watt,
        milliamp: power.milliamp,
        level: levelMatch ? Number(levelMatch[1]) : null,
        temperature: tempMatch ? Number(tempMatch[1]) / 10 : null,
      };

      samples.push(sample);
      onSample?.(sample, samples);

      if (samples.length >= limit) break;
      // 用可中止的 sleep，用户点停止时立刻退出而不是等满一个间隔
      await sleep(interval, signal);
    }

    return samples;
  }

  /**
   * 把采样点导出成 CSV。
   *
   * 加 BOM 是为了 Excel 直接双击打开不乱码 —— 不带 BOM 的 UTF-8 CSV
   * 在中文 Windows 的 Excel 里会把表头显示成乱码。
   */
  exportCsv(samples: PowerSample[], label = 'battery'): { blob: Blob; name: string } {
    const header = ['时间', '秒数', '功率(W)', '电流(mA)', '电量(%)', '温度(℃)'];
    const rows = samples.map((sample) => [
      sample.time,
      (sample.elapsed / 1000).toFixed(1),
      sample.watt === null ? '' : sample.watt.toFixed(3),
      sample.milliamp === null ? '' : sample.milliamp.toFixed(0),
      sample.level ?? '',
      sample.temperature ?? '',
    ]);

    const csv = [header, ...rows].map((row) => row.join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    return { blob, name: `${label}_${timestamp()}.csv` };
  }

  /** 采样统计：均值、峰值、时长 */
  static summarize(samples: PowerSample[]): {
    count: number;
    averageWatt: number | null;
    peakWatt: number | null;
    durationSeconds: number;
    drainPercent: number | null;
  } {
    const watts = samples.map((s) => s.watt).filter((w): w is number => w !== null);
    const levels = samples.map((s) => s.level).filter((l): l is number => l !== null);
    return {
      count: samples.length,
      averageWatt: watts.length ? watts.reduce((a, b) => a + b, 0) / watts.length : null,
      peakWatt: watts.length ? Math.max(...watts) : null,
      durationSeconds: samples.length ? samples[samples.length - 1].elapsed / 1000 : 0,
      drainPercent:
        levels.length >= 2 ? levels[0] - levels[levels.length - 1] : null,
    };
  }
}

/**
 * 系统服务：状态栏、沉浸模式、字体缩放、动画倍率、自动锁屏。
 *
 * 这一整类能力都依赖 `settings put` 命令。
 * 关键前提：`settings put secure` 需要 WRITE_SECURE_SETTINGS 权限，
 * 这个权限普通应用拿不到，但 ADB shell 用户默认就有 —— 这正是 Webroit 的价值所在。
 * `settings put system` / `global` 的门槛更低，多数设备直接可写。
 *
 * 所有写入都先落一条快照（见 core/snapshot.ts），
 * 用户点「一键还原」时按逆序回放，设备回到本次会话开始前的状态。
 */

import type { ShellContext } from '@/core/shell';
import { assertNumber, quote } from '@/core/utils';
import { settingsInverse, snapshots } from '@/core/snapshot';

/** 状态栏图标槽位 */
export const STATUS_ICON_SLOTS: { label: string; key: string }[] = [
  { label: '时间', key: 'clock' },
  { label: '定位', key: 'location' },
  { label: '耳机', key: 'headset' },
  { label: '投射', key: 'cast' },
  { label: '闹钟', key: 'alarm_clock' },
  { label: '声音', key: 'volume' },
  { label: '信号', key: 'mobile' },
  { label: '飞行模式', key: 'airplane' },
  { label: '蓝牙', key: 'bluetooth' },
  { label: '电池', key: 'battery' },
  { label: '无线', key: 'wifi' },
  { label: 'NFC', key: 'nfc' },
];

/** 无极调节项 */
export interface TuningState {
  fontScale: number | null;
  windowAnimation: number | null;
  transitionAnimation: number | null;
  animatorDuration: number | null;
  screenOffTimeout: number | null;
}

/** 可调节的动画/缩放键 */
const TUNABLE_KEYS = [
  ['system', 'font_scale'],
  ['global', 'window_animation_scale'],
  ['global', 'transition_animation_scale'],
  ['global', 'animator_duration_scale'],
  ['system', 'screen_off_timeout'],
] as const;

/** 一次设置变更的原值记录 */
interface Change {
  scope: string;
  key: string;
  before: string;
}

export class SystemService {
  #shell: ShellContext;

  constructor(shell: ShellContext) {
    this.#shell = shell;
  }

  /**
   * 读一个 settings 值，顺带把原值留作回滚依据。
   *
   * 为什么在读的时候留：写入前一定要读一次原值，
   * 读和写之间如果隔了别的命令，中间被别人改了就会记错。
   * 所以这里把「读」和「记」合成一个动作。
   */
  async #readBefore(scope: string, key: string): Promise<Change> {
    const before = await this.#shell.text(`settings get ${scope} ${key}`, {
      log: false,
      allowFailure: true,
    });
    return { scope, key, before: before.trim() };
  }

  /** 依次写入一组变更，并把整组存成一条快照 */
  async #apply(module: string, label: string, changes: Change[], writes: string[]): Promise<void> {
    // 快照先落，再改设备 —— 顺序反了的话，命令失败也留下了「改过」的假记录
    if (changes.length > 0) {
      snapshots.record({
        module,
        label,
        restore: changes.map((change) =>
          settingsInverse(change.scope, change.key, change.before),
        ),
      });
    }
    for (const command of writes) {
      await this.#shell.mutation(command);
    }
  }

  /* ─────────────── 状态栏 ─────────────── */

  /**
   * 设置状态栏图标显示。
   *
   * 原理：`icon_blacklist` 里列出的图标会被隐藏。
   * 只操作我们管理的 12 个槽位，其他槽位的用户设置原样保留 ——
   * 这点很关键，否则会误伤用户之前隐藏的其他图标。
   */
  async setStatusIcons(
    hidden: string[],
    options: { rotationSuggestion?: boolean; clockSeconds?: boolean } = {},
  ): Promise<void> {
    const controlled = STATUS_ICON_SLOTS.map((slot) => slot.key);
    const change = await this.#readBefore('secure', 'icon_blacklist');

    const existing =
      change.before === 'null' || change.before === '' ? [] : change.before.split(',').filter(Boolean);
    // 保留不在我们管理范围内的图标设置
    const kept = existing.filter((key) => !controlled.includes(key));
    const merged = [...new Set([...kept, ...hidden.filter((key) => controlled.includes(key))])].join(
      ',',
    );

    const changes: Change[] = [change];
    const writes = [`settings put secure icon_blacklist ${quote(merged)}`];

    if (options.rotationSuggestion !== undefined) {
      changes.push(await this.#readBefore('secure', 'show_rotation_suggestions'));
      writes.push(
        `settings put secure show_rotation_suggestions ${options.rotationSuggestion ? 0 : 1}`,
      );
    }
    if (options.clockSeconds !== undefined) {
      changes.push(await this.#readBefore('secure', 'clock_seconds'));
      writes.push(`settings put secure clock_seconds ${options.clockSeconds ? 1 : 0}`);
    }

    await this.#apply('system', '状态栏图标', changes, writes);
  }

  /** 读当前状态栏设置 */
  async statusIcons(): Promise<Record<string, string>> {
    const keys = [
      'icon_blacklist',
      'show_rotation_suggestions',
      'clock_seconds',
      'sysui_qqs_count',
      'sysui_rounded_content_padding',
    ];
    const values = await Promise.all(
      keys.map((key) => this.#shell.text(`settings get secure ${key}`, { log: false })),
    );
    return Object.fromEntries(keys.map((key, index) => [key, values[index].trim()]));
  }

  /** 快捷设置面板行数 / 圆角内边距 */
  async quickSettings(
    key: 'sysui_qqs_count' | 'sysui_rounded_content_padding',
    value: string,
  ): Promise<string> {
    if (!['sysui_qqs_count', 'sysui_rounded_content_padding'].includes(key)) {
      throw new Error('无效设置项');
    }

    const change = await this.#readBefore('secure', key);
    if (value === 'default') {
      await this.#apply('system', '快捷设置面板', [change], [`settings delete secure ${key}`]);
      return '已恢复默认';
    }

    const allowed = key === 'sysui_qqs_count' ? [3, 4, 5, 6, 7, 8, 9] : [0, 5, 10, 15, 20, 30];
    if (!allowed.includes(Number(value))) throw new Error('无效设置值');
    await this.#apply('system', '快捷设置面板', [change], [
      `settings put secure ${key} ${Number(value)}`,
    ]);
    return `已设为 ${value}`;
  }

  /* ─────────────── 沉浸模式 ─────────────── */

  /**
   * 沉浸模式。
   * target 支持包名、逗号分隔、* 通配、- 排除前缀。
   */
  async immersive(kind: 'status' | 'navigation' | 'full' | 'reset', target = '*'): Promise<string> {
    if (!['status', 'navigation', 'full', 'reset'].includes(kind)) {
      throw new Error('无效沉浸模式');
    }

    const change = await this.#readBefore('global', 'policy_control');
    if (kind === 'reset') {
      await this.#apply('system', '沉浸模式', [change], [
        'settings put global policy_control immersive.full=null',
      ]);
      return '已退出沉浸模式';
    }

    const scope = String(target).trim() || '*';
    if (!/^[\w.*,-]+$/.test(scope)) {
      throw new Error('软件范围只允许包名、逗号、* 和 -');
    }
    await this.#apply('system', '沉浸模式', [change], [
      `settings put global policy_control ${quote(`immersive.${kind}=${scope}`)}`,
    ]);
    return '已进入沉浸模式';
  }

  /* ─────────────── 网络检测修复 ─────────────── */

  /**
   * 修复 Wi-Fi 感叹号。
   * 把验证服务器指到国内可达地址，顺手校准时区与 NTP。
   */
  async fixWifi(): Promise<string[]> {
    const entries: [string, string][] = [
      ['captive_portal_http_url', 'http://connect.rom.miui.com/generate_204'],
      ['captive_portal_https_url', 'https://connect.rom.miui.com/generate_204'],
      ['time_zone', 'Asia/Shanghai'],
      ['ntp_server', 'ntp1.aliyun.com'],
    ];

    const changes: Change[] = [];
    for (const [key] of entries) {
      changes.push(await this.#readBefore('global', key));
    }

    const writes = entries.map(([key, value]) => `settings put global ${key} ${quote(value)}`);
    await this.#apply('system', '修复 WiFi 验证', changes, writes);
    return entries.map(([key, value]) => `${key} = ${value}`);
  }

  /* ─────────────── 无极调节 ─────────────── */

  /** 读当前调节状态 */
  async tuning(): Promise<TuningState> {
    const values = await Promise.all(
      TUNABLE_KEYS.map(([scope, key]) =>
        this.#shell.text(`settings get ${scope} ${key}`, { log: false, allowFailure: true }),
      ),
    );
    const num = (index: number): number | null => {
      const text = values[index].trim();
      if (text === 'null' || text === '') return null;
      const parsed = Number(text);
      /*
       * 设备返回非数字时给 null 而不是 NaN。
       *
       * 这条不是防御性冗余：部分 ROM 的 settings 键不存在时返回空串以外的
       * 说明性文字，Number() 会得到 NaN。NaN 一旦流进上层，
       * 「字体 NaN×」这种提示会直接显示给用户，看起来像工具算错了。
       * 归成 null，上层就能统一显示成「未设置」。
       */
      return Number.isFinite(parsed) ? parsed : null;
    };
    return {
      fontScale: num(0),
      windowAnimation: num(1),
      transitionAnimation: num(2),
      animatorDuration: num(3),
      screenOffTimeout: num(4),
    };
  }

  /** 设置缩放/动画倍率 */
  async setTuning(
    key: 'font_scale' | 'window_animation_scale' | 'transition_animation_scale' | 'animator_duration_scale',
    value: unknown,
  ): Promise<string> {
    const allowed = [
      'font_scale',
      'window_animation_scale',
      'transition_animation_scale',
      'animator_duration_scale',
    ];
    if (!allowed.includes(key)) throw new Error('无效调节项目');
    const min = key === 'font_scale' ? 0.2 : 0;
    const num = assertNumber(value, min, 4, '倍率');
    const scope = key === 'font_scale' ? 'system' : 'global';

    const change = await this.#readBefore(scope, key);
    await this.#apply('system', '系统参数', [change], [
      `settings put ${scope} ${key} ${Number(num.toFixed(2))}`,
    ]);
    return `已设为 ${Number(num.toFixed(2))}`;
  }

  /** 设置自动锁屏时间（秒） */
  async setScreenTimeout(seconds: unknown): Promise<string> {
    const value = assertNumber(seconds, 1, 2147483, '秒数');
    const change = await this.#readBefore('system', 'screen_off_timeout');
    await this.#apply('system', '自动锁屏时间', [change], [
      `settings put system screen_off_timeout ${Math.round(value * 1000)}`,
    ]);
    return `已设为 ${Math.round(value)} 秒`;
  }

  /* ─────────────── 应急还原 ─────────────── */

  /**
   * 应急还原：把分辨率与密度强制拉回物理值，并清掉图标黑名单。
   *
   * 这是给「DPI 改成 1000，界面大到点不到按钮」准备的逃生通道。
   * 刻意不走快照 —— 快照本身也可能记的是错值，
   * 物理值（wm size reset 后的 Physical size）是唯一可靠的基准。
   */
  async emergencyRestore(): Promise<string> {
    await this.#shell.text('wm size reset', { log: false, allowFailure: true });
    await this.#shell.text('wm density reset', { log: false, allowFailure: true });
    await this.#shell.text('settings delete secure icon_blacklist', { log: false, allowFailure: true });
    await this.#shell.text('settings put system font_scale 1.0', { log: false, allowFailure: true });

    const status = await this.#shell.text('wm size', { log: false, allowFailure: true });
    const density = await this.#shell.text('wm density', { log: false, allowFailure: true });
    const sizeMatch = status.match(/Physical size:\s*(\d+x\d+)/i);
    const dpiMatch = density.match(/Physical density:\s*(\d+)/i);
    return `已还原到物理值：${sizeMatch?.[1] ?? '分辨率未知'} @ ${dpiMatch?.[1] ?? '?'} dpi`;
  }
}

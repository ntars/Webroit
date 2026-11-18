/**
 * 显示服务：分辨率、DPI、截图、按键模拟。
 *
 * 这些命令全部是 `wm` / `screencap` / `input`，
 * 属于 ADB shell 的标准能力，不需要 root。
 * 但部分厂商 ROM 需要额外开启「USB 调试（安全设置）」才能写 wm。
 */

import type { ShellContext } from '@/core/shell';
import type { DisplayInfo } from '@/core/utils';
import {
  assertInteger,
  assertNumber,
  baseName,
  parseDisplay,
  quote,
  safeFileName,
  timestamp,
} from '@/core/utils';
import { snapshots } from '@/core/snapshot';

/** 可模拟的按键 */
export interface KeyOption {
  label: string;
  code: number;
}

/** 常用按键表，避免用户去查 KEYCODE 表 */
export const COMMON_KEYS: KeyOption[] = [
  { label: '返回', code: 4 },
  { label: '主页', code: 3 },
  { label: '最近任务', code: 187 },
  { label: '电源', code: 26 },
  { label: '音量 +', code: 24 },
  { label: '音量 −', code: 25 },
  { label: '静音', code: 164 },
  { label: '菜单', code: 82 },
  { label: '相机', code: 27 },
  { label: '搜索', code: 84 },
  { label: '回车', code: 66 },
  { label: '退格', code: 67 },
  { label: '亮屏', code: 224 },
  { label: '熄屏', code: 223 },
  { label: '截屏', code: 120 },
];

export class DisplayService {
  #shell: ShellContext;

  constructor(shell: ShellContext) {
    this.#shell = shell;
  }

  /** 当前分辨率与 DPI */
  async status(): Promise<DisplayInfo> {
    const [size, density] = await Promise.all([
      this.#shell.text('wm size', { log: false, allowFailure: true }).catch(() => ''),
      this.#shell.text('wm density', { log: false, allowFailure: true }).catch(() => ''),
    ]);
    return parseDisplay(size, density);
  }

  /**
   * 改分辨率前先记原值。
   *
   * `wm size reset` 是最可靠的还原方式，但它会丢掉「用户之前设过的自定义值」。
   * 所以快照记的是「当前覆盖值」而不是 reset —— 这样一键还原能回到
   * 用户上次设定的状态，而不是物理分辨率。
   * 只有在没有覆盖值时（用的是物理值）才记 reset。
   */
  async setResolution(width: unknown, height: unknown): Promise<DisplayInfo> {
    const w = assertInteger(width, 100, 16384, '宽度');
    const h = assertInteger(height, 100, 16384, '高度');

    const before = await this.status();
    const restore = before.overridden && before.width && before.height
      ? [`wm size ${before.width}x${before.height}`]
      : ['wm size reset'];
    snapshots.record({
      module: 'display',
      label: `分辨率 ${before.width ?? '?'}×${before.height ?? '?'} → ${w}×${h}`,
      restore,
    });

    await this.#shell.mutation(`wm size ${w}x${h}`);
    return this.status();
  }

  /**
   * 设置显示密度。
   * unit=dp 时按「最小宽度 dp」换算成 DPI，更符合直觉。
   */
  async setDensity(value: unknown, unit: 'dpi' | 'dp' = 'dpi'): Promise<DisplayInfo> {
    let target = assertNumber(value, 1, 10000, unit === 'dp' ? '最小宽度' : 'DPI');
    const before = await this.status();
    if (unit === 'dp') {
      if (!before.width || !before.height) throw new Error('无法读取屏幕分辨率');
      target = Math.round((Math.min(before.width, before.height) * 160) / target);
    }
    const dpi = assertInteger(Math.round(target), 72, 1600, '目标 DPI');

    snapshots.record({
      module: 'display',
      label: `屏幕密度 ${before.dpi ?? '?'} → ${dpi} dpi`,
      restore: before.overridden && before.dpi ? [`wm density ${before.dpi}`] : ['wm density reset'],
    });

    await this.#shell.mutation(`wm density ${dpi}`);
    return this.status();
  }

  /** 重置分辨率或 DPI 到物理值 */
  async reset(kind: 'size' | 'density'): Promise<DisplayInfo> {
    await this.#shell.mutation(`wm ${kind} reset`);
    return this.status();
  }

  /** 截图，返回 PNG Blob 与文件名 */
  async screenshot(): Promise<{ blob: Blob; name: string; remote: string }> {
    const remote = `/sdcard/${timestamp()}.png`;
    await this.#shell.mutation(`screencap -p ${quote(remote)}`);

    const blob = await this.#shell.driver.read(remote);
    // 校验 PNG 魔数，防止拿到空文件或权限错误页面
    const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    const pngMagic = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!pngMagic.every((byte, index) => signature[index] === byte)) {
      throw new Error('截屏未返回有效 PNG 文件，已保留手机内原文件');
    }

    return { blob, name: baseName(remote), remote };
  }

  /** 删除设备上的临时截图 */
  async removeTemp(remote: string): Promise<void> {
    await this.#shell.text(`rm ${quote(remote)}`, { log: false, allowFailure: true });
  }

  /** 模拟按键 */
  async pressKey(code: number | string, longPress = false): Promise<string> {
    const value = String(code);
    if (!/^(?:\d+|KEYCODE_[A-Z_]+)$/.test(value)) {
      throw new Error('无效的按键编号');
    }
    return this.#shell.mutation(`input keyevent ${longPress ? '--longpress ' : ''}${value}`);
  }

  /** 模拟输入文本（仅 ASCII 安全，中文请用其他方案） */
  async inputText(text: string): Promise<string> {
    // input text 不支持空格与特殊字符，需转义成 %s
    const escaped = String(text).replace(/([\\()<>|;&*~`'"$ ])/g, '\\$1');
    return this.#shell.mutation(`input text ${quote(escaped)}`);
  }

  /** 模拟点击 */
  async tap(x: unknown, y: unknown): Promise<string> {
    const px = assertInteger(x, 0, 16384, '横坐标');
    const py = assertInteger(y, 0, 16384, '纵坐标');
    return this.#shell.mutation(`input tap ${px} ${py}`);
  }

  /** 模拟滑动 */
  async swipe(x1: unknown, y1: unknown, x2: unknown, y2: unknown, duration = 300): Promise<string> {
    const [a, b, c, d] = [
      assertInteger(x1, 0, 16384, '起点 X'),
      assertInteger(y1, 0, 16384, '起点 Y'),
      assertInteger(x2, 0, 16384, '终点 X'),
      assertInteger(y2, 0, 16384, '终点 Y'),
    ];
    const ms = assertInteger(duration, 0, 10000, '持续时间');
    return this.#shell.mutation(`input swipe ${a} ${b} ${c} ${d} ${ms}`);
  }

  /** 让截图文件名可安全落盘 */
  static safeScreenshotName(name: string): string {
    return safeFileName(name, 'screenshot.png');
  }
}

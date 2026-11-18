/**
 * 基础工具函数：命令转义、参数校验、解析器。
 *
 * 设计原则：
 * 所有值在拼接进 shell 命令前必须过校验，宁可抛错也不拼出半成品命令。
 * 因为 ADB shell 命令一旦注入成功，就能以 shell 用户身份操作整台设备。
 */

/** 单引号包裹，内部单引号转义为 '\'' —— POSIX shell 通用安全写法 */
export function quote(value: unknown): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** 校验包名格式，返回原值；非法则抛错 */
export function assertPackageName(value: unknown): string {
  const name = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(name)) {
    throw new Error(`请输入有效的软件包名，例如 com.android.settings（收到：${name || '空'}）`);
  }
  return name;
}

/** 校验数值范围 */
export function assertNumber(value: unknown, min: number, max: number, label = '数值'): number {
  const text = String(value ?? '').trim();
  const num = Number(text);
  if (text === '' || !Number.isFinite(num) || num < min || num > max) {
    throw new Error(`${label}应在 ${min} — ${max} 之间（收到：${text || '空'}）`);
  }
  return num;
}

/** 校验整数范围 */
export function assertInteger(value: unknown, min: number, max: number, label = '数值'): number {
  const num = assertNumber(value, min, max, label);
  if (!Number.isInteger(num)) throw new Error(`${label}必须是整数`);
  return num;
}

/** 文件名消毒：去掉各平台非法字符，限制长度 */
export function safeFileName(value: unknown, fallback = 'file'): string {
  const name = String(value ?? '')
    // 这里的控制字符范围是刻意写死的：文件名消毒本来就要吃掉 \u0000-\u001f，
    // 不是笔误，所以对本行关闭 no-control-regex。
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .slice(0, 160);
  return name || fallback;
}

/** 取路径最后一段 */
export function baseName(path: string): string {
  return String(path).replaceAll('\\', '/').split('/').pop() || '';
}

/** 时间戳，用于截图/导出文件命名：2026-11-15_14-03-22 */
export function timestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

/** 把 getprop 输出解析为键值对 */
export function parseProps(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of String(text).matchAll(/^\[([^\]]+)\]:\s*\[(.*)\]\s*$/gm)) {
    result[match[1]] = match[2];
  }
  return result;
}

/** 从 props 中挑出营销机型名，覆盖国内外主流厂商 */
export function pickDeviceName(props: Record<string, string>): string {
  const keys = [
    'ro.vendor.oplus.market.name',
    'ro.product.marketname',
    'ro.product.vendor.marketname',
    'ro.product.odm.marketname',
    'ro.vivo.market.name',
    'ro.vendor.vivo.market.name',
    'ro.config.marketing_name',
    'ro.vendor.oplus.market.enname',
    'ro.product.model',
  ];
  for (const key of keys) {
    const value = String(props[key] ?? '').trim();
    if (value && !/^(?:unknown|null|undefined)$/i.test(value)) return value;
  }
  return '未知机型';
}

/** 解析 `wm size` / `wm density` 输出 */
export interface DisplayInfo {
  width: number | null;
  height: number | null;
  dpi: number | null;
  /** 最小宽度 dp，等于 min(宽,高) * 160 / dpi */
  dp: number | null;
  physicalSize: string | null;
  physicalDpi: number | null;
  /** 是否存在用户覆盖值（说明改过分辨率/DPI） */
  overridden: boolean;
}

export function parseDisplay(sizeText: string, densityText: string): DisplayInfo {
  const sizes = [...String(sizeText).matchAll(/(Physical|Override) size:\s*(\d+)x(\d+)/gi)];
  const densities = [...String(densityText).matchAll(/(Physical|Override) density:\s*(\d+)/gi)];
  const current = sizes.at(-1);
  const currentDensity = densities.at(-1);
  const width = current ? Number(current[2]) : null;
  const height = current ? Number(current[3]) : null;
  const dpi = currentDensity ? Number(currentDensity[2]) : null;
  return {
    width,
    height,
    dpi,
    dp: width && height && dpi ? Math.round((Math.min(width, height) * 160) / dpi) : null,
    physicalSize: sizes[0] ? `${sizes[0][2]}x${sizes[0][3]}` : null,
    physicalDpi: densities[0] ? Number(densities[0][2]) : null,
    overridden: sizes.some((m) => m[1].toLowerCase() === 'override'),
  };
}

/** 解析 `dumpsys battery` 输出 */
export interface BatteryInfo {
  raw: string;
  level: number | null;
  /** 伏特 */
  voltage: number | null;
  /** 摄氏度 */
  temperature: number | null;
  acPowered: boolean;
  usbPowered: boolean;
  wirelessPowered: boolean;
  /** 电量统计是否已暂停（模拟电池时会暂停） */
  updatesStopped: boolean;
  fields: Record<string, string>;
}

export function parseBattery(text: string): BatteryInfo {
  const raw = String(text);
  const fields: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:]+):\s*(.*?)\s*$/);
    if (match) fields[match[1].trim().toLowerCase()] = match[2];
  }
  const num = (key: string): number | null => {
    const value = fields[key];
    if (value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const voltageRaw = num('voltage');
  const temperatureRaw = num('temperature');
  return {
    raw,
    level: num('level'),
    voltage: voltageRaw === null ? null : voltageRaw / 1000,
    temperature: temperatureRaw === null ? null : temperatureRaw / 10,
    acPowered: fields['ac powered'] === 'true',
    usbPowered: fields['usb powered'] === 'true',
    wirelessPowered: fields['wireless powered'] === 'true',
    updatesStopped: /updates stopped/i.test(raw),
    fields,
  };
}

/** 解析前台应用：优先看 Focus，退回 Activity 栈 */
export interface FocusInfo {
  package: string;
  activity: string;
}

export function parseFocus(text: string): FocusInfo {
  const lines = String(text).split(/\r?\n/);
  const preferred = lines.filter((line) =>
    /mCurrentFocus|mFocusedApp|mResumedActivity|topResumedActivity/.test(line),
  );
  for (const line of preferred) {
    const match = line.match(/\b([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)\/([\w.$]+)/);
    if (match) {
      return {
        package: match[1],
        activity: match[2].startsWith('.') ? match[1] + match[2] : match[2],
      };
    }
  }
  return { package: '', activity: '' };
}

/** 解析 CPU 各核当前频率（MHz） */
export interface CpuCore {
  id: number;
  mhz: number;
}

export function parseCpuFreq(text: string): CpuCore[] {
  return String(text)
    .trim()
    .split(/\r?\n/)
    .map((line) => line.match(/^(\d+):(\d+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ id: Number(match[1]), mhz: Math.round(Number(match[2]) / 1000) }))
    .sort((a, b) => a.id - b.id);
}

/** 秒数格式化为「X天X时X分」 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return (
    `${Math.floor(total / 86400)}天` +
    `${Math.floor((total % 86400) / 3600)}时` +
    `${Math.floor((total % 3600) / 60)}分`
  );
}

/** 字节格式化 */
export function formatBytes(bytes: number): string {
  let value = Number(bytes) || 0;
  for (const unit of ['B', 'KB', 'MB', 'GB', 'TB']) {
    if (value < 1024) return `${value.toFixed(value < 10 ? 1 : 0)} ${unit}`;
    value /= 1024;
  }
  return `${value.toFixed(1)} PB`;
}

/**
 * 把 Uint8Array 转成 ArrayBuffer，用于构造 Blob。
 *
 * 为什么要拷贝一次：
 * TypeScript 5.9 起 Uint8Array 的泛型参数默认是 ArrayBufferLike，
 * 而 BlobPart 只接受 ArrayBuffer 支撑的视图 —— 因为 SharedArrayBuffer
 * 不保证线程安全。直接传 Uint8Array 会编译失败，类型断言又能骗过检查
 * 但在 SharedArrayBuffer 场景下真的会出问题。
 * 拷进一块新的 ArrayBuffer 是唯一既通过类型检查、又保证语义正确的做法。
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

/** 把多段 Uint8Array 拼成一整块 */
export function joinBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** 按 shell 规则切分参数，支持单双引号与 \" 转义 */
export function splitArgs(input: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let quoteChar: string | null = null;
  let started = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '\\' && input[i + 1] === '"') {
      token += '"';
      i++;
      started = true;
    } else if (quoteChar) {
      if (char === quoteChar) quoteChar = null;
      else token += char;
      started = true;
    } else if (char === '"' || char === "'") {
      quoteChar = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) {
        tokens.push(token);
        token = '';
        started = false;
      }
    } else {
      token += char;
      started = true;
    }
  }
  if (quoteChar) throw new Error('命令中的引号未闭合');
  if (started) tokens.push(token);
  return tokens;
}

/** 命令结果里出现这些字样即视为失败 */
const FAILURE_PATTERN = /^(?:Failure\b|Error:|Exception occurred|Security exception|java\.lang\.|Permission denied)/im;

export function assertCommandSuccess(text: string): string {
  const trimmed = String(text ?? '').trim();
  if (FAILURE_PATTERN.test(trimmed)) throw new Error(trimmed);
  return text;
}

/** 可被 AbortSignal 打断的 sleep */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('操作已停止', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('操作已停止', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** AbortSignal 检查点 */
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('操作已停止', 'AbortError');
  }
}

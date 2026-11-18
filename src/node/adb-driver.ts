/**
 * 命令行侧的设备驱动：用本机 adb 说话，实现与浏览器 Driver 同一份契约。
 *
 * 为什么可以这么做：
 * services 层与 34 个工具从不直接调 adb，它们只经由 ShellContext.driver.exec()。
 * 所以只要在 Node 里把这七个方法填对，冻结应用、改 DPI、导出 APK
 * 这些业务逻辑一行都不用重写，全部原样跑在命令行下。
 *
 * 与浏览器侧的差异（必须说清楚，否则使用者会以为两边等价）：
 * - 浏览器走 WebUSB，把手机当 USB 设备直接对话，不依赖本机是否有 adb
 * - 命令行走本机 adb 二进制，需要已安装 platform-tools 并已 adb devices 可见
 * - 交互终端（PTY）在命令行里没有意义，openTerminal() 直接报错
 *
 * 退出码策略与浏览器侧一致：用哨兵串从 stdout 尾部回填。
 * 这不是多余 —— 老版本 adb 不把远端退出码传回来，靠 adb 自身退出码判断
 * 会把「命令失败」误判成「成功」。
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  DeviceDriver,
  ExecOptions,
  ShellResult,
  TerminalHandle,
  TransferOptions,
} from '@/core/transport/types';
import { checkAbort, joinBytes } from '@/core/utils';

/** 输出体积上限，与浏览器侧对齐 */
const STDOUT_LIMIT = 32 * 1024 * 1024;
const PULL_LIMIT = 768 * 1024 * 1024;

/** adb 可执行文件路径，可用 WEBROIT_ADB 覆盖（多版本 SDK 场景） */
function adbPath(): string {
  return process.env.WEBROIT_ADB?.trim() || 'adb';
}

/** 一次 adb 调用的结果 */
interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * 跑一条本机 adb 命令。
 *
 * 用 spawn 而不是 execFile，是为了两件事：
 * 1. 能按 chunk 回调，长命令的输出可以实时吐给调用方
 * 2. 能响应 AbortSignal 真正杀掉进程，而不是等它自己结束
 */
function runAdb(
  args: string[],
  options: { signal?: AbortSignal; onStdout?: (text: string) => void } = {},
): Promise<RunResult> {
  const { signal, onStdout } = options;
  return new Promise((resolve, reject) => {
    checkAbort(signal);

    const child = spawn(adbPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let settled = false;

    const onAbort = () => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(signal?.reason ?? new Error('操作已停止'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > STDOUT_LIMIT) {
        child.kill('SIGKILL');
        if (!settled) {
          settled = true;
          reject(new Error(`输出超过 ${Math.round(STDOUT_LIMIT / 1048576)} MB，请缩小命令范围`));
        }
        return;
      }
      out.push(chunk);
      onStdout?.(chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      reject(
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? new Error(
              '找不到 adb 命令。请先安装 Android platform-tools 并加入 PATH，' +
                '或用环境变量 WEBROIT_ADB 指定 adb 的完整路径',
            )
          : error,
      );
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
  });
}

/**
 * 把命令包上哨兵串，从 stdout 尾部取回远端退出码。
 *
 * 与浏览器侧的降级路径写法一致，保证两边语义相同：
 * 「命令本身成功但内容报错」与「命令退出码非零」在两边得到同样的判定。
 */
function wrapWithMarker(command: string, marker: string): string {
  return `(\n${command}\n); __webroit_status=$?; printf '\\n${marker}%s' "$__webroit_status"`;
}

/** 解析哨兵串，返回真实输出与退出码 */
function unwrapMarker(text: string, marker: string): { stdout: string; exitCode: number } | null {
  const at = text.lastIndexOf('\n' + marker);
  if (at < 0) return null;
  const exitCode = Number(text.slice(at + marker.length + 1).trim());
  if (!Number.isFinite(exitCode)) return null;
  return { stdout: text.slice(0, at), exitCode };
}

/** 一次性的临时目录 */
async function withTempDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'webroit-'));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * NodeDriver —— 命令行侧的一台已连接设备。
 *
 * 构造时不做任何 IO：所有校验推迟到第一次真正执行命令，
 * 这样「列出设备再决定连哪台」的流程不必先付出一次连接代价。
 */
export class NodeDriver implements DeviceDriver {
  readonly serial: string;
  readonly label: string;
  connected = true;

  constructor(serial: string, label: string) {
    this.serial = serial;
    this.label = label;
  }

  /** 本机 adb 的公共前缀参数 */
  get #base(): string[] {
    return ['-s', this.serial];
  }

  /**
   * 执行一条 shell 命令。
   *
   * 命令整体作为单个参数传给 adb：adb 会把 argv 用空格拼起来再送到设备，
   * 如果拆成多个参数，含引号或管道的命令会被本机 shell 语义曲解一次。
   */
  async exec(command: string, options: ExecOptions = {}): Promise<ShellResult> {
    const { signal, onStdout, onStderr } = options;
    if (!this.connected) throw new Error('设备已断开');

    const marker = `__WEBROIT_EXIT_${Math.random().toString(36).slice(2)}__`;
    const wrapped = wrapWithMarker(command, marker);

    const result = await runAdb([...this.#base, 'shell', wrapped], { signal, onStdout });

    // adb 自己失败（设备离线、未授权、序列号不存在）时不会有哨兵串
    const parsed = unwrapMarker(result.stdout, marker);
    if (!parsed) {
      const message = (result.stderr || result.stdout).trim();
      if (result.code !== 0 || /error|unauthorized|offline|not found/i.test(message)) {
        throw new Error(message || `adb 退出码 ${result.code}，未取得命令输出`);
      }
      // 输出里没有哨兵串但也没有错误：按原样返回，退出码未知
      onStderr?.(result.stderr);
      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.code };
    }

    // adb 层面的告警（如 daemon 启动提示）不算命令失败，单独转给 stderr 回调
    if (result.stderr.trim()) onStderr?.(result.stderr);
    return { stdout: parsed.stdout, stderr: result.stderr, exitCode: parsed.exitCode };
  }

  /**
   * 交互终端在命令行场景没有意义 —— 用户本身就在终端里。
   * 这里明确抛错，而不是返回一个假句柄让上层以为能用。
   */
  async openTerminal(): Promise<TerminalHandle> {
    throw new Error('命令行模式不支持交互终端，请直接使用 adb shell 或 webroit shell 单条命令');
  }

  /** 推送本地文件到设备 */
  async write(file: File, remotePath: string, options: TransferOptions = {}): Promise<void> {
    const { signal, onProgress } = options;
    if (!this.connected) throw new Error('设备已断开');
    checkAbort(signal);

    await withTempDir(async (dir) => {
      const local = join(dir, file.name || 'upload.bin');
      const bytes = Buffer.from(await file.arrayBuffer());
      await writeFile(local, bytes);
      onProgress?.(bytes.length, bytes.length);
      checkAbort(signal);

      const result = await runAdb([...this.#base, 'push', local, remotePath], { signal });
      if (result.code !== 0 || /error|failed/i.test(result.stderr)) {
        throw new Error((result.stderr || result.stdout).trim() || '推送失败');
      }
    });
  }

  /** 从设备拉取文件 */
  async read(remotePath: string, options: TransferOptions = {}): Promise<Blob> {
    const { signal, onProgress } = options;
    if (!this.connected) throw new Error('设备已断开');
    checkAbort(signal);

    return withTempDir(async (dir) => {
      const local = join(dir, 'pulled.bin');
      const result = await runAdb([...this.#base, 'pull', remotePath, local], { signal });
      if (result.code !== 0 || /error|failed|does not exist/i.test(result.stderr)) {
        throw new Error((result.stderr || result.stdout).trim() || `拉取失败：${remotePath}`);
      }

      const bytes = await readFile(local);
      if (bytes.length > PULL_LIMIT) {
        throw new Error(`文件超过 ${Math.round(PULL_LIMIT / 1048576)} MB，命令行模式请直接用 adb pull`);
      }
      onProgress?.(bytes.length, bytes.length);

      const type = /\.png$/i.test(remotePath)
        ? 'image/png'
        : /\.apk$/i.test(remotePath)
          ? 'application/vnd.android.package-archive'
          : 'application/octet-stream';
      // 拷一份到独立的 ArrayBuffer：Blob 需要独占的内存视图
      const copy = new Uint8Array(joinBytes([new Uint8Array(bytes)]));
      return new Blob([copy], { type });
    });
  }

  /**
   * 发一条原始 ADB 服务请求。
   *
   * 浏览器侧发的是裸服务串（tcpip:5555），命令行侧要翻成 adb 的子命令
   * （adb tcpip 5555）。这一步翻译只发生在这里，调用方仍然只认服务串。
   */
  async control(service: string): Promise<string> {
    if (!/^(?:tcpip:\d+|usb:|reboot:[\w-]*)$/.test(service)) {
      throw new Error('无效的设备服务');
    }

    const [name, value] = service.split(':');
    const args = [...this.#base, name];
    if (value) args.push(value);

    const result = await runAdb(args);
    if (result.code !== 0) {
      throw new Error((result.stderr || result.stdout).trim() || `服务 ${service} 执行失败`);
    }
    return result.stdout;
  }

  /** 重启设备 */
  async reboot(mode: string): Promise<void> {
    if (mode === 'poweroff') {
      // 与浏览器侧一致：poweroff 走 shell 的 reboot -p
      const result = await runAdb([...this.#base, 'shell', 'reboot -p']);
      if (result.code !== 0) throw new Error(result.stderr.trim() || '关机失败');
      this.connected = false;
      return;
    }
    const args = [...this.#base, 'reboot'];
    if (mode) args.push(mode);
    const result = await runAdb(args);
    if (result.code !== 0) throw new Error(result.stderr.trim() || '重启失败');
    this.connected = false;
  }

  /** 关闭连接：命令行侧没有长连接可关，只标记状态 */
  async close(): Promise<void> {
    this.connected = false;
  }
}

/** 一台本机 adb 可见的设备 */
export interface AdbDevice {
  serial: string;
  /** device | offline | unauthorized | ... */
  state: string;
  model?: string;
  product?: string;
  transport?: string;
}

/**
 * 列出本机 adb 可见的设备。
 *
 * 解析 `adb devices -l` 的固定列输出。状态不是 device 的行也保留 ——
 * 「未授权」和「离线」是需要告诉用户的具体原因，直接过滤掉只会让人困惑。
 */
export async function listDevices(): Promise<AdbDevice[]> {
  const result = await runAdb(['devices', '-l']);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || 'adb devices 执行失败');
  }

  return result.stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state, ...rest] = line.split(/\s+/);
      const extras: Record<string, string> = {};
      for (const token of rest) {
        const at = token.indexOf(':');
        if (at > 0) extras[token.slice(0, at)] = token.slice(at + 1);
      }
      const device: AdbDevice = { serial, state };
      if (extras.model) device.model = extras.model.replaceAll('_', ' ');
      if (extras.product) device.product = extras.product;
      if (extras.transport_id) device.transport = extras.transport_id;
      return device;
    });
}

/**
 * 按序列号或「唯一在线设备」挑选目标。
 *
 * 不做「有多台就随便挑一台」这种事 —— 改错别的手机的分辨率是不可逆的。
 * 多台时必须显式指定，这是安全底线，不是使用便利问题。
 */
export async function pickDevice(serial?: string): Promise<AdbDevice> {
  const devices = await listDevices();
  const online = devices.filter((device) => device.state === 'device');

  if (serial) {
    const found = devices.find((device) => device.serial === serial);
    if (!found) {
      throw new Error(
        `未找到序列号为 ${serial} 的设备。当前可见：${devices.map((d) => d.serial).join(', ') || '无'}`,
      );
    }
    if (found.state !== 'device') {
      throw new Error(
        `设备 ${serial} 当前状态为 ${found.state}。` +
          (found.state === 'unauthorized' ? '请在手机上点「允许 USB 调试」后重试' : '请重新插拔数据线'),
      );
    }
    return found;
  }

  if (online.length === 0) {
    const hint = devices.length
      ? `已探测到 ${devices.length} 台设备但都不可用（${devices
          .map((d) => `${d.serial}: ${d.state}`)
          .join('，')}）`
      : '未探测到任何设备';
    throw new Error(`${hint}。请确认数据线已连接、已开启 USB 调试，并执行 adb devices 检查`);
  }
  if (online.length > 1) {
    throw new Error(
      `检测到 ${online.length} 台在线设备，必须用 --serial 指定目标：` +
        online.map((d) => d.serial).join(', '),
    );
  }
  return online[0];
}

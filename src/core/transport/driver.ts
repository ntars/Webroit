/**
 * 传输层：把浏览器和手机之间的字节通道，封装成统一的 Driver。
 *
 * 分层边界（架构强制，见 docs/02-技术方案.md）：
 *   UI → services → session → transport
 * 本文件属于 transport，只关心「怎么把命令送到设备、把结果取回来」，
 * 不理解任何业务语义（不知道什么叫冻结应用、什么叫改 DPI）。
 *
 * 依赖全部动态 import：不插线、不进终端页的用户，一个字节都不用下载。
 *
 * 关于类型：`@yume-chan/*` 的 `.d.ts` 自带一套与 DOM 不一致的 `ReadableStream`
 * 声明形状 —— 但运行时它就是 `globalThis.ReadableStream`（见 `stream-extra/esm/stream.js`），
 * 两边是同一个类，差异只在声明上。所以这里**不做任何类型断言**，而是：
 *   1. 传输层内部一律用包自带的真实类型（`Adb` / `AdbSync` / `AdbSocket`）；
 *   2. 需要同时吃下 DOM 流与包内流的地方，用只描述「能拿 reader、能读、能放锁」的
 *      窄结构接口 `ByteSource`，两边都天然满足，无需强转；
 *   3. 把 DOM 流交给包的方法时（`sync.write`），用包自己的构造函数重新包一层，
 *      运行时零拷贝（同一个构造器），类型上两侧都对。
 */

import {
  baseName,
  checkAbort,
  toArrayBuffer,
} from '@/core/utils';
import { collect } from '@/core/transport/stream';
import type {
  DeviceDriver,
  ExecOptions,
  ShellResult,
  TerminalHandle,
  TransferOptions,
} from '@/core/transport/types';
import type { Adb, AdbDaemonConnection, AdbSync } from '@yume-chan/adb';
import type { AdbDaemonWebUsbDevice } from '@yume-chan/adb-daemon-webusb';

// 类型从 types.ts 统一出口再导出，历史调用点（import from '@/core/transport/driver'）无需改动
export type { ExecOptions, ShellResult, TerminalHandle, TransferOptions };

/** 设备授权取消 */
export interface ConnectOptions {
  /** 已授权过的设备对象，可从 `listAuthorizedDevices()` 取得；不传则弹选择框 */
  device?: AdbDaemonWebUsbDevice;
  signal?: AbortSignal;
}

/** 读取流的体积上限，防止一条命令把内存撑爆 */
const PULL_LIMIT = 768 * 1024 * 1024;

/** UTF-8 编解码器，流式使用 */
const decoder = () => new TextDecoder();

/**
 * Driver —— 一台已连接设备的操作句柄（WebUSB 实现）。
 *
 * 只暴露四个原语：执行命令、读写文件、发原始服务请求、关闭。
 * 所有业务能力都由上层 services 用这四个原语组合出来。
 *
 * implements DeviceDriver：命令行侧的 NodeDriver 实现同一份契约，
 * 因此 services 与工具层在两种传输上完全共用。
 */
export class Driver implements DeviceDriver {
  /** 设备序列号 */
  readonly serial: string;
  /** 展示名（通常是机型） */
  readonly label: string;
  /** 连接是否存活 */
  connected = true;

  /** 底层 ADB 会话，只有 session 层做能力探测时会用到 */
  #adb: Adb;
  #closeOwned: () => Promise<void>;
  #sessions = new Set<AdbSync>();
  #terminals = new Set<TerminalHandle>();
  #closing?: Promise<void>;
  #disconnected: Promise<void>;

  constructor(
    adb: Adb,
    options: { serial?: string; label?: string; closeOwned?: () => Promise<void> },
  ) {
    this.#adb = adb;
    this.serial = options.serial || adb.serial || '';
    this.label = options.label || this.serial;
    this.#closeOwned = options.closeOwned ?? (async () => {});
    this.#disconnected = adb.disconnected.then(
      () => {
        this.connected = false;
      },
      (error: unknown) => {
        this.connected = false;
        throw error;
      },
    );
    // 断开事件可能无人等待，先吞掉异常避免 unhandled rejection
    this.#disconnected.catch(() => {});
  }

  /** 拿到底层 adb 实例（仅限 session 层做能力探测） */
  get raw(): Adb {
    return this.#adb;
  }

  /**
   * 执行一条 shell 命令。
   *
   * 两条路径：
   * 1. 设备支持 shell 协议 → 直接 spawn，能拿到真实退出码，stdout/stderr 分离。
   * 2. 只支持 none 协议（老设备）→ 用哨兵串把退出码回填到 stdout 尾部再解析。
   */
  async exec(command: string, options: ExecOptions = {}): Promise<ShellResult> {
    const { signal, onStdout, onStderr } = options;
    checkAbort(signal);

    const subprocess = this.#adb.subprocess;
    const shellProtocol = subprocess.shellProtocol;

    if (shellProtocol) {
      const process = await shellProtocol.spawn(command, signal);
      const outDecoder = decoder();
      const errDecoder = decoder();
      const jobs = [
        collect(process.stdout, {
          onChunk: onStdout
            ? (bytes) => {
                const text = outDecoder.decode(bytes, { stream: true });
                if (text) onStdout(text);
              }
            : undefined,
        }),
        collect(process.stderr, {
          onChunk: onStderr
            ? (bytes) => {
                const text = errDecoder.decode(bytes, { stream: true });
                if (text) onStderr(text);
              }
            : undefined,
        }),
        process.exited,
        process.stdin.close(),
      ] as const;

      try {
        const [stdout, stderr, exitCode] = await Promise.all(jobs);
        const outTail = outDecoder.decode();
        const errTail = errDecoder.decode();
        if (outTail) onStdout?.(outTail);
        if (errTail) onStderr?.(errTail);
        return {
          stdout: decoder().decode(stdout),
          stderr: decoder().decode(stderr),
          exitCode,
        };
      } catch (error) {
        await Promise.resolve(process.kill()).catch(() => {});
        await Promise.allSettled(jobs);
        throw error;
      }
    }

    // 降级路径：哨兵串回填退出码
    const marker = `__WEBROIT_EXIT_${crypto.randomUUID().replaceAll('-', '')}__`;
    const wrapped = `(\n${command}\n); __webroit_status=$?; printf '\\n${marker}%s' "$__webroit_status"`;
    const process = await subprocess.noneProtocol.spawn(wrapped, signal);
    const jobs = [collect(process.output), process.exited, process.stdin.close()] as const;
    try {
      const [bytes] = await Promise.all(jobs);
      const text = decoder().decode(bytes);
      const at = text.lastIndexOf('\n' + marker);
      if (at < 0) throw new Error('设备没有返回命令退出状态');
      const exitCode = Number(text.slice(at + marker.length + 1).trim());
      if (!Number.isFinite(exitCode)) throw new Error('设备返回了无效退出状态');
      return { stdout: text.slice(0, at), stderr: '', exitCode };
    } catch (error) {
      await Promise.resolve(process.kill()).catch(() => {});
      await Promise.allSettled(jobs);
      throw error;
    }
  }

  /**
   * 打开一个 PTY 交互终端（xterm 用）。
   * 注意：PTY 会话挂在本 Driver 上，Driver 关闭时会被统一杀掉。
   */
  async openTerminal(): Promise<TerminalHandle> {
    const subprocess = this.#adb.subprocess;
    const pty = subprocess.shellProtocol
      ? await subprocess.shellProtocol.pty({ terminalType: 'xterm-256color' })
      : await subprocess.noneProtocol.pty();

    if (!this.connected) {
      await Promise.resolve(pty.kill()).catch(() => {});
      throw new Error('设备已断开');
    }

    // 两种协议（shell / none）的 pty 退出码类型不同（number / undefined），
    // 收窄成统一的 TerminalHandle 后再挂监听，避免在联合类型上调 .then。
    const handle: TerminalHandle = {
      kill: () => pty.kill(),
      exited: pty.exited,
    };
    this.#terminals.add(handle);
    Promise.resolve(handle.exited).then(
      () => this.#terminals.delete(handle),
      () => this.#terminals.delete(handle),
    );
    return handle;
  }

  /**
   * 在一次 sync 会话里完成读写，结束后一定释放。
   * sync 通道是独占的：不 dispose 会让后续所有文件操作卡死。
   */
  async #withSync<T>(work: (sync: AdbSync) => Promise<T>, signal?: AbortSignal): Promise<T> {
    checkAbort(signal);
    const sync = await this.#adb.sync();
    this.#sessions.add(sync);

    let abortReject: (reason?: unknown) => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      abortReject = reject;
    });

    const onAbort = () => {
      void sync.dispose().catch(() => {});
      abortReject(signal?.reason ?? new DOMException('操作已停止', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    // 不把收尾放在 finally 里抛错：finally 中的 throw 会覆盖 try 里的原始异常，
    // 让真正的失败原因（例如设备拔线）被一句「dispose 失败」盖掉。
    // 这里先把结果收进变量，收尾做完再决定抛哪个错。
    let result: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      checkAbort(signal);
      result = { ok: true, value: await Promise.race([work(sync), aborted]) };
    } catch (error) {
      result = { ok: false, error };
    }

    signal?.removeEventListener('abort', onAbort);
    this.#sessions.delete(sync);

    let disposeError: unknown;
    let disposeFailed = false;
    try {
      await sync.dispose();
    } catch (error) {
      disposeError = error;
      disposeFailed = true;
    }

    // 主操作失败 → 原样抛出原始错误，释放阶段的错误只作旁支忽略（它多半是同一个原因引起的）；
    // 主操作成功但释放失败 → 数据可能没刷进设备，必须让调用方知道，抛释放错误。
    if (!result.ok) throw result.error;
    if (disposeFailed) throw disposeError;
    return result.value;
  }

  /** 推送本地文件到设备 */
  async write(file: File, remotePath: string, options: TransferOptions = {}): Promise<void> {
    const { signal, onProgress } = options;
    const libs = await loadLibs();
    await this.#withSync(async (sync) => {
      // 文件流是 DOM 的 ReadableStream，sync.write 要的是包内的流类型。
      // 运行时两者是同一个构造器（stream-extra 直接导出 globalThis.ReadableStream），
      // 所以这里用包自己的构造器重新包一层，语义等价、零拷贝，两侧类型都成立。
      const reader = file.stream().getReader();
      let sent = 0;
      const source = new libs.stream.ReadableStream<Uint8Array>({
        async pull(controller) {
          checkAbort(signal);
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          sent += value.length;
          onProgress?.(sent, file.size);
          controller.enqueue(value);
        },
        cancel() {
          void reader.cancel().catch(() => {});
        },
      });
      await sync.write({
        filename: remotePath,
        file: source,
        permission: 0o644,
        mtime: Math.floor((file.lastModified || Date.now()) / 1000),
      });
      onProgress?.(file.size, file.size);
    }, signal);
  }

  /** 从设备拉取文件到内存 */
  async read(remotePath: string, options: TransferOptions = {}): Promise<Blob> {
    const { signal, onProgress } = options;
    return this.#withSync(async (sync) => {
      let total = 0;
      try {
        total = Number((await sync.lstat(remotePath)).size);
      } catch {
        // 拿不到大小不影响读取，进度退化为「已读字节数」
      }
      const bytes = await collect(sync.read(remotePath), {
        limit: PULL_LIMIT,
        onProgress: (done) => {
          checkAbort(signal);
          onProgress?.(done, total);
        },
      });
      const type = /\.png$/i.test(remotePath)
        ? 'image/png'
        : /\.apk$/i.test(remotePath)
          ? 'application/vnd.android.package-archive'
          : 'application/octet-stream';
      return new Blob([toArrayBuffer(bytes)], { type });
    }, signal);
  }

  /** 发一条原始 ADB 服务请求（tcpip / usb / reboot 等） */
  async control(service: string): Promise<string> {
    if (!/^(?:tcpip:\d+|usb:|reboot:[\w-]*)$/.test(service)) {
      throw new Error('无效的设备服务');
    }
    const socket = await this.#adb.createSocket(service);
    try {
      return decoder().decode(await collect(socket.readable, { limit: 1024 * 1024 }));
    } finally {
      await Promise.resolve(socket.close()).catch(() => {});
    }
  }

  /** 重启设备，poweroff 走 shell 的 reboot -p */
  async reboot(mode: string): Promise<void> {
    if (mode === 'poweroff') {
      try {
        await this.exec('reboot -p');
      } catch (error) {
        if (this.connected) throw error;
      }
      return;
    }
    const socket = await this.#adb.createSocket('reboot:' + mode);
    await Promise.resolve(socket.close()).catch(() => {});
  }

  /** 关闭连接，杀掉所有终端与 sync 会话 */
  async close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.connected = false;
    this.#closing = (async () => {
      for (const pty of this.#terminals) {
        await Promise.resolve(pty.kill()).catch(() => {});
      }
      this.#terminals.clear();
      for (const session of this.#sessions) {
        await session.dispose().catch(() => {});
      }
      try {
        await this.#adb.close();
      } finally {
        await this.#closeOwned();
      }
    })();
    return this.#closing;
  }
}

/* ─────────────────────────── 依赖加载 ─────────────────────────── */

/**
 * 四个 ADB 依赖的命名空间。
 *
 * 全部用 `typeof import()` 取真实类型 —— 它由动态 import 的返回值直接推导，
 * 不需要手写形状，也不会因为包升级而失真。
 */
interface Libs {
  adb: typeof import('@yume-chan/adb');
  stream: typeof import('@yume-chan/stream-extra');
  usb: typeof import('@yume-chan/adb-daemon-webusb');
  CredentialStore: typeof import('@yume-chan/adb-credential-web').default;
  /** WebUSB 管理器；浏览器不支持 WebUSB 时为 undefined */
  manager: typeof import('@yume-chan/adb-daemon-webusb').AdbDaemonWebUsbDeviceManager.BROWSER;
}

let libsPromise: Promise<Libs> | null = null;

/**
 * 按需加载 Tango WebADB 依赖。
 * 用动态 import 是为了让首屏不背 ADB 全套的包体。
 */
async function loadLibs(): Promise<Libs> {
  if (libsPromise) return libsPromise;
  libsPromise = (async () => {
    const [adbLib, streamLib, usbLib, credentialLib] = await Promise.all([
      import('@yume-chan/adb'),
      import('@yume-chan/stream-extra'),
      import('@yume-chan/adb-daemon-webusb'),
      import('@yume-chan/adb-credential-web'),
    ]);

    // 自检：确保流依赖是同一个实例，否则 Consumable 判定会失效
    const probe = new Uint8Array([1]);
    const consumable = new streamLib.Consumable(probe);
    if (streamLib.MaybeConsumable.getValue(consumable) !== probe) {
      throw new Error('流依赖实例不一致，请检查依赖版本');
    }

    return {
      adb: adbLib,
      stream: streamLib,
      usb: usbLib,
      CredentialStore: credentialLib.default,
      manager: usbLib.AdbDaemonWebUsbDeviceManager.BROWSER,
    };
  })();
  return libsPromise;
}

/* ─────────────────────────── 连接流程 ─────────────────────────── */

/** 当前环境是否支持 WebUSB */
export function isWebUsbSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator;
}

/**
 * 认证并建立 ADB 会话。
 * 手机端会弹出「允许 USB 调试」授权框，60 秒不操作即视为超时。
 *
 * 返回已构造好的 Driver —— 调用方不要再自己 new 一层，
 * 否则会把 Driver 当成 transport 传进去。
 */
async function authenticate(
  connection: AdbDaemonConnection,
  serial: string,
  closeOwned: () => Promise<void>,
  signal: AbortSignal | undefined,
  managerName: string,
  label: string,
): Promise<Driver> {
  checkAbort(signal);
  const libs = await loadLibs();

  let cancelled = false;
  let rejectCancel: (reason?: unknown) => void = () => {};
  const cancelPromise = new Promise<never>((_, reject) => {
    rejectCancel = reject;
  });

  const onCancel = () => {
    cancelled = true;
    void closeOwned().catch(() => {});
    rejectCancel(signal?.reason ?? new Error('认证超时，请在手机上允许 USB 调试后重试'));
  };
  const timer = setTimeout(onCancel, 60_000);
  signal?.addEventListener('abort', onCancel, { once: true });

  const auth = libs.adb.AdbDaemonTransport.authenticate({
    serial,
    connection,
    credentialStore: new libs.CredentialStore(managerName),
  });
  // 若已取消，认证成功后也要立刻关掉，避免泄漏
  auth.then(
    (transport) => {
      if (cancelled) void Promise.resolve(transport.close()).catch(() => {});
    },
    () => {},
  );

  try {
    const transport = await Promise.race([auth, cancelPromise]);
    checkAbort(signal);
    return new Driver(new libs.adb.Adb(transport), { serial, label, closeOwned });
  } catch (error) {
    cancelled = true;
    await closeOwned().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCancel);
  }
}

/** 列出浏览器已授权过的设备（不弹选择框） */
export async function listAuthorizedDevices(): Promise<AdbDaemonWebUsbDevice[]> {
  const libs = await loadLibs();
  if (!libs.manager) return [];
  return libs.manager.getDevices();
}

/** 通过 WebUSB 连接设备（会弹出浏览器的设备选择框） */
export async function connectUsb(options: ConnectOptions = {}): Promise<Driver> {
  const libs = await loadLibs();
  const { signal, device } = options;

  if (!libs.manager) {
    throw new Error(
      '当前浏览器不支持 WebUSB，请使用 Chrome / Edge，并通过 HTTPS 或 localhost 打开页面',
    );
  }

  const selected: AdbDaemonWebUsbDevice | undefined =
    device ?? (await libs.manager.requestDevice());
  if (!selected) throw new DOMException('未选择设备', 'AbortError');
  checkAbort(signal);

  const close = () => selected.raw.close();
  try {
    const connection = await selected.connect();
    checkAbort(signal);
    return await authenticate(
      connection,
      selected.serial,
      close,
      signal,
      'Webroit',
      selected.name || selected.serial,
    );
  } catch (error) {
    await close().catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    // 用 instanceof 判 busy：该错误类由包导出，比读 name 字符串可靠
    // （name 会被压缩器、跨 iframe 等情形改掉）。
    if (
      error instanceof libs.usb.AdbDaemonWebUsbDevice.DeviceBusyError ||
      /already.*use|claim.*interface/i.test(message)
    ) {
      throw new Error('当前 ADB 接口被占用，请结束本机 adb.exe 进程或其他 WebADB 页面后重试');
    }
    throw error;
  }
}

/** 清理 IndexedDB 里缓存的 ADB 密钥 */
export async function clearAdbKeys(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('Tango');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('密钥数据库被其他标签页占用，请关闭其他 WebADB 页面后重试'));
  });
}

export { baseName };

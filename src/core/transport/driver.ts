/**
 * 传输层：把浏览器和手机之间的字节通道，封装成统一的 Driver。
 *
 * 分层边界（架构强制，见 docs/02-技术方案.md）：
 *   UI → services → session → transport
 * 本文件属于 transport，只关心「怎么把命令送到设备、把结果取回来」，
 * 不理解任何业务语义（不知道什么叫冻结应用、什么叫改 DPI）。
 *
 * 依赖全部动态 import：不插线、不进终端页的用户，一个字节都不用下载。
 */

import {
  baseName,
  checkAbort,
  joinBytes,
  toArrayBuffer,
} from '@/core/utils';
import type {
  DeviceDriver,
  ExecOptions,
  ShellResult,
  TerminalHandle,
  TransferOptions,
} from '@/core/transport/types';

// 类型从 types.ts 统一出口再导出，历史调用点（import from '@/core/transport/driver'）无需改动
export type { ExecOptions, ShellResult, TerminalHandle, TransferOptions };

/** 设备授权取消 */
export interface ConnectOptions {
  device?: unknown;
  signal?: AbortSignal;
}

/** 读取流的体积上限，防止一条命令把内存撑爆 */
const STDOUT_LIMIT = 32 * 1024 * 1024;
const PULL_LIMIT = 768 * 1024 * 1024;

/** UTF-8 编解码器，流式使用 */
const decoder = () => new TextDecoder();

/**
 * 把 ReadableStream 全量读进内存，附带体积上限与进度回调。
 */
async function collect(
  readable: ReadableStream<Uint8Array>,
  options: {
    limit?: number;
    onProgress?: (size: number) => void;
    onChunk?: (chunk: Uint8Array) => void;
  } = {},
): Promise<Uint8Array> {
  const { limit = STDOUT_LIMIT, onProgress, onChunk } = options;
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.length;
      if (size > limit) {
        throw new Error(
          `输出超过 ${Math.round(limit / 1048576)} MB，请缩小命令范围或停止长时间运行的命令`,
        );
      }
      chunks.push(value);
      onProgress?.(size);
      onChunk?.(value);
    }
    return joinBytes(chunks);
  } finally {
    reader.releaseLock();
  }
}

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

  #adb: any;
  #closeOwned: () => Promise<void>;
  #sessions = new Set<any>();
  #terminals = new Set<TerminalHandle>();
  #closing?: Promise<void>;
  #disconnected: Promise<void>;

  constructor(
    adb: any,
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
  get raw(): any {
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
        await process.kill().catch(() => {});
        await Promise.allSettled(jobs as unknown as Promise<unknown>[]);
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
      await process.kill().catch(() => {});
      await Promise.allSettled(jobs as unknown as Promise<unknown>[]);
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
      await pty.kill();
      throw new Error('设备已断开');
    }

    const handle: TerminalHandle = {
      kill: () => pty.kill(),
      exited: pty.exited,
    };
    this.#terminals.add(handle);
    pty.exited.then(
      () => this.#terminals.delete(handle),
      () => this.#terminals.delete(handle),
    );
    return handle;
  }

  /**
   * 在一次 sync 会话里完成读写，结束后一定释放。
   * sync 通道是独占的：不 dispose 会让后续所有文件操作卡死。
   */
  async #withSync<T>(work: (sync: any) => Promise<T>, signal?: AbortSignal): Promise<T> {
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
    await this.#withSync(async (sync) => {
      let done = 0;
      const source = file.stream().pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            checkAbort(signal);
            done += chunk.length;
            onProgress?.(done, file.size);
            controller.enqueue(chunk);
          },
        }),
      );
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
      await socket.close().catch(() => {});
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
    await socket.close().catch(() => {});
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

interface Libs {
  adb: any;
  stream: any;
  usb: any;
  CredentialStore: any;
  manager: any;
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
    const consumable = new (streamLib as any).Consumable(probe);
    if ((streamLib as any).MaybeConsumable.getValue(consumable) !== probe) {
      throw new Error('流依赖实例不一致，请检查依赖版本');
    }

    return {
      adb: adbLib,
      stream: streamLib,
      usb: usbLib,
      CredentialStore: (credentialLib as any).default,
      manager: (usbLib as any).AdbDaemonWebUsbDeviceManager.BROWSER,
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
  connection: any,
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
    (transport: any) => {
      if (cancelled) void transport.close().catch(() => {});
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
export async function listAuthorizedDevices(): Promise<unknown[]> {
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

  const selected: any = device ?? (await libs.manager.requestDevice());
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
    if (
      (error as any)?.name === 'DeviceBusyError' ||
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

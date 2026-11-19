/**
 * Shell 封装：给 services 层一个「说人话」的命令执行入口。
 *
 * 这一层存在的唯一理由，是解决一个具体问题：
 * 早期实现里按顺序 await stdout 再 await stderr，遇到输出量大的命令会死锁 ——
 * 设备端写满管道缓冲后阻塞，浏览器端还在等 stderr，双方互相等。
 * 所以这里强制 stdout / stderr / exit 三者并行读取。
 *
 * 顺带统一了三件事：
 * 1. 命令日志（可关闭，用于后台轮询类调用避免刷屏）
 * 2. 失败即抛错（可用 allowFailure 关闭，用于「探测型」命令）
 * 3. 检查点与取消（长命令能被打断）
 */

import type { DeviceDriver, ShellResult } from '@/core/transport/types';
import { assertCommandSuccess, checkAbort } from '@/core/utils';

/** 命令输出流类型 */
export type OutputChannel = 'command' | 'result' | 'stderr' | 'info';

/** 输出回调 */
export type OutputSink = (channel: OutputChannel, text: string) => void;

/** 进度回调 */
export type ProgressSink = (name: string, done: number, total: number) => void;

/** Shell 调用选项 */
export interface ShellOptions {
  /** 是否输出命令日志，默认 true。后台轮询请传 false */
  log?: boolean;
  signal?: AbortSignal;
  /** 命令失败是否不抛错，默认 false */
  allowFailure?: boolean;
  /** 超时毫秒数，超时后中断 */
  timeout?: number;
}

/**
 * 命令以非零退出码结束。
 *
 * 用独立的错误类承载 exitCode，而不是往 Error 上挂一个 any 属性：
 * 上层要判断「是命令跑失败了，还是连接断了」时，instanceof 比字符串匹配可靠。
 */
export class ShellCommandError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.name = 'ShellCommandError';
    this.exitCode = exitCode;
  }
}

/** Shell 上下文的构造参数 */
export interface ShellContextOptions {
  driver: DeviceDriver;
  output?: OutputSink;
  progress?: ProgressSink;
}

/**
 * ShellContext —— 命令执行的统一门面。
 *
 * services 层的每个业务方法都长这样：
 *   async freezeApp(name) {
 *     return this.mutation(`pm disable-user --user 0 ${assertPackageName(name)}`);
 *   }
 * 业务里不出现任何 await 读取流、退出码判断的样板代码。
 */
export class ShellContext {
  readonly driver: DeviceDriver;

  #output: OutputSink;
  #progress: ProgressSink;
  #abort = new AbortController();

  /**
   * 最近执行过的命令环形缓冲。
   *
   * 存在的理由：审计日志要记「这次操作实际跑了哪些命令」，
   * 但让每个 service 方法手动上报命令既啰嗦又容易漏。
   * 这里统一在出口收一份，审计侧按序号窗口取走即可。
   * 上限 200 条足够一次操作使用，也避免长时间会话无限积累。
   */
  #recentCommands: { seq: number; command: string }[] = [];

  /** 命令自增序号。时间戳在同一毫秒内不可区分，序号可以 */
  #commandSeq = 0;

  constructor(options: ShellContextOptions) {
    this.driver = options.driver;
    this.#output = options.output ?? (() => {});
    this.#progress = options.progress ?? (() => {});
  }

  /** 当前命令序号水位。调用方记下它，事后用它划出「本次操作执行了哪些命令」 */
  commandMark(): number {
    return this.#commandSeq;
  }

  /**
   * 取序号大于 mark 的命令（去重、保序）。
   *
   * 用序号而不是时间戳做边界：两次操作可能落在同一毫秒内
   * （脚本连续执行、用户连点），时间戳切不干净 ——
   * 上一次操作的最后一条命令会漏进这一次的审计记录里。
   */
  commandsSince(mark: number): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of this.#recentCommands) {
      if (item.seq <= mark || seen.has(item.command)) continue;
      seen.add(item.command);
      result.push(item.command);
    }
    return result;
  }

  /** 中止当前上下文里所有进行中的命令 */
  abort(reason?: unknown): void {
    this.#abort.abort(reason);
  }

  /**
   * 这个上下文是否已被中止。
   *
   * 存在的理由是一个实测出来的缺口：批量操作是「一轮 for 循环里逐条 await」，
   * 每条命令自己会响应 signal，但**循环本身不响应** —— 拔线之后正在跑的那条
   * 会很快失败，循环却接着处理下一条，于是后面 N 条命令一条条发往一条已经
   * 死掉的 USB 链路，每条都要等到超时才返回。用户看到的是「拔线后界面还在
   * 转，转了两分钟」，审计里则躺着 N 条注定失败的记录。
   *
   * 所以循环需要一个「该不该继续下一条」的判据。用只读布尔而不是让循环
   * 自己 await signal：循环体是同步的，加 await 会改变调用时序，
   * 而这里要的只是一次开关检查。
   */
  get aborted(): boolean {
    return this.#abort.signal.aborted;
  }

  /**
   * 这个上下文的取消信号，供调用方把「可能永远不返回的一次调用」包成可中止的。
   *
   * 为什么光有 `aborted` 布尔不够：批量循环的判据只在两条命令**之间**生效，
   * 而真正卡人的是正在等的那一条 —— USB 链路死掉时底层 `spawn` 的 Promise
   * 可能既不 resolve 也不 reject，signal 透下去也没用。所以循环需要
   * `shell.signal` 去和这次调用 `Promise.race`，谁先有结果算谁。
   */
  get signal(): AbortSignal {
    return this.#abort.signal;
  }

  /** 每次调用都拿一个新的复合 signal：外部 signal 与内部 abort 谁先触发都生效 */
  #composeSignal(signal?: AbortSignal): AbortSignal {
    if (!signal) return this.#abort.signal;
    // AbortSignal.any 在 Chrome 116+ 可用，WebUSB 场景下浏览器版本足够新。
    // 运行时仍做一次存在性判断，避免个别内核缺失时直接抛错。
    if (typeof AbortSignal.any === 'function') {
      return AbortSignal.any([signal, this.#abort.signal]);
    }
    // 兜底：手动桥接
    const controller = new AbortController();
    const forward = () => controller.abort(signal.reason ?? this.#abort.signal.reason);
    if (signal.aborted || this.#abort.signal.aborted) forward();
    else {
      signal.addEventListener('abort', forward, { once: true });
      this.#abort.signal.addEventListener('abort', forward, { once: true });
    }
    return controller.signal;
  }

  /**
   * 执行 shell 命令，并行读流，返回完整结果。
   */
  async shell(command: string, options: ShellOptions = {}): Promise<ShellResult> {
    const { log = true, signal, allowFailure = false, timeout } = options;
    const effective = this.#composeSignal(signal);
    checkAbort(effective);

    // 不论是否输出日志都记命令 —— 审计依赖它，与显示偏好无关
    this.#recentCommands.push({ seq: ++this.#commandSeq, command });
    if (this.#recentCommands.length > 200) {
      this.#recentCommands.splice(0, this.#recentCommands.length - 200);
    }

    if (log) this.#output('command', `$ adb shell ${command}`);

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let timeoutController: AbortController | undefined;

    if (timeout && timeout > 0) {
      timeoutController = new AbortController();
      timeoutTimer = setTimeout(
        () => timeoutController?.abort(new Error(`命令超时（${timeout} ms）`)),
        timeout,
      );
    }

    const finalSignal = timeoutController
      ? typeof AbortSignal.any === 'function'
        ? AbortSignal.any([effective, timeoutController.signal])
        : effective
      : effective;

    let streamedOut = false;
    let streamedErr = false;

    try {
      const result = await this.driver.exec(command, {
        signal: finalSignal,
        onStdout: log
          ? (text) => {
              streamedOut = true;
              this.#output('result', text);
            }
          : undefined,
        onStderr: log
          ? (text) => {
              streamedErr = true;
              this.#output('stderr', text);
            }
          : undefined,
      });

      if (log) {
        if (result.stdout && !streamedOut) this.#output('result', result.stdout.trimEnd());
        if (result.stderr && !streamedErr) this.#output('stderr', result.stderr.trimEnd());
        if (!result.stdout && !result.stderr) {
          this.#output('result', `（无输出，退出码 ${result.exitCode ?? '未知'}）`);
        }
      }

      const failed =
        result.exitCode !== undefined && result.exitCode !== null && result.exitCode !== 0;

      if (failed && !allowFailure) {
        const message = (result.stderr || result.stdout || `命令退出码 ${result.exitCode}`).trim();
        throw new ShellCommandError(message, result.exitCode as number);
      }

      return result;
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
  }

  /** 只要 stdout，失败抛错 */
  async text(command: string, options: ShellOptions = {}): Promise<string> {
    return (await this.shell(command, options)).stdout;
  }

  /**
   * 状态变更型命令。
   * 额外检查输出里是否含 Failure / Permission denied 等字样 ——
   * 有些命令退出码是 0，但内容是错误说明。
   */
  async mutation(command: string, options: ShellOptions = {}): Promise<string> {
    return assertCommandSuccess(await this.text(command, options));
  }

  /** 只要 stdout，且允许失败（探测用），失败时返回空串 */
  async probe(command: string, signal?: AbortSignal): Promise<string> {
    try {
      return await this.text(command, { log: false, signal, allowFailure: true });
    } catch {
      return '';
    }
  }

  /** 进度上报入口，交给 services 用 */
  reportProgress(name: string, done: number, total: number): void {
    this.#progress(name, done, total);
  }

  /** 手动输出一条信息（不是命令结果） */
  info(text: string): void {
    this.#output('info', text);
  }
}

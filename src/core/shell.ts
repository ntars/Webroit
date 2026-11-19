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
import { assertCommandSuccess, checkAbort, raceAbort } from '@/core/utils';

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
   * 在途的「操作级」取消信号。
   *
   * 与 `#abort` 的区别是生命周期：`#abort` 一响这条连接就废了（永久），
   * 这里的信号随一次操作生灭 —— 用户点卡片上的「中止」只该停这一次，
   * 不该把整条连接一起废掉（那样后续所有操作都会立刻失败）。
   */
  #scoped = new Set<AbortSignal>();

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
    /*
     * 三个来源都要合：
     * 1. `this.#abort`      —— 连接级。拔线时整条会话一起停。
     * 2. `signal`           —— 单次调用级。某个调用点自己传进来的。
     * 3. `#scoped`          —— 操作级。`runScoped()` 登记的那一段操作。
     *
     * 第 3 个是 T-019 补的：在这之前，工具卡片上的「中止」只能停住卡片自己
     * 那一次 await，服务层内部发出的命令根本不知道有这回事 —— 按钮看着生效
     * （界面停了转圈），底层命令照跑，直到自己回来或 USB 超时。
     */
    const all = [
      this.#abort.signal,
      ...(signal ? [signal] : []),
      ...this.#scoped,
    ].filter((item, index, list) => list.indexOf(item) === index);

    // 只有一根信号时不必包一层，省一个对象
    if (all.length === 1) return all[0];

    // AbortSignal.any 在 Chrome 116+ 可用，WebUSB 场景下浏览器版本足够新。
    // 运行时仍做一次存在性判断，避免个别内核缺失时直接抛错。
    if (typeof AbortSignal.any === 'function') {
      return AbortSignal.any(all);
    }
    // 兜底：手动桥接
    const controller = new AbortController();
    const forward = () => controller.abort(all.find((item) => item.aborted)?.reason);
    if (all.some((item) => item.aborted)) forward();
    else {
      for (const item of all) item.addEventListener('abort', forward, { once: true });
    }
    return controller.signal;
  }

  /**
   * 把「一段操作」的取消信号登记进上下文，操作期间发出的所有命令都认它。
   *
   * 为什么需要这一层，而不是让每个工具自己把 signal 传下去：
   * 26 个工具里**只有 2 个**（`files.install` / `files.transfer`）真的把
   * `ToolContext.signal` 交给了服务层，其余 24 个都写 `run({ input })`，
   * 直接 `requireServices().apps.disable(...)`。命令最终都走 `shell()`，
   * 而 `shell()` 只认自己的 `#abort` 与调用点显式传的 signal ——
   * 于是「冻结一个应用」这类操作，卡片上的「中止」按钮完全打不到它。
   *
   * 与其给 24 个工具逐个补 signal 参数（新增一个工具又漏一个），
   * 不如在出口登记一次：`runScoped()` 期间发出的命令自动组合这个信号。
   * 这是「能力是不是所有调用方都需要」的判据 —— 是，就收到出口。
   *
   * 作用域结束（成功 / 失败 / 中止）就注销，不会污染下一次操作。
   */
  async runScoped<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
    if (!signal) return work();
    this.#scoped.add(signal);

    /*
     * 注销必须挂在**内层任务真正结束**上，不能挂在 race 的结果上。
     *
     * 这件事是测试打红之后才看清的：race 输掉时（用户点了中止）外层立刻
     * 拿到控制权并跑 finally，如果在那里注销，内层那段代码其实还在往下跑 ——
     * 它后面再发的命令就都落在作用域之外，一条条照发不误。表现为「界面已经
     * 停了，日志里还在出新命令」，正是这个按钮最初要解决的问题。
     *
     * 所以改成：注销挂在内层的 finally 上；外层只负责把控制权还给调用方。
     * 内层从被中止到真正退出这段时间里，它发起的命令仍会被拦在出口。
     */
    const settle = (async () => {
      try {
        return await work();
      } finally {
        this.#scoped.delete(signal);
      }
    })();

    /*
     * 这里也要 race：命令层已经在 `shell()` 里 race 过了，但工具里还有
     * 不经过命令的等待（文件分块上传、采样间隔 sleep）。只在命令层 race
     * 的话，卡在分块上传里那一步照样停不下来。
     */
    return raceAbort(settle, this.#composeSignal());
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
      /*
       * 这里必须 race 一次取消信号，不能直接 await。
       *
       * 把 signal 透传给驱动是必要的，但不充分：数据线被拔掉之后，
       * 底层 `spawn()` 返回的 Promise 可能既不 resolve 也不 reject ——
       * 谁来兑现它？没有谁。于是 `await` 会一直挂着，直到 USB 传输超时
       * （按秒计，实测能到两分钟）。
       *
       * 这一层是唯一的收口点：services 层的 76 处命令调用全部经过 `shell()`，
       * 在这里 race 一次，等于一次性覆盖所有调用点。上一轮（T-017）只把批量
       * 循环外面包了 `raceAbort`，单条冻结 / 启用、显示调节、文件传输这些
       * 走的还是裸 await —— 同一个洞，只是少有人撞上。
       *
       * race 输掉的那一侧不会真正取消底层命令（做不到），但调用方拿回了
       * 控制权，不会卡死在一次已经没有意义的等待上；底层残留的 Promise 由
       * 驱动自己的断线清理收尾（`raceAbort` 内部已挂 catch 防 unhandled）。
       */
      const result = await raceAbort(
        this.driver.exec(command, {
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
        }),
        finalSignal,
      );

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

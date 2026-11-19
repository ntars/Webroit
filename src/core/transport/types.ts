/**
 * 传输层契约。
 *
 * 为什么要单独一个文件：
 * 浏览器侧的 Driver 用 WebUSB 说话，命令行侧用本机 adb 说话 ——
 * 两者实现完全不同，但上层（ShellContext → services → 工具）只认这几个方法。
 * 把契约抽出来，services 与 34 个工具就能在两种传输上原样运行，一行都不用改。
 *
 * 注意：这里只放类型，不放实现。浏览器侧 driver.ts 仍负责 WebUSB 那一整套，
 * 命令行侧 node/driver.ts 负责 child_process 那套，互不 import。
 */

/** shell 命令执行结果 */
export interface ShellResult {
  stdout: string;
  stderr: string;
  /** 部分设备/协议拿不到退出码，此时为 undefined */
  exitCode?: number;
}

/** 命令执行回调 */
export interface ExecOptions {
  signal?: AbortSignal;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
}

/** 传输进度回调 */
export interface TransferOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/** 终端会话句柄的最小接口 */
export interface TerminalHandle {
  kill(): Promise<unknown> | unknown;
  exited: Promise<unknown>;
}

/**
 * 一台已连接设备的操作句柄。
 *
 * 这七个成员就是全部接口面 —— 上层任何能力都由它们组合出来。
 * 新增传输实现时，只要把这七个方法填对，services 与工具层无需改动。
 */
export interface DeviceDriver {
  /** 设备序列号 */
  readonly serial: string;
  /** 展示名（通常是机型） */
  readonly label: string;
  /** 连接是否存活 */
  connected: boolean;

  /** 执行一条 shell 命令 */
  exec(command: string, options?: ExecOptions): Promise<ShellResult>;
  /** 打开交互终端。命令行场景不支持，实现可抛错 */
  openTerminal(): Promise<TerminalHandle>;
  /** 推送本地文件到设备 */
  write(file: File, remotePath: string, options?: TransferOptions): Promise<void>;
  /** 从设备拉取文件 */
  read(remotePath: string, options?: TransferOptions): Promise<Blob>;
  /** 发一条原始 ADB 服务请求（tcpip / usb / reboot 等） */
  control(service: string): Promise<string>;
  /** 重启设备 */
  reboot(mode: string): Promise<void>;
  /** 关闭连接 */
  close(): Promise<void>;

  /**
   * 等待「连接被意外中断」。
   *
   * 为什么需要它：拔线之后 `connected` 会变成 false，但那是一个被动字段，
   * 没有任何人盯着它看 —— 用户看到的是「界面还在，点什么都报错」。
   * 这个 Promise 在连接真断掉时兑现，让上层能在断线瞬间把界面切回未连接态
   * 并说明原因，而不是等用户自己发现所有按钮都失灵。
   *
   * 可选：命令行侧没有长连接，不必实现。
   */
  whenDisconnected?(): Promise<void>;
}

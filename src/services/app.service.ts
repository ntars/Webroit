/**
 * 应用服务：包列表、冻结/启用、卸载、清数据、提取 APK。
 *
 * 全部走 `pm` / `cmd package` / `am` / `monkey` 标准命令，
 * 不需要 root，也不需要 Shizuku —— 这正是 Webroit 的能力边界。
 *
 * 一条重要的边界说明：
 * 「冻结」用的是 `pm disable-user --user 0`，效果等价于停用应用，
 * 应用会从桌面消失且不再后台运行，执行 `pm enable` 即可完全恢复。
 * 这不是 root 级的「深度冻结」，但对绝大多数使用场景已经够用。
 */

import type { ShellContext } from '@/core/shell';
import { assertPackageName, quote, raceAbort } from '@/core/utils';

/** 应用条目 */
export interface PackageEntry {
  /** 包名 */
  name: string;
  /** 是否系统应用 */
  system: boolean;
  /** 是否已停用（冻结） */
  disabled: boolean;
  /** 是否已卸载但保留数据（pm uninstall -k 的结果） */
  uninstalled?: boolean;
}

/** 应用详情 */
export interface PackageDetail {
  name: string;
  versionName: string;
  versionCode: string;
  targetSdk: string;
  minSdk: string;
  /** 安装时间（设备本地时间字符串） */
  firstInstallTime: string;
  lastUpdateTime: string;
  /** APK 路径，多路径说明是 split APK */
  paths: string[];
  /** 申请的危险权限 */
  permissions: string[];
  /** 是否系统应用 */
  system: boolean;
}

/** 批量操作的单条结果 */
export interface BatchResult {
  name: string;
  success: boolean;
  message: string;
  /**
   * 这一条根本没执行。
   *
   * 与 `success: false` 分开的原因：连接在批量途中中断时，剩下的项既没成功
   * 也没失败 —— 命令压根没发出去。把两者混成一个「失败」，用户会去排查
   * 那些包的权限或存储问题，而真正的原因是线掉了。
   */
  skipped?: boolean;
}

/**
 * 批量中途停下时，剩余项的原因文案。
 *
 * 写清「没执行」而不是「失败」，用户才知道不用去查这些包本身。
 */
const STOPPED_MESSAGE = '连接已中断，这一条没有执行';

/** uninstallLock 的 service call 事务号，按 API 等级对应 */
const UNINSTALL_LOCK_TRANSACTION: Record<number, number> = {
  25: 145,
  26: 151,
  27: 151,
  28: 152,
  29: 151,
  30: 156,
  31: 136,
  32: 136,
  33: 133,
  34: 134,
  35: 138,
  36: 139,
};

export class AppService {
  #shell: ShellContext;
  #sdk: number;

  constructor(shell: ShellContext, sdk: number) {
    this.#shell = shell;
    this.#sdk = sdk;
  }

  /** 列出全部包名 */
  async listPackages(): Promise<string[]> {
    const output = await this.#shell.text('pm list packages', { log: false });
    return output
      .split(/\r?\n/)
      .map((line) => line.replace(/^package:/, '').trim())
      .filter((name) => /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(name))
      .sort();
  }

  /**
   * 列出应用并带上状态。
   * 用 `pm list packages -f -d -s -u` 一次性拿全信息再合并，
   * 避免对每个包单独查（几百个包会卡几十秒）。
   */
  async listWithState(): Promise<PackageEntry[]> {
    const [allText, disabledText, systemText, uninstalledText] = await Promise.all([
      this.#shell.text('pm list packages', { log: false }),
      this.#shell.text('pm list packages -d', { log: false, allowFailure: true }),
      this.#shell.text('pm list packages -s', { log: false, allowFailure: true }),
      this.#shell.text('pm list packages -u', { log: false, allowFailure: true }),
    ]);

    const parse = (text: string): Set<string> =>
      new Set(
        text
          .split(/\r?\n/)
          .map((line) => line.replace(/^package:/, '').trim())
          .filter(Boolean),
      );

    const all = parse(allText);
    const disabled = parse(disabledText);
    const system = parse(systemText);
    const withUninstalled = parse(uninstalledText);

    return [...all]
      .sort()
      .map((name) => ({
        name,
        system: system.has(name),
        disabled: disabled.has(name),
        // 出现在 -u 里但不在默认列表里，说明是「已卸载保留数据」
        uninstalled: withUninstalled.has(name) && !all.has(name),
      }));
  }

  /** 查 APK 路径，多路径 = split APK */
  async paths(name: string): Promise<string[]> {
    const packageName = assertPackageName(name);
    const text = await this.#shell.text(`pm path ${quote(packageName)}`, { log: false });
    const paths = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith('package:'))
      .map((line) => line.slice(8).trim());
    if (!paths.length) throw new Error(`${packageName} 未安装或无权访问`);
    return paths;
  }

  /** 应用详情 */
  async detail(name: string): Promise<PackageDetail> {
    const packageName = assertPackageName(name);
    const [infoText, paths, systemText] = await Promise.all([
      this.#shell.text(`dumpsys package ${quote(packageName)}`, { log: false }),
      this.paths(packageName),
      this.#shell.text('pm list packages -s', { log: false, allowFailure: true }),
    ]);

    const pick = (pattern: RegExp): string => infoText.match(pattern)?.[1]?.trim() || '—';

    // 申请的危险权限：dumpsys 里 requested permissions 段落下的行
    const permissions: string[] = [];
    const permSection = infoText.split(/requested permissions:/)[1]?.split(/\n\s*\n/)[0] ?? '';
    for (const line of permSection.split(/\r?\n/)) {
      const match = line.match(/^\s*(android\.permission\.[A-Z_]+)\s*$/);
      if (match) permissions.push(match[1]);
    }

    return {
      name: packageName,
      versionName: pick(/versionName=([^\s]+)/),
      versionCode: pick(/versionCode=(\d+)/),
      targetSdk: pick(/targetSdk=(\d+)/),
      minSdk: pick(/minSdk=(\d+)/),
      firstInstallTime: pick(/firstInstallTime=(.+)/),
      lastUpdateTime: pick(/lastUpdateTime=(.+)/),
      paths,
      permissions,
      system: systemText.split(/\r?\n/).some((line) => line.trim() === `package:${packageName}`),
    };
  }

  /** 是否能以「当前用户」维度操作该包（系统应用的限制更多） */
  async isSystemPackage(name: string): Promise<boolean> {
    const packageName = assertPackageName(name);
    const text = await this.#shell.text('pm list packages -s', { log: false, allowFailure: true });
    return text.split(/\r?\n/).some((line) => line.trim() === `package:${packageName}`);
  }

  /* ─────────────────── 单项操作 ─────────────────── */

  /** 启用应用（解冻） */
  async enable(name: string): Promise<string> {
    const packageName = assertPackageName(name);
    return this.#shell.mutation(`pm enable --user 0 ${quote(packageName)}`);
  }

  /** 停用应用（冻结） */
  async disable(name: string): Promise<string> {
    const packageName = assertPackageName(name);
    return this.#shell.mutation(`pm disable-user --user 0 ${quote(packageName)}`);
  }

  /** 启动应用 */
  async launch(name: string): Promise<string> {
    const packageName = assertPackageName(name);
    return this.#shell.mutation(
      `monkey -p ${quote(packageName)} -c android.intent.category.LAUNCHER 1`,
    );
  }

  /** 强行停止 */
  async forceStop(name: string): Promise<string> {
    const packageName = assertPackageName(name);
    return this.#shell.mutation(`am force-stop ${quote(packageName)}`);
  }

  /** 清除全部数据 */
  async clearData(name: string): Promise<string> {
    const packageName = assertPackageName(name);
    return this.#shell.mutation(`pm clear --user 0 ${quote(packageName)}`);
  }

  /**
   * 卸载。
   * - 系统应用加 `-k` 保留数据，便于随时 install-existing 恢复
   * - 普通应用直接卸干净
   */
  async uninstall(name: string): Promise<string> {
    const packageName = assertPackageName(name);
    const isSystem = await this.isSystemPackage(packageName);
    return this.#shell.mutation(
      `pm uninstall ${isSystem ? '-k ' : ''}--user 0 ${quote(packageName)}`,
    );
  }

  /** 卸载但保留数据 */
  async uninstallKeepData(name: string): Promise<string> {
    const packageName = assertPackageName(name);
    return this.#shell.mutation(`pm uninstall -k --user 0 ${quote(packageName)}`);
  }

  /** 恢复被卸载的系统应用（Android 7+ 的 cmd package） */
  async restore(name: string): Promise<string> {
    const packageName = assertPackageName(name);
    return this.#shell.mutation(`cmd package install-existing --user 0 ${quote(packageName)}`);
  }

  /**
   * 读 / 写「卸载锁定」标记。
   *
   * 这是 Android 隐藏的 PackageManager 接口，只能用 service call 调，
   * 且事务号随 API 版本变化，所以按版本映射。
   * 不支持时明确报错，不猜测。
   */
  async uninstallLock(name: string, value?: boolean): Promise<boolean> {
    const packageName = assertPackageName(name);
    const transaction = UNINSTALL_LOCK_TRANSACTION[this.#sdk];
    if (!transaction) {
      throw new Error(`当前 Android API ${this.#sdk} 没有可验证的卸载限制接口，已停止操作`);
    }
    if (await this.isSystemPackage(packageName)) {
      throw new Error('卸载锁定仅适用于第三方应用');
    }
    await this.paths(packageName);

    if (value === undefined) {
      const result = await this.#shell.text(
        `service call package ${transaction + 1} s16 ${quote(packageName)} i32 0`,
        { log: false },
      );
      const words = [...result.matchAll(/\b([0-9a-f]{8})\b/gi)].map((m) => parseInt(m[1], 16));
      // 第一个返回值是状态码，第二个是布尔结果
      if (words[0] !== 0 || ![0, 1].includes(words[1])) {
        throw new Error('系统返回的卸载限制状态无法识别，未执行修改');
      }
      return Boolean(words[1]);
    }

    await this.#shell.mutation(
      `service call package ${transaction} s16 ${quote(packageName)} i32 ${value ? 1 : 0} i32 0`,
    );
    // 回读校验，确认系统真的接受了修改
    const actual = await this.uninstallLock(packageName);
    if (actual !== value) throw new Error('系统未接受卸载限制修改');
    return actual;
  }

  /* ─────────────────── 批量操作 ─────────────────── */

  /**
   * 批量操作。逐条执行并收集结果，单个失败不影响后续。
   * 通过 onProgress 回传进度，UI 可以显示进度条。
   *
   * **连接中断即停手**：每条之前检查 `#shell.aborted`，一旦为真就把剩余项
   * 标记为「未执行」并退出循环，不再向已经断开的链路发命令。
   *
   * 为什么这件事不能只靠 signal：单条命令自己会响应中断（`shell()` 内部
   * 把 signal 透给驱动），但**循环是同步的**，前一条抛错被 catch 之后
   * 它会毫不犹豫地开始下一条。拔线时那个 catch 里捕获的很可能是
   * 「设备已断开」，然后循环继续跑 50 条 —— 每条都要等 USB 超时。
   * 所以需要一次显式的开关检查，而不是指望异常自己把循环打断。
   */
  async batch(
    names: string[],
    action: 'enable' | 'disable' | 'uninstall' | 'clearData' | 'forceStop',
    onProgress?: (done: number, total: number, current: string) => void,
  ): Promise<BatchResult[]> {
    /** 单条动作，抽成闭包是为了能整体 race 一次取消信号 */
    const runOne = async (name: string): Promise<string> => {
      switch (action) {
        case 'enable':
          return this.enable(name);
        case 'disable':
          return this.disable(name);
        case 'uninstall':
          return this.uninstall(name);
        case 'clearData':
          return this.clearData(name);
        case 'forceStop':
          return this.forceStop(name);
      }
    };

    const results: BatchResult[] = [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];

      // 连接已结束：剩下的一次性标记为「未执行」并退出，不再朝死链路发命令
      if (this.#shell.aborted) {
        for (const rest of names.slice(i)) {
          results.push({ name: rest, success: false, skipped: true, message: STOPPED_MESSAGE });
        }
        break;
      }

      onProgress?.(i, names.length, name);
      try {
        /*
         * 单条动作包成可中止的。
         *
         * 为什么循环里的 `aborted` 检查还不够：那条检查只在两条命令**之间**
         * 生效，而拔线时正卡着的是当前这一条 —— 底层 spawn 的 Promise
         * 可能永远不兑现（数据线都没了，谁来回它？）。所以要 race 一次信号，
         * 让断线能立刻把控制权拿回来，而不是等 USB 超时。
         */
        const output = await raceAbort(runOne(name), this.#shell.signal);
        results.push({ name, success: true, message: output.trim() || '成功' });
      } catch (error) {
        results.push({
          name,
          success: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    /*
     * 中途停下时不要把进度推到满 —— 那会让进度条走到 100% 然后弹一条
     * 「剩余 26 个没执行」，两句话互相打脸。停下就停在停下的位置。
     */
    if (!this.#shell.aborted) onProgress?.(names.length, names.length, '');
    return results;
  }
}

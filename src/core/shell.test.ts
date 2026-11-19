/**
 * `ShellContext` 单元测试。
 *
 * 这一层是所有业务命令的唯一出口（services 层 76 处调用都经过它），
 * 所以它的取消语义必须在这里钉死，而不是指望每个调用点自己处理。
 *
 * 重点覆盖：**正在执行的那一条命令能不能被打断**。
 *
 * 为什么这条值得单独立测：拔线时底层 `driver.exec()` 返回的 Promise
 * 可能既不 resolve 也不 reject —— 数据线都拔了，谁来兑现它？
 * 如果 `shell()` 只是 `await` 它，那么 76 个调用点每一个都会卡在上面，
 * 直到 USB 超时（按秒计，实测能到两分钟）。
 *
 * 上一轮（T-017）只在批量循环外层包了 `raceAbort`，单条路径仍然是裸 await。
 * 这里用一个「永不兑现」的假驱动把那个洞量化出来。
 */

import { describe, expect, it } from 'vitest';

import { ShellContext, ShellCommandError } from '@/core/shell';
import type { DeviceDriver, ShellResult } from '@/core/transport/types';

/** 只实现 exec 的假驱动，其余方法不该被 shell 层碰到 */
function makeDriver(exec: DeviceDriver['exec']): DeviceDriver {
  return {
    serial: 'TEST0001',
    label: '测试设备',
    connected: true,
    exec,
    openTerminal: async () => {
      throw new Error('测试环境不提供终端');
    },
    write: async () => {},
    read: async () => new Blob([]),
    control: async () => '',
    // 签名要求一个 mode 参数，这里不会被调用，只为满足接口
    reboot: async (_mode: string) => {},
    close: async () => {},
  } as DeviceDriver;
}

const ok = (stdout = 'Success'): ShellResult => ({ stdout, stderr: '', exitCode: 0 });

/**
 * 等一个 Promise，但最多等 ms 毫秒。
 *
 * 用它而不是直接 await：被测缺陷的表现就是「永不返回」，
 * 直接 await 会让整个用例挂到 vitest 默认超时才报错，
 * 输出里只剩一句超时，看不出是哪一个断言失败。
 */
function within<T>(
  work: Promise<T>,
  ms = 300,
): Promise<{ state: 'done'; value: T } | { state: 'failed'; error: unknown } | { state: 'hung' }> {
  return Promise.race([
    work.then(
      (value) => ({ state: 'done' as const, value }),
      // 拒绝也是「返回了」—— 被测的就是「有没有拿回控制权」，不是成功与否
      (error: unknown) => ({ state: 'failed' as const, error }),
    ),
    new Promise<{ state: 'hung' }>((resolve) => setTimeout(() => resolve({ state: 'hung' }), ms)),
  ]);
}

/** 造一个「永不兑现」的 Promise，模拟链路死掉后的驱动 */
const neverSettles = () => new Promise<ShellResult>(() => {});

describe('ShellContext 取消语义', () => {
  it('上下文未中止时 aborted 为 false，signal 未触发', () => {
    const shell = new ShellContext({ driver: makeDriver(async () => ok()) });
    expect(shell.aborted).toBe(false);
    expect(shell.signal.aborted).toBe(false);
  });

  it('abort() 之后 aborted 变 true，signal 同步触发', () => {
    const shell = new ShellContext({ driver: makeDriver(async () => ok()) });
    shell.abort(new Error('设备连接已结束'));
    expect(shell.aborted).toBe(true);
    expect(shell.signal.aborted).toBe(true);
  });

  it('已中止的上下文直接拒绝，不发命令出去', async () => {
    let sent = 0;
    const shell = new ShellContext({
      driver: makeDriver(async () => {
        sent += 1;
        return ok();
      }),
    });
    shell.abort(new Error('设备连接已结束'));

    await expect(shell.text('echo hi')).rejects.toThrow();
    // 关键：不是「发出去再失败」，而是压根没发 —— 死链路上多发一条就是多等一次超时
    expect(sent).toBe(0);
  });

  it('正在执行的那一条命令能被 abort 打断（不等底层 Promise 兑现）', async () => {
    const shell = new ShellContext({ driver: makeDriver(() => neverSettles()) });

    const running = shell.text('pm list packages');
    // 给 shell() 一点时间真正进入 await 状态，再模拟拔线
    await new Promise((r) => setTimeout(r, 20));
    shell.abort(new Error('设备连接已结束'));

    const outcome = await within(running, 500);
    // 必须「有结论」——挂着不动就是缺陷本身
    expect(outcome.state).toBe('failed');
    if (outcome.state === 'failed') {
      expect(String((outcome.error as Error)?.message)).toMatch(/设备连接已结束/);
    }
  });

  it('mutation() 同样能被打断，且不把中断报成「命令失败」', async () => {
    const shell = new ShellContext({ driver: makeDriver(() => neverSettles()) });

    const running = shell.mutation('pm disable-user --user 0 com.example');
    await new Promise((r) => setTimeout(r, 20));
    shell.abort(new Error('设备连接已结束'));

    const outcome = await within(running, 500);
    expect(outcome.state).toBe('failed');
    if (outcome.state === 'failed') {
      // 中断不是「命令在设备上执行失败」—— 两者出口完全不同：
      // 前者去查数据线，后者去查权限 / 系统版本
      expect(outcome.error).not.toBeInstanceOf(ShellCommandError);
    }
  });

  it('未中止时正常返回结果，取消机制不干扰成功路径', async () => {
    const shell = new ShellContext({ driver: makeDriver(async () => ok('com.a\ncom.b')) });
    expect(await shell.text('pm list packages')).toBe('com.a\ncom.b');
  });

  it('命令非零退出码仍然抛 ShellCommandError', async () => {
    const shell = new ShellContext({
      driver: makeDriver(async () => ({ stdout: '', stderr: 'Permission denied', exitCode: 1 })),
    });
    await expect(shell.text('pm disable-user com.example')).rejects.toBeInstanceOf(ShellCommandError);
  });

  it('allowFailure 为真时不抛错，把退出码交给调用方判断', async () => {
    const shell = new ShellContext({
      driver: makeDriver(async () => ({ stdout: 'no', stderr: '', exitCode: 1 })),
    });
    const result = await shell.shell('cmd package help', { allowFailure: true });
    expect(result.exitCode).toBe(1);
  });

  it('probe() 吞掉异常返回空串（探测型命令不该打断流程）', async () => {
    const shell = new ShellContext({
      driver: makeDriver(async () => {
        throw new Error('device offline');
      }),
    });
    expect(await shell.probe('which screencap')).toBe('');
  });
});

describe('ShellContext 命令留痕', () => {
  it('commandMark 之后能按序号切出本次执行的命令', async () => {
    const shell = new ShellContext({ driver: makeDriver(async () => ok()) });
    await shell.text('echo one');

    const mark = shell.commandMark();
    await shell.text('echo two');
    await shell.text('echo three');

    expect(shell.commandsSince(mark)).toEqual(['echo two', 'echo three']);
  });

  it('同一条命令重复执行只记一次，避免审计里堆重复行', async () => {
    const shell = new ShellContext({ driver: makeDriver(async () => ok()) });
    const mark = shell.commandMark();
    await shell.text('wm size');
    await shell.text('wm size');
    expect(shell.commandsSince(mark)).toEqual(['wm size']);
  });
});

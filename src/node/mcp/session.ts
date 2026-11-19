/**
 * 设备会话缓存。
 *
 * MCP server 是长期进程，每次调用都重连 adb 并重跑 10 条能力探测太浪费；
 * 但缓存又不能永久有效 —— 数据线拔掉后连接就失效了。
 * 策略：懒连接 + 复用 + 失败即丢弃重连一次。
 *
 * 另一个容易漏的点：工具通过 `requireServices()` 拿服务，浏览器在 main.tsx 里
 * 绑了一次，这里必须自己绑一次，否则每个工具都报「设备未连接」。
 */

import { NodeDriver, pickDevice } from '@/node/adb-driver';
import { createServices, type Services } from '@/services/index';
import { DeviceSession, probeCapabilities } from '@/core/session/device-session';
import { bindServices } from '@/tools/builtin';

/** 一次已建立的运行时 */
interface Runtime {
  session: DeviceSession;
  services: Services;
  close: () => Promise<void>;
}

export class SessionHolder {
  #runtime: Runtime | null = null;
  #connecting: Promise<Runtime> | null = null;

  /** 取当前会话，没有就建一个 */
  async get(): Promise<{ session: DeviceSession; services: Services }> {
    if (this.#runtime) return this.#runtime;
    if (this.#connecting) return this.#connecting;

    this.#connecting = (async () => {
      const serial = process.env.WEBROIT_SERIAL?.trim() || undefined;
      const device = await pickDevice(serial);
      const driver = new NodeDriver(device.serial, device.model ?? device.serial);
      try {
        const capabilities = await probeCapabilities(driver);
        const session = new DeviceSession(driver, capabilities);
        const services = createServices(session, {
          // 协议通道是 stdout，日志只能走 stderr，否则会破坏 JSON-RPC
          output: (channel, text) => {
            if (channel === 'command') process.stderr.write(`[adb] ${text.trim()}\n`);
            else if (channel === 'stderr') process.stderr.write(`[adb:err] ${text.trim()}\n`);
          },
        });

        bindServices(() => services);

        const runtime: Runtime = {
          session,
          services,
          close: async () => {
            await driver.close().catch(() => {});
          },
        };
        this.#runtime = runtime;
        return runtime;
      } catch (error) {
        await driver.close().catch(() => {});
        throw error;
      } finally {
        this.#connecting = null;
      }
    })();

    return this.#connecting;
  }

  /** 丢弃缓存（执行失败后调用，下次会重连） */
  async reset(): Promise<void> {
    const current = this.#runtime;
    this.#runtime = null;
    if (current) await current.close().catch(() => {});
  }

  async close(): Promise<void> {
    await this.reset();
  }
}

/**
 * 连接链路：从「请求 USB 权限」到「服务就绪」唯一的一份实现。
 *
 * 为什么必须只有一份：
 * 这条链路有五个必须按序完成的步骤 —— 请求设备 → 认证 → 探测能力 →
 * 建服务 → 挂断线监听。少任何一步都不会报错，只会让状态悄悄错位。
 * 实际发生过两次：
 *
 * 1. 主界面漏了「错误分支里清 phase」，界面卡在「连接中」；
 * 2. 应急页自己抄了一遍，漏了「断线监听」—— 拔掉数据线后，
 *    那一页的「当前连接状态」还显示「已连接」，点还原报的错也没人解释。
 *
 * 所以链路收在这里，两个入口都调它。UI 层只关心「成功还是被取消」。
 */

import { createSession } from '@/core/session/device-session';
import { connectUsb, isWebUsbSupported } from '@/core/transport/driver';
import { explainError, messageOf } from '@/core/error-copy';
import { createServices, type Services } from '@/services/index';
import {
  disconnectReason,
  loseConnection,
  phase,
  phaseMessage,
  progressSink,
  pushOutput,
  services,
  session,
  toast,
} from '@/ui/state/app-state';

/** 连接结果 */
export type ConnectOutcome =
  | { status: 'ok'; services: Services }
  /** 用户自己关掉了设备选择框：不是错误，不该弹红条 */
  | { status: 'cancelled' }
  | { status: 'failed'; reason: string; next: string };

/** 连接是否正在进行，避免两处入口同时拉起两个设备选择框 */
let inFlight = false;

/**
 * 走一遍完整连接链路。
 *
 * 已连接时直接返回现有服务 —— 调用方不必自己判，否则每个入口都要抄一次
 * 「先看 services.value」。
 */
export async function connectDevice(): Promise<ConnectOutcome> {
  const existing = services.value;
  if (existing) return { status: 'ok', services: existing };
  if (inFlight) return { status: 'cancelled' };

  if (!isWebUsbSupported()) {
    const reason = '当前浏览器不支持 WebUSB。';
    const next = '改用 Chrome 或 Edge 桌面版，并通过 https 或 localhost 打开本页面。';
    phase.set('error');
    phaseMessage.set(reason);
    toast('error', reason);
    return { status: 'failed', reason, next };
  }

  inFlight = true;
  phase.set('requesting');
  phaseMessage.set('请在弹出的窗口中选择你的安卓设备');
  // 上一次中断的原因到本次连接就不再成立，先清掉
  disconnectReason.set(null);

  try {
    phase.set('authenticating');
    phaseMessage.set('等待手机确认 USB 调试授权…');

    const created = await createSession(async () => {
      pushOutput('info', '正在请求 USB 设备访问权限…');
      const driver = await connectUsb();
      pushOutput('info', `已连接 ${driver.label}（${driver.serial}）`);
      return driver;
    });

    phase.set('probing');
    phaseMessage.set('正在探测设备能力…');

    const built = createServices(created, {
      output: (channel, text) => pushOutput(channel, text),
      /*
       * 进度走信号而非终端文本。
       *
       * 旧写法是 `pushOutput('info', `${label}：${done} / ${total}`)`：
       * 一块一行、且 80 ms 内的同频道文本会被合并进同一个 DOM 节点，
       * 于是 1600 条进度拼成一串几万像素宽的字符，终端只能显示末尾几个数字。
       */
      progress: progressSink,
    });
    services.set(built);
    session.set(created);
    phase.set('ready');
    phaseMessage.set('');
    toast('success', `已连接 ${created.capabilities.model}`);

    /*
     * 盯着连接是否意外中断。
     *
     * 判据是「services 还是不是这一条会话」：主动断开时上层会先把
     * services 清空，再关连接，所以这条判断能自动区分两种情形 ——
     * 不需要在关闭路径和这里各维护一个布尔锁，也就没有先后顺序的坑。
     *
     * 应急页也必须走到这里。它抄链路的那一版没有这段，
     * 于是拔线后页面还在说「已连接」。
     */
    void created.driver.whenDisconnected?.().then(() => {
      if (services.value === built) loseConnection();
    });

    if (created.capabilities.vendorNote) {
      toast('info', created.capabilities.vendorNote);
    }

    return { status: 'ok', services: built };
  } catch (error) {
    const reason = messageOf(error);
    // 用户主动关掉设备选择框不算错误，静默退回待连接状态
    if ((error as Error)?.name === 'AbortError' && /未选择设备/.test(reason)) {
      phase.set('idle');
      phaseMessage.set('');
      return { status: 'cancelled' };
    }
    /*
     * 终端与提示条保留设备原话（排查时要能搜到原文），
     * 而返回给调用方的 reason / next 走翻译层 ——
     * 应急页要在下面接一句「展开手动方法」，那句必须接在可执行的动作后面。
     */
    const explained = explainError(error);
    phase.set('error');
    phaseMessage.set(reason);
    pushOutput('stderr', reason);
    toast('error', explained.reason);
    return { status: 'failed', reason: explained.reason, next: explained.next };
  } finally {
    inFlight = false;
  }
}

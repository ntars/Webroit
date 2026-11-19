/**
 * 连接动作的复用 Hook。
 *
 * 连接入口现在散落在三处 —— 顶部提示条、分区内的空态、工具卡片的执行按钮。
 * 三处都要走「请求设备 → 认证 → 探测能力 → 建服务」这一条链路，
 * 各自抄一遍必然会漏掉某一步（尤其是错误分支里清 phase）。
 * 所以链路只留在这里一份。
 *
 * 与旧版 ConnectPanel 的一处行为差异：连接成功后不再强制跳回设备总览。
 * 用户可能是在「应用管理」里点执行才发现没连接，连上后把他甩到别的分区
 * 会打断他刚才的动作，让他自己决定去哪。
 */

import { useState } from 'preact/hooks';

import { createSession } from '@/core/session/device-session';
import { connectUsb, isWebUsbSupported } from '@/core/transport/driver';
import { createServices } from '@/services/index';
import { messageOf } from '@/core/error-copy';
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

export interface ConnectResult {
  /** 走完整的连接链路；已连接时直接返回 true */
  connect: () => Promise<boolean>;
  /** 连接进行中，用于禁用按钮 */
  busy: boolean;
  /** 当前浏览器是否支持 WebUSB */
  supported: boolean;
  /** 进行中的阶段提示，例如「等待手机确认 USB 调试授权…」 */
  message: string;
}

export function useConnect(): ConnectResult {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const supported = isWebUsbSupported();

  const connect = async (): Promise<boolean> => {
    if (busy) return false;

    // 已连接就不重复拉设备选择框
    if (services.value) return true;

    setBusy(true);
    phase.set('requesting');
    phaseMessage.set('请在弹出的窗口中选择你的安卓设备');
    setMessage('请在弹出的窗口中选择你的安卓设备');
    // 上一次中断的原因到本次连接就不再成立，先清掉
    disconnectReason.set(null);

    try {
      phase.set('authenticating');
      phaseMessage.set('等待手机确认 USB 调试授权…');
      setMessage('等待手机确认 USB 调试授权…');

      const created = await createSession(async () => {
        pushOutput('info', '正在请求 USB 设备访问权限…');
        const driver = await connectUsb();
        pushOutput('info', `已连接 ${driver.label}（${driver.serial}）`);
        return driver;
      });

      phase.set('probing');
      phaseMessage.set('正在探测设备能力…');
      setMessage('正在探测设备能力…');

      const createdServices = createServices(created, {
        output: (channel, text) => pushOutput(channel, text),
        /*
         * 进度走信号而非终端文本。
         *
         * 上一版是 `pushOutput('info', `${label}：${done} / ${total}`)`：
         * 一块一行、且 80 ms 内的同频道文本会被合并进同一个 DOM 节点，
         * 于是 1600 条进度拼成一串几万像素宽的字符，终端只能显示末尾几个数字。
         * 现在改由进度条承载，终端只留命令与结果。
         */
        progress: progressSink,
      });
      services.set(createdServices);

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
       */
      void created.driver.whenDisconnected?.().then(() => {
        if (services.value === createdServices) loseConnection();
      });

      if (created.capabilities.vendorNote) {
        toast('info', created.capabilities.vendorNote);
      }
      return true;
    } catch (error) {
      const text = messageOf(error);
      // 用户主动关掉设备选择框不算错误，静默退回待连接状态
      if ((error as Error)?.name === 'AbortError' && /未选择设备/.test(text)) {
        phase.set('idle');
        phaseMessage.set('');
        return false;
      }
      phase.set('error');
      phaseMessage.set(text);
      pushOutput('stderr', text);
      toast('error', text);
      return false;
    } finally {
      setBusy(false);
      setMessage('');
    }
  };

  return { connect, busy, supported, message };
}

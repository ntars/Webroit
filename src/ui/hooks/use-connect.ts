/**
 * 连接动作的 UI 外壳：只管「按钮该转圈还是该可点」，链路本身在 state/connect.ts。
 *
 * 上一版这条链路写在这个 hook 里，应急页要用时只能自己抄一份 ——
 * 抄出来的那份漏了断线监听。现在两个入口共用同一条链路，
 * 这里只剩「正在连」这个纯界面状态。
 */

import { useState } from 'preact/hooks';

import { isWebUsbSupported } from '@/core/transport/driver';
import { explainError } from '@/core/error-copy';
import { connectDevice } from '@/ui/state/connect';
import { toast } from '@/ui/state/app-state';

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

    setBusy(true);
    setMessage('请在弹出的窗口中选择你的安卓设备');
    try {
      const outcome = await connectDevice();
      return outcome.status === 'ok';
    } catch (error) {
      /*
       * 链路内部已经把失败翻成「原因 + 下一步」并弹过提示了，
       * 这里兜的是它自己抛错的情况（理论上不该有，但不能让按钮
       * 永远停在转圈）。文案仍走翻译层 —— 直接抛原文等于把
       * adb 的英文报错丢给用户，绕过了本项目唯一的翻译出口。
       */
      toast('error', explainError(error).reason);
      return false;
    } finally {
      setBusy(false);
      setMessage('');
    }
  };

  return { connect, busy, supported, message };
}

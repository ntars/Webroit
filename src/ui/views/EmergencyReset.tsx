/**
 * 应急重置页：通过 URL 直达，不依赖正常界面。
 *
 * 为什么需要单独一页：
 * 把 DPI 改成 1000 后，安卓会把界面元素放得巨大 ——
 * 侧边栏挤成一条、按钮大到只有一角可见、甚至滚不出「还原」按钮。
 * 这时用户根本点不到任何工具卡片，常规入口等于失效。
 *
 * 这一页刻意做得极简：
 * - 一个超大的按钮，占满视口宽度，必然可点
 * - 不依赖侧边栏、不依赖分区切换、不依赖设备连接状态
 * - 未连接时会提示先连接，连接成功后按钮才可用
 *
 * 触发方式：地址栏追加 `#/reset-display`，或直接访问 `/?reset-display`。
 * 这一点写进了 docs/05-风险与合规.md 的 R4 防护措施。
 */

import { type FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';

import { createSession } from '@/core/session/device-session';
import { connectUsb } from '@/core/transport/driver';
import { createServices } from '@/services/index';
import { explainError } from '@/core/error-copy';
import { phase, pushOutput, services, session, toast } from '@/ui/state/app-state';
import { useSignal } from '@/ui/state/signal';

export const EmergencyReset: FunctionComponent = () => {
  const current = useSignal(services);
  const currentPhase = useSignal(phase);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ reason: string; next: string } | null>(null);

  /** 未连接时先连一次 —— 应急场景不能要求用户先回主页点连接 */
  const ensureConnected = async () => {
    if (current) return current;

    setMessage('正在连接设备，请在手机上允许 USB 调试…');
    const created = await createSession(async () => {
      pushOutput('info', '应急重置：请求 USB 设备访问权限');
      return connectUsb();
    });

    const built = createServices(created, {
      output: (channel, text) => pushOutput(channel, text),
    });
    services.set(built);
    session.set(created);
    phase.set('ready');
    return built;
  };

  const reset = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    setMessage('正在还原…');

    try {
      const active = await ensureConnected();
      const summary = await active.system.emergencyRestore();
      setMessage(summary);
      toast('success', summary);
    } catch (error) {
      /*
       * 应急页最怕「只给一句报错」。用户此刻界面已经错乱，
       * 唯一的指望就是这个页面，所以必须把下一步说死 ——
       * 连不上设备时下面还有一段折叠的手动命令清单，文案里直接指向它。
       */
      const explained = explainError(error);
      setMessage(null);
      setFailure({ reason: explained.reason, next: explained.next });
      toast('error', explained.reason);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="emergency">
      <div class="emergency__card">
        <h1 class="emergency__title">应急重置显示</h1>
        <p class="emergency__desc">
          把分辨率、屏幕密度、字体缩放、状态栏图标全部拉回设备的物理默认值。
          适用于「改坏了 DPI 导致界面过大无法操作」的情况。
        </p>

        <button
          type="button"
          class="emergency__button"
          onClick={reset}
          disabled={busy}
        >
          {busy ? (
            <>
              <span class="spinner" />
              正在还原…
            </>
          ) : (
            '立即还原'
          )}
        </button>

        {failure && (
          <div class="notice notice--danger error-notice" role="alert">
            <strong>还原没完成</strong>
            <p class="error-notice__reason">{failure.reason}</p>
            <p class="error-notice__next">
              {failure.next}
              {' '}如果始终连不上，展开下方「连不上时的手动方法」，那里是三条不依赖本页面的命令。
            </p>
          </div>
        )}

        {message && !failure && (
          <div class="notice">
            <p>{message}</p>
          </div>
        )}

        <div class="emergency__foot">
          <a href="#/" class="link">返回主界面</a>
          <span class="emergency__hint">
            当前连接状态：{current ? '已连接' : currentPhase === 'ready' ? '已连接' : '未连接'}
          </span>
        </div>

        <details class="emergency__manual">
          <summary>连不上时的手动方法</summary>
          <ol>
            <li>把手机连到电脑，打开命令行（Windows 按 Win+R 输入 cmd）。</li>
            <li>
              执行 <code>adb shell wm size reset</code>
            </li>
            <li>
              执行 <code>adb shell wm density reset</code>
            </li>
            <li>
              执行 <code>adb shell settings put system font_scale 1.0</code>
            </li>
          </ol>
          <p>这三条命令不依赖本页面，只要电脑装了 adb 工具就能用。</p>
        </details>
      </div>
    </div>
  );
};

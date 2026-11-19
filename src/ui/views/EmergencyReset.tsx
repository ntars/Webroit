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
 * - 不依赖侧边栏、不依赖分区切换
 * - 未连接时会自己先连一次，不要求用户回主页点连接
 *
 * 触发方式：地址栏追加 `#/reset-display`，或直接访问 `/?reset-display`。
 * 退出走 `leaveEmergency()` —— 两种入口的标记都在那里清，
 * 上一版只清 hash，从查询串进来的人点了「返回主界面」纹丝不动。
 */

import { type FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';

import { connectDevice } from '@/ui/state/connect';
import { explainError } from '@/core/error-copy';
import { phase, services, toast } from '@/ui/state/app-state';
import { leaveEmergency } from '@/ui/routing/route';
import { useSignal } from '@/ui/state/signal';

export const EmergencyReset: FunctionComponent = () => {
  const current = useSignal(services);
  const currentPhase = useSignal(phase);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ reason: string; next: string } | null>(null);
  const [cancelled, setCancelled] = useState(false);

  /*
   * 状态行的三态。
   *
   * 上一版写的是 `current ? '已连接' : currentPhase === 'ready' ? '已连接' : '未连接'`
   * —— 第二个分支永远走不到（services 已置空时 phase 不可能是 ready），
   * 而真正该说的是「正在连，请别动」。这里按「有服务 / 传输中 / 其他」三分。
   */
  const connectionLabel = current
    ? '已连接'
    : currentPhase === 'requesting' || currentPhase === 'authenticating' || currentPhase === 'probing'
      ? '连接中…'
      : '未连接';

  const reset = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    setCancelled(false);

    try {
      setMessage('正在连接设备，请在手机上允许 USB 调试…');
      // 链路与主界面共用同一份：断线监听、阶段迁移、错误翻译都在里面
      const outcome = await connectDevice();

      if (outcome.status === 'cancelled') {
        // 用户自己关掉了设备选择框，不是失败。给一条温和的出口，别报红。
        setMessage(null);
        setCancelled(true);
        return;
      }
      if (outcome.status === 'failed') {
        setMessage(null);
        setFailure({ reason: outcome.reason, next: outcome.next });
        return;
      }

      setMessage('正在还原…');
      const summary = await outcome.services.system.emergencyRestore();
      setMessage(summary);
      toast('success', summary);
    } catch (error) {
      /*
       * 应急页最怕「只给一句报错」。用户此刻界面已经错乱，
       * 唯一的指望就是这个页面，所以必须把下一步说死 ——
       * 连不上设备时下面还有一段折叠的手动命令清单，文案里直接指向它。
       *
       * 文案走翻译层而不是自己拼：`error.message` 是 adb 的英文原文，
       * 而这一页的使用者此刻最需要的是一句中文的「下一步做什么」。
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

        {cancelled && (
          <div class="notice">
            <p>没有选择设备，什么也没改。想继续的话再点一次「立即还原」。</p>
          </div>
        )}

        {message && !failure && (
          <div class="notice">
            <p>{message}</p>
          </div>
        )}

        <div class="emergency__foot">
          {/*
            退出必须走 leaveEmergency()：它把 hash 与查询串两处标记一起清掉。
            上一版是普通链接 `<a href="#/">`，只改 hash —— 从 `?reset-display`
            进来的人点了没反应，被永久留在这一页。
          */}
          <button type="button" class="link emergency__exit" onClick={leaveEmergency}>
            返回主界面
          </button>
          <span class="emergency__hint">当前连接状态：{connectionLabel}</span>
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

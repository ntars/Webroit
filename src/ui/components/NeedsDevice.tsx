/**
 * 未连接时的内联说明。
 *
 * 这一层是「浏览不受限、执行才拦」策略的落点：
 * 功能列表、参数表单、风险标签全部照常可见可点，
 * 只有真正会发命令的动作才在工具卡片上拦一下。
 *
 * 这里刻意不放「连接设备」按钮。
 * 内容区顶部已经有一条常驻提示条承载这个动作，两者相隔不到 60px，
 * 再放一个一模一样的按钮，读起来就是「这里也要点、那里也要点」。
 * 需要动手时，用户要么点顶部提示条，要么点卡片上的「连接设备后执行」，
 * 两处都离得近，不缺入口。
 *
 * 与 ConnectPanel 的分工：
 * - ConnectPanel 是完整引导，讲清 WebUSB 原理与四步准备，面向「第一次来」
 * - NeedsDevice 只回答「这一块为什么空」，面向「已经在逛」
 */

import { type FunctionComponent } from 'preact';

import { useConnect } from '@/ui/hooks/use-connect';

interface Props {
  /** 一句话说明当前为什么需要连接，例如「读取应用列表需要先连接设备」 */
  reason: string;
  /** 嵌在卡片或列表中时减少纵向占用 */
  compact?: boolean;
}

export const NeedsDevice: FunctionComponent<Props> = ({ reason, compact = false }) => {
  // 只取 supported 用于降级提示；连接动作由顶部提示条与工具卡片承担
  const { supported } = useConnect();

  return (
    <div class="needs-device" data-compact={compact}>
      <div class="needs-device__icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <rect x="7" y="2" width="10" height="20" rx="2.5" />
          <path d="M10 19h4" />
          <circle cx="12" cy="8.5" r="2.2" />
        </svg>
      </div>

      <div class="needs-device__body">
        <p class="needs-device__reason">{reason}</p>
        <p class="needs-device__hint">
          {supported
            ? '功能与参数可以先看。需要读取时，点上方「连接设备」，或在具体功能上直接执行。'
            : '当前浏览器不支持 WebUSB，请改用 Chrome 或 Edge 桌面版，并通过 https 或 localhost 打开。'}
        </p>
      </div>
    </div>
  );
};

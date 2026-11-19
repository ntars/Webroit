/**
 * 连接引导：讲清 WebUSB 原理与四步准备。
 *
 * 这一屏承担三个职责：
 * 1. 说明为什么需要 WebUSB（很多用户第一次见到会警惕）
 * 2. 给出前置准备的检查清单（ADB 调试不开，后面全部功能都用不了）
 * 3. 提供连接入口与错误反馈
 *
 * 文案刻意写得具体 —— 「打开开发者选项 → USB 调试」比
 * 「请开启调试模式」有用得多，因为不同品牌路径差异很大。
 *
 * 定位变化（v0.1 起）：不再是「未连接时的整屏落地页」，而是从顶部提示条
 * 按需打开的详细引导。主浏览路径上不再拦人，访客先看功能，要点连接时再看步骤。
 * 连接链路复用 useConnect，与提示条、侧边栏、工具卡片共用一份实现。
 */

import { type FunctionComponent } from 'preact';
import { useEffect } from 'preact/hooks';

import {
  phase,
  phaseMessage,
} from '@/ui/state/app-state';
import { useSignal } from '@/ui/state/signal';
import { useConnect } from '@/ui/hooks/use-connect';
import { explainError } from '@/core/error-copy';
import { ErrorNotice } from '@/ui/components/ErrorNotice';

interface Props {
  /** 连接成功后的回调 —— 由外层决定是否关闭引导层 */
  onConnected?: () => void;
}

export const ConnectPanel: FunctionComponent<Props> = ({ onConnected }) => {
  const currentPhase = useSignal(phase);
  const message = useSignal(phaseMessage);
  const { connect, busy, supported, message: busyMessage } = useConnect();

  // 连接成功后交给外层收尾，本组件不假设自己是不是弹层
  useEffect(() => {
    if (currentPhase === 'ready') onConnected?.();
  }, [currentPhase]);

  return (
    <div class="connect">
      <div class="connect__hero">
        <div class="connect__logo" aria-hidden="true">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none">
            <rect x="7" y="2" width="10" height="20" rx="2.5" stroke="currentColor" stroke-width="1.4" />
            <path d="M10 19h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
            <circle cx="12" cy="8.5" r="2.4" stroke="currentColor" stroke-width="1.4" />
          </svg>
        </div>
        <h1 class="connect__title">在浏览器里管理你的安卓设备</h1>
        <p class="connect__subtitle">
          不需要安装任何软件，也不需要 root。数据全程留在你的电脑上，不经过任何服务器。
        </p>

        {!supported && (
          <div class="notice notice--danger">
            <strong>当前浏览器不支持 WebUSB</strong>
            <p>
              请使用 Chrome 或 Edge 桌面版，并通过 <code>https://</code> 或{' '}
              <code>localhost</code> 打开本页面。Firefox 与 Safari 尚未支持该接口。
            </p>
          </div>
        )}

        {currentPhase === 'error' && message && (
          <ErrorNotice explanation={explainError(message)} title="连接失败" />
        )}

        <button
          type="button"
          class="btn btn--primary btn--lg connect__button"
          disabled={!supported || busy}
          onClick={() => void connect()}
        >
          {busy ? (
            <>
              <span class="spinner" />
              {busyMessage || '正在连接…'}
            </>
          ) : (
            '连接设备'
          )}
        </button>

        <p class="connect__privacy">
          WebUSB 会请求访问已连接的 USB 设备。授权仅对本次会话有效，可随时拔出数据线中断。
        </p>
      </div>

      <div class="connect__steps">
        <h2 class="connect__steps-title">连接前请确认</h2>
        <ol class="steps">
          <li class="step">
            <span class="step__index">1</span>
            <div class="step__body">
              <div class="step__title">开启开发者选项</div>
              <div class="step__desc">
                进入「设置 → 关于手机」，连续点击「版本号」7 次，直到提示已进入开发者模式。
              </div>
            </div>
          </li>
          <li class="step">
            <span class="step__index">2</span>
            <div class="step__body">
              <div class="step__title">打开 USB 调试</div>
              <div class="step__desc">
                在「设置 → 系统 → 开发者选项」中开启「USB 调试」。
                小米、OPPO、vivo 还需额外开启「USB 调试（安全设置）」，否则无法修改系统设置。
              </div>
            </div>
          </li>
          <li class="step">
            <span class="step__index">3</span>
            <div class="step__body">
              <div class="step__title">用数据线连接电脑</div>
              <div class="step__desc">
                部分数据线只供电不传数据，若连接后无反应请更换线材。
                连接后手机可能弹出「USB 用途」选项，选择「文件传输」更稳妥。
              </div>
            </div>
          </li>
          <li class="step">
            <span class="step__index">4</span>
            <div class="step__body">
              <div class="step__title">在手机上允许调试</div>
              <div class="step__desc">
                点击下方「连接设备」后，手机会弹出授权框，请勾选「一律允许」并确定。
                若 60 秒内未操作，连接会自动取消。
              </div>
            </div>
          </li>
        </ol>

        <div class="connect__tips">
          <h3 class="connect__tips-title">常见问题</h3>
          <dl class="faq">
            <dt>提示「ADB 接口被占用」</dt>
            <dd>
              本机的 adb 服务正在占用该设备。请关闭其他 WebADB 页面，
              或在终端执行 <code>adb kill-server</code> 后重试。
            </dd>
            <dt>连接成功但部分功能报权限错误</dt>
            <dd>
              这是厂商 ROM 的限制，不是工具问题。请在开发者选项里开启
              「USB 调试（安全设置）」，并关闭「权限监控」。
            </dd>
            <dt>需要 root 吗</dt>
            <dd>
              不需要。所有功能都通过标准 ADB 接口实现，
              在 ADB shell 用户权限范围内完成。
            </dd>
          </dl>
        </div>
      </div>
    </div>
  );
};

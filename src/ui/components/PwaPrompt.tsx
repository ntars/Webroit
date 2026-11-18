/**
 * PWA 相关的两处界面：安装入口与更新提示。
 *
 * 两者都刻意做成「小而安静」的形态，不弹模态框：
 * 用户来这里是操作设备的，任何盖住主界面的东西都是干扰。
 */

import { type FunctionComponent } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { canInstall, isStandalone, onInstallAvailable, promptInstall } from '@/core/pwa';

/** 顶栏的安装按钮，仅在浏览器确认可安装时出现 */
export const InstallButton: FunctionComponent = () => {
  const [available, setAvailable] = useState(canInstall);
  // 已安装为独立窗口时不再提示，否则用户会看到自己的应用里有个「安装自己」按钮
  const [installed] = useState(isStandalone);

  useEffect(() => onInstallAvailable(setAvailable), []);

  if (installed || !available) return null;

  return (
    <button
      type="button"
      class="btn btn--ghost btn--sm"
      title="安装为桌面应用，可离线打开"
      onClick={() => {
        void promptInstall().then((accepted) => {
          if (accepted) setAvailable(false);
        });
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
    </button>
  );
};

/**
 * 新版本提示条。
 *
 * 不使用自动刷新：用户可能正在跑一条耗时命令，刷新会丢掉终端输出。
 * 由用户自己决定什么时候换版本。
 */
export const UpdateBanner: FunctionComponent<{ onApply: (() => void) | null }> = ({ onApply }) => {
  if (!onApply) return null;

  return (
    <div class="update-banner" role="status">
      <span class="update-banner__text">新版本已就绪，刷新后生效</span>
      <button type="button" class="btn btn--primary btn--sm" onClick={onApply}>
        立即刷新
      </button>
    </div>
  );
};

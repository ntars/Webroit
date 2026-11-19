/**
 * 应用外壳：侧边栏 + 主区域 + 终端抽屉。
 *
 * 布局用 CSS Grid 而非 flex，因为三块区域的高度关系需要明确约束：
 * 主区域可滚动，侧边栏与终端固定。grid 的 1fr 比 flex 的 flex: 1
 * 更不容易在内容溢出时把侧边栏挤变形。
 */

import { type FunctionComponent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { type ModuleId, visibleModules } from '@/tools/registry';
import { PREVIEW_CAPABILITIES } from '@/core/preview';
import {
  activeModule,
  clearTerminal,
  closeConnection,
  disconnectReason,
  pendingUpdate,
  phase,
  preferences,
  session,
  sidebarOpen,
  switchModule,
  terminalLines,
  updatePreferences,
} from '@/ui/state/app-state';
import { route, syncRoute } from '@/ui/routing/route';
import { useSignal } from '@/ui/state/signal';
import { Terminal } from '@/ui/components/Terminal';
import { InstallButton, UpdateBanner } from '@/ui/components/PwaPrompt';
import { useConnect } from '@/ui/hooks/use-connect';
import { ModuleView } from '@/ui/views/ModuleView';
import { ConnectPanel } from '@/ui/views/ConnectPanel';
import { EmergencyReset } from '@/ui/views/EmergencyReset';
import { BrandBadge } from '@/ui/components/BrandBadge';
import { ToastHost } from '@/ui/components/ToastHost';
import { SettingsSheet } from '@/ui/components/SettingsSheet';
import { ProgressStrip } from '@/ui/components/ProgressStrip';
import { ErrorBoundary } from '@/ui/components/ErrorBoundary';

/** SVG 图标 */
function Icon({ path, size = 16 }: { path: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

/**
 * 未连接时的顶部提示条。
 *
 * 为什么是「条」而不是「整屏」：用户来这个站点的第一诉求是看清它能做什么，
 * 而不是先被要求插线。整屏连接引导适合做落地页首屏，但会让访客在
 * 看到任何功能之前就流失。所以判断放在这里 —— 浏览随便，执行再说。
 *
 * 三种未连接状态要分开说，因为用户该做的事完全不同：
 * - 从未连接      → 告诉他浏览不受限，随时可连
 * - 浏览器不支持  → 换浏览器，连按钮都不该给
 * - 连接被中断    → 必须先说清「刚才断过」，再让他重连
 */
const ConnectStrip: FunctionComponent<{
  supported: boolean;
  busy: boolean;
  message: string;
  /** 上一次连接是否意外中断 */
  lost: boolean;
  onConnect: () => void;
  onShowGuide: () => void;
}> = ({ supported, busy, message, lost, onConnect, onShowGuide }) => (
  <div class="connect-strip" data-warn={!supported} data-lost={lost}>
    <div class="connect-strip__text">
      {!supported ? (
        <>
          <strong>当前浏览器不支持 WebUSB</strong>
          <span>请改用 Chrome 或 Edge 桌面版，并通过 https 或 localhost 打开。</span>
        </>
      ) : lost ? (
        <>
          <strong>与设备的连接已中断</strong>
          <span>数据线可能松了，或设备重启过。重新插拔后点「重新连接」；中断时未完成的操作请复查结果。</span>
        </>
      ) : (
        <>
          <strong>当前未连接设备</strong>
          <span>功能与参数都可以先看，执行操作时会提示连接。</span>
        </>
      )}
    </div>
    <div class="connect-strip__actions">
      <button type="button" class="btn btn--ghost btn--sm" onClick={onShowGuide}>
        连接步骤
      </button>
      <button
        type="button"
        class="btn btn--primary btn--sm"
        disabled={!supported || busy}
        onClick={onConnect}
      >
        {busy ? (
          <>
            <span class="spinner" />
            {message || '连接中…'}
          </>
        ) : lost ? (
          '重新连接'
        ) : (
          '连接设备'
        )}
      </button>
    </div>
  </div>
);

export const App: FunctionComponent = () => {
  const currentModule = useSignal(activeModule);
  const currentPhase = useSignal(phase);
  const currentSession = useSignal(session);
  const prefs = useSignal(preferences);
  const lines = useSignal(terminalLines);
  const sidebarVisible = useSignal(sidebarOpen);
  const updateHandler = useSignal(pendingUpdate);
  const lostReason = useSignal(disconnectReason);
  const terminalRef = useRef<HTMLDivElement>(null);
  const currentRoute = useSignal(route);
  const emergency = currentRoute === 'emergency';
  const [guide, setGuide] = useState(false);
  const [settings, setSettings] = useState(false);
  const { connect, busy: connecting, message: connectMessage, supported } = useConnect();

  /*
   * 地址变化要能切换页面。
   *
   * 两种事件都要监听：hash 变化给 hashchange，`history.replaceState`（退出应急页
   * 时用它，避免在历史里留一条记录）只给 popstate。少听一个就有一种路径
   * 点完没反应 —— 而这一页正是「别的路都走不通」时用的。
   */
  useEffect(() => {
    const sync = () => syncRoute();
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  /*
   * ── 抽屉的两个退出口 ──
   *
   * 窄屏下侧边栏是 position:fixed 的抽屉，展开后正好盖住汉堡按钮本身。
   * 上一版只留了「点导航项跳分区」这一条路 —— 那等于强迫用户换分区才能退出；
   * 想留在当前分区继续看的人会被永久困住。所以补两条不改变意图的出口：
   *
   * 1. Esc：键盘用户的通用习惯，与「取消」语义一致
   * 2. 遮罩点击：手指用户唯一顺手的位置
   *
   * 桌面端不受影响：`sidebarOpen` 只在窄屏被汉堡按钮翻转，
   * 且遮罩在 >860px 时由 CSS 隐藏，这里不做断点判断，避免两处各存一份逻辑。
   */
  useEffect(() => {
    if (!sidebarVisible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') sidebarOpen.set(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [sidebarVisible]);

  // 连接成功后自动滚到终端底部，让用户看到第一条命令输出
  useEffect(() => {
    const element = terminalRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines.length]);

  const connected = currentPhase === 'ready' && currentSession !== null;

  /*
   * 分区列表在未连接时也完整给出。
   *
   * 老做法是未连接就只列通用分区、并禁用全部导航项 —— 结果是访客只能看到
   * 一屏连接引导，完全不知道这个工具到底能做什么。现在改成：
   * 导航全部可点，各分区照常渲染，读不到的数据由内联提示说明原因。
   */
  const modules = connected
    ? visibleModules(currentSession!.capabilities)
    : visibleModules(PREVIEW_CAPABILITIES, true);

  /*
   * 应急页完全独立渲染，不套侧边栏与外框 ——
   * 界面被撑大时，任何外层布局都可能把按钮挤出可视区。
   *
   * 但提示层必须跟着走：这一页自己就有 2 处 toast（重置成功、重置失败），
   * 少挂一个 ToastHost 就等于让「重置到底成没成」再次变成猜谜。
   * 它是 position:fixed 的独立浮层，不参与应急页那套「单列大按钮」布局。
   */
  if (emergency) {
    return (
      <>
        <EmergencyReset />
        <ToastHost />
      </>
    );
  }

  return (
    <div class="app" data-sidebar={prefs.sidebarCollapsed ? 'collapsed' : 'expanded'}>
      {/* 抽屉遮罩：窄屏展开时铺满，点它即关闭；桌面端由 CSS 隐藏 */}
      <div
        class="sidebar-scrim"
        data-open={sidebarVisible}
        aria-hidden="true"
        onClick={() => sidebarOpen.set(false)}
      />

      {/* ── 侧边栏 ── */}
      <aside class="sidebar" data-open={sidebarVisible} aria-label="功能分区">
        <div class="sidebar__brand">
          <div class="sidebar__logo" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="7" y="2" width="10" height="20" rx="2.5" stroke="currentColor" stroke-width="1.8" />
              <path d="M10 19h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
              <circle cx="12" cy="8" r="2.2" stroke="currentColor" stroke-width="1.6" />
            </svg>
          </div>
          <div class="sidebar__title">
            <span class="sidebar__name">Webroit</span>
            <span class="sidebar__version">v0.1 开发版</span>
          </div>
        </div>

        <nav class="sidebar__nav" aria-label="功能分区">
          {modules.map((module) => (
            <button
              key={module.id}
              type="button"
              class="nav-item"
              data-active={module.id === currentModule}
              data-preview={!connected}
              onClick={() => switchModule(module.id as ModuleId)}
              title={module.description}
            >
              <span class="nav-item__icon">
                <Icon path={module.icon} />
              </span>
              <span class="nav-item__text">{module.title}</span>
            </button>
          ))}
        </nav>

        <div class="sidebar__footer">
          {connected && currentSession ? (
            <>
              <BrandBadge />
              <button
                type="button"
                class="btn btn--ghost btn--sm btn--block"
                onClick={() => {
                  // 主动断开：先清状态再关连接，断线监听据此不弹「意外中断」
                  closeConnection();
                  void currentSession.close().catch(() => {});
                }}
              >
                断开连接
              </button>
            </>
          ) : (
            <div class="sidebar__connect">
              <div class="sidebar__hint">
                {supported ? '浏览不受限，执行操作时再连接' : '当前浏览器不支持 WebUSB'}
              </div>
              <button
                type="button"
                class="btn btn--ghost btn--sm btn--block"
                disabled={!supported || connecting}
                onClick={() => void connect()}
              >
                {connecting ? (
                  <>
                    <span class="spinner" />
                    {connectMessage || '连接中…'}
                  </>
                ) : (
                  '连接设备'
                )}
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ── 主区域 ── */}
      <main class="main">
        <header class="titlebar">
          <div class="titlebar__left">
            <button
              type="button"
              class="btn btn--ghost btn--sm titlebar__menu"
              onClick={() => sidebarOpen.set(!sidebarVisible)}
              aria-label={sidebarVisible ? '收起侧边栏' : '展开侧边栏'}
              aria-expanded={sidebarVisible}
            >
              <Icon path="M4 6h16M4 12h16M4 18h16" />
            </button>
            <h1 class="titlebar__title">
              {modules.find((module) => module.id === currentModule)?.title ?? 'Webroit'}
            </h1>
          </div>
          <div class="titlebar__right">
            <InstallButton />
            <button
              type="button"
              class="btn btn--ghost btn--sm titlebar__settings"
              onClick={() => setSettings(true)}
              title="偏好设置"
              aria-label="偏好设置"
              aria-expanded={settings}
            >
              <Icon
                path="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
              />
            </button>
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              onClick={() => updatePreferences({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })}
              title="切换明暗主题"
            >
              <Icon
                path={
                  prefs.theme === 'dark'
                    ? 'M12 3v1m0 16v1M4.2 4.2l.7.7m14.2 14.2l.7.7M3 12h1m16 0h1M4.2 19.8l.7-.7M19.1 4.9l.7-.7M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z'
                    : 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'
                }
              />
            </button>
          </div>
        </header>

        <div class="content">
          <UpdateBanner onApply={updateHandler} />
          {/*
            未连接时在内容区顶部放一条窄提示，而不是把整屏换成连接引导。
            访客可以直接往下浏览每个分区的功能与参数，只有真正要执行时才需要连接。
          */}
          {!connected && (
            <ConnectStrip
              supported={supported}
              busy={connecting}
              message={connectMessage}
              lost={lostReason === 'lost'}
              onConnect={() => void connect()}
              onShowGuide={() => setGuide(true)}
            />
          )}
          {/*
            分区渲染包在错误边界里。

            实测过没有它的后果：一个分区算错字段，Preact 会把整棵子树从 DOM 卸掉，
            主区域只剩一张连接提示条，且切到别的分区也不恢复 —— 用户以为整个工具坏了。
            边界挂在这一级 + `resetKey` 给当前分区 id：坏的那一块就地变成说明块，
            切分区自动重试渲染，其余部分（侧边栏、终端）照常可用。
          */}
          <ErrorBoundary
            label={modules.find((module) => module.id === currentModule)?.title}
            resetKey={currentModule}
          >
            <ModuleView module={currentModule} />
          </ErrorBoundary>
        </div>

        {/* ── 终端 ── */}
        <section class="terminal-panel" data-collapsed={!connected}>
          <div class="terminal-panel__header">
            <span class="terminal-panel__label">命令输出</span>
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              onClick={clearTerminal}
              disabled={lines.length === 0}
            >
              清空
            </button>
          </div>
          <div class="terminal-panel__body" ref={terminalRef}>
            <Terminal
              lines={lines}
              fontSize={prefs.terminalFontSize}
              showCommandEcho={prefs.showCommandEcho}
            />
          </div>
          {/*
            传输进度：贴在终端面板底部而不是顶部 ——
            顶部是「命令输出」标题行，进度插在那里会把标题挤走；
            底部紧邻最后一行输出，正好是用户此刻的视线位置。
          */}
          <ProgressStrip />
        </section>
      </main>

      {/* 全局提示层：单例挂在最后，任何分区的执行结果都从这里出声 */}
      <ToastHost />

      {/* 偏好设置：改即生效，无「保存」按钮 */}
      {settings && <SettingsSheet onClose={() => setSettings(false)} />}

      {/* 连接步骤：从提示条按需打开，不占用主浏览路径 */}
      {guide && (
        <div
          class="guide-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="连接步骤"
          onClick={(event) => {
            if (event.target === event.currentTarget) setGuide(false);
          }}
        >
          <div class="guide-sheet">
            <button
              type="button"
              class="btn btn--ghost btn--sm guide-sheet__close"
              onClick={() => setGuide(false)}
              aria-label="关闭"
            >
              关闭
            </button>
            <ConnectPanel
              onConnected={() => {
                setGuide(false);
                switchModule('device');
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * 应用状态：连接、分区、终端输出、执行进度。
 *
 * 全部状态集中在这里，组件只读不写 —— 写操作通过导出的动作函数完成。
 * 这样任何一个状态变化都能在单一位置加审计或日志，不会散落在组件里。
 */

import type { DeviceSession } from '@/core/session/device-session';
import type { Services } from '@/services/index';
import { type Preferences, loadPreferences, resetPreferences, savePreferences } from '@/core/storage';
import type { ModuleId } from '@/tools/registry';
import type { OutputChannel } from '@/core/shell';
import { signal } from '@/ui/state/signal';
import { ProgressThrottle, type ProgressTick } from '@/ui/state/progress';
import { applyTheme } from '@/ui/theme/apply';

/** 连接阶段 */
export type ConnectionPhase =
  | 'idle'
  | 'requesting'
  | 'authenticating'
  | 'probing'
  | 'ready'
  | 'error';

/** 终端输出的一行 */
export interface TerminalLine {
  id: number;
  channel: OutputChannel;
  text: string;
  at: number;
}

/** 进度条状态 */
export interface ProgressState {
  label: string;
  done: number;
  total: number;
  /** 百分比 0–100；总量未知时为 -1，界面据此改为只显示已传字节数 */
  percent: number;
}

/** 一条提示消息 */
export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

let lineSeed = 0;
let toastSeed = 0;

/* ─────────────────────── 状态 ─────────────────────── */

export const phase = signal<ConnectionPhase>('idle');
export const phaseMessage = signal<string>('');
export const session = signal<DeviceSession | null>(null);
export const services = signal<Services | null>(null);
export const activeModule = signal<ModuleId>('device');
export const terminalLines = signal<TerminalLine[]>([]);
export const progress = signal<ProgressState | null>(null);
export const toasts = signal<Toast[]>([]);
export const preferences = signal<Preferences>(loadPreferences());
/** 侧边栏在窄屏下的展开状态 */
export const sidebarOpen = signal<boolean>(false);
/**
 * 待应用的 Service Worker 更新。
 *
 * 存的是一个「激活新版本」的函数而非布尔值：激活动作由 core/pwa 决定，
 * 界面只负责在用户点击时把它调起来，不需要知道 Service Worker 的任何细节。
 */
export const pendingUpdate = signal<(() => void) | null>(null);
/**
 * 上一次连接为什么结束。
 *
 * 只区分「用户主动断开」与「意外中断」：前者不需要提示，后者必须提示 ——
 * 否则用户会对着一个已经失效的界面继续点。
 */
export const disconnectReason = signal<'user' | 'lost' | null>(null);

/* ─────────────────────── 动作 ─────────────────────── */

/** 追加终端输出，自动合并连续同频道文本并限制总行数 */
export function pushOutput(channel: OutputChannel, text: string): void {
  const trimmed = text.replace(/\r\n/g, '\n');
  if (!trimmed) return;

  terminalLines.set((prev) => {
    const last = prev[prev.length - 1];
    // 同频道的连续片段合并，避免每条 read 回调都生成一行
    if (last && last.channel === channel && Date.now() - last.at < 80) {
      const merged = [...prev];
      merged[merged.length - 1] = { ...last, text: last.text + trimmed, at: Date.now() };
      return merged;
    }
    const next = [...prev, { id: ++lineSeed, channel, text: trimmed, at: Date.now() }];
    // 上限 2000 行，超出丢最早的，防止长时间运行把内存吃光
    return next.length > 2000 ? next.slice(next.length - 2000) : next;
  });
}

/** 清空终端 */
export function clearTerminal(): void {
  terminalLines.set([]);
}

/** 弹一条提示，3 秒后自动消失 */
export function toast(kind: Toast['kind'], text: string): void {
  const item: Toast = { id: ++toastSeed, kind, text };
  toasts.set((prev) => [...prev, item]);
  setTimeout(() => {
    toasts.set((prev) => prev.filter((entry) => entry.id !== item.id));
  }, kind === 'error' ? 6000 : 3000);
}

/** 关闭指定提示 */
export function dismissToast(id: number): void {
  toasts.set((prev) => prev.filter((entry) => entry.id !== id));
}

/*
 * ── 传输进度的上报口 ──
 *
 * 底层是「每 64 KB 回调一次」，100 MB 的包约 1600 次。直接推信号会让
 * 整棵树每秒重渲染上千次，所以中间隔一层降频（见 `state/progress.ts`）。
 *
 * 降频器是模块级单例而非组件内的 useRef：进度是全局唯一的
 * —— 同一时刻只可能有一个文件在传（`sync` 会话本来就不并发）。
 * 放组件里会让「切分区后进度归零」变成一个新 bug。
 *
 * 不额外暴露 `setProgress`：唯一该被调用的入口就是下面两个，
 * 多一个能直接改信号的出口，就等于允许某处绕过降频把界面刷爆。
 */
const progressThrottle = new ProgressThrottle();

/**
 * 上报一次传输进度。
 *
 * 满值时自动转收尾 —— 这个判断放在这里而不是每个调用点：
 * 「已传 == 总量」只有底层知道，让 `use-connect`、应急页、CLI 各自判断
 * 必然会漏掉某一处，表现为进度条永远卡在 99%。
 *
 * @param label 文件名或操作名，显示在进度条左侧
 * @param done 已传字节数
 * @param total 总字节数；拿不到时传 0，界面显示「已传 N」
 */
export function reportProgress(label: string, done: number, total: number): void {
  if (total > 0 && done >= total) {
    finishProgress(label, done, total);
    return;
  }
  const tick: ProgressTick | null = progressThrottle.accept({ label, done, total });
  if (!tick) return;
  progress.set({
    label: tick.label,
    done: tick.done,
    total: tick.total,
    percent: tick.percent,
  });
}

/**
 * 传输收尾：交终值并留在界面上给用户看一眼，随后自动消失。
 *
 * 为什么不是立刻清空：进度条「闪一下就没了」等于什么都没看到 ——
 * 用户会怀疑文件到底传完没有。留 800 ms 让终点被看见，再由这里清掉。
 */
export function finishProgress(label: string, done: number, total: number): void {
  const tick = progressThrottle.finish({ label, done, total });
  if (tick) {
    progress.set({
      label: tick.label,
      done: tick.done,
      total: tick.total,
      percent: tick.percent,
    });
  }
  progressThrottle.reset();
  setTimeout(() => {
    // 期间若已开始下一个文件，就不要把新进度清掉
    if (progress.value?.label === label) progress.set(null);
  }, 800);
}

/** 直接清空进度条，不做收尾动画（切换设备、清空终端时用） */
export function clearProgress(): void {
  progressThrottle.reset();
  progress.set(null);
}

/**
 * 直接可用的进度回调，签名与 `shell` 的 `ProgressSink` 一致。
 *
 * 收尾判定放在这里而不是每个调用方：`done >= total` 这件事只有底层知道，
 * 让 `use-connect`、`EmergencyReset`、CLI 各自判断一遍必然会漏。
 */
export function progressSink(name: string, done: number, total: number): void {
  if (total > 0 && done >= total) finishProgress(name, done, total);
  else reportProgress(name, done, total);
}

/**
 * 更新偏好并落盘。
 *
 * 主题在这里落 DOM：偏好只是「记住用户选了深色」，真正让界面变的是
 * `data-theme` 属性。上一版两条路分开走，结果按钮点了没反应 ——
 * 现在统一从这一个出口出去，任何调用点都不可能只改一半。
 */
export function updatePreferences(patch: Partial<Preferences>): void {
  const next = savePreferences(patch);
  preferences.set(next);
  if (patch.theme) applyTheme(next.theme);
}

/** 切换分区 */
export function switchModule(id: ModuleId): void {
  activeModule.set(id);
  updatePreferences({ lastModule: id });
  sidebarOpen.set(false);
}

/**
 * 恢复默认偏好。
 *
 * 只重置偏好，不碰设备快照与审计记录 —— 那两类是「发生过的事实」，
 * 不该因为一次「把界面调回原样」而消失。真要清干净见 README 9.3。
 *
 * 主题也必须跟着回落，否则用户点了「恢复默认」看到界面还是深色，
 * 会以为按钮没生效。
 */
export function resetAllPreferences(): void {
  const next = resetPreferences();
  preferences.set(next);
  applyTheme(next.theme);
  toast('success', '偏好已恢复默认');
}

/** 重置连接状态 */
export function resetConnection(): void {
  session.set(null);
  services.set(null);
  phase.set('idle');
  phaseMessage.set('');
  clearProgress();
}

/**
 * 连接意外中断时的收尾。
 *
 * 与 resetConnection 的区别只有一个：留一条原因，让界面能说清
 * 「为什么突然回到未连接」。少了这条，用户拔线后看到的是一切归零的界面，
 * 会误以为工具自己坏了。
 */
export function loseConnection(): void {
  resetConnection();
  disconnectReason.set('lost');
  toast('error', '与设备的连接已中断，请重新插拔数据线后连接');
}

/** 用户主动断开：清掉原因标记，界面不弹提示 */
export function closeConnection(): void {
  disconnectReason.set('user');
  resetConnection();
}

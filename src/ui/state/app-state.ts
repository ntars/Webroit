/**
 * 应用状态：连接、分区、终端输出、执行进度。
 *
 * 全部状态集中在这里，组件只读不写 —— 写操作通过导出的动作函数完成。
 * 这样任何一个状态变化都能在单一位置加审计或日志，不会散落在组件里。
 */

import type { DeviceSession } from '@/core/session/device-session';
import type { Services } from '@/services/index';
import { type Preferences, loadPreferences, savePreferences } from '@/core/storage';
import type { ModuleId } from '@/tools/registry';
import type { OutputChannel } from '@/core/shell';
import { signal } from '@/ui/state/signal';

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

/** 设置进度 */
export function setProgress(next: ProgressState | null): void {
  progress.set(next);
}

/** 更新偏好并落盘 */
export function updatePreferences(patch: Partial<Preferences>): void {
  preferences.set(savePreferences(patch));
}

/** 切换分区 */
export function switchModule(id: ModuleId): void {
  activeModule.set(id);
  updatePreferences({ lastModule: id });
  sidebarOpen.set(false);
}

/** 重置连接状态 */
export function resetConnection(): void {
  session.set(null);
  services.set(null);
  phase.set('idle');
  phaseMessage.set('');
  progress.set(null);
}

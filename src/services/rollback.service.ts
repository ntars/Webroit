/**
 * 回滚服务：把本次会话的所有设置改动按逆序还原。
 *
 * 为什么必须逆序：
 * 用户可能连着改了三次 DPI（420 → 300 → 480）。
 * 快照记录的是「每次改动前的值」：420 / 300 / 480 前身。
 * 只有从最后一条往前后退，才能正确回到 420；
 * 正序回放会让最后一条（480 前身=300）覆盖掉第一次的正确还原。
 *
 * 单条失败不中断整批：设备上某些键可能已被系统重置，
 * `settings delete` 会返回非零退出码，但其他项仍应继续还原。
 */

import type { ShellContext } from '@/core/shell';
import { snapshots, type SnapshotEntry } from '@/core/snapshot';

/** 单条回放结果 */
export interface RollbackStep {
  label: string;
  commands: string[];
  ok: boolean;
  error?: string;
}

/** 批量回放汇总 */
export interface RollbackReport {
  total: number;
  restored: number;
  failed: number;
  steps: RollbackStep[];
}

export class RollbackService {
  #shell: ShellContext;

  constructor(shell: ShellContext) {
    this.#shell = shell;
  }

  /** 当前会话里有多少条可回滚记录 */
  count(): number {
    return snapshots.list().length;
  }

  /**
   * 列出可回滚项，按「最近改的在前」排序，与还原顺序一致。
   *
   * 用 seq 而不是时间戳：连续操作（脚本批量跑、用户连点）会在同一毫秒
   * 产生多条记录，`at` 完全相同，按时间戳排不出先后。
   * 后果很实际：DPI 改了三次（420→300→480），顺序错了就会还原到 300
   * 而不是最初的 420。seq 是同会话内单调递增的，落盘后读回仍然保序。
   */
  pending(): SnapshotEntry[] {
    return [...snapshots.list()].sort((a, b) => b.seq - a.seq);
  }

  /**
   * 还原全部。逆序回放，逐条执行，失败的记下来继续下一条。
   */
  async restoreAll(): Promise<RollbackReport> {
    const entries = this.pending();
    return this.#replay(entries);
  }

  /**
   * 只还原某个分区。
   * 典型场景：只改过显示参数，不想动系统设置。
   */
  async restoreModule(module: string): Promise<RollbackReport> {
    const entries = this.pending().filter((entry) => entry.module === module);
    return this.#replay(entries);
  }

  async #replay(entries: SnapshotEntry[]): Promise<RollbackReport> {
    const steps: RollbackStep[] = [];
    const done: string[] = [];

    for (const entry of entries) {
      let ok = true;
      let error: string | undefined;

      for (const command of entry.restore) {
        try {
          await this.#shell.text(command, { log: true, allowFailure: false });
        } catch (caught) {
          ok = false;
          error = caught instanceof Error ? caught.message : String(caught);
          break;
        }
      }

      steps.push({ label: entry.label, commands: entry.restore, ok, error });
      // 失败的不删记录，用户可以重试；成功的才丢
      if (ok) done.push(entry.id);
    }

    await snapshots.forget(done);

    const restored = steps.filter((step) => step.ok).length;
    return {
      total: steps.length,
      restored,
      failed: steps.length - restored,
      steps,
    };
  }

  /**
   * 丢弃全部记录，不执行还原。
   * 用于「这些改动我就想留着，别再提示我还原了」。
   */
  async discard(): Promise<void> {
    await snapshots.clear();
  }
}

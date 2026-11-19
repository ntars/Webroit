/**
 * 传输进度的显示层。
 *
 * 为什么需要单独一层：
 * 底层上报的粒度是「每读到 / 写出一块就回调一次」，块大小 64 KB。
 * 传一个 100 MB 的 APK 就是约 1600 次回调。上一版把它直接拼进终端文本：
 *
 * ```
 * pushOutput('info', `${label}：${done} / ${total}`)
 * ```
 *
 * 而 `pushOutput` 会把 80 ms 内的同频道文本合并进**同一个 DOM 节点**。
 * 1600 条进度挤在一个 `<div>` 里，宽度撑到几万像素，终端面板只能显示末尾几个字符 ——
 * 用户看到的是模糊跳动的数字，看不出「还剩多少」。
 *
 * 所以分成三步：
 * 1. 上报侧只负责把「当前已传字节数」交出来，不做任何展示决策；
 * 2. 这里做**降频**：不足 120 ms 且未跨 1% 的中间态直接丢弃；
 * 3. 界面侧拿到的是「每秒最多 8 次」的干净序列，渲染成一条进度条。
 *
 * 为什么阈值是「时间 OR 百分比」两个条件满足其一：
 * 只看时间 → 慢速小文件一次都不刷新，进度条卡在 0% 到最后突然 100%；
 * 只看百分比 → 100 MB 文件每 1% 就刷一次，仍有 100 次，且极快时会连成一片。
 * 两个条件取并集，则「慢的时候按时间动、快的时候按比例动」，两种极端都能看到变化。
 */

/** 单次进度快照 */
export interface ProgressSnapshot {
  /** 正在传的文件名或操作名 */
  label: string;
  /** 已传字节数 */
  done: number;
  /** 总字节数。拿不到时为 0，此时界面只显示已传量 */
  total: number;
}

/** 最短刷新间隔（毫秒）。8 次/秒对人眼已经连续，再密只是白烧渲染 */
export const PROGRESS_MIN_INTERVAL = 120;

/** 百分比变化阈值（百分点）。跨过它即使没到时间也刷新 */
export const PROGRESS_PERCENT_STEP = 1;

/** 一次上报的判定结果：要不要真的推给界面 */
export interface ProgressTick extends ProgressSnapshot {
  /** 百分比 0–100。total 无效时为 -1（界面据此显示「已传 N」） */
  percent: number;
}

/** 计算百分比；total 无效（<= 0）时返回 -1 表示「总量未知」 */
export function percentOf(done: number, total: number): number {
  if (!(total > 0)) return -1;
  const ratio = (Number(done) || 0) / total;
  if (!Number.isFinite(ratio)) return -1;
  return Math.max(0, Math.min(100, ratio * 100));
}

/**
 * 进度降频器。
 *
 * 用法：底层每块调用一次 `accept()`，返回 `null` 表示本次丢弃，
 * 返回快照表示应当更新界面。`finish()` 用于强制交出终值 ——
 * 传输结束时若恰好落在降频窗口内，不强制刷新会让进度条永远停在 97%。
 */
export class ProgressThrottle {
  #lastAt = 0;
  #lastPercent = -1;
  #lastLabel = '';
  #lastDone = -1;

  /** 判定本次上报是否要推给界面 */
  accept(snapshot: ProgressSnapshot, now = Date.now()): ProgressTick | null {
    const percent = percentOf(snapshot.done, snapshot.total);
    const tick: ProgressTick = { ...snapshot, percent };

    // 换了一个文件 → 立即重置，新文件必须从 0% 开始显示，不能继承上一个的高水位
    if (snapshot.label !== this.#lastLabel) {
      this.#lastLabel = snapshot.label;
      this.#lastAt = now;
      this.#lastPercent = percent;
      this.#lastDone = snapshot.done;
      return tick;
    }

    // 字节数没有前进（同一块重试、读取返回空块）→ 丢弃，避免百分比不动却反复渲染
    if (snapshot.done === this.#lastDone) return null;

    const elapsed = now - this.#lastAt;
    /*
     * 总量未知（percent 为 -1）时只看时间：两个 -1 相减是 0，
     * 不会误判成「跨了 1%」。这类场景是「拉取时 lstat 拿不到文件大小」，
     * 界面上只显示已传字节数，按时间刷新即可。
     */
    const stepped = percent - this.#lastPercent >= PROGRESS_PERCENT_STEP;
    const reachedEnd = snapshot.total > 0 && snapshot.done >= snapshot.total;

    if (!reachedEnd && elapsed < PROGRESS_MIN_INTERVAL && !stepped) return null;

    this.#lastAt = now;
    this.#lastPercent = percent;
    this.#lastDone = snapshot.done;
    return tick;
  }

  /**
   * 传输收尾：强制交出终值。
   *
   * @returns 需要刷新的快照；与上一次完全相同则返回 null（不需要多刷一帧）
   */
  finish(snapshot: ProgressSnapshot, now = Date.now()): ProgressTick | null {
    if (snapshot.label === this.#lastLabel && snapshot.done === this.#lastDone) return null;
    this.#lastAt = now;
    this.#lastPercent = percentOf(snapshot.done, snapshot.total);
    this.#lastLabel = snapshot.label;
    this.#lastDone = snapshot.done;
    return { ...snapshot, percent: this.#lastPercent };
  }

  /** 复位。切换设备、清空终端时调用，避免下一个任务被上一个的水位影响 */
  reset(): void {
    this.#lastAt = 0;
    this.#lastPercent = -1;
    this.#lastLabel = '';
    this.#lastDone = -1;
  }
}

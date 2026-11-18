/**
 * 设置快照：改动前记原值，出错时按逆序回滚。
 *
 * 为什么需要它：
 * `settings put`、`wm density` 这类命令是**静默生效**的 —— 没有系统弹窗，
 * 没有确认步骤，改完界面立刻变化。用户把 DPI 调到 1000、把字体调到 2 倍，
 * 手机界面会大到没法操作；这时想改回来，得知道「原值到底是多少」。
 * 靠记忆不现实，靠搜索引擎给的"默认值"更不现实 —— 每个厂商都不一样。
 *
 * 三条约定：
 * 1. **只记能反悔的**。`settings` / `wm` 这类有明确逆操作的才记；
 *    卸载应用、清数据不记 —— 它们不可逆，记了也给不出还原命令。
 * 2. **只回放本次会话**。跨会话回放陈旧值会把设备改坏
 *    （比如三个月前记的 DPI 装在新手机上是错的）。
 * 3. **落 IndexedDB 而非内存**。页面刷新后快照还在，
 *    不至于「改坏了 → 手一抖刷新了 → 原值没了」。
 *
 * 关于第 3 条在命令行下的处理：
 * IndexedDB 是浏览器 API，Node 里没有。所以落盘能力被抽成 SnapshotBackend，
 * 由宿主注册 —— 浏览器注册 IndexedDB 实现，命令行不注册（退化为纯内存）。
 * 命令行进程本身就是一次会话，退出即结束，没有「刷新丢值」的问题，
 * 因此这个退化是合理的，不是妥协。
 */

import { quote } from '@/core/utils';

/** 一条快照 */
export interface SnapshotEntry {
  id: string;
  /** 所属会话，用于跨会话清理 */
  sessionId: string;
  /** 毫秒时间戳 */
  at: number;
  /**
   * 单调递增序号，同会话内唯一。
   *
   * 为什么单靠时间戳不够：连续操作（脚本批量跑、用户连点）会在同一毫秒
   * 产生多条记录，`at` 完全相同。时间戳排不出先后，而回滚必须严格逆序 ——
   * DPI 改了三次（420→300→480），顺序错了就还原到 300 而不是最初的 420。
   * IndexedDB 读回时又按 UUID 主键排，顺序更是随机的。
   * 用自增序号做第二排序键，内存与落盘后都能稳定保序。
   */
  seq: number;
  /** 分区，如 display / system */
  module: string;
  /** 人类可读的变更描述，如「分辨率 1080×2400 → 720×1600」 */
  label: string;
  /** 回滚命令，按数组顺序执行 */
  restore: string[];
}

/** 上限：一次会话很难改到 200 项，超出丢最旧的 */
const MAX_ENTRIES = 200;

type Listener = (entries: SnapshotEntry[]) => void;

/**
 * 快照的落盘后端。
 *
 * 只保留三个动作：读全部、写一条、删若干。
 * 把 IndexedDB 的 open / transaction / onsuccess 那一整套关在实现里，
 * SnapshotStore 本身不再出现任何浏览器 API —— 这是它能被命令行复用的前提。
 */
export interface SnapshotBackend {
  readAll(): Promise<SnapshotEntry[]>;
  put(entry: SnapshotEntry): Promise<void>;
  remove(ids: string[]): Promise<void>;
}

/** 当前后端。null 表示纯内存模式 */
let backend: SnapshotBackend | null = null;

/**
 * 注册落盘后端。浏览器启动时调一次；命令行不调，即纯内存。
 *
 * 注册后立刻重新加载一次：SnapshotStore 是模块级单例，构造时后端还没注册，
 * 那次初始化是空转的。不补这一次，刷新页面后快照读不回来 ——
 * 「改坏了 → 刷新 → 原值没了」这个原本要防的场景会重新出现。
 */
export function bindSnapshotBackend(next: SnapshotBackend | null): void {
  backend = next;
  void snapshots.reload();
}

/** 取当前后端（SnapshotStore 内部用） */
function currentBackend(): SnapshotBackend | null {
  return backend;
}

/** 每次页面加载算一个会话 */
const SESSION_ID: string = (() => {
  try {
    return crypto.randomUUID();
  } catch {
    return `s-${Date.now()}`;
  }
})();

/**
 * 把「某条 settings 的原值」翻译成还原命令。
 *
 * Android 的 `settings get` 在键不存在时返回字符串 `null`，
 * 这种键的还原方式是 `settings delete` 而不是 `settings put null` ——
 * 后者会真的写入字符串 "null"，让系统读到一个非法值。
 */
export function settingsInverse(scope: string, key: string, original: string): string {
  const value = String(original ?? '').trim();
  if (!value || value === 'null') return `settings delete ${scope} ${key}`;
  return `settings put ${scope} ${key} ${quote(value)}`;
}

/** 快照仓库 */
export class SnapshotStore {
  #entries: SnapshotEntry[] = [];
  /** 单调递增序号，重启后从已有记录的最大值继续 */
  #seq = 0;
  #listeners = new Set<Listener>();
  #ready: Promise<void>;

  constructor() {
    this.#ready = this.#open();
  }

  async #open(): Promise<void> {
    const store = currentBackend();
    if (!store) return;
    try {
      const stored = await store.readAll();
      // 只留本次会话：上一会话的原值回放到现在的设备上是错的
      const stale = stored.filter((entry) => entry.sessionId !== SESSION_ID);
      /*
       * 兜底 seq：早期写入的记录可能没有这个字段（或被人为改过），
       * undefined 参与减法会得到 NaN，Array.sort 遇 NaN 行为未定义 ——
       * 回滚顺序就乱了。缺字段的按时间戳回填，保证排序键总是数字。
       */
      const mine = stored
        .filter((entry) => entry.sessionId === SESSION_ID)
        .map((entry) => ({
          ...entry,
          seq: Number.isFinite(entry.seq) ? entry.seq : entry.at,
        }))
        .sort((a, b) => a.seq - b.seq);
      this.#entries = mine;
      if (stale.length > 0) void store.remove(stale.map((entry) => entry.id));
      // 序号接着已有的往下走，否则新记录会插到旧记录前面
      this.#seq = mine.reduce((max, entry) => Math.max(max, entry.seq), 0);
      this.#emit();
    } catch {
      // 后端不可用（隐私模式 / 磁盘满）时退化成纯内存，不影响功能
    }
  }

  /** 就绪等待 */
  async whenReady(): Promise<void> {
    return this.#ready;
  }

  /**
   * 重新从后端加载。
   *
   * 用于「后端比单例晚一步注册」的场景：注册后调一次，把已有记录读回来。
   * 只在内存里没有记录时才覆盖，避免把本次会话刚记的改动冲掉。
   */
  async reload(): Promise<void> {
    if (this.#entries.length > 0) return;
    await this.#open();
  }

  /** 订阅变化，返回取消函数 */
  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.#entries);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    for (const listener of this.#listeners) listener(this.#entries);
  }

  /** 当前会话的全部快照，按时间正序 */
  list(): SnapshotEntry[] {
    return [...this.#entries];
  }

  /** 记录一条快照，返回 ID */
  record(input: { module: string; label: string; restore: string[] }): string {
    if (input.restore.length === 0) {
      throw new Error('快照必须至少包含一条还原命令');
    }
    const entry: SnapshotEntry = {
      id: crypto.randomUUID(),
      sessionId: SESSION_ID,
      at: Date.now(),
      seq: ++this.#seq,
      module: input.module,
      label: input.label,
      restore: input.restore,
    };

    this.#entries.push(entry);
    if (this.#entries.length > MAX_ENTRIES) {
      const dropped = this.#entries.splice(0, this.#entries.length - MAX_ENTRIES);
      void this.#removeStored(dropped.map((item) => item.id));
    }

    this.#emit();
    void this.#persist(entry);
    return entry.id;
  }

  /** 删掉指定快照（还原成功或用户确认后调用） */
  async forget(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const removing = new Set(ids);
    this.#entries = this.#entries.filter((entry) => !removing.has(entry.id));
    this.#emit();
    await this.#removeStored(ids);
  }

  /** 清空本次会话的全部记录（不回滚，只丢记录） */
  async clear(): Promise<void> {
    const ids = this.#entries.map((entry) => entry.id);
    await this.forget(ids);
  }

  async #persist(entry: SnapshotEntry): Promise<void> {
    const store = currentBackend();
    if (!store) return;
    try {
      await store.put(entry);
    } catch {
      // 写入失败不影响业务，内存里还有
    }
  }

  async #removeStored(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const store = currentBackend();
    if (!store) return;
    try {
      await store.remove(ids);
    } catch {
      // 同上
    }
  }
}

/** 全局单例 */
export const snapshots = new SnapshotStore();

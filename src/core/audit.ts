/**
 * 审计日志：记录每一次状态变更型操作。
 *
 * 为什么要记：
 * Webroit 的很多操作（冻结应用、改分辨率、模拟电量）在设备上是**静默生效**的，
 * 没有系统弹窗、没有二次确认。用户过两小时发现某个应用不见了，
 * 唯一能追溯的线索就是这里。
 *
 * 设计取舍：
 * - 只记「变更型」操作，只读查询不记（否则刷屏到无意义）
 * - 环形缓冲，上限 500 条，超出丢最旧的 —— 全量持久化会让 IndexedDB 无限膨胀
 * - 写入是同步入内存 + 异步落盘，不阻塞命令执行
 */

/** 一条操作记录 */
export interface AuditEntry {
  /** 唯一 ID */
  id: string;
  /** 毫秒时间戳 */
  at: number;
  /** 分区，如 apps / display */
  module: string;
  /** 工具 ID 或命令来源 */
  action: string;
  /** 人类可读的动作描述 */
  label: string;
  /** 实际执行的命令（可能多条） */
  commands: string[];
  /** 结果 */
  status: 'ok' | 'error' | 'aborted';
  /** 失败时的错误信息 */
  error?: string;
  /** 设备序列号，多设备时区分 */
  serial?: string;
}

/** 内存中的环形缓冲上限 */
const MAX_ENTRIES = 500;

/** IndexedDB 库名与存储名 */
const DB_NAME = 'webroit';
const STORE = 'audit';

/** 监听器 */
type Listener = (entries: AuditEntry[]) => void;

/**
 * 审计日志。
 *
 * 单例使用：整个应用一份，避免多个实例各存一半。
 */
export class AuditLog {
  #entries: AuditEntry[] = [];
  #listeners = new Set<Listener>();
  #db: IDBDatabase | null = null;
  #ready: Promise<void>;

  constructor() {
    this.#ready = this.#open();
  }

  /** 打开（或创建）IndexedDB */
  async #open(): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    try {
      this.#db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) {
            const store = db.createObjectStore(STORE, { keyPath: 'id' });
            store.createIndex('at', 'at');
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      // 启动时把最近记录读回内存
      const loaded = await this.#readAll();
      this.#entries = loaded.slice(-MAX_ENTRIES);
      this.#emit();
    } catch {
      // IndexedDB 不可用（隐私模式等）不影响主流程，退化成纯内存
      this.#db = null;
    }
  }

  async #readAll(): Promise<AuditEntry[]> {
    if (!this.#db) return [];
    return new Promise((resolve) => {
      const tx = this.#db!.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result as AuditEntry[]) ?? []);
      request.onerror = () => resolve([]);
    });
  }

  /** 就绪等待，UI 首屏前调用可保证读到历史 */
  async whenReady(): Promise<void> {
    return this.#ready;
  }

  /** 订阅变化，返回取消订阅函数 */
  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.#entries);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    /*
     * 发副本，不是内部数组本身。
     *
     * 这个数组是订阅者的渲染依据。`record()` 用 `push`、`update()` 用
     * `Object.assign`，两者都是就地改 —— 内部引用自始至终不变。直接把
     * `this.#entries` 发出去，订阅方（`AuditView` 的 `setEntries`）拿到的是
     * 同一个引用，Preact 按 `Object.is` 判等后跳过重渲染，表现是
     * **新记录写进去了、列表纹丝不动**。
     *
     * 实测（临时探针）：挂载后再记一条，列表从 2 条仍是 2 条；
     * 同一订阅者前后两次拿到的数组 `===` 成立。清空之所以"看起来生效"，
     * 只是因为 `clear()` 恰好赋了新数组。
     *
     * 复制一次的成本是 500 个元素上限的一次浅拷贝，可以忽略；
     * 换来的是「订阅者拿到的快照永远与此刻一致」这条不变量。
     */
    const snapshot = this.#entries.slice();
    for (const listener of this.#listeners) listener(snapshot);
  }

  /** 当前全部记录（副本，防止外部改动内部数组） */
  list(): AuditEntry[] {
    return [...this.#entries];
  }

  /**
   * 记录一次操作。
   *
   * 返回记录 ID，调用方可以在操作失败后补写错误信息。
   */
  record(entry: Omit<AuditEntry, 'id' | 'at'> & { at?: number }): string {
    const full: AuditEntry = {
      ...entry,
      id: crypto.randomUUID(),
      at: entry.at ?? Date.now(),
    };

    this.#entries.push(full);
    if (this.#entries.length > MAX_ENTRIES) {
      const dropped = this.#entries.splice(0, this.#entries.length - MAX_ENTRIES);
      void this.#deleteStored(dropped);
    }

    this.#emit();
    void this.#persist(full);
    return full.id;
  }

  /** 更新一条记录（典型场景：先记 ok，失败后改成 error） */
  update(id: string, patch: Partial<Pick<AuditEntry, 'status' | 'error' | 'commands'>>): void {
    const entry = this.#entries.find((item) => item.id === id);
    if (!entry) return;
    Object.assign(entry, patch);
    this.#emit();
    void this.#persist(entry);
  }

  async #persist(entry: AuditEntry): Promise<void> {
    if (!this.#db) return;
    try {
      const tx = this.#db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
    } catch {
      // 写入失败不影响业务，内存里还有
    }
  }

  async #deleteStored(entries: AuditEntry[]): Promise<void> {
    if (!this.#db || entries.length === 0) return;
    try {
      const tx = this.#db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const entry of entries) store.delete(entry.id);
    } catch {
      // 同上
    }
  }

  /**
   * 清空全部记录，并留下一条「清空」自述。
   *
   * 为什么清空要自动留痕，而不是让调用方自己补一条：
   * 这一页存在的唯一理由是「改过什么能追溯」。一份可以被无声抹掉的日志，
   * 抹掉之后与「从来没操作过」长得一模一样 —— 而这两种情况的含义完全相反。
   * 所以「清空必须留下痕迹」是日志自身的不变量，收在这里实现一次；
   * 指望每个调用点记得补一条，漏一个就等于给了个洗白入口。
   *
   * @returns 被清掉的条数（不含自述那条）
   */
  async clear(note?: { module: string; action: string; label: string }): Promise<number> {
    const removed = this.#entries.length;
    this.#entries = [];
    this.#emit();

    /*
     * 先清盘，再写自述 —— 顺序不能反。
     *
     * `record()` 内部会把新记录 `put` 进 IndexedDB。若先记自述再 `clear()`，
     * 那条自述会被紧接着的清库一起抹掉，刷新页面后断层依旧无法解释。
     */
    if (this.#db) {
      try {
        const tx = this.#db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
      } catch {
        // 忽略：盘上清不掉不影响内存里的结论
      }
    }

    if (note) {
      this.record({
        module: note.module,
        action: note.action,
        label: note.label,
        commands: [],
        status: 'ok',
      });
    }

    return removed;
  }

  /**
   * 导出为 JSON。
   * 用于用户反馈问题时报 bug —— 一份完整操作记录比口头描述有用得多。
   */
  export(): { blob: Blob; name: string } {
    const payload = {
      app: 'Webroit',
      exportedAt: new Date().toISOString(),
      count: this.#entries.length,
      entries: this.#entries,
    };
    const json = JSON.stringify(payload, null, 2);
    return {
      blob: new Blob([json], { type: 'application/json' }),
      name: `webroit-audit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`,
    };
  }
}

/** 全局单例 */
export const auditLog = new AuditLog();

/**
 * 包一层：执行命令并自动记录审计。
 *
 * 用法：
 *   await audited({ module: 'apps', action: 'freeze', label: '冻结 微信' },
 *     () => services.apps.disable('com.tencent.mm'));
 *
 * commands 支持两种形式：
 * - 数组：命令在调用前就已知
 * - 函数：命令要等 run() 跑完才知道（这是常态，因为工具内部才拼命令）。
 *   audited 在 run() 成功后、写盘前调用它，取到实际执行的命令。
 */
export async function audited<T>(
  meta: {
    module: string;
    action: string;
    label: string;
    commands?: string[] | (() => string[]);
    serial?: string;
  },
  run: () => Promise<T>,
): Promise<T> {
  const resolveCommands = (): string[] => {
    if (!meta.commands) return [];
    return typeof meta.commands === 'function' ? meta.commands() : meta.commands;
  };

  const id = auditLog.record({
    module: meta.module,
    action: meta.action,
    label: meta.label,
    commands: resolveCommands(),
    status: 'ok',
    serial: meta.serial,
  });

  try {
    const result = await run();
    // 命令在 run 之后才完整，这里补写一次 —— 成功路径同样需要命令留底
    const commands = resolveCommands();
    if (commands.length > 0) auditLog.update(id, { commands });
    return result;
  } catch (error) {
    const aborted = (error as Error)?.name === 'AbortError';
    auditLog.update(id, {
      status: aborted ? 'aborted' : 'error',
      error: aborted ? undefined : (error as Error).message,
      commands: resolveCommands(),
    });
    throw error;
  }
}

/**
 * `snapshot.ts` 单元测试。
 *
 * 这一层最容易出错的地方不是「记不记得住」，而是「顺序对不对」：
 * 回滚必须严格逆序，DPI 改了三次（420→300→480）时错一个顺序就把设备往错方向改。
 * 所以用例集中在 seq 单调性、上限截断、以及 settings 原值的逆向命令推导。
 *
 * 用纯内存模式（不注册后端）测核心逻辑，落盘行为另用假后端验证。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SnapshotStore, bindSnapshotBackend, settingsInverse, type SnapshotBackend } from './snapshot';

describe('settingsInverse', () => {
  it('有原值时生成 settings put 并给值加引号', () => {
    expect(settingsInverse('system', 'screen_off_timeout', '60000')).toBe(
      "settings put system screen_off_timeout '60000'",
    );
  });

  it('原值含空格时整体被引号包住，不被拆成两个参数', () => {
    expect(settingsInverse('secure', 'k', 'a b')).toBe("settings put secure k 'a b'");
  });

  it('原值为 null 时生成 delete，而不是 put null', () => {
    // 写成 put ... null 会真的把字符串 "null" 写入系统，是必须避免的坑
    expect(settingsInverse('system', 'animator_duration_scale', 'null')).toBe(
      'settings delete system animator_duration_scale',
    );
  });

  it('原值为空串时同样生成 delete', () => {
    expect(settingsInverse('global', 'k', '')).toBe('settings delete global k');
  });

  it('原值首尾空白被 trim 掉', () => {
    expect(settingsInverse('system', 'k', '  5  ')).toBe("settings put system k '5'");
  });
});

describe('SnapshotStore（纯内存）', () => {
  let store: SnapshotStore;

  beforeEach(() => {
    bindSnapshotBackend(null);
    store = new SnapshotStore();
  });

  it('刚建好时列表为空', () => {
    expect(store.list()).toEqual([]);
  });

  it('record 返回 ID，且能从 list 里取回这条记录', () => {
    const id = store.record({ module: 'display', label: 'DPI 440 → 320', restore: ['wm density 440'] });
    const entries = store.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(id);
    expect(entries[0].label).toBe('DPI 440 → 320');
    expect(entries[0].restore).toEqual(['wm density 440']);
  });

  it('restore 为空数组时拒绝记录 —— 记了也还原不回去，等于假快照', () => {
    expect(() => store.record({ module: 'display', label: 'x', restore: [] })).toThrow(
      /至少包含一条还原命令/,
    );
  });

  it('seq 严格单调递增，同一毫秒内也能排出先后', () => {
    // 固定时间戳制造「同一毫秒」场景，验证排序键不依赖 at
    const fixed = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(fixed);
    store.record({ module: 'display', label: 'a', restore: ['r1'] });
    store.record({ module: 'display', label: 'b', restore: ['r2'] });
    store.record({ module: 'display', label: 'c', restore: ['r3'] });
    vi.restoreAllMocks();

    const seqs = store.list().map((entry) => entry.seq);
    const ats = store.list().map((entry) => entry.at);
    expect(new Set(ats).size).toBe(1); // 时间戳确实相同
    expect(seqs[0]).toBeLessThan(seqs[1]);
    expect(seqs[1]).toBeLessThan(seqs[2]);
  });

  it('list 返回副本，外部改动不影响内部状态', () => {
    store.record({ module: 'display', label: 'a', restore: ['r'] });
    const snapshot = store.list();
    snapshot.pop();
    expect(store.list()).toHaveLength(1);
  });

  it('forget 按 ID 删除，未命中的 ID 静默忽略', async () => {
    const keep = store.record({ module: 'system', label: 'keep', restore: ['r'] });
    const drop = store.record({ module: 'system', label: 'drop', restore: ['r'] });
    await store.forget([drop, 'not-exist']);
    expect(store.list().map((entry) => entry.id)).toEqual([keep]);
  });

  it('forget 传空数组时什么也不做', async () => {
    store.record({ module: 'system', label: 'a', restore: ['r'] });
    await store.forget([]);
    expect(store.list()).toHaveLength(1);
  });

  it('clear 清空全部记录', async () => {
    store.record({ module: 'system', label: 'a', restore: ['r'] });
    store.record({ module: 'system', label: 'b', restore: ['r'] });
    await store.clear();
    expect(store.list()).toEqual([]);
  });

  it('subscribe 立刻回调一次当前值，退订后不再收到', () => {
    const listener = vi.fn();
    const off = store.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith([]);

    store.record({ module: 'display', label: 'a', restore: ['r'] });
    expect(listener).toHaveBeenCalledTimes(2);

    off();
    store.record({ module: 'display', label: 'b', restore: ['r'] });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('超过 200 条时丢掉最旧的，只保留最新 200 条', () => {
    for (let i = 0; i < 205; i++) {
      store.record({ module: 'display', label: `#${i}`, restore: ['r'] });
    }
    const entries = store.list();
    expect(entries).toHaveLength(200);
    expect(entries[0].label).toBe('#5');
    expect(entries.at(-1)?.label).toBe('#204');
  });
});

describe('SnapshotStore（带落盘后端）', () => {
  /** 用 Map 模拟后端，行为与 IndexedDB 版一致：put 覆盖、remove 批量删 */
  function memoryBackend(): SnapshotBackend & { rows: Map<string, never> } {
    const rows = new Map<string, never>();
    return {
      rows,
      readAll: async () => [...rows.values()] as never,
      put: async (entry) => {
        rows.set(entry.id, entry as never);
      },
      remove: async (ids) => {
        for (const id of ids) rows.delete(id);
      },
    };
  }

  it('注册后端后，record 会把记录写进后端', async () => {
    const backend = memoryBackend();
    bindSnapshotBackend(backend);
    const store = new SnapshotStore();
    await store.whenReady();
    store.record({ module: 'display', label: 'a', restore: ['r'] });
    await vi.waitFor(() => expect(backend.rows.size).toBe(1));
    bindSnapshotBackend(null);
  });

  it('后端读回上一会话的记录时按 sessionId 丢弃，不回放陈旧值', async () => {
    const backend = memoryBackend();
    // 伪造一条「别的会话」的记录：sessionId 不同即视为陈旧
    backend.rows.set('stale-1', {
      id: 'stale-1',
      sessionId: 'other-session',
      at: 1,
      seq: 1,
      module: 'display',
      label: 'old',
      restore: ['r'],
    } as never);

    bindSnapshotBackend(backend);
    const store = new SnapshotStore();
    await store.whenReady();

    expect(store.list()).toEqual([]);
    // 陈旧记录同时从后端清掉，避免越攒越多
    await vi.waitFor(() => expect(backend.rows.size).toBe(0));
    bindSnapshotBackend(null);
  });

  it('后端抛错时退化为纯内存，不影响 record 与 list', async () => {
    const broken: SnapshotBackend = {
      readAll: async () => {
        throw new Error('磁盘满');
      },
      put: async () => {
        throw new Error('磁盘满');
      },
      remove: async () => {
        throw new Error('磁盘满');
      },
    };
    bindSnapshotBackend(broken);
    const store = new SnapshotStore();
    await store.whenReady();

    expect(() => store.record({ module: 'system', label: 'a', restore: ['r'] })).not.toThrow();
    expect(store.list()).toHaveLength(1);
    bindSnapshotBackend(null);
  });
});

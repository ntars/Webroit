/**
 * `audit.ts` 单元测试。
 *
 * 这一层最容易被忽略的不是「记不记得住」，而是**订阅者拿到的到底是什么**。
 * 实测踩过的两个坑：
 *
 * 1. `#emit()` 直接把内部数组发出去，于是 `record()` 的 `push` 就地改数组、
 *    引用不变，订阅方（渲染层）按引用判等后跳过重渲染 ——
 *    **新记录写进去了、列表纹丝不动**。这类缺陷在单测里最容易漏，
 *    因为它不抛错、不返回异常值，只是「界面没变」。
 * 2. `clear()` 若只清不留痕，抹掉之后与「从来没操作过」长得一模一样，
 *    而这一页存在的理由正是追溯。所以「清空必须自述」也在这里锁住。
 *
 * 测试不注册 IndexedDB 后端（Node 里没有），走纯内存模式。
 */

import { describe, expect, it } from 'vitest';

import { AuditLog, type AuditEntry } from './audit';

/**
 * 造一份最小可用的记录入参。
 *
 * 返回类型显式写成 `Omit<AuditEntry, 'id' | 'at'>`，而不是用 `as const`
 * 收窄字面量 —— 后者会把 `commands` 变成只读元组，赋给 `string[]` 时类型不过。
 */
function entry(label: string, status: 'ok' | 'error' = 'ok'): Omit<AuditEntry, 'id' | 'at'> {
  return {
    module: 'apps',
    action: 'apps.disable',
    label,
    commands: ['pm disable-user --user 0 com.demo'],
    status,
  };
}

describe('AuditLog 订阅者拿到的快照', () => {
  it('record 之后订阅者拿到的是新数组引用', () => {
    const log = new AuditLog();
    const refs: unknown[] = [];
    log.subscribe((entries) => refs.push(entries));

    log.record(entry('第一条'));
    log.record(entry('第二条'));

    // 三次回调：订阅时立即回填一次 + 每次 record 一次
    expect(refs).toHaveLength(3);
    /*
     * 关键断言：相邻两次不能是同一个引用。
     * 若 #emit 直接发内部数组，这里会全等 —— 而那正是「界面不刷新」的根因。
     */
    expect(refs[1]).not.toBe(refs[0]);
    expect(refs[2]).not.toBe(refs[1]);
  });

  it('每次回调的内容与该时刻的真实状态一致', () => {
    const log = new AuditLog();
    const seen: number[] = [];
    log.subscribe((entries) => seen.push(entries.length));

    log.record(entry('一'));
    log.record(entry('二'));

    expect(seen).toEqual([0, 1, 2]);
  });

  it('订阅者改自己拿到的数组不会污染内部状态', () => {
    const log = new AuditLog();
    let received: unknown[] = [];
    log.subscribe((entries) => {
      received = entries as unknown[];
    });

    log.record(entry('一'));
    received.length = 0;

    // 内部仍应保有那一条
    expect(log.list()).toHaveLength(1);
  });

  it('update 之后订阅者也拿到新引用', () => {
    const log = new AuditLog();
    const refs: unknown[] = [];
    log.subscribe((entries) => refs.push(entries));

    const id = log.record(entry('待失败'));
    const before = refs.length;
    log.update(id, { status: 'error', error: 'permission denied' });

    expect(refs.length).toBe(before + 1);
    expect(refs.at(-1)).not.toBe(refs.at(-2));
  });

  it('环形缓冲超上限时丢掉最旧的，订阅者仍拿到正确长度', () => {
    const log = new AuditLog();
    let last: readonly unknown[] = [];
    log.subscribe((entries) => {
      last = entries;
    });

    for (let i = 0; i < 505; i++) log.record(entry(`第 ${i} 条`));

    expect(last).toHaveLength(500);
    // 丢的是最旧那 5 条：首条 label 应是「第 5 条」
    expect((last[0] as { label: string }).label).toBe('第 5 条');
  });
});

describe('AuditLog.clear', () => {
  it('返回被清掉的条数（不含自述记录）', async () => {
    const log = new AuditLog();
    log.record(entry('一'));
    log.record(entry('二'));

    await expect(log.clear()).resolves.toBe(2);
    expect(log.list()).toHaveLength(0);
  });

  it('带 note 清空后留下一条自述记录', async () => {
    const log = new AuditLog();
    log.record(entry('一'));
    log.record(entry('二'));

    const removed = await log.clear({
      module: 'audit',
      action: 'audit.clear',
      label: '清空操作记录（2 条）',
    });

    expect(removed).toBe(2);
    const rest = log.list();
    /*
     * 这一条是「清空必留痕」的核心：清完之后不能变成「从来没操作过」。
     * 少了它，设备被改坏时用户最需要的线索反而是最先消失的。
     */
    expect(rest).toHaveLength(1);
    expect(rest[0].action).toBe('audit.clear');
    expect(rest[0].label).toContain('2 条');
  });

  it('带 note 清空时，订阅者先看到空列表再看到自述记录', async () => {
    const log = new AuditLog();
    log.record(entry('一'));

    const lengths: number[] = [];
    log.subscribe((entries) => lengths.push(entries.length));

    await log.clear({ module: 'audit', action: 'audit.clear', label: '清空（1 条）' });

    // 订阅时回填 1 → clear 清空 0 → 自述写入 1
    expect(lengths).toEqual([1, 0, 1]);
  });

  it('空日志也能清空，返回 0 且只在有 note 时留痕', async () => {
    const log = new AuditLog();

    await expect(log.clear()).resolves.toBe(0);
    expect(log.list()).toHaveLength(0);

    await expect(log.clear({ module: 'audit', action: 'audit.clear', label: '清空（0 条）' })).resolves.toBe(0);
    expect(log.list()).toHaveLength(1);
  });
});

describe('AuditLog 导出', () => {
  it('导出内容含条数与全部记录', () => {
    const log = new AuditLog();
    log.record(entry('一'));
    log.record(entry('二'));

    const { blob, name } = log.export();
    expect(name.startsWith('webroit-audit-')).toBe(true);
    expect(name.endsWith('.json')).toBe(true);
    expect(blob.type).toBe('application/json');
  });
});

/**
 * 进度降频层测试。
 *
 * 这一层的价值全在「什么时候不刷新」上，所以用例的重心不是「能算出百分比」，
 * 而是三条容易写错的边界：
 * 1. 慢速小文件必须按时间动（否则卡在 0% 到最后突然 100%）
 * 2. 快速大文件必须按比例动，且总次数有上限（否则 1600 次回调全渲染）
 * 3. 换文件必须立刻重置（否则新文件继承上一个的高水位，显示 99% 起步）
 */

import { describe, expect, it } from 'vitest';

import {
  PROGRESS_MIN_INTERVAL,
  PROGRESS_PERCENT_STEP,
  ProgressThrottle,
  percentOf,
} from '@/ui/state/progress';

describe('percentOf', () => {
  it('正常换算并取整到百分比', () => {
    expect(percentOf(0, 200)).toBe(0);
    expect(percentOf(50, 200)).toBe(25);
    expect(percentOf(200, 200)).toBe(100);
  });

  it('总量未知或非法时返回 -1，而不是 0 或 NaN', () => {
    // 返回 0 会让界面显示「0%」并永远不动，比不显示更糟
    expect(percentOf(123, 0)).toBe(-1);
    expect(percentOf(123, -5)).toBe(-1);
    expect(percentOf(123, Number.NaN)).toBe(-1);
  });

  it('已传超过总量时封顶 100，不出现 103%', () => {
    expect(percentOf(300, 200)).toBe(100);
  });

  it('负的已传量夹到 0', () => {
    expect(percentOf(-10, 200)).toBe(0);
  });
});

describe('ProgressThrottle', () => {
  const TOTAL = 100 * 1024 * 1024; // 100 MB，与真实 APK 量级一致

  it('首个回调立即放行，界面不必等 120 ms 才动', () => {
    const throttle = new ProgressThrottle();
    const tick = throttle.accept({ label: 'a.apk', done: 0, total: TOTAL }, 1000);
    expect(tick).not.toBeNull();
    expect(tick?.percent).toBe(0);
  });

  it('窗口内且未跨 1% 的中间态被丢弃', () => {
    const throttle = new ProgressThrottle();
    throttle.accept({ label: 'a.apk', done: 0, total: TOTAL }, 1000);
    // 50 ms 后、只前进了 0.01%（远小于 1 个百分点）
    const dropped = throttle.accept({ label: 'a.apk', done: 10_000, total: TOTAL }, 1050);
    expect(dropped).toBeNull();
  });

  it('窗口未到但跨了 1 个百分点时放行 —— 快速传输也看得到动', () => {
    const throttle = new ProgressThrottle();
    throttle.accept({ label: 'a.apk', done: 0, total: TOTAL }, 1000);
    const tick = throttle.accept({ label: 'a.apk', done: 2 * 1024 * 1024, total: TOTAL }, 1010);
    expect(tick).not.toBeNull();
    expect(tick!.percent).toBeGreaterThanOrEqual(PROGRESS_PERCENT_STEP);
  });

  it('时间到了即使百分比没动也放行 —— 慢速小文件不会卡在 0%', () => {
    const throttle = new ProgressThrottle();
    throttle.accept({ label: 'a.apk', done: 0, total: TOTAL }, 1000);
    const tick = throttle.accept({ label: 'a.apk', done: 1, total: TOTAL }, 1000 + PROGRESS_MIN_INTERVAL);
    expect(tick).not.toBeNull();
  });

  it('字节数没前进时一律丢弃，避免同字节数反复渲染', () => {
    const throttle = new ProgressThrottle();
    throttle.accept({ label: 'a.apk', done: 5_000, total: TOTAL }, 1000);
    const dropped = throttle.accept({ label: 'a.apk', done: 5_000, total: TOTAL }, 2000);
    expect(dropped).toBeNull();
  });

  it('换文件立即重置，新文件从自己的 0% 起步', () => {
    const throttle = new ProgressThrottle();
    throttle.accept({ label: 'a.apk', done: 0, total: TOTAL }, 1000);
    throttle.accept({ label: 'a.apk', done: 99 * 1024 * 1024, total: TOTAL }, 2000);
    // 同一毫秒切到新文件
    const tick = throttle.accept({ label: 'b.apk', done: 0, total: TOTAL }, 2000);
    expect(tick).not.toBeNull();
    expect(tick!.label).toBe('b.apk');
    expect(tick!.percent).toBe(0);
  });

  it('传满时无条件放行 —— 终值不能被降频吃掉', () => {
    const throttle = new ProgressThrottle();
    throttle.accept({ label: 'a.apk', done: 0, total: TOTAL }, 1000);
    // 同一毫秒内直接跑到满：时间窗口远未到，百分比也没跨 1 个整点地连续刷新
    const tick = throttle.accept({ label: 'a.apk', done: TOTAL, total: TOTAL }, 1001);
    expect(tick).not.toBeNull();
    expect(tick!.percent).toBe(100);
  });

  it('1600 次逐块回调最多只放行 1% 粒度 —— 终端不再被刷爆', () => {
    const throttle = new ProgressThrottle();
    const blocks = 1600;
    const blockSize = TOTAL / blocks;
    let emitted = 0;
    for (let i = 0; i <= blocks; i++) {
      // 每块间隔 1 ms：模拟 USB 高速传输，时间条件几乎永远不满足
      const tick = throttle.accept({ label: 'a.apk', done: i * blockSize, total: TOTAL }, 1000 + i);
      if (tick) emitted++;
    }
    // 允许「比例 + 时间」两条通路，实际次数落在 100–200 之间；
    // 关键是远小于 1601，而不是精确等于某个数
    expect(emitted).toBeGreaterThan(50);
    expect(emitted).toBeLessThan(250);
  });

  it('finish() 强制交出终值，且与上次相同则不重复刷新', () => {
    const throttle = new ProgressThrottle();
    throttle.accept({ label: 'a.apk', done: 0, total: TOTAL }, 1000);
    throttle.accept({ label: 'a.apk', done: TOTAL / 2, total: TOTAL }, 1010);
    // 收尾发生在降频窗口内
    const forced = throttle.finish({ label: 'a.apk', done: TOTAL, total: TOTAL }, 1020);
    expect(forced).not.toBeNull();
    expect(forced!.percent).toBe(100);
    // 再调一次：状态没变，不必多推一帧
    expect(throttle.finish({ label: 'a.apk', done: TOTAL, total: TOTAL }, 1030)).toBeNull();
  });

  it('reset() 后重新开始计数，不被上一轮水位影响', () => {
    const throttle = new ProgressThrottle();
    throttle.accept({ label: 'a.apk', done: 0, total: TOTAL }, 1000);
    throttle.accept({ label: 'a.apk', done: 50 * 1024 * 1024, total: TOTAL }, 2000);
    throttle.reset();
    const tick = throttle.accept({ label: 'a.apk', done: 0, total: TOTAL }, 2001);
    expect(tick).not.toBeNull();
    expect(tick!.percent).toBe(0);
  });

  it('总量未知时只按时间节流，百分比保持 -1', () => {
    const throttle = new ProgressThrottle();
    throttle.accept({ label: 'x', done: 0, total: 0 }, 1000);
    expect(throttle.accept({ label: 'x', done: 4096, total: 0 }, 1050)).toBeNull();
    const tick = throttle.accept({ label: 'x', done: 8192, total: 0 }, 1000 + PROGRESS_MIN_INTERVAL);
    expect(tick).not.toBeNull();
    expect(tick!.percent).toBe(-1);
  });
});

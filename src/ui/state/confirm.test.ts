/**
 * 确认门槛判定的单测。
 *
 * 这个文件的由来是一次实测出来的分裂：同一个「卸载应用」，
 * 功能卡片里要手打「确认」，应用列表的「批量卸载」点一下就执行。
 * 两处各写一遍 `risk >= 2 && (confirmDangerous || risk >= 3)`，
 * 后写的那一处忘了 —— 所以判定收进 `gateFor()`，这里锁住它的行为。
 *
 * 重点在三条边界：
 * 1. 关掉「高危二次确认」后，2 级放行、3 级仍然拦 —— 开关不能买到不可逆操作。
 * 2. 3 级永远要确认词，不管开关怎么设。
 * 3. 0 / 1 级一律不问，否则每次读数据都弹框，用户会习惯性点确认，
 *    门槛本身就被训练失效了。
 */

import { describe, expect, it } from 'vitest';

import { CONFIRM_WORD, gateFor } from '@/ui/state/confirm';

describe('确认门槛', () => {
  it('只读操作从不询问', () => {
    expect(gateFor(0, true)).toEqual({ needsConfirm: false, needsWord: false });
    expect(gateFor(0, false)).toEqual({ needsConfirm: false, needsWord: false });
  });

  it('可逆操作不弹确认，但仍写审计', () => {
    expect(gateFor(1, true).needsConfirm).toBe(false);
    expect(gateFor(1, false).needsConfirm).toBe(false);
  });

  it('需确认级在开关打开时询问，且不要确认词', () => {
    const gate = gateFor(2, true);
    expect(gate.needsConfirm).toBe(true);
    expect(gate.needsWord).toBe(false);
  });

  it('需确认级在开关关闭时放行 —— 这是开关的正当用途', () => {
    expect(gateFor(2, false).needsConfirm).toBe(false);
  });

  it('高危级不受开关影响：关掉偏好仍然要问', () => {
    expect(gateFor(3, false).needsConfirm).toBe(true);
  });

  it('高危级永远要求手打确认词', () => {
    expect(gateFor(3, true).needsWord).toBe(true);
    expect(gateFor(3, false).needsWord).toBe(true);
  });

  it('确认词是两个字的中文，能被打出来但不顺手', () => {
    expect(CONFIRM_WORD).toBe('确认');
    expect(CONFIRM_WORD.length).toBeGreaterThanOrEqual(2);
  });
});

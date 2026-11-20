/**
 * 焦点陷阱的纯逻辑与 DOM 行为测试。
 *
 * `tabDestination()` 是不碰 DOM 的那一半，可以真跑；
 * 另一半（真的改 `document.activeElement`）挂在 `useFocusTrap` 上，
 * 需要 Preact 渲染环境 —— 那部分交给 `scripts/probe-focus.mjs` 在真浏览器里验。
 * 这里只测「算得对」，因为它是这个 hook 唯一会算错的地方。
 */

import { describe, expect, it } from 'vitest';

import { tabDestination } from './use-focus-trap';

describe('tabDestination', () => {
  it('正向：普通前进一格', () => {
    expect(tabDestination(0, 5, false)).toBe(1);
    expect(tabDestination(3, 5, false)).toBe(4);
  });

  it('正向：末尾回到开头', () => {
    expect(tabDestination(4, 5, false)).toBe(0);
  });

  it('反向：普通后退一格', () => {
    expect(tabDestination(3, 5, true)).toBe(2);
    expect(tabDestination(1, 5, true)).toBe(0);
  });

  it('反向：开头回绕到末尾', () => {
    expect(tabDestination(0, 5, true)).toBe(4);
  });

  it('焦点不在容器内时正向取第一个', () => {
    expect(tabDestination(-1, 5, false)).toBe(0);
  });

  it('焦点不在容器内时反向取最后一个', () => {
    expect(tabDestination(-1, 5, true)).toBe(4);
  });

  it('只有一个可聚焦元素时原地不动', () => {
    expect(tabDestination(0, 1, false)).toBe(0);
    expect(tabDestination(0, 1, true)).toBe(0);
  });

  it('没有可聚焦元素时返回 -1', () => {
    expect(tabDestination(0, 0, false)).toBe(-1);
    expect(tabDestination(-1, 0, true)).toBe(-1);
  });

  it('下标越界也能落回合法范围', () => {
    // 元素被卸载后 activeElement 可能仍指向旧节点，indexOf 会给到 length
    expect(tabDestination(9, 5, false)).toBe(0);
    expect(tabDestination(9, 5, true)).toBe(3);
  });
});

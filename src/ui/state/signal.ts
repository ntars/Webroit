/**
 * 全局状态：一个极小的信号实现 + 应用状态对象。
 *
 * 为什么不用状态库：整个应用只有「连接状态、当前分区、终端输出」三类共享状态，
 * 引入任何状态库都比自己写这 40 行重。Preact 的 hooks 配合这里的 signal
 * 已经足够，且不增加包体。
 */

import { useEffect, useState } from 'preact/hooks';

/** 信号：值 + 订阅者 */
export interface Signal<T> {
  readonly value: T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: (value: T) => void): () => void;
}

/** 创建一个信号 */
export function signal<T>(initial: T): Signal<T> {
  let current = initial;
  const listeners = new Set<(value: T) => void>();

  return {
    get value() {
      return current;
    },
    set(next) {
      const resolved =
        typeof next === 'function' ? (next as (prev: T) => T)(current) : next;
      if (Object.is(resolved, current)) return;
      current = resolved;
      for (const listener of listeners) listener(current);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** 在组件里订阅信号，返回当前值并触发重渲染 */
export function useSignal<T>(store: Signal<T>): T {
  const [value, setValue] = useState<T>(store.value);
  useEffect(() => store.subscribe(setValue), [store]);
  return value;
}

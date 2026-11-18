/**
 * `collect()` 的单测。
 *
 * 这个函数是所有命令输出与文件读取的唯一入口 —— 它出错的表现不是报错，
 * 而是「少读了几块」「上限不生效」「流没解锁导致下一次读卡死」这类静默故障。
 * 所以这里重点测三件事：字节完整、上限真的拦得住、reader 一定会被释放。
 */

import { describe, expect, it } from 'vitest';

import { collect } from '@/core/transport/stream';

/** 造一个按块吐字节的假流，记录 reader 是否被释放 */
function makeStream(chunks: Uint8Array[], options: { failAt?: number } = {}) {
  let cursor = 0;
  const state = { released: false, pulls: 0 };

  const source = {
    getReader() {
      return {
        async read() {
          if (options.failAt !== undefined && state.pulls === options.failAt) {
            state.pulls += 1;
            throw new Error('设备读取失败');
          }
          state.pulls += 1;
          if (cursor >= chunks.length) return { done: true as const };
          const value = chunks[cursor];
          cursor += 1;
          return { done: false as const, value };
        },
        releaseLock() {
          state.released = true;
        },
      };
    },
  };

  return { source, state };
}

const bytes = (...values: number[]) => new Uint8Array(values);

describe('collect', () => {
  it('把多块字节按顺序拼成一块', async () => {
    const { source } = makeStream([bytes(1, 2), bytes(3), bytes(4, 5)]);
    expect([...(await collect(source))]).toEqual([1, 2, 3, 4, 5]);
  });

  it('空流返回空数组，不抛错', async () => {
    const { source } = makeStream([]);
    expect((await collect(source)).length).toBe(0);
  });

  it('单块数据内容不变', async () => {
    const only = bytes(7, 8, 9);
    const { source } = makeStream([only]);
    expect([...(await collect(source))]).toEqual([7, 8, 9]);
  });

  it('按累计字节数回调进度', async () => {
    const seen: number[] = [];
    const { source } = makeStream([bytes(1, 1), bytes(2), bytes(3)]);
    await collect(source, { onProgress: (n) => seen.push(n) });
    expect(seen).toEqual([2, 3, 4]);
  });

  it('逐块回调原始字节，供流式解码使用', async () => {
    const first = bytes(65);
    const second = bytes(66);
    const got: Uint8Array[] = [];
    const { source } = makeStream([first, second]);
    await collect(source, { onChunk: (c) => got.push(c) });
    expect(got).toEqual([first, second]);
  });

  it('超过上限立即抛错，且错误信息带上限数值', async () => {
    const { source } = makeStream([bytes(1, 2, 3), bytes(4, 5, 6)]);
    await expect(collect(source, { limit: 5 })).rejects.toThrow(/超过 0 MB/);
  });

  it('恰好等于上限时正常返回（边界不误伤）', async () => {
    const { source } = makeStream([bytes(1, 2, 3), bytes(4, 5)]);
    expect((await collect(source, { limit: 5 })).length).toBe(5);
  });

  it('读失败时仍然释放 reader 的锁', async () => {
    const { source, state } = makeStream([bytes(1)], { failAt: 1 });
    await expect(collect(source)).rejects.toThrow('设备读取失败');
    expect(state.released).toBe(true);
  });

  it('正常读完也释放锁', async () => {
    const { source, state } = makeStream([bytes(1)]);
    await collect(source);
    expect(state.released).toBe(true);
  });

  it('跳过 done 为 false 但 value 缺失的异常块', async () => {
    let step = 0;
    const source = {
      getReader: () => ({
        read: async () => {
          step += 1;
          if (step === 1) return { done: false as const, value: undefined };
          if (step === 2) return { done: false as const, value: bytes(9) };
          return { done: true as const };
        },
        releaseLock: () => {},
      }),
    };
    expect([...(await collect(source))]).toEqual([9]);
  });
});

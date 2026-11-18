/**
 * 传输层的字节流工具：把「可读流」读成一块内存，附带体积上限与进度回调。
 *
 * 单独一个文件的原因有两个：
 * 1. `driver.ts` 已接近单文件上限，这段是纯函数，搬出来不影响任何调用方；
 * 2. 它能被单测覆盖 —— 不依赖 WebUSB、不依赖真机，只吃一个能读的流。
 *
 * 关于 `ByteSource` 这个窄接口（重要，别改回 `ReadableStream<Uint8Array>`）：
 * DOM 与 `@yume-chan/stream-extra` 各有一份 `ReadableStream` 声明，两者的
 * `getReader` 重载不同（一个有零参重载，一个没有），互相赋值会报 TS2345 / TS2739。
 * 但运行时它们是同一个类 —— `stream-extra` 的 `esm/stream.js` 直接
 * `export { ReadableStream }` 取的就是 `globalThis.ReadableStream`。
 * 所以差异纯粹在声明形状上。用只描述「能拿 reader、能读、能放锁」的窄接口收参，
 * 两边的流都能直接传进来，既不需要类型断言，也不必为了迁就类型复制一份读循环。
 */

import { joinBytes } from '@/core/utils';

/** 读取流的默认体积上限，防止一条命令把内存撑爆 */
export const STDOUT_LIMIT = 32 * 1024 * 1024;

/** 「能读出字节」的最小形状 */
export interface ByteSource {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    releaseLock(): void;
  };
}

/** 读取选项 */
export interface CollectOptions {
  /** 上限字节数，超出即抛错（不是截断 —— 截断会让调用方拿到半份数据却以为完整） */
  limit?: number;
  /** 每读到一块回调一次累计字节数 */
  onProgress?: (size: number) => void;
  /** 每读到一块回调原始字节，用于流式解码 */
  onChunk?: (chunk: Uint8Array) => void;
}

/**
 * 把可读流全量读进内存。
 *
 * 无论成功还是抛错，reader 的锁都会被释放 —— 不释放会让后续对这个流的操作全部卡死。
 */
export async function collect(
  readable: ByteSource,
  options: CollectOptions = {},
): Promise<Uint8Array> {
  const { limit = STDOUT_LIMIT, onProgress, onChunk } = options;
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.length;
      if (size > limit) {
        throw new Error(
          `输出超过 ${Math.round(limit / 1048576)} MB，请缩小命令范围或停止长时间运行的命令`,
        );
      }
      chunks.push(value);
      onProgress?.(size);
      onChunk?.(value);
    }
    return joinBytes(chunks);
  } finally {
    reader.releaseLock();
  }
}

/**
 * 工具层的宿主能力注入。
 *
 * 工具定义本身是纯声明，但它们有两件事必须由外部提供：
 * 1. 干活儿的服务从哪来（浏览器里是 WebUSB 会话，命令行里是子进程 adb）
 * 2. 产物（截屏、拉取的文件、导出的 APK）往哪交（浏览器触发下载，命令行写盘）
 *
 * 两者都用「注册一次、工具层只管取」的形态，所以工具定义不需要知道自己跑在哪儿。
 * 这个文件因此不能出现任何浏览器 API 与 Node API —— 它两侧都被编译，
 * 一旦混进 document 或 node:fs，另一侧就编译不过。这是「共享层真的可共享」的守门人。
 */

import type { Services } from '@/services/index';

/* ─────────────────────── 产物交付口 ─────────────────────── */

/**
 * 产物交付口。
 *
 * 浏览器里是「触发下载」，命令行里是「写进磁盘」—— 同一个工具在两处都要
 * 把截屏、拉取的文件、导出的 APK 交到用户手上，差别只在最后一步。
 *
 * 所以这里只留一个可替换的出口，具体实现由宿主注册：
 * 浏览器在 main.tsx 里注册下载实现，命令行注册写文件实现。
 */
export type FileSink = (blob: Blob, name: string) => void | Promise<void>;

let fileSink: FileSink | null = null;

/**
 * 注册产物交付口。
 *
 * 不做「默认浏览器下载」的兜底：那会让工具层重新带上 document，
 * 从而没法在 Node 侧编译。未注册时明确报错，比静默丢文件好 ——
 * 截屏和导出的 APK 拿不到，用户会以为是功能坏了。
 */
export function bindFileSink(sink: FileSink | null): void {
  fileSink = sink;
}

/** 交付一个产物 */
export function deliver(blob: Blob, name: string): Promise<void> {
  if (!fileSink) {
    throw new Error('未注册产物交付方式，无法保存文件（浏览器应注册下载实现，命令行应注册写盘实现）');
  }
  return Promise.resolve(fileSink(blob, name));
}

/* ─────────────────────── 服务解析器 ─────────────────────── */

/** services 从哪来 —— 由 app 层注入，避免工具层直接持有会话 */
let resolver: (() => Services | null) | null = null;

/** 注入服务解析器，应用启动时调一次 */
export function bindServices(fn: () => Services | null): void {
  resolver = fn;
}

/** 取当前服务，没有就报「设备未连接」 */
export function requireServices(): Services {
  const services = resolver?.();
  if (!services) throw new Error('设备未连接');
  return services;
}

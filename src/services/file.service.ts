/**
 * 文件服务：APK 安装（单包 / split）、推送、拉取、提取已装应用。
 *
 * 安装流程严格走 `pm install`，与手动敲命令完全一致：
 * 1. 先把 APK 推送到 /data/local/tmp（这个目录 shell 用户可写）
 * 2. 再 pm install，装完立刻清理临时文件
 *
 * split APK 走 install-create / install-write / install-commit 三步，
 * 中途失败必须 install-abandon，否则设备上会残留半截安装会话。
 */

import type { ShellContext } from '@/core/shell';
import type { ProgressSink } from '@/core/shell';
import {
  assertPackageName,
  baseName,
  checkAbort,
  quote,
  safeFileName,
  toArrayBuffer,
} from '@/core/utils';

/** 安装结果 */
export interface InstallResult {
  name: string;
  success: boolean;
  message: string;
}

/** 安装选项 */
export interface InstallOptions {
  /** 是否按 split APK 方式安装 */
  split?: boolean;
  /** 允许降级安装 */
  allowDowngrade?: boolean;
  signal?: AbortSignal;
}

export class FileService {
  #shell: ShellContext;
  #sdk: number;

  constructor(shell: ShellContext, sdk: number) {
    this.#shell = shell;
    this.#sdk = sdk;
  }

  /** 推送到设备临时目录 */
  #tempPath(extension = '.apk'): string {
    const random = Math.random().toString(36).slice(2, 8);
    return `/data/local/tmp/webroit_${Date.now()}_${random}${extension}`;
  }

  /**
   * 安装一个或多个 APK。
   * split=true 时按拆分包流程安装。
   */
  async install(files: File[], options: InstallOptions = {}): Promise<InstallResult[]> {
    const { split = false, allowDowngrade = false, signal } = options;
    if (!files.length) throw new Error('未选择 APK');

    for (const file of files) {
      if (!/\.apk$/i.test(file.name)) throw new Error(`${file.name} 不是 APK 文件`);
    }

    // --bypass-low-target-sdk-block 仅 Android 14+ 需要，用于装老目标版本应用
    const installFlags =
      `-r${allowDowngrade ? ' -d' : ''}` +
      `${this.#sdk >= 34 ? ' --bypass-low-target-sdk-block' : ''}`;

    const staged: string[] = [];
    const results: InstallResult[] = [];
    let sessionId: string | null = null;
    let committed = false;

    try {
      for (const file of files) {
        checkAbort(signal);
        const remote = this.#tempPath();
        staged.push(remote);

        this.#shell.info(`推送 ${file.name}（${(file.size / 1048576).toFixed(1)} MB）…`);
        await this.#shell.driver.write(file, remote, {
          signal,
          onProgress: (done, total) => this.#shell.reportProgress(file.name, done, total),
        });

        if (split) continue;

        try {
          const output = await this.#shell.mutation(`pm install ${installFlags} ${quote(remote)}`, {
            signal,
          });
          if (!/\bSuccess\b/.test(output)) throw new Error(output || '系统未返回安装成功');
          results.push({ name: file.name, success: true, message: '安装成功' });
        } catch (error) {
          if ((error as Error).name === 'AbortError') throw error;
          results.push({
            name: file.name,
            success: false,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (split && staged.length) {
        const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
        const create = await this.#shell.mutation(
          `pm install-create ${installFlags} -S ${totalBytes}`,
          { signal },
        );
        const match = create.match(/\[(\d+)\]/);
        if (!match) throw new Error(create || '创建安装会话失败');
        sessionId = match[1];

        for (let index = 0; index < files.length; index++) {
          const output = await this.#shell.mutation(
            `pm install-write -S ${files[index].size} ${sessionId} ${quote(`part${index}.apk`)} ${quote(staged[index])}`,
            { signal },
          );
          if (!/\bSuccess\b/.test(output)) throw new Error(output || '写入拆分 APK 失败');
        }

        const commit = await this.#shell.mutation(`pm install-commit ${sessionId}`, { signal });
        if (!/\bSuccess\b/.test(commit)) throw new Error(commit || '提交安装失败');
        committed = true;
        results.push({ name: '拆分 APK（共 ' + files.length + ' 个）', success: true, message: '安装成功' });
      }

      return results;
    } finally {
      // 未提交的会话必须放弃，否则设备上会留下挂起的会话
      if (sessionId && !committed) {
        await this.#shell
          .text(`pm install-abandon ${sessionId}`, { log: false, allowFailure: true })
          .catch(() => {});
      }
      if (staged.length) {
        await this.#shell
          .text(`rm -f ${staged.map(quote).join(' ')}`, { log: false, allowFailure: true })
          .catch(() => {});
      }
    }
  }

  /** 推送任意文件到设备 */
  async push(file: File, remotePath: string, signal?: AbortSignal): Promise<string> {
    if (!String(remotePath).startsWith('/')) {
      throw new Error('手机路径必须以 / 开头');
    }
    // 拒绝 NUL 与换行：这两类字符会让 shell 命令被截断或注入第二条命令。
    // eslint-disable-next-line no-control-regex
    if (/[\u0000\r\n]/.test(remotePath)) {
      throw new Error('手机路径包含非法字符');
    }
    await this.#shell.driver.write(file, remotePath, {
      signal,
      onProgress: (done, total) => this.#shell.reportProgress(file.name, done, total),
    });
    return `${file.name} → ${remotePath}（${file.size} 字节）`;
  }

  /** 从设备拉取文件 */
  async pull(remotePath: string, signal?: AbortSignal): Promise<{ blob: Blob; name: string }> {
    const name = safeFileName(baseName(remotePath) || 'file');
    const blob = await this.#shell.driver.read(remotePath, {
      signal,
      onProgress: (done, total) => this.#shell.reportProgress(name, done, total),
    });
    return { blob, name };
  }

  /**
   * 提取已安装应用的 APK。
   * 单 APK 直接拉取；split APK 逐个拉取后打包成 zip。
   */
  async extractApk(
    packageName: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<{ blob: Blob; name: string; split: boolean }> {
    const name = assertPackageName(packageName);

    const pathText = await this.#shell.text(`pm path ${quote(name)}`, { log: false });
    const paths = pathText
      .split(/\r?\n/)
      .filter((line) => line.startsWith('package:'))
      .map((line) => line.slice(8).trim());
    if (!paths.length) throw new Error(`${name} 未安装或无权访问`);

    const info = await this.#shell.text(`dumpsys package ${quote(name)}`, { log: false });
    const version = info.match(/\bversionName=([^\s]+)/)?.[1] ?? 'unknown';

    if (paths.length === 1) {
      const blob = await this.#shell.driver.read(paths[0], {
        signal: options.signal,
        onProgress: (done, total) => this.#shell.reportProgress(name, done, total),
      });
      return {
        blob,
        name: `${name}_${safeFileName(version)}.apk`,
        split: false,
      };
    }

    // split APK：逐个拉取后在浏览器端打包
    const parts: { name: string; bytes: Uint8Array }[] = [];
    for (const path of paths) {
      checkAbort(options.signal);
      const blob = await this.#shell.driver.read(path, { signal: options.signal });
      parts.push({
        name: baseName(path),
        bytes: new Uint8Array(await blob.arrayBuffer()),
      });
    }

    return {
      blob: buildZip(parts),
      name: `${name}_${safeFileName(version)}_split.zip`,
      split: true,
    };
  }

  /** 列出设备某个目录下的内容 */
  async list(remotePath: string): Promise<{ name: string; size: number; dir: boolean }[]> {
    const text = await this.#shell.text(`ls -la ${quote(remotePath)}`, {
      log: false,
      allowFailure: true,
    });
    const entries: { name: string; size: number; dir: boolean }[] = [];
    for (const line of text.split(/\r?\n/)) {
      // ls -la 每行形如：drwxr-xr-x 2 root root 4096 2026-11-15 14:00 folder
      // 字符组里的 - 放在首位即表示字面量连字符，无需转义。
      const match = line.match(/^([-dl])\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+(.+)$/);
      if (!match) continue;
      const name = match[3].trim();
      if (name === '.' || name === '..') continue;
      entries.push({ name, size: Number(match[2]), dir: match[1] === 'd' });
    }
    return entries;
  }
}

/* ─────────────────────── 浏览器端 zip 打包 ─────────────────────── */

/** CRC32 查表，避免引入压缩库 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 生成不压缩的 zip（store 模式）。
 * APK 本身就是压缩过的，再压一次几乎没收益，反而浪费 CPU。
 */
function buildZip(files: { name: string; bytes: Uint8Array }[]): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  let centralSize = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.bytes);

    // 本地文件头
    const header = new Uint8Array(30 + nameBytes.length);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, 0x04034b50, true); // 签名
    headerView.setUint16(4, 20, true); // 解压所需版本
    headerView.setUint16(6, 0x0800, true); // UTF-8 文件名标志
    headerView.setUint16(12, 0x21, true); // 修改时间
    headerView.setUint32(14, crc, true);
    headerView.setUint32(18, file.bytes.length, true); // 压缩后大小
    headerView.setUint32(22, file.bytes.length, true); // 原始大小
    headerView.setUint16(26, nameBytes.length, true);
    header.set(nameBytes, 30);

    // 中央目录项
    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(14, 0x21, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.bytes.length, true);
    centralView.setUint32(24, file.bytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    chunks.push(header, file.bytes);
    directory.push(central);
    offset += header.length + file.bytes.length;
    centralSize += central.length;
  }

  // 中央目录结束记录
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return new Blob([...chunks.map(toArrayBuffer), ...directory.map(toArrayBuffer), toArrayBuffer(end)], { type: 'application/zip' });
}

export type { ProgressSink };

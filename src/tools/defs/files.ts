/**
 * 文件分区工具。
 *
 * 四项：安装 APK、双向传输、提取安装包、浏览目录。
 */

import type { Tool } from '@/tools/registry';
import { formatBytes } from '@/core/utils';
import { deliver, requireServices } from '@/tools/host';
import { bool, str } from '@/tools/input';

export const fileTools: Tool[] = [
  {
    id: 'files.install',
    module: 'files',
    title: '安装 APK',
    description: '安装单个 APK，或一次选中多个分卷包完成整套安装',
    risk: 2,
    params: [
      {
        key: 'file',
        label: 'APK 文件',
        type: 'file',
        required: true,
        hint: '分卷包请一次选中全部 .apk 文件',
      },
      {
        key: 'downgrade',
        label: '允许降级',
        type: 'boolean',
        defaultValue: false,
        hint: '安装版本号低于当前已装版本的包',
      },
    ],
    available: (caps) => caps.canUsePm && caps.canUseSync,
    async run({ input, signal }) {
      const raw = input.file;
      const files = (Array.isArray(raw) ? raw : [raw]).filter(
        (item): item is File => item instanceof File,
      );
      if (files.length === 0) throw new Error('未选择文件');

      const results = await requireServices().files.install(files, {
        // 多文件必然是分卷包，自动走 install-create 流程
        split: files.length > 1,
        allowDowngrade: bool(input, 'downgrade'),
        signal,
      });
      const ok = results.filter((item) => item.success).length;
      return {
        summary: `安装完成：成功 ${ok} 个，失败 ${results.length - ok} 个`,
        data: results,
      };
    },
  },
  {
    id: 'files.transfer',
    module: 'files',
    title: '传输文件',
    description: '把本地文件推送到手机，或从手机拉取文件到本地',
    risk: 1,
    params: [
      {
        key: 'direction',
        label: '方向',
        type: 'select',
        required: true,
        defaultValue: 'push',
        options: [
          { label: '推送到手机', value: 'push' },
          { label: '从手机拉取', value: 'pull' },
        ],
      },
      {
        key: 'file',
        label: '本地文件',
        type: 'file',
        hint: '仅「推送到手机」需要选择',
      },
      {
        key: 'remote',
        label: '手机上的路径',
        type: 'text',
        required: true,
        defaultValue: '/sdcard/Download/',
        placeholder: '/sdcard/Download/a.txt',
        hint: '推送时以 / 结尾表示目录，会自动补上文件名；拉取时填完整文件路径',
      },
    ],
    available: (caps) => caps.canUseSync,
    async run({ input, signal }) {
      const direction = str(input, 'direction', 'push');
      const remote = str(input, 'remote');
      const files = requireServices().files;

      if (direction === 'pull') {
        const pulled = await files.pull(remote, signal);
        await deliver(pulled.blob, pulled.name);
        return { summary: `已拉取 ${pulled.name}（${formatBytes(pulled.blob.size)}）` };
      }

      const file = input.file;
      if (!(file instanceof File)) throw new Error('未选择文件');
      const target = await files.push(file, remote, signal);
      return { summary: `已推送到 ${target}` };
    },
  },
  {
    id: 'files.extract',
    module: 'files',
    title: '提取安装包',
    description: '把已安装应用的 APK 导出到本地，分卷应用自动打包成 zip',
    risk: 0,
    params: [
      { key: 'package', label: '包名', type: 'text', required: true, placeholder: 'com.tencent.mm' },
    ],
    available: (caps) => caps.canUsePm && caps.canUseSync,
    async run({ input }) {
      const result = await requireServices().files.extractApk(str(input, 'package'));
      await deliver(result.blob, result.name);
      return {
        summary: `已导出 ${result.name}（${formatBytes(result.blob.size)}）${result.split ? '，含分卷包' : ''}`,
      };
    },
  },
  {
    id: 'files.list',
    module: 'files',
    title: '浏览目录',
    description: '列出手机上某个目录的文件与子目录',
    risk: 0,
    params: [
      {
        key: 'path',
        label: '目录路径',
        type: 'text',
        required: true,
        defaultValue: '/sdcard',
        placeholder: '/sdcard',
      },
    ],
    available: () => true,
    async run({ input }) {
      const entries = await requireServices().files.list(str(input, 'path', '/sdcard'));
      return { summary: `共 ${entries.length} 项`, data: entries };
    },
  },
];

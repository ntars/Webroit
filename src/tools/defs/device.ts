/**
 * 设备分区工具。
 *
 * 只有一项：重启。设备总览视图进入即自动采集硬件画像，再放一张读取卡片
 * 就是同一件事的两个入口，用户会不知道该点哪个。
 */

import type { Tool } from '@/tools/registry';
import { requireServices } from '@/tools/host';
import { str } from '@/tools/input';

export const deviceTools: Tool[] = [
  {
    id: 'device.reboot',
    module: 'device',
    title: '重启设备',
    description: '重启系统、进入 Recovery / Bootloader / EDL，或直接关机',
    risk: 3,
    params: [
      {
        key: 'mode',
        label: '重启模式',
        type: 'select',
        required: true,
        defaultValue: 'system',
        options: [
          { label: '重启系统', value: 'system' },
          { label: 'Recovery 模式', value: 'recovery' },
          { label: 'Bootloader', value: 'bootloader' },
          { label: 'Fastbootd', value: 'fastboot' },
          { label: 'EDL（9008）', value: 'edl' },
          { label: '关机', value: 'poweroff' },
        ],
        hint: '进入 Recovery / Bootloader / EDL 后 ADB 连接会断开，属正常现象',
      },
    ],
    available: () => true,
    async run({ input }) {
      const mode = str(input, 'mode', 'system') as
        | 'system'
        | 'recovery'
        | 'bootloader'
        | 'fastboot'
        | 'edl'
        | 'poweroff';
      const message = await requireServices().device.reboot(mode);
      return { summary: message, destructive: mode !== 'system' };
    },
  },
];

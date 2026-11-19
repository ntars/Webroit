/**
 * 电池分区工具。
 *
 * 两项：模拟（电量 / 温度 / 电压 / 充电状态 / 充电来源合并为一张卡片）、
 * 精确还原。都是 `dumpsys battery set` 系列命令。
 */

import type { Tool } from '@/tools/registry';
import { requireServices } from '@/tools/host';
import { str } from '@/tools/input';

export const batteryTools: Tool[] = [
  {
    id: 'battery.simulate',
    module: 'battery',
    title: '模拟电池',
    description: '伪造电量、温度、电压，或模拟不同的充电来源',
    risk: 2,
    params: [
      {
        key: 'kind',
        label: '模拟项目',
        type: 'select',
        required: true,
        defaultValue: 'level',
        options: [
          { label: '电量百分比', value: 'level' },
          { label: '电池温度', value: 'temperature' },
          { label: '电池电压', value: 'voltage' },
          { label: '充电状态', value: 'status' },
          { label: '充电来源', value: 'source' },
        ],
      },
      {
        key: 'value',
        label: '数值 / 选项',
        type: 'text',
        placeholder: '15',
        hint: '电量 0~100；温度 -50~150℃；电压 3000~5000mV；充电状态可填 unknown / charging / discharging / not-charging / full；充电来源可填 usb / ac / wireless / unplugged',
      },
    ],
    available: (caps) => caps.canUseDumpsys,
    async run({ input }) {
      const kind = str(input, 'kind', 'level');
      const raw = input.value;
      const battery = requireServices().battery;

      if (kind === 'source') {
        const source = String(raw ?? 'usb').trim() as 'usb' | 'ac' | 'wireless' | 'unplugged';
        const result = await battery.setSource(source, source !== 'unplugged');
        return {
          summary: `已模拟为 ${source} 供电状态`,
          data: result,
          destructive: true,
        };
      }

      const result = await battery.set(
        kind as 'level' | 'temperature' | 'voltage' | 'status',
        raw,
      );
      return {
        summary: `已模拟：电量 ${result.level ?? '?'}% · 温度 ${result.temperature ?? '?'}℃ · ${result.status ?? '?'}`,
        data: result,
        destructive: true,
      };
    },
  },
  {
    id: 'battery.restore',
    module: 'battery',
    title: '还原电池状态',
    description: '把模拟过的参数逐项写回真实值',
    risk: 1,
    params: [],
    available: (caps) => caps.canUseDumpsys,
    async run() {
      const message = await requireServices().battery.restore();
      return { summary: message };
    },
  },
];

/**
 * 显示与输入分区工具。
 *
 * 四项：读取显示参数、修改显示参数、截屏、模拟操作。
 * 「分辨率 / DPI / 还原」合并为一张卡片 —— 都是 `wm` 命令，还原是它的反向操作。
 */

import type { Tool } from '@/tools/registry';
import { COMMON_KEYS } from '@/services/display.service';
import { formatBytes } from '@/core/utils';
import { deliver, requireServices } from '@/tools/host';
import { bool, num, str } from '@/tools/input';

export const displayTools: Tool[] = [
  {
    id: 'display.read',
    module: 'display',
    title: '读取显示参数',
    description: '当前分辨率、屏幕密度、最小宽度 dp',
    risk: 0,
    params: [],
    available: (caps) => caps.canUseWmSize,
    async run() {
      const status = await requireServices().display.status();
      return {
        summary: `${status.width ?? '?'} × ${status.height ?? '?'} @ ${status.dpi ?? '?'} dpi`,
        data: status,
      };
    },
  },
  {
    id: 'display.write',
    module: 'display',
    title: '修改显示参数',
    description: '调整分辨率或屏幕密度，也可以还原为出厂值',
    risk: 3,
    params: [
      {
        key: 'target',
        label: '修改项',
        type: 'select',
        required: true,
        defaultValue: 'resolution',
        options: [
          { label: '分辨率', value: 'resolution' },
          { label: '屏幕密度（DPI）', value: 'density' },
          { label: '还原到出厂值', value: 'reset' },
        ],
        hint: '改错可能导致界面错位，可用「还原到出厂值」恢复',
      },
      {
        key: 'width',
        label: '宽度',
        type: 'number',
        min: 320,
        max: 7680,
        placeholder: '1080',
        hint: '仅「分辨率」需要填写',
      },
      {
        key: 'height',
        label: '高度',
        type: 'number',
        min: 320,
        max: 7680,
        placeholder: '2400',
        hint: '仅「分辨率」需要填写',
      },
      {
        key: 'density',
        label: '屏幕密度',
        type: 'number',
        min: 72,
        max: 1000,
        placeholder: '420',
        hint: '仅「屏幕密度」需要填写，单位 DPI',
      },
    ],
    available: (caps) => caps.canUseWmSize,
    async run({ input }) {
      const target = str(input, 'target', 'resolution');
      const display = requireServices().display;

      if (target === 'reset') {
        // 分辨率与密度分别消除覆盖值，两个都要 reset 才算真正还原
        const afterSize = await display.reset('size');
        const afterDensity = await display.reset('density');
        return {
          summary: `已还原：${afterSize.width} × ${afterSize.height} @ ${afterDensity.dpi} dpi`,
          data: afterDensity,
        };
      }

      if (target === 'density') {
        const result = await display.setDensity(num(input, 'density'), 'dpi');
        return {
          summary: `屏幕密度已改为 ${result.dpi} dpi`,
          data: result,
          destructive: true,
        };
      }

      const result = await display.setResolution(num(input, 'width'), num(input, 'height'));
      return {
        summary: `分辨率已改为 ${result.width} × ${result.height}`,
        data: result,
        destructive: true,
      };
    },
  },
  {
    id: 'display.screenshot',
    module: 'display',
    title: '截屏',
    description: '截取当前屏幕并保存到本地',
    risk: 0,
    params: [],
    available: (caps) => caps.canUseScreenshot && caps.canUseSync,
    async run() {
      const services = requireServices();
      const shot = await services.display.screenshot();
      try {
        await deliver(shot.blob, shot.name);
      } finally {
        // 无论下载是否成功，设备上的临时文件都要清掉
        await services.display.removeTemp(shot.remote);
      }
      return { summary: `已截屏：${shot.name}（${formatBytes(shot.blob.size)}）` };
    },
  },
  {
    id: 'display.input',
    module: 'display',
    title: '模拟操作',
    description: '发送按键、点击坐标、滑动或输入文字',
    risk: 2,
    params: [
      {
        key: 'kind',
        label: '操作类型',
        type: 'select',
        required: true,
        defaultValue: 'key',
        options: [
          { label: '按键', value: 'key' },
          { label: '点击坐标', value: 'tap' },
          { label: '滑动', value: 'swipe' },
          { label: '输入文字', value: 'text' },
        ],
      },
      {
        key: 'key',
        label: '按键',
        type: 'select',
        defaultValue: '4',
        options: COMMON_KEYS.map((key) => ({ label: key.label, value: String(key.code) })),
        hint: '仅「按键」需要选择',
      },
      {
        key: 'longPress',
        label: '长按按键',
        type: 'boolean',
        defaultValue: false,
        hint: '仅「按键」有效，如长按电源键弹出关机菜单',
      },
      { key: 'x1', label: '起点 X', type: 'number', min: 0, max: 16384, placeholder: '540' },
      { key: 'y1', label: '起点 Y', type: 'number', min: 0, max: 16384, placeholder: '1200' },
      {
        key: 'x2',
        label: '终点 X',
        type: 'number',
        min: 0,
        max: 16384,
        placeholder: '540',
        hint: '仅「滑动」需要填写',
      },
      {
        key: 'y2',
        label: '终点 Y',
        type: 'number',
        min: 0,
        max: 16384,
        placeholder: '400',
        hint: '仅「滑动」需要填写',
      },
      {
        key: 'text',
        label: '文字',
        type: 'text',
        placeholder: 'hello world',
        hint: '仅「输入文字」需要填写，只支持 ASCII',
      },
    ],
    available: (caps) => caps.canUseInput,
    async run({ input }) {
      const kind = str(input, 'kind', 'key');
      const display = requireServices().display;

      if (kind === 'tap') {
        await display.tap(num(input, 'x1'), num(input, 'y1'));
        return { summary: `已在 (${num(input, 'x1')}, ${num(input, 'y1')}) 点击` };
      }
      if (kind === 'swipe') {
        await display.swipe(
          num(input, 'x1'),
          num(input, 'y1'),
          num(input, 'x2'),
          num(input, 'y2'),
        );
        return { summary: `已从 (${num(input, 'x1')}, ${num(input, 'y1')}) 滑动到 (${num(input, 'x2')}, ${num(input, 'y2')})` };
      }
      if (kind === 'text') {
        await display.inputText(str(input, 'text'));
        return { summary: '文字已发送' };
      }

      const code = str(input, 'key', '4');
      const long = bool(input, 'longPress');
      await display.pressKey(code, long);
      const label = COMMON_KEYS.find((key) => String(key.code) === code)?.label ?? code;
      return { summary: `已发送${long ? '长按' : ''}按键：${label}` };
    },
  },
];

/**
 * 系统调校分区工具。
 *
 * 七项：读取系统参数、修改系统参数、状态栏图标、沉浸模式、
 * WiFi 验证修复、一键还原、应急重置显示。
 *
 * 「字体 / 三种动画 / 锁屏时间」合并为一张卡片 —— 都是 `settings put`，只是参数名不同。
 */

import type { Tool } from '@/tools/registry';
import { STATUS_ICON_SLOTS } from '@/services/system.service';
import { packageList, num, str } from '@/tools/input';
import { requireServices } from '@/tools/host';

export const systemTools: Tool[] = [
  {
    id: 'system.read',
    module: 'system',
    title: '读取系统参数',
    description: '当前字体缩放、三种动画倍率、自动锁屏时间',
    risk: 0,
    params: [],
    available: (caps) => caps.canUseSettings,
    async run() {
      const state = await requireServices().system.tuning();
      /*
       * 读不到时要说明「未设置」，不能显示成 ? 或 NaN。
       * 未设置是设备本来就没有这个键（部分 ROM 如此），
       * 与「读失败」是两件事，但对用户来说结果一样：当前没有生效值。
       */
      const show = (value: number | null): string => (value === null ? '未设置' : `${value}×`);
      return {
        summary: `字体 ${show(state.fontScale)} · 动画 ${show(state.windowAnimation)}`,
        data: state,
      };
    },
  },
  {
    id: 'system.write',
    module: 'system',
    title: '修改系统参数',
    description: '调整字体缩放、动画倍率或自动锁屏时间',
    risk: 1,
    params: [
      {
        key: 'key',
        label: '参数',
        type: 'select',
        required: true,
        defaultValue: 'window_animation_scale',
        options: [
          { label: '窗口动画倍率', value: 'window_animation_scale' },
          { label: '过渡动画倍率', value: 'transition_animation_scale' },
          { label: '属性动画倍率', value: 'animator_duration_scale' },
          { label: '字体缩放', value: 'font_scale' },
          { label: '自动锁屏时间（秒）', value: 'screen_off_timeout' },
        ],
      },
      {
        key: 'value',
        label: '数值',
        type: 'number',
        required: true,
        step: 0.1,
        min: 0,
        max: 86400,
        defaultValue: 0.5,
        hint: '动画倍率填 0~4（0 关闭、1 默认）；字体填 0.85~1.3；锁屏时间填 15~1800 秒',
      },
    ],
    available: (caps) => caps.canUseSettings,
    async run({ input }) {
      const key = str(input, 'key', 'window_animation_scale');
      const value = num(input, 'value');
      const system = requireServices().system;

      if (key === 'screen_off_timeout') {
        await system.setScreenTimeout(value);
        return { summary: `自动锁屏已设为 ${value} 秒` };
      }
      await system.setTuning(key as 'font_scale' | 'window_animation_scale' | 'transition_animation_scale' | 'animator_duration_scale', value);
      const labels: Record<string, string> = {
        window_animation_scale: '窗口动画',
        transition_animation_scale: '过渡动画',
        animator_duration_scale: '属性动画',
        font_scale: '字体缩放',
      };
      return { summary: `${labels[key] ?? key}已设为 ${value}×` };
    },
  },
  {
    id: 'system.statusIcons',
    module: 'system',
    title: '状态栏图标',
    description: '隐藏状态栏上不需要的图标，保留其余设置不变',
    risk: 1,
    params: [
      {
        key: 'hidden',
        label: '要隐藏的图标',
        type: 'text',
        defaultValue: '',
        placeholder: 'nfc, alarm_clock',
        hint: `留空表示全部恢复。可选：${STATUS_ICON_SLOTS.map((slot) => slot.key).join(' / ')}`,
      },
    ],
    available: (caps) => caps.canWriteSecureSettings,
    async run({ input }) {
      const hidden = packageList(str(input, 'hidden'));
      await requireServices().system.setStatusIcons(hidden);
      return {
        summary: hidden.length ? `已隐藏 ${hidden.length} 个状态栏图标` : '已恢复全部状态栏图标',
      };
    },
  },
  {
    id: 'system.immersive',
    module: 'system',
    title: '沉浸模式',
    description: '隐藏状态栏或导航栏，获得完整屏幕显示',
    risk: 1,
    params: [
      {
        key: 'kind',
        label: '模式',
        type: 'select',
        defaultValue: 'full',
        options: [
          { label: '全屏（状态栏 + 导航栏）', value: 'full' },
          { label: '仅隐藏状态栏', value: 'status' },
          { label: '仅隐藏导航栏', value: 'navigation' },
          { label: '退出沉浸模式', value: 'reset' },
        ],
      },
    ],
    available: (caps) => caps.canWriteSecureSettings,
    async run({ input }) {
      const kind = str(input, 'kind', 'full') as 'status' | 'navigation' | 'full' | 'reset';
      await requireServices().system.immersive(kind);
      return { summary: kind === 'reset' ? '已退出沉浸模式' : '已进入沉浸模式' };
    },
  },
  {
    id: 'system.wifi',
    module: 'system',
    title: '修复 WiFi 验证',
    description: '解决已连接 WiFi 却提示「无法访问网络」的感叹号问题',
    risk: 1,
    params: [],
    available: (caps) => caps.canUseSettings,
    async run() {
      const steps = await requireServices().system.fixWifi();
      return { summary: `已应用 ${steps.length} 项网络修正`, data: steps };
    },
  },
  {
    id: 'system.rollback',
    module: 'system',
    title: '一键还原设置',
    description: '把本次会话改过的分辨率、DPI、系统参数按逆序还原到改动前的值',
    risk: 1,
    params: [
      {
        key: 'scope',
        label: '还原范围',
        type: 'select',
        defaultValue: 'all',
        options: [
          { label: '全部改动', value: 'all' },
          { label: '仅显示参数', value: 'display' },
          { label: '仅系统参数', value: 'system' },
        ],
        hint: '只还原本次会话内的改动，不会碰本次会话之前的状态',
      },
    ],
    available: () => true,
    async run({ input }) {
      const services = requireServices();
      const scope = str(input, 'scope', 'all');
      const report =
        scope === 'all'
          ? await services.rollback.restoreAll()
          : await services.rollback.restoreModule(scope);

      if (report.total === 0) {
        return { summary: '本次会话没有需要还原的改动' };
      }
      return {
        summary:
          report.failed === 0
            ? `已还原 ${report.restored} 项改动`
            : `还原 ${report.restored} 项，${report.failed} 项失败（可在结果里查看原因）`,
        data: report.steps,
      };
    },
  },
  {
    id: 'system.emergency',
    module: 'system',
    title: '应急重置显示',
    description: '界面大到点不动时用这个：强制把分辨率、DPI、字体拉回物理值',
    risk: 2,
    params: [],
    available: () => true,
    async run() {
      const message = await requireServices().system.emergencyRestore();
      return { summary: message };
    },
  },
];

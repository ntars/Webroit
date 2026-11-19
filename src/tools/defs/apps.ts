/**
 * 应用分区工具。
 *
 * 六项：详情、启停、清数据、卸载与恢复、卸载保护、批量。
 * 「冻结 / 解冻 / 强制停止」合并为一张卡片（同一对象、同一前置条件、方向不同），
 * 避免侧边栏出现三个语义重叠的入口。
 */

import type { Tool } from '@/tools/registry';
import { requireServices } from '@/tools/host';
import { packageList, str } from '@/tools/input';

export const appTools: Tool[] = [
  {
    id: 'apps.inspect',
    module: 'apps',
    title: '查看应用详情',
    description: '版本号、安装路径、申请权限、安装与更新时间',
    risk: 0,
    params: [
      { key: 'package', label: '包名', type: 'text', required: true, placeholder: 'com.tencent.mm' },
    ],
    available: (caps) => caps.canUsePm,
    async run({ input }) {
      const detail = await requireServices().apps.detail(str(input, 'package'));
      return {
        summary: `${detail.name} v${detail.versionName}${detail.system ? ' · 系统应用' : ''}`,
        data: detail,
      };
    },
  },
  {
    id: 'apps.control',
    module: 'apps',
    title: '启停应用',
    description: '冻结（停用）或解冻应用，也可以强制结束它的进程',
    risk: 2,
    params: [
      { key: 'package', label: '包名', type: 'text', required: true, placeholder: 'com.tencent.mm' },
      {
        key: 'action',
        label: '动作',
        type: 'select',
        required: true,
        defaultValue: 'freeze',
        options: [
          { label: '冻结（等同于系统「停用」）', value: 'freeze' },
          { label: '解冻（恢复启用）', value: 'unfreeze' },
          { label: '强制结束进程', value: 'stop' },
        ],
        hint: '冻结后应用图标仍在，但无法启动；解冻可完全恢复原状',
      },
    ],
    available: (caps) => caps.canUsePm,
    async run({ input }) {
      const name = str(input, 'package');
      const action = str(input, 'action', 'freeze');
      const apps = requireServices().apps;
      if (action === 'unfreeze') {
        await apps.enable(name);
        return { summary: `${name} 已恢复启用` };
      }
      if (action === 'stop') {
        await apps.forceStop(name);
        return { summary: `${name} 进程已结束` };
      }
      await apps.disable(name);
      return { summary: `${name} 已冻结`, destructive: true };
    },
  },
  {
    id: 'apps.data',
    module: 'apps',
    title: '清除应用数据',
    description: '清空应用的账号、设置与缓存，等同于系统里的「清除全部数据」',
    risk: 3,
    params: [
      { key: 'package', label: '包名', type: 'text', required: true, placeholder: 'com.tencent.mm' },
    ],
    available: (caps) => caps.canUsePm,
    async run({ input }) {
      const name = str(input, 'package');
      await requireServices().apps.clearData(name);
      return { summary: `${name} 的数据已清除，需要重新登录`, destructive: true };
    },
  },
  {
    id: 'apps.installState',
    module: 'apps',
    title: '卸载与恢复',
    description: '卸载应用，或把卸载掉的系统应用重新装回来',
    risk: 3,
    params: [
      { key: 'package', label: '包名', type: 'text', required: true, placeholder: 'com.tencent.mm' },
      {
        key: 'action',
        label: '动作',
        type: 'select',
        required: true,
        defaultValue: 'uninstall',
        options: [
          { label: '卸载', value: 'uninstall' },
          { label: '卸载但保留数据', value: 'uninstall-keep' },
          { label: '恢复已卸载的系统应用', value: 'restore' },
        ],
      },
    ],
    available: (caps) => {
      if (caps.canUsePm) return true;
      return '当前设备不支持 pm 命令';
    },
    async run({ input }) {
      const name = str(input, 'package');
      const action = str(input, 'action', 'uninstall');
      const apps = requireServices().apps;

      if (action === 'restore') {
        if (requireServices().capabilities.sdk < 30) {
          throw new Error('恢复系统应用需要 Android 11（API 30）及以上');
        }
        await apps.restore(name);
        return { summary: `${name} 已恢复安装` };
      }
      if (action === 'uninstall-keep') {
        await apps.uninstallKeepData(name);
        return { summary: `${name} 已卸载，数据保留`, destructive: true };
      }
      await apps.uninstall(name);
      return { summary: `${name} 已卸载`, destructive: true };
    },
  },
  {
    id: 'apps.lock',
    module: 'apps',
    title: '卸载保护',
    description: '锁定后应用在桌面与商店里无法被卸载，可用于防误删',
    risk: 2,
    params: [
      { key: 'package', label: '包名', type: 'text', required: true, placeholder: 'com.tencent.mm' },
      {
        key: 'lock',
        label: '操作',
        type: 'select',
        defaultValue: 'true',
        options: [
          { label: '开启保护', value: 'true' },
          { label: '解除保护', value: 'false' },
        ],
      },
    ],
    available: (caps) => caps.canUseCmdPackage || caps.canUsePm,
    async run({ input }) {
      const name = str(input, 'package');
      const lock = str(input, 'lock', 'true') === 'true';
      const state = await requireServices().apps.uninstallLock(name, lock);
      return { summary: `${name} ${state ? '已开启' : '已解除'}卸载保护` };
    },
  },
  {
    id: 'apps.batch',
    module: 'apps',
    title: '批量处理',
    description: '对多个包名执行同一动作，逐条执行并汇总每条结果',
    risk: 3,
    params: [
      {
        key: 'packages',
        label: '包名列表',
        type: 'textarea',
        required: true,
        placeholder: 'com.a.b\ncom.c.d',
        hint: '每行一个，或用逗号、空格分隔',
      },
      {
        key: 'action',
        label: '动作',
        type: 'select',
        required: true,
        defaultValue: 'disable',
        options: [
          { label: '冻结', value: 'disable' },
          { label: '解冻', value: 'enable' },
          { label: '强制结束', value: 'forceStop' },
          { label: '清除数据', value: 'clearData' },
          { label: '卸载', value: 'uninstall' },
        ],
      },
    ],
    available: (caps) => caps.canUsePm,
    async run({ input }) {
      const names = packageList(str(input, 'packages'));
      if (names.length === 0) throw new Error('未提供包名');

      const action = str(input, 'action', 'disable') as
        | 'enable'
        | 'disable'
        | 'forceStop'
        | 'clearData'
        | 'uninstall';
      const results = await requireServices().apps.batch(names, action);
      const ok = results.filter((item) => item.success).length;
      return {
        summary: `${names.length} 个应用，成功 ${ok} 个，失败 ${names.length - ok} 个`,
        data: results,
        destructive: action !== 'enable',
      };
    },
  },
];

/**
 * 品牌专区工具。
 *
 * vendor 字段决定它只会在对应品牌的设备上出现 —— registry 的 visibleTools()
 * 会按当前设备品牌过滤，所以小米设备上永远不会看到三星的清单。
 *
 * 五个品牌各两项，由同一份模板生成：id 必须带品牌前缀，否则注册表会因
 * ID 重复直接抛错。
 */

import type { Tool, VendorId } from '@/tools/registry';
import { packageList, str } from '@/tools/input';
import { requireServices } from '@/tools/host';

/** 生成某个品牌的两项工具（扫描 + 启停） */
function vendorTools(vendor: VendorId, bloatLabel: string): Tool[] {
  return [
    {
      id: `vendor.${vendor}.scan`,
      module: 'vendor',
      title: `扫描${bloatLabel}`,
      description: '列出可停用的系统组件及其当前状态，每项都标注实际作用',
      risk: 0,
      vendor,
      params: [],
      available: () => true,
      async run() {
        const items = await requireServices().vendorService.scan();
        const disabled = items.filter((item) => item.disabled).length;
        return {
          summary: `共 ${items.length} 个可停用组件，已停用 ${disabled} 个`,
          data: items,
        };
      },
    },
    {
      id: `vendor.${vendor}.disable`,
      module: 'vendor',
      title: '停用 / 恢复组件',
      description: '批量停用选中的系统组件，可随时恢复',
      risk: 2,
      vendor,
      params: [
        {
          key: 'packages',
          label: '组件包名',
          type: 'textarea',
          required: true,
          placeholder: 'com.miui.systemAdSolution',
          hint: '从扫描结果里选填；仅允许停用清单内的组件',
        },
        {
          key: 'action',
          label: '动作',
          type: 'select',
          defaultValue: 'disable',
          options: [
            { label: '停用', value: 'disable' },
            { label: '恢复', value: 'enable' },
          ],
        },
      ],
      available: () => true,
      async run({ input }) {
        const names = packageList(str(input, 'packages'));
        if (names.length === 0) throw new Error('未提供组件包名');
        const action = str(input, 'action', 'disable');
        const vendorService = requireServices().vendorService;

        const results =
          action === 'enable'
            ? await vendorService.enable(names)
            : await vendorService.disable(names);
        const ok = results.filter((item) => item.ok).length;
        return {
          summary: `${names.length} 个组件，${action === 'enable' ? '恢复' : '停用'}成功 ${ok} 个`,
          data: results,
          destructive: action === 'disable',
        };
      },
    },
  ];
}

const LABEL = '系统广告与预装组件';

export const vendorToolsAll: Tool[] = [
  ...vendorTools('xiaomi', LABEL),
  ...vendorTools('oppo', LABEL),
  ...vendorTools('vivo', LABEL),
  ...vendorTools('huawei', LABEL),
  ...vendorTools('samsung', LABEL),
];

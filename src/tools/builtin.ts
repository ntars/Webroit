/**
 * 内置工具集的聚合入口。
 *
 * 这里只做「拼装」：把各分区的工具按固定顺序汇总成 BUILTIN_TOOLS。
 * 具体每一项工具的定义散在 `defs/` 下按分区各一个文件，
 * 宿主能力注入在 `host.ts`、入参收敛在 `input.ts`。
 *
 * 拆成多文件的原因很直白：单一文件曾经涨到 1071 行，
 * 想改「电池」那一项却要在一千行里滚动找位置。
 *
 * 关于「不重复」的设计约定：
 * 一组操作如果满足「同一入口、同一前置条件、结果互补」，就合并成一个带
 * action 参数的工具，而不是拆成多个独立按钮。例如：
 * - 冻结与解冻是同一件事的两个方向 → 合并为「应用启停」
 * - 分辨率 / DPI / 还原都是改显示参数 → 合并为「显示参数」
 * - 字体 / 动画 / 锁屏超时都写 settings → 合并为「系统参数」
 * - 电量 / 温度 / 电压 / 充电来源都是电池模拟 → 合并为「电池模拟」
 * 这样侧边栏不会出现十几个语义重叠的入口，用户也不必猜该点哪个。
 *
 * 注册顺序即侧边栏分区顺序，改动前先看 registry 的 MODULES。
 */

import type { Tool } from '@/tools/registry';

import { deviceTools } from '@/tools/defs/device';
import { appTools } from '@/tools/defs/apps';
import { displayTools } from '@/tools/defs/display';
import { fileTools } from '@/tools/defs/files';
import { systemTools } from '@/tools/defs/system';
import { batteryTools } from '@/tools/defs/battery';
import { vendorToolsAll } from '@/tools/defs/vendor';

/**
 * 宿主能力再导出。
 *
 * 入口（main.tsx / dev-preview.tsx / node/runtime.ts / node/mcp.ts）历来
 * 从本文件取 bindServices 与 bindFileSink，保持这个出口不变，
 * 免得每个调用方都要改 import 路径 —— 单一口径比「更整齐的目录」重要。
 */
export { bindFileSink, bindServices, type FileSink } from '@/tools/host';

/** 全部内置工具 */
export const BUILTIN_TOOLS: Tool[] = [
  ...deviceTools,
  ...appTools,
  ...displayTools,
  ...fileTools,
  ...systemTools,
  ...batteryTools,
  ...vendorToolsAll,
];

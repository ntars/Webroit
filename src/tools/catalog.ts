/**
 * 工具目录：把注册表里的 Tool 压成可序列化的机器可读形态。
 *
 * 为什么需要这一层：
 * CLI 的 `tools` 子命令、MCP Server 的 tool 列表、给外部 agent 的参考文档，
 * 三处都要「这个工具叫什么、干什么、要哪些参数、风险几级」。
 * 如果各写一份，代码一改就漂移 —— 文档说 26 个，实际 34 个这种问题会反复出现。
 *
 * 所以三处统一从这里取，而这里从 BUILTIN_TOOLS 现算，源头唯一。
 */

import { BUILTIN_TOOLS } from '@/tools/builtin';
import {
  MODULES,
  RISK_LABEL,
  VENDORS,
  type ParamSchema,
  type RiskLevel,
  type VendorId,
} from '@/tools/registry';

/** 目录里的参数条目，字段与 ParamSchema 一致但去掉不可序列化的部分 */
export interface CatalogParam {
  key: string;
  label: string;
  /** text | number | select | boolean | file | textarea */
  type: ParamSchema['type'];
  required: boolean;
  description: string;
  /** select 的候选值 */
  choices?: { label: string; value: string }[];
  default?: unknown;
  min?: number;
  max?: number;
}

/** 目录里的一个工具 */
export interface CatalogEntry {
  id: string;
  module: string;
  moduleTitle: string;
  title: string;
  description: string;
  risk: RiskLevel;
  /** 风险等级的中文标签，直接给人看 */
  riskLabel: string;
  /** 是否属于品牌专区，仅该品牌设备可用 */
  vendor?: VendorId;
  vendorName?: string;
  params: CatalogParam[];
}

/** 参数说明：优先用 hint，没有就用 label 兜底，保证 agent 读得到人话 */
function describeParam(param: ParamSchema): string {
  const parts = [param.hint ?? param.label];
  if (param.placeholder) parts.push(`例如 ${param.placeholder}`);
  return parts.join('，');
}

/** 单个参数的目录形态 */
function toCatalogParam(param: ParamSchema): CatalogParam {
  const entry: CatalogParam = {
    key: param.key,
    label: param.label,
    type: param.type,
    required: param.required === true,
    description: describeParam(param),
  };
  if (param.options) entry.choices = param.options;
  if (param.defaultValue !== undefined) entry.default = param.defaultValue;
  if (param.min !== undefined) entry.min = param.min;
  if (param.max !== undefined) entry.max = param.max;
  return entry;
}

/** 分区标题查表，避免每个工具都带一份冗余文案 */
const MODULE_TITLES = new Map(MODULES.map((module) => [module.id, module.title]));
const VENDOR_NAMES = new Map(VENDORS.map((vendor) => [vendor.id, vendor.name]));

/** 把一批 Tool 转成目录条目，按分区顺序、再按 id 排序 */
export function toCatalog(tools = BUILTIN_TOOLS): CatalogEntry[] {
  const moduleOrder = new Map(MODULES.map((module, index) => [module.id, index]));
  return tools
    .map((tool): CatalogEntry => {
      const entry: CatalogEntry = {
        id: tool.id,
        module: tool.module,
        moduleTitle: MODULE_TITLES.get(tool.module) ?? tool.module,
        title: tool.title,
        description: tool.description,
        risk: tool.risk,
        riskLabel: RISK_LABEL[tool.risk],
        params: tool.params.map(toCatalogParam),
      };
      if (tool.vendor) {
        entry.vendor = tool.vendor;
        entry.vendorName = VENDOR_NAMES.get(tool.vendor) ?? tool.vendor;
      }
      return entry;
    })
    .sort((a, b) => {
      const diff = (moduleOrder.get(a.module as never) ?? 99) - (moduleOrder.get(b.module as never) ?? 99);
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
}

/** 目录统计：总数、通用数、按品牌数 */
export interface CatalogStats {
  total: number;
  /** 不含品牌专区的通用工具数 */
  generic: number;
  /** 每个品牌设备实际可用的工具数（通用 + 该品牌专属） */
  perDevice: number;
  vendors: number;
  /** 各风险等级的分布 */
  risks: Record<RiskLevel, number>;
}

/** 现算统计，供文档与 `webroit tools --stats` 使用 */
export function catalogStats(entries = toCatalog()): CatalogStats {
  const vendorEntries = entries.filter((entry) => entry.vendor);
  const risks: Record<RiskLevel, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const entry of entries) risks[entry.risk] += 1;
  return {
    total: entries.length,
    generic: entries.length - vendorEntries.length,
    perDevice: entries.length - vendorEntries.length + 2,
    vendors: new Set(vendorEntries.map((entry) => entry.vendor)).size,
    risks,
  };
}

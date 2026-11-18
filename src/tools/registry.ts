/**
 * 工具注册表（ADR-003）。
 *
 * 核心思路：UI 不硬编码功能列表，而是从注册表读。
 * 新增一个功能 = 往 registry 里加一个 Tool 对象，不需要动 UI 一行代码。
 *
 * 每个 Tool 自己声明三件事：
 * 1. 风险等级 —— 决定是否弹二次确认
 * 2. 可用条件 —— 依据设备能力 / 品牌决定显示、置灰还是隐藏
 * 3. 执行体 —— 拿到 ToolContext 就能跑
 *
 * 分区设计原则：一个功能只出现在一个分区里，不重复登记。
 * 品牌独有能力统一收进 vendor 分区，由品牌判定决定是否可见。
 */

import type { DeviceCapabilities } from '@/core/session/device-session';
import type { ShellContext } from '@/core/shell';

/** 功能分区，与 UI 侧边栏一一对应 */
export type ModuleId =
  | 'device'
  | 'apps'
  | 'display'
  | 'files'
  | 'system'
  | 'battery'
  | 'vendor'
  | 'terminal'
  | 'audit';

/** 分区展示信息 */
export interface ModuleMeta {
  id: ModuleId;
  title: string;
  description: string;
  /** 内联 SVG 的 path 数据，避免引入图标库 */
  icon: string;
  /** 是否只对特定品牌显示 */
  brandScoped?: boolean;
  /**
   * 分区是否不承载工具卡片。
   *
   * 审计日志、终端这类分区是「一整块交互界面」而非「一组可执行操作」，
   * 它们没有 Tool 可注册，但需要一个侧边栏入口。
   * 置为 true 后，visibleModules() 不会因为它工具数为 0 就把它藏起来。
   */
  viewOnly?: boolean;
}

export const MODULES: ModuleMeta[] = [
  {
    id: 'device',
    title: '设备总览',
    description: '硬件信息、运行状态、重启控制',
    icon: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm3 17h4',
  },
  {
    id: 'apps',
    title: '应用管理',
    description: '启停、卸载、清数据、卸载保护',
    icon: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
  },
  {
    id: 'display',
    title: '显示与输入',
    description: '分辨率、DPI、截屏、模拟操作',
    icon: 'M3 5h18v11H3zM8 20h8M12 16v4',
  },
  {
    id: 'files',
    title: '文件传输',
    description: '安装 APK、推送拉取、提取安装包',
    icon: 'M3 7h6l2 2h10v10H3z',
  },
  {
    id: 'system',
    title: '系统调校',
    description: '字体、动画、状态栏、沉浸模式',
    icon: 'M4 6h16M4 12h16M4 18h16',
  },
  {
    id: 'battery',
    title: '电池管理',
    description: '状态读取、充电模拟、功耗采样',
    icon: 'M3 8h15v8H3zM20 11v2',
  },
  {
    id: 'vendor',
    title: '品牌专区',
    description: '当前品牌独有的可停用组件与专属设置',
    icon: 'M12 2l2.9 6.3 6.9.9-5 4.8 1.3 6.9L12 17.8 6.9 21l1.3-6.9-5-4.8 6.9-.9z',
    brandScoped: true,
  },
  {
    id: 'terminal',
    title: 'ADB 终端',
    description: '原生 shell 交互会话',
    icon: 'M4 5l6 7-6 7M12 19h8',
    viewOnly: true,
  },
  {
    id: 'audit',
    title: '操作记录',
    description: '本机留存的变更日志，可导出',
    icon: 'M9 3h6a2 2 0 0 1 2 2v0h1a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1a2 2 0 0 1 2-2zM9 12h6M9 16h4',
    viewOnly: true,
  },
];

/* ─────────────────────── 品牌识别 ─────────────────────── */

/** 已知品牌 */
export type VendorId = 'xiaomi' | 'oppo' | 'vivo' | 'huawei' | 'samsung' | 'generic';

/** 品牌展示信息 */
export interface VendorMeta {
  id: VendorId;
  /** 品牌中文名 */
  name: string;
  /** 系统名 */
  rom: string;
  /** 匹配 ro.product.brand / ro.product.manufacturer 的正则 */
  pattern: RegExp;
}

export const VENDORS: VendorMeta[] = [
  { id: 'xiaomi', name: '小米 / 红米', rom: 'MIUI · HyperOS', pattern: /xiaomi|redmi|poco/i },
  { id: 'oppo', name: 'OPPO / 一加 / 真我', rom: 'ColorOS · realme UI', pattern: /oppo|oneplus|realme/i },
  { id: 'vivo', name: 'vivo / iQOO', rom: 'OriginOS · Funtouch', pattern: /vivo|iqoo/i },
  { id: 'huawei', name: '华为 / 荣耀', rom: 'EMUI · HarmonyOS · MagicOS', pattern: /huawei|honor/i },
  { id: 'samsung', name: '三星', rom: 'One UI', pattern: /samsung/i },
];

/**
 * 判定设备品牌。
 *
 * 优先看 ro.product.brand，它比 manufacturer 更贴近用户认知
 * （比如 Redmi 的 manufacturer 是 Xiaomi，但 brand 是 Redmi）。
 * 都匹配不上就归为 generic —— 原生 Android 与其他小厂设备。
 */
export function detectVendor(capabilities: DeviceCapabilities): VendorId {
  const props = capabilities.props;
  const candidates = [
    props['ro.product.brand'],
    props['ro.product.manufacturer'],
    props['ro.product.vendor.brand'],
    props['ro.build.product'],
    capabilities.brand,
  ]
    .filter(Boolean)
    .join(' ');

  for (const vendor of VENDORS) {
    if (vendor.pattern.test(candidates)) return vendor.id;
  }
  return 'generic';
}

/** 取品牌元信息 */
export function vendorMeta(id: VendorId): VendorMeta | null {
  return VENDORS.find((vendor) => vendor.id === id) ?? null;
}

/* ─────────────────────── 风险等级 ─────────────────────── */

/**
 * 风险等级。
 * 0 只读    —— 随便点
 * 1 可逆    —— 直接执行，提供撤销
 * 2 需确认  —— 弹确认框
 * 3 高危    —— 弹确认框 + 要求输入确认词
 */
export type RiskLevel = 0 | 1 | 2 | 3;

/** 风险等级的展示文案 */
export const RISK_LABEL: Record<RiskLevel, string> = {
  0: '只读',
  1: '可逆',
  2: '需确认',
  3: '高危',
};

/* ─────────────────────── 工具定义 ─────────────────────── */

/** 执行上下文 */
export interface ToolContext {
  shell: ShellContext;
  capabilities: DeviceCapabilities;
  /** 用户在 UI 里填的参数 */
  input: Record<string, unknown>;
  signal?: AbortSignal;
}

/** 执行结果 */
export interface ToolResult {
  /** 给用户看的一句话结论 */
  summary: string;
  /** 可选结构化数据，UI 自行渲染成表格/列表 */
  data?: unknown;
  /** 是否为破坏性操作，UI 可以据此改变配色 */
  destructive?: boolean;
}

/** 参数定义，供 UI 自动生成表单 */
export interface ParamSchema {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'file' | 'textarea';
  placeholder?: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string }[];
  defaultValue?: unknown;
  required?: boolean;
}

/** 一个工具 */
export interface Tool {
  id: string;
  module: ModuleId;
  title: string;
  description: string;
  risk: RiskLevel;
  params: ParamSchema[];

  /**
   * 可用性判定。
   * 返回 true 表示可用；返回字符串表示不可用并把它当作原因展示。
   */
  available(capabilities: DeviceCapabilities): boolean | string;

  /** 仅 vendor 分区的工具需要声明所属品牌 */
  vendor?: VendorId;

  run(context: ToolContext): Promise<ToolResult>;
}

/** 注册表本体 */
const registry = new Map<string, Tool>();

/** 注册一个工具 */
export function registerTool(tool: Tool): void {
  if (registry.has(tool.id)) {
    throw new Error(`工具 ID 重复：${tool.id}`);
  }
  registry.set(tool.id, tool);
}

/** 批量注册 */
export function registerTools(tools: Tool[]): void {
  for (const tool of tools) registerTool(tool);
}

/** 取全部工具 */
export function allTools(): Tool[] {
  return [...registry.values()];
}

/** 按分区取工具 */
export function toolsOfModule(module: ModuleId): Tool[] {
  return allTools().filter((tool) => tool.module === module);
}

/**
 * 按分区取「当前设备可见」的工具。
 * vendor 分区额外按品牌过滤，避免在小米设备上看到三星的清理项。
 */
export function visibleTools(module: ModuleId, capabilities: DeviceCapabilities): Tool[] {
  const tools = toolsOfModule(module);
  if (module !== 'vendor') return tools;
  const current = detectVendor(capabilities);
  return tools.filter((tool) => tool.vendor === current);
}

/** 按 ID 取工具 */
export function findTool(id: string): Tool | undefined {
  return registry.get(id);
}

/**
 * 当前设备应该显示的分区列表。
 *
 * 三种情况分别处理：
 * - 普通分区：始终显示
 * - viewOnly 分区（终端、操作记录）：始终显示 —— 它们的价值不在工具卡片上，
 *   按工具数判定会把入口误删掉，这是先前版本的一个实际 bug
 * - 品牌分区：只有该品牌确有工具时才出现，否则用户点进去看到空白，比不显示更糟
 *
 * 例外：`preview` 为 true（尚未连接任何设备）时，品牌分区也显示。
 * 未连接时没有品牌可判，若沿用「工具数为 0 就隐藏」会让访客以为没有品牌专区这个功能。
 * 点进去会看到「连接后按品牌显示」的说明，比直接藏掉诚实。
 */
export function visibleModules(capabilities: DeviceCapabilities, preview = false): ModuleMeta[] {
  return MODULES.filter((module) => {
    if (module.viewOnly) return true;
    if (!module.brandScoped) return true;
    if (preview) return true;
    return visibleTools(module.id, capabilities).length > 0;
  });
}

/** 统计：已注册总数与各分区数量 */
export function registryStats(): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const tool of registry.values()) {
    stats[tool.module] = (stats[tool.module] ?? 0) + 1;
  }
  return stats;
}

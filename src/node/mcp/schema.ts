/**
 * MCP 的 schema 层：把内部 Tool 描述翻译成客户端能读的 JSON Schema。
 *
 * 两个翻译方向：
 * - `webroit_apps_control` 这样的名字 → 原始 Tool（客户端只接受 [A-Za-z0-9_-]）
 * - `ParamSchema` → JSON Schema（客户端用它校验参数、生成提示）
 *
 * 风险等级不藏在参数里，而是显式加到 tools/list 的 description 文本中，
 * 让 agent 在读到「这是高危操作」时就能停下来问人，而不是等执行被拒。
 */

import type { ParamSchema, Tool } from '@/tools/registry';
import { BUILTIN_TOOLS } from '@/tools/builtin';

/* ─────────────────────── 工具名映射 ─────────────────────── */

/**
 * MCP 工具名只保证支持 [A-Za-z0-9_-]，点号在部分客户端里会被截断或拒绝。
 * 统一把 `apps.control` 映射成 `webroit_apps_control`，
 * 原始 id 保留在描述里，两边都能对上。
 */
export function mcpName(toolId: string): string {
  return `webroit_${toolId.replaceAll('.', '_').replaceAll('-', '_')}`;
}

/** 反向查找：从 MCP 名找回原始 Tool */
const TOOL_BY_MCP = new Map<string, Tool>(BUILTIN_TOOLS.map((tool) => [mcpName(tool.id), tool]));

/** 按 MCP 名取工具，取不到返回 undefined（由调用方决定怎么报错） */
export function findToolByMcpName(name: string): Tool | undefined {
  return TOOL_BY_MCP.get(name);
}

/** 设备列举工具的名字，它不属于 34 个功能工具 */
export const DEVICES_TOOL = 'webroit_devices';

/* ─────────────────────── schema 转换 ─────────────────────── */

/** 把 ParamSchema 转成 JSON Schema 的一条属性 */
function toJsonProperty(param: ParamSchema): Record<string, unknown> {
  const base: Record<string, unknown> = { description: param.hint || param.label };

  switch (param.type) {
    case 'number':
      base.type = param.min !== undefined || param.max !== undefined ? 'integer' : 'number';
      if (param.min !== undefined) base.minimum = param.min;
      if (param.max !== undefined) base.maximum = param.max;
      break;
    case 'boolean':
      base.type = 'boolean';
      break;
    case 'select':
      base.type = 'string';
      if (param.options?.length) {
        base.enum = param.options.map((option) => option.value);
        base.description = `${base.description}。可选：${param.options
          .map((option) => `${option.value}（${option.label}）`)
          .join('、')}`;
      }
      break;
    case 'file':
      // 浏览器里是文件选择器，MCP 里只能是路径
      base.type = 'string';
      base.description = `${base.description}。这里是本地文件路径`;
      break;
    default:
      base.type = 'string';
  }

  if (param.defaultValue !== undefined) base.default = param.defaultValue;
  return base;
}

/** 生成一个工具的 inputSchema */
function toInputSchema(tool: Tool): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const param of tool.params) {
    properties[param.key] = toJsonProperty(param);
    if (param.required) required.push(param.key);
  }

  // 破坏性操作必须显式放行
  if (tool.risk >= 2) {
    properties.allowDangerous = {
      type: 'boolean',
      default: false,
      description:
        tool.risk === 3
          ? '这是高危操作，可能不可逆。确认要执行必须传 true'
          : '这是变更操作。确认要执行必须传 true',
    };
  }

  const schema: Record<string, unknown> = { type: 'object', properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

/** risks 中文标签，写进工具描述让 agent 一眼看到 */
const RISK_TEXT: Record<number, string> = {
  0: '只读，不改动设备',
  1: '可逆变更，出错可回滚',
  2: '需确认，改动设备状态',
  3: '高危，可能不可逆',
};

/* ─────────────────────── tools/list 的响应 ─────────────────────── */

/** 组装 tools/list 的完整响应体：设备列举工具在前，34 个功能工具在后 */
export function listToolDescriptors(): unknown[] {
  const devices = {
    name: DEVICES_TOOL,
    title: '列出已连接的安卓设备',
    description:
      '列出本机 adb 可见的设备与状态。调用任何其他工具前先用它确认有设备在线。状态为 device 才可使用。',
    inputSchema: { type: 'object', properties: {} },
  };

  const tools = BUILTIN_TOOLS.map((tool) => ({
    name: mcpName(tool.id),
    title: tool.title,
    description: [
      tool.description,
      `风险：${RISK_TEXT[tool.risk]}。`,
      tool.vendor ? `仅 ${tool.vendor} 品牌设备可用。` : '',
      `原始工具 ID：${tool.id}`,
    ]
      .filter(Boolean)
      .join(' '),
    inputSchema: toInputSchema(tool),
  }));

  return [devices, ...tools];
}

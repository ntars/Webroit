/**
 * Webroit MCP Server —— 让任意 AI agent 直接操作安卓设备。
 *
 * 传输：stdio，按行分隔的 JSON-RPC 2.0。不用官方 SDK：
 * 只用到的四个方法（initialize / tools/list / tools/call / ping）自己实现更透明，
 * 也避免给一个本地工具链引入整套依赖树。
 *
 * 与网页版的关系：
 * 工具实现完全同一份（BUILTIN_TOOLS），只是换了个调用入口。
 * 所以网页里能做的事，agent 通过 MCP 也能做，风险等级也一致。
 *
 * 一条硬约束必须写在最前面：
 * 本进程用本机 adb，不用 WebUSB。WebUSB 只能在浏览器里跑，
 * 任何外部进程（包括这个 MCP server）都无法走那条通道。
 * 因此使用前提是：已安装 platform-tools，且 adb devices 能看到设备。
 *
 * 安全设计：risk >= 2 的工具在 inputSchema 里带 allowDangerous 参数，
 * 默认 false。agent 必须显式传 true 才会执行 —— 这样每一次破坏性操作
 * 都留在了 agent 的调用记录里，而不是悄悄发生。
 */

import { createInterface } from 'node:readline';

import { listDevices, NodeDriver, pickDevice } from '@/node/adb-driver';
import { coerceParams, gateTool, loadFileParams } from '@/node/runtime';
import { UsageError } from '@/node/errors';
import { createServices, type Services } from '@/services/index';
import { DeviceSession, probeCapabilities } from '@/core/session/device-session';
import { bindFileSink, bindServices, BUILTIN_TOOLS } from '@/tools/builtin';
import type { ParamSchema, Tool } from '@/tools/registry';
import { catalogStats, toCatalog } from '@/tools/catalog';

/* ─────────────────────── 协议常量 ─────────────────────── */

/** 支持的协议版本，按新到旧。协商时优先回客户端要的那个 */
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];

const SERVER_INFO = {
  name: 'webroit',
  title: 'Webroit 安卓玩机',
  version: '0.1.0',
};

/** 附带的使用说明，客户端会把它塞进上下文 */
const INSTRUCTIONS = `Webroit 通过本机 adb 操作安卓设备，提供 34 项功能：设备信息、应用启停与卸载、\
显示参数与截屏、文件传输、系统调校、电池模拟、品牌预装组件清理。

使用流程：
1. 先调 webroit_devices 确认有设备在线（状态必须是 device）
2. 调 webroit_tools_list 或看工具描述了解可用功能
3. 需要先读后写时，优先调用只读工具确认现状

风险约定：
- 标注「只读」的工具随时可调
- 标注「需确认」与「高危」的工具必须传 allowDangerous: true，否则服务器直接拒绝
- 文件传输类工具在命令行下用文件路径（path 参数），不是浏览器里的文件选择器

多台设备时用环境变量 WEBROIT_SERIAL 指定序列号，否则服务器会报错并要求指明。`;

/* ─────────────────────── 设备会话缓存 ─────────────────────── */

/**
 * 会话持有者。
 *
 * MCP server 是长期进程，每次调用都重连 adb 并重跑 10 条能力探测太浪费；
 * 但缓存又不能永久有效 —— 数据线拔掉后连接就失效了。
 * 策略：懒连接 + 复用 + 失败即丢弃重连一次。
 */
class SessionHolder {
  #runtime: { session: DeviceSession; services: Services; close: () => Promise<void> } | null = null;
  #connecting: Promise<{ session: DeviceSession; services: Services; close: () => Promise<void> }> | null =
    null;

  /** 取当前会话，没有就建一个 */
  async get(): Promise<{ session: DeviceSession; services: Services }> {
    if (this.#runtime) return this.#runtime;
    if (this.#connecting) return this.#connecting;

    this.#connecting = (async () => {
      const serial = process.env.WEBROIT_SERIAL?.trim() || undefined;
      const device = await pickDevice(serial);
      const driver = new NodeDriver(device.serial, device.model ?? device.serial);
      try {
        const capabilities = await probeCapabilities(driver);
        const session = new DeviceSession(driver, capabilities);
        const services = createServices(session, {
          // 协议通道是 stdout，日志只能走 stderr，否则会破坏 JSON-RPC
          output: (channel, text) => {
            if (channel === 'command') process.stderr.write(`[adb] ${text.trim()}\n`);
            else if (channel === 'stderr') process.stderr.write(`[adb:err] ${text.trim()}\n`);
          },
        });

        /*
         * 工具通过这个解析器拿服务。不绑的话每个工具都报「设备未连接」——
         * 浏览器在 main.tsx 里绑，MCP 这里必须自己绑一次。
         */
        bindServices(() => services);

        const runtime = {
          session,
          services,
          close: async () => {
            await driver.close().catch(() => {});
          },
        };
        this.#runtime = runtime;
        return runtime;
      } catch (error) {
        await driver.close().catch(() => {});
        throw error;
      } finally {
        this.#connecting = null;
      }
    })();

    return this.#connecting;
  }

  /** 丢弃缓存（执行失败后调用，下次会重连） */
  async reset(): Promise<void> {
    const current = this.#runtime;
    this.#runtime = null;
    if (current) await current.close().catch(() => {});
  }

  async close(): Promise<void> {
    await this.reset();
  }
}

/* ─────────────────────── 工具名映射 ─────────────────────── */

/**
 * MCP 工具名只保证支持 [A-Za-z0-9_-]，点号在部分客户端里会被截断或拒绝。
 * 这里统一把 `apps.control` 映射成 `webroit_apps_control`，
 * 原始 id 保留在描述里，两边都能对上。
 */
function mcpName(toolId: string): string {
  return `webroit_${toolId.replaceAll('.', '_').replaceAll('-', '_')}`;
}

/** 反向查找：从 MCP 名找回原始 Tool */
const TOOL_BY_MCP = new Map<string, Tool>(BUILTIN_TOOLS.map((tool) => [mcpName(tool.id), tool]));

/** 设备列举工具的名字，它不属于 34 个功能工具 */
const DEVICES_TOOL = 'webroit_devices';

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

function listToolDescriptors(): unknown[] {
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

/* ─────────────────────── tools/call 的实现 ─────────────────────── */

/** tools/call 的返回：一段文本，成功与失败都用它承载 */
interface CallResult {
  content: { type: 'text'; text: string }[];
  isError: boolean;
}

/** 统一的结果包装 */
function textResult(text: string, isError = false): CallResult {
  return { content: [{ type: 'text' as const, text }], isError };
}

/** 处理设备列举 */
async function callDevices(): Promise<CallResult> {
  const devices = await listDevices();
  if (devices.length === 0) {
    return textResult(
      '未探测到设备。请确认数据线已连接、已在开发者选项开启 USB 调试，并执行 adb devices 检查。',
      true,
    );
  }
  const lines = devices.map((device) => {
    const state = device.state === 'device' ? '就绪' : device.state;
    return `${device.serial}\t${state}${device.model ? `\t${device.model}` : ''}`;
  });
  return textResult(`共 ${devices.length} 台设备：\n${lines.join('\n')}`);
}

/** 处理一个功能工具 */
async function callTool(holder: SessionHolder, tool: Tool, args: Record<string, unknown>): Promise<CallResult> {
  const allowDangerous = args.allowDangerous === true;

  // 门控在前：未授权的调用拿不到任何参数结构信息
  const gate = gateTool(tool, allowDangerous);
  if (!gate.ok) return textResult(gate.reason, true);

  // 参数按 schema 收敛成字符串再走统一的转换逻辑，
  // 这样 MCP 与 CLI 的参数处理是同一条代码路径，不会出现两种行为
  const rawParams: Record<string, string> = {};
  for (const param of tool.params) {
    const value = args[param.key];
    if (value === undefined || value === null) continue;
    rawParams[param.key] = String(value);
  }

  let input: Record<string, unknown>;
  try {
    const coerced = coerceParams(tool, rawParams);
    if (coerced.missing.length > 0) {
      return textResult(`${tool.title} 缺少必填参数：${coerced.missing.join('、')}`, true);
    }
    input = coerced.input;
  } catch (error) {
    return textResult(error instanceof Error ? error.message : String(error), true);
  }

  let runtime;
  try {
    runtime = await holder.get();
  } catch (error) {
    return textResult(error instanceof Error ? error.message : String(error), true);
  }

  const availability = tool.available(runtime.services.capabilities);
  if (availability !== true) {
    return textResult(
      typeof availability === 'string'
        ? `${tool.title} 当前不可用：${availability}`
        : `${tool.title} 当前设备不支持`,
      true,
    );
  }

  try {
    const resolved = await loadFileParams(tool, input);
    const result = await tool.run({
      shell: runtime.services.shell,
      capabilities: runtime.services.capabilities,
      input: resolved,
    });

    const parts = [result.summary];
    if (result.data !== undefined) {
      parts.push(`\n结构化结果：\n${JSON.stringify(result.data, null, 2)}`);
    }
    return textResult(parts.join(''));
  } catch (error) {
    // 执行失败说明会话可能已经坏了（拔线、设备重启），丢掉缓存下次重连
    await holder.reset();
    const message = error instanceof Error ? error.message : String(error);
    return textResult(`${tool.title} 执行失败：${message}`, true);
  }
}

/* ─────────────────────── JSON-RPC 层 ─────────────────────── */

/** JSON-RPC 错误码 */
const RPC_ERROR = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * 写一条响应。
 *
 * stdout 是协议通道，只允许出现协议消息 —— 任何调试输出都必须走 stderr，
 * 写错一个字符就会让客户端 JSON 解析失败，表现为「服务器不响应」。
 */
function send(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function sendResult(id: RpcRequest['id'], result: unknown): void {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id: RpcRequest['id'], code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

/** 协议版本协商：客户端要的版本若在支持列表里就照办 */
function negotiateVersion(requested: unknown): string {
  if (typeof requested === 'string' && PROTOCOL_VERSIONS.includes(requested)) return requested;
  return PROTOCOL_VERSIONS[0];
}

async function handleMessage(holder: SessionHolder, message: RpcRequest): Promise<void> {
  const { id, method, params = {} } = message;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      sendResult(id, {
        protocolVersion: negotiateVersion(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
      return;

    case 'notifications/initialized':
      // 通知不需要响应
      return;

    case 'ping':
      if (!isNotification) sendResult(id, {});
      return;

    case 'tools/list':
      if (isNotification) return;
      sendResult(id, { tools: listToolDescriptors() });
      return;

    case 'tools/call': {
      if (isNotification) return;
      const name = params.name;
      const args = (params.arguments ?? {}) as Record<string, unknown>;

      if (typeof name !== 'string') {
        sendError(id, RPC_ERROR.invalidParams, '缺少工具名 name');
        return;
      }

      try {
        let result: CallResult;
        if (name === DEVICES_TOOL) {
          result = await callDevices();
        } else {
          const tool = TOOL_BY_MCP.get(name);
          if (!tool) {
            sendError(id, RPC_ERROR.invalidParams, `未知工具：${name}。先用 tools/list 获取可用工具`);
            return;
          }
          result = await callTool(holder, tool, args);
        }
        sendResult(id, result);
      } catch (error) {
        const message = error instanceof UsageError ? error.message : String(error);
        sendResult(id, textResult(message, true));
      }
      return;
    }

    case 'resources/list':
      // 明确回不支持，比让客户端等超时好
      if (!isNotification) sendResult(id, { resources: [] });
      return;

    case 'prompts/list':
      if (!isNotification) sendResult(id, { prompts: [] });
      return;

    default:
      if (!isNotification) sendError(id, RPC_ERROR.methodNotFound, `未实现的方法：${method}`);
  }
}

/* ─────────────────────── 启动 ─────────────────────── */

function main(): void {
  const holder = new SessionHolder();

  /*
   * 文件类工具在命令行下只能给路径。MCP 场景没有浏览器下载的概念，
   * 所以产物默认落到系统临时目录，并把路径写回结果里 ——
   * agent 拿到路径后可以自行读取或转发。
   */
  const outDir = process.env.WEBROIT_OUT_DIR?.trim() || process.cwd();
  void (async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    await mkdir(outDir, { recursive: true }).catch(() => {});
    bindFileSink(async (blob, name) => {
      await writeFile(join(outDir, name), Buffer.from(await blob.arrayBuffer()));
      process.stderr.write(`[webroit] 产物已保存：${join(outDir, name)}\n`);
    });
  })();

  const rl = createInterface({ input: process.stdin, terminal: false });

  /*
   * 在途请求计数。
   *
   * 必须记这个数：客户端常常一口气把所有消息写进 stdin 就关掉管道
   * （脚本化调用、管道测试都是这样），此时 stdin 立刻触发 end。
   * 如果 end 就 exit，那些还在等 adb 返回的调用会被腰斩 ——
   * 现象是「有些调用有输出，有些凭空消失」，极难排查。
   * 所以退出要等到计数归零。
   */
  let inFlight = 0;
  let closing = false;

  const maybeExit = () => {
    if (closing && inFlight === 0) {
      void holder.close().then(() => {
        rl.close();
        process.exit(0);
      });
    }
  };

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: RpcRequest;
    try {
      parsed = JSON.parse(trimmed) as RpcRequest;
    } catch {
      sendError(null, RPC_ERROR.parseError, '无法解析的 JSON');
      return;
    }

    if (parsed.jsonrpc !== '2.0' || typeof parsed.method !== 'string') {
      sendError(parsed.id ?? null, RPC_ERROR.invalidRequest, '不是合法的 JSON-RPC 2.0 请求');
      return;
    }

    inFlight += 1;
    handleMessage(holder, parsed)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        sendError(parsed.id ?? null, RPC_ERROR.internalError, message);
      })
      .finally(() => {
        inFlight -= 1;
        maybeExit();
      });
  });

  const shutdown = () => {
    closing = true;
    maybeExit();
    // 兜底：设备卡住导致调用永不返回时，5 秒后强制退出，不让管道挂死
    setTimeout(() => process.exit(0), 5_000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.on('end', shutdown);

  // 启动横幅走 stderr：stdout 是协议通道，写一个字都会让客户端解析失败
  const stats = catalogStats(toCatalog());
  process.stderr.write(
    `[webroit] MCP server 已就绪，${stats.total} 个工具（通用 ${stats.generic}，每台设备 ${stats.perDevice}）\n`,
  );
}

main();

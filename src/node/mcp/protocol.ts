/**
 * MCP 协议层：常量、消息收发、结果包装。
 *
 * 传输是 stdio，按行分隔的 JSON-RPC 2.0。不用官方 SDK —— 这里只用得到
 * 四个方法（initialize / tools/list / tools/call / ping），自己实现更透明，
 * 也避免给一个本地工具链引入整套依赖树。
 *
 * 一条硬约束写在这里，因为这层就是它的守门人：
 * **stdout 是协议通道，只允许出现协议消息。** 任何调试输出、日志、横幅
 * 都必须走 stderr，写错一个字符客户端就解析失败，表现为「服务器不响应」。
 */

/* ─────────────────────── 协议常量 ─────────────────────── */

/** 支持的协议版本，按新到旧。协商时优先回客户端要的那个 */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];

export const SERVER_INFO = {
  name: 'webroit',
  title: 'Webroit 安卓玩机',
  version: '0.1.0',
};

/** 附带的使用说明，客户端会把它塞进上下文 */
export const INSTRUCTIONS = `Webroit 通过本机 adb 操作安卓设备，提供 34 项功能：设备信息、应用启停与卸载、\
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

/** JSON-RPC 错误码 */
export const RPC_ERROR = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

/* ─────────────────────── 收发 ─────────────────────── */

/** 写一条消息。stdout 只此一处可写。 */
export function send(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export function sendResult(id: RpcRequest['id'], result: unknown): void {
  send({ jsonrpc: '2.0', id, result });
}

export function sendError(id: RpcRequest['id'], code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

/** 协议版本协商：客户端要的版本若在支持列表里就照办 */
export function negotiateVersion(requested: unknown): string {
  if (typeof requested === 'string' && PROTOCOL_VERSIONS.includes(requested)) return requested;
  return PROTOCOL_VERSIONS[0];
}

/* ─────────────────────── 结果包装 ─────────────────────── */

/** tools/call 的返回：一段文本，成功与失败都用它承载 */
export interface CallResult {
  content: { type: 'text'; text: string }[];
  isError: boolean;
}

/** 统一的结果包装 */
export function textResult(text: string, isError = false): CallResult {
  return { content: [{ type: 'text' as const, text }], isError };
}

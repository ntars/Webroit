/**
 * MCP 方法分发与工具调用。
 *
 * 这里承担两件事，它们共享同一份上下文（会话缓存），所以放在一起：
 * 1. `handleMessage` 把一条 JSON-RPC 消息路由到具体实现
 * 2. `callTool` 把一个 MCP 工具调用翻译成 Tool.run()
 *
 * 门控在参数解析之前：未授权的破坏性调用不该拿到任何参数结构信息。
 * 参数处理走 `coerceParams` —— 与 CLI 同一条代码路径，避免两边行为漂移。
 */

import { coerceParams, gateTool, loadFileParams } from '@/node/runtime';
import { UsageError } from '@/node/errors';
import { listDevices } from '@/node/adb-driver';
import type { Tool } from '@/tools/registry';
import {
  DEVICES_TOOL,
  findToolByMcpName,
  listToolDescriptors,
} from '@/node/mcp/schema';
import {
  INSTRUCTIONS,
  RPC_ERROR,
  SERVER_INFO,
  negotiateVersion,
  sendError,
  sendResult,
  textResult,
  type CallResult,
  type RpcRequest,
} from '@/node/mcp/protocol';
import type { SessionHolder } from '@/node/mcp/session';

/* ─────────────────────── tools/call ─────────────────────── */

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
export async function callTool(
  holder: SessionHolder,
  tool: Tool,
  args: Record<string, unknown>,
): Promise<CallResult> {
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

/* ─────────────────────── 方法分发 ─────────────────────── */

/** 处理一条请求。返回即表示已写出响应（或明确无需响应）。 */
export async function handleMessage(holder: SessionHolder, message: RpcRequest): Promise<void> {
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
          const tool = findToolByMcpName(name);
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

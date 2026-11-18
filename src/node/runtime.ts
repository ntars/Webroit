/**
 * 命令行运行时：把「一台 adb 设备」变成「一套可直接执行的工具」。
 *
 * 装配链路与浏览器完全一致 ——
 *   NodeDriver → probeCapabilities → createServices → 按 ID 找 Tool → run()
 * 唯一的差异在最底下那一层（WebUSB 换成 child_process）。
 * 所以 34 个工具、全部 service、风险等级、参数校验都只有一份实现，
 * 不存在「网页里能用、命令行里行为不一样」的漂移。
 *
 * 这里额外补两件浏览器由 UI 承担的事：
 * 1. 风险门控 —— 网页靠弹确认框，命令行靠显式 --allow-dangerous
 * 2. 产物落盘 —— 网页靠浏览器下载，命令行写到 --out 指定的目录
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createServices, type Services } from '@/services/index';
import { DeviceSession, probeCapabilities } from '@/core/session/device-session';
import { bindServices, bindFileSink, BUILTIN_TOOLS } from '@/tools/builtin';
import { findTool, type RiskLevel, type Tool } from '@/tools/registry';
import { NodeDriver, pickDevice, type AdbDevice } from '@/node/adb-driver';
import { UsageError } from '@/node/errors';

/** 一次运行的上下文 */
export interface DeviceRuntime {
  session: DeviceSession;
  services: Services;
  device: AdbDevice;
  /** 本次运行写出的产物路径 */
  artifacts: string[];
  close(): Promise<void>;
}

/** 运行时选项 */
export interface RuntimeOptions {
  /** 指定设备序列号。多台在线设备时必须给 */
  serial?: string;
  /** 产物保存目录，默认当前目录 */
  outDir?: string;
  /** 命令输出回调（--verbose 时接到 stderr） */
  onOutput?: (channel: 'command' | 'result' | 'stderr' | 'info', text: string) => void;
}

/**
 * 连接设备并装配服务。
 *
 * 探测能力是必须的一步，不是可选的优化：
 * 工具的 available() 依赖真实能力位，跳过探测会让「这台设备不支持」变成
 * 执行到一半才报错的红色堆栈。
 */
export async function openRuntime(options: RuntimeOptions = {}): Promise<DeviceRuntime> {
  const device = await pickDevice(options.serial);
  const driver = new NodeDriver(device.serial, device.model ?? device.serial);

  let capabilities;
  try {
    capabilities = await probeCapabilities(driver);
  } catch (error) {
    await driver.close().catch(() => {});
    throw error;
  }

  const session = new DeviceSession(driver, capabilities);
  const services = createServices(session, {
    output: options.onOutput
      ? (channel, text) => options.onOutput?.(channel, text)
      : undefined,
    progress: (name, done, total) => {
      // 进度只在 TTY 下画行，重定向到文件时不污染输出
      if (!process.stderr.isTTY || total <= 0) return;
      const ratio = Math.min(1, done / total);
      const width = 24;
      const filled = Math.round(ratio * width);
      process.stderr.write(
        `\r${name} ${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${Math.round(ratio * 100)}%`,
      );
      if (ratio >= 1) process.stderr.write('\n');
    },
  });

  const artifacts: string[] = [];
  const outDir = resolve(options.outDir ?? process.cwd());
  await mkdir(outDir, { recursive: true });

  /*
   * 把服务注入工具层。
   *
   * 工具是通过 bindServices 注册的解析器去拿服务的 —— 浏览器在 main.tsx 里绑，
   * 命令行这边如果不绑，每个工具都会报「设备未连接」，即使设备明明连着。
   * 这一步是命令行能跑通 34 个工具的前提，漏了它则全部工具失效。
   */
  bindServices(() => services);

  // 命令行侧的产物交付：写进 outDir，并把路径回报给调用方
  bindFileSink(async (blob, name) => {
    const target = join(outDir, name);
    await writeFile(target, Buffer.from(await blob.arrayBuffer()));
    artifacts.push(target);
  });

  return {
    session,
    services,
    device,
    artifacts,
    async close() {
      await driver.close().catch(() => {});
    },
  };
}

/* ─────────────────────── 风险门控 ─────────────────────── */

/** 风险门控的结果 */
export type GateResult = { ok: true } | { ok: false; reason: string };

/**
 * 判断某个工具在当前参数下能否执行。
 *
 * 网页里这一层由 UI 的确认弹窗承担：risk 2 弹框、risk 3 要求输入确认词。
 * 命令行没有弹窗，改成显式的 --allow-dangerous ——
 * 少了它，一条 `webroit run device.reboot` 就能悄悄重启别人的手机；
 * 有了它，任何破坏性动作都是调用者主动写下的。
 */
export function gateTool(tool: Tool, allowDangerous: boolean): GateResult {
  if (tool.risk <= 1) return { ok: true };
  if (allowDangerous) return { ok: true };

  const hint =
    tool.risk === 3
      ? '这是高危操作，可能造成不可逆后果。确认要执行请加 --allow-dangerous'
      : '这是需确认的变更操作。确认要执行请加 --allow-dangerous';
  return { ok: false, reason: `${tool.title}（风险等级 ${tool.risk}）：${hint}` };
}

/** 把命令行传来的字符串参数按 schema 转成正确类型 */
export function coerceParams(
  tool: Tool,
  raw: Record<string, string>,
): { input: Record<string, unknown>; missing: string[] } {
  const input: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const param of tool.params) {
    const value = raw[param.key];

    if (value === undefined || value === '') {
      if (param.required) missing.push(`${param.key}（${param.label}）`);
      else if (param.defaultValue !== undefined) input[param.key] = param.defaultValue;
      continue;
    }

    switch (param.type) {
      case 'number': {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          throw new UsageError(`参数 ${param.key} 需要数字，收到「${value}」`);
        }
        if (param.min !== undefined && parsed < param.min) {
          throw new UsageError(`参数 ${param.key} 不能小于 ${param.min}`);
        }
        if (param.max !== undefined && parsed > param.max) {
          throw new UsageError(`参数 ${param.key} 不能大于 ${param.max}`);
        }
        input[param.key] = parsed;
        break;
      }
      case 'boolean':
        input[param.key] = value === 'true' || value === '1' || value === 'on' || value === 'yes';
        break;
      case 'select': {
        const allowed = param.options?.map((option) => option.value) ?? [];
        if (allowed.length > 0 && !allowed.includes(value)) {
          throw new UsageError(`参数 ${param.key} 只能是：${allowed.join(' / ')}，收到「${value}」`);
        }
        input[param.key] = value;
        break;
      }
      case 'file':
        // 先原样存路径，读完盘再换成 File 对象（见 loadFileParams）。
        // 参数校验保持纯函数，不在这里做 IO。
        input[param.key] = value;
        break;
      default:
        input[param.key] = value;
    }
  }

  // 未在 schema 里声明的参数直接报错，避免拼错的 key 被静默忽略
  const known = new Set(tool.params.map((param) => param.key));
  const unknown = Object.keys(raw).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new UsageError(
      `未知参数：${unknown.join(', ')}。该工具可用参数：${
        tool.params.map((param) => param.key).join(', ') || '（无）'
      }`,
    );
  }

  return { input, missing };
}

/**
 * 把 file 类型参数从路径换成 File 对象。
 *
 * 单独一步而不是混在 coerceParams 里：读文件是异步 IO，
 * 而参数校验应该是纯函数 —— 校验阶段不该因为磁盘问题抛出无关错误。
 */
export async function loadFileParams(
  tool: Tool,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fileParams = tool.params.filter((param) => param.type === 'file');
  if (fileParams.length === 0) return input;

  const { readFile, stat } = await import('node:fs/promises');
  const { basename } = await import('node:path');
  const next = { ...input };

  for (const param of fileParams) {
    const path = input[param.key];
    if (typeof path !== 'string' || !path) continue;

    const info = await stat(path).catch(() => null);
    if (!info || !info.isFile()) {
      throw new Error(`参数 ${param.key} 指向的文件不存在：${path}`);
    }
    const bytes = await readFile(path);
    next[param.key] = new File([new Uint8Array(bytes)], basename(path), {
      lastModified: info.mtimeMs,
    });
  }

  return next;
}

/* ─────────────────────── 执行一个工具 ─────────────────────── */

/** 执行结果 */
export interface RunOutcome {
  toolId: string;
  title: string;
  risk: RiskLevel;
  summary: string;
  data?: unknown;
  destructive: boolean;
  /** 写出的产物路径 */
  artifacts: string[];
  /** 耗时毫秒 */
  elapsed: number;
}

/** 执行选项 */
export interface RunOptions {
  /** 字符串参数原样传入，类型按 schema 转换 */
  params?: Record<string, string>;
  allowDangerous?: boolean;
  outDir?: string;
  serial?: string;
  signal?: AbortSignal;
  onOutput?: RuntimeOptions['onOutput'];
}

/**
 * 一次完整的「找到工具 → 校验参数 → 过风险门控 → 执行」。
 *
 * 拆成独立函数而不是塞进 CLI，是为了让 MCP Server 也能直接调用 ——
 * MCP 只是另一种调用方式，不该重写一套执行逻辑。
 */
export async function runTool(
  toolId: string,
  options: RunOptions = {},
): Promise<RunOutcome> {
  const tool = findTool(toolId) ?? BUILTIN_TOOLS.find((item) => item.id === toolId);
  if (!tool) {
    throw new UsageError(`未找到工具：${toolId}。用 webroit tools 查看全部可用工具`);
  }

  /*
   * 顺序有意如此：先过风险门控，再校验参数。
   * 反过来的话，一次未授权的调用会先返回「参数 xxx 不存在，可用参数：…」，
   * 等于把高危工具的参数结构白送出去。门控在前，未授权的调用
   * 除了一句「需要 --allow-dangerous」之外拿不到任何信息。
   */
  const gate = gateTool(tool, options.allowDangerous === true);
  if (!gate.ok) throw new UsageError(gate.reason);

  // 参数写错时不该白连一次手机，所以校验放在连接之前
  const { input, missing } = coerceParams(tool, options.params ?? {});
  if (missing.length > 0) {
    throw new UsageError(`${tool.title} 缺少必填参数：${missing.join('、')}`);
  }

  const started = Date.now();
  const runtime = await openRuntime({
    serial: options.serial,
    outDir: options.outDir,
    onOutput: options.onOutput,
  });

  try {
    // 能力门控：设备不支持就不要硬跑
    const availability = tool.available(runtime.services.capabilities);
    if (availability !== true) {
      throw new Error(
        typeof availability === 'string'
          ? `${tool.title} 当前不可用：${availability}`
          : `${tool.title} 当前设备不支持`,
      );
    }

    const resolved = await loadFileParams(tool, input);
    const result = await tool.run({
      shell: runtime.services.shell,
      capabilities: runtime.services.capabilities,
      input: resolved,
      signal: options.signal,
    });

    return {
      toolId: tool.id,
      title: tool.title,
      risk: tool.risk,
      summary: result.summary,
      data: result.data,
      destructive: result.destructive === true,
      artifacts: runtime.artifacts,
      elapsed: Date.now() - started,
    };
  } finally {
    await runtime.close();
  }
}

/** 取工具列表（供 CLI 与 MCP 共用） */
export function listTools(): Tool[] {
  return BUILTIN_TOOLS;
}

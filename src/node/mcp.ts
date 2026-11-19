/**
 * Webroit MCP Server —— 让任意 AI agent 直接操作安卓设备。
 *
 * 传输：stdio，按行分隔的 JSON-RPC 2.0。本文件只负责启动与退出；
 * 协议常量在 `mcp/protocol.ts`、schema 翻译在 `mcp/schema.ts`、
 * 会话缓存在 `mcp/session.ts`、方法分发与工具调用在 `mcp/handle.ts`。
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

import { bindFileSink } from '@/tools/builtin';
import { catalogStats, toCatalog } from '@/tools/catalog';
import { handleMessage } from '@/node/mcp/handle';
import { RPC_ERROR, sendError, type RpcRequest } from '@/node/mcp/protocol';
import { SessionHolder } from '@/node/mcp/session';

/* ─────────────────────── 启动 ─────────────────────── */

/**
 * 注册产物落盘。
 *
 * 文件类工具在命令行下只能给路径。MCP 场景没有浏览器下载的概念，
 * 所以产物默认落到 `WEBROIT_OUT_DIR`（缺省当前目录），并把路径写回 stderr ——
 * agent 拿到路径后可以自行读取或转发。
 */
function registerFileSink(): void {
  const outDir = process.env.WEBROIT_OUT_DIR?.trim() || process.cwd();
  void (async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    await mkdir(outDir, { recursive: true }).catch(() => {});
    bindFileSink(async (blob, name) => {
      const target = join(outDir, name);
      await writeFile(target, Buffer.from(await blob.arrayBuffer()));
      process.stderr.write(`[webroit] 产物已保存：${target}\n`);
    });
  })();
}

function main(): void {
  const holder = new SessionHolder();
  registerFileSink();

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

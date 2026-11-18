/**
 * webroit 命令行入口。
 *
 * 设计取向：给人和给 agent 都能用。
 * - 给人：默认输出人类可读文本，关键结论在最后一行
 * - 给 agent：加 --json，输出结构化结果，字段固定，不随版本漂移
 *
 * 不使用任何 CLI 框架：参数就这几个，手写解析比引依赖更透明，
 * 也不会因为框架升级改变输出行为（agent 依赖输出稳定）。
 */

import { listDevices } from '@/node/adb-driver';
import { runTool } from '@/node/runtime';
import { UsageError } from '@/node/errors';
import { toCatalog, catalogStats, type CatalogEntry } from '@/tools/catalog';
import { RISK_LABEL, type RiskLevel } from '@/tools/registry';

/** 退出码语义固定，agent 可据此分支 */
const EXIT = {
  ok: 0,
  /** 用法错误：参数缺失、工具不存在 */
  usage: 2,
  /** 执行失败：设备出错、命令失败 */
  fail: 1,
} as const;

/** 解析后的全局选项 */
interface GlobalOptions {
  json: boolean;
  verbose: boolean;
  serial?: string;
  outDir?: string;
  allowDangerous: boolean;
  help: boolean;
}

/** 解析 --key=value 与 --key value 两种写法 */
function parseArgv(argv: string[]): { command: string; positional: string[]; flags: Map<string, string | true> } {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }

    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      flags.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }

    // 布尔开关不吞下一个 token；取值型选项要看下一个是不是 -- 开头
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(body, next);
      i += 1;
    } else {
      flags.set(body, true);
    }
  }

  return { command: positional[0] ?? 'help', positional: positional.slice(1), flags };
}

/** 取字符串选项 */
function flagString(flags: Map<string, string | true>, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === 'string' ? value : undefined;
}

/** 取布尔选项 */
function flagBool(flags: Map<string, string | true>, key: string): boolean {
  const value = flags.get(key);
  if (value === undefined) return false;
  return value === true || value === 'true' || value === '1';
}

/* ─────────────────────── 输出 ─────────────────────── */

/** 人类可读的风险标记 */
function riskBadge(risk: RiskLevel): string {
  return `[${RISK_LABEL[risk]}]`;
}

/** 打印工具列表 */
function printTools(entries: CatalogEntry[], verbose: boolean): void {
  const byModule = new Map<string, CatalogEntry[]>();
  for (const entry of entries) {
    const list = byModule.get(entry.moduleTitle) ?? [];
    list.push(entry);
    byModule.set(entry.moduleTitle, list);
  }

  for (const [moduleTitle, list] of byModule) {
    console.log(`\n${moduleTitle}`);
    for (const entry of list) {
      const vendorTag = entry.vendorName ? ` · ${entry.vendorName}` : '';
      console.log(`  ${entry.id.padEnd(22)} ${riskBadge(entry.risk)} ${entry.title}${vendorTag}`);
      if (verbose) {
        console.log(`  ${''.padEnd(22)} ${entry.description}`);
        for (const param of entry.params) {
          const required = param.required ? '必填' : '可选';
          console.log(`  ${''.padEnd(22)}   --${param.key} <${param.type}> ${required} · ${param.description}`);
        }
      }
    }
  }

  const stats = catalogStats(entries);
  console.log(
    `\n共 ${stats.total} 个工具：通用 ${stats.generic} 个，每台设备可用 ${stats.perDevice} 个，` +
      `覆盖 ${stats.vendors} 个品牌`,
  );
  console.log(
    `风险分布：只读 ${stats.risks[0]} · 可逆 ${stats.risks[1]} · 需确认 ${stats.risks[2]} · 高危 ${stats.risks[3]}`,
  );
  console.log('查看某个工具的详细参数：webroit tools --verbose');
}

/* ─────────────────────── 各子命令 ─────────────────────── */

/** devices：列出本机 adb 可见设备 */
async function cmdDevices(options: GlobalOptions): Promise<number> {
  let devices;
  try {
    devices = await listDevices();
  } catch (error) {
    /*
     * 连不上 adb 是最常见的首次使用场景（没装 platform-tools、
     * 或装了但不在 PATH 里），必须给出可操作的提示而不是抛堆栈。
     * 这种情况归类为「环境未就绪」，不是工具用法错误，所以退出码沿用 1。
     */
    const message = error instanceof Error ? error.message : String(error);
    const hint = /找不到 adb 命令/.test(message)
      ? '这是首次使用的常见情况：需要先安装 Android platform-tools。\n' +
        '  macOS:  brew install android-platform-tools\n' +
        '  Windows/Linux: 从 developer.android.com 下载后把 platform-tools 加入 PATH\n' +
        '  或用 WEBROIT_ADB=/完整路径/adb 指定'
      : '请执行 adb devices 检查 adb 本身是否正常';
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: message, hint }, null, 2));
    } else {
      console.log(`无法列出设备：${message}`);
      console.log(hint);
    }
    return EXIT.fail;
  }

  if (options.json) {
    console.log(JSON.stringify({ devices }, null, 2));
    return EXIT.ok;
  }

  if (devices.length === 0) {
    console.log('未探测到设备。请确认：');
    console.log('  1. 数据线已连接，且手机已在「开发者选项」里开启 USB 调试');
    console.log('  2. 手机上已点「允许 USB 调试」');
    console.log('  3. 执行 adb devices 能看到设备');
    return EXIT.ok;
  }

  for (const device of devices) {
    const state = device.state === 'device' ? '就绪' : device.state;
    console.log(`${device.serial}  ${state}${device.model ? `  ${device.model}` : ''}`);
  }
  return EXIT.ok;
}

/** tools：列出工具目录 */
function cmdTools(options: GlobalOptions, showStats: boolean): number {
  const entries = toCatalog();

  if (showStats || options.json) {
    const stats = catalogStats(entries);
    if (options.json) {
      console.log(
        JSON.stringify(showStats ? { stats } : { stats, tools: entries }, null, 2),
      );
    } else {
      console.log(`工具总数：${stats.total}`);
      console.log(`通用工具：${stats.generic}`);
      console.log(`每台设备可用：${stats.perDevice}`);
      console.log(`覆盖品牌：${stats.vendors}`);
      console.log(
        `风险分布：只读 ${stats.risks[0]} · 可逆 ${stats.risks[1]} · 需确认 ${stats.risks[2]} · 高危 ${stats.risks[3]}`,
      );
    }
    return EXIT.ok;
  }

  printTools(entries, options.verbose);
  return EXIT.ok;
}

/** run：执行一个工具 */
async function cmdRun(
  options: GlobalOptions,
  positional: string[],
  flags: Map<string, string | true>,
): Promise<number> {
  const toolId = positional[0];
  if (!toolId) {
    console.error('用法：webroit run <tool-id> [--参数=值 ...] [--allow-dangerous]');
    console.error('先用 webroit tools 查看可用工具与参数');
    return EXIT.usage;
  }

  // 工具参数：除全局开关外，其余都当作工具参数
  const GLOBAL_KEYS = new Set(['json', 'verbose', 'serial', 'out', 'allow-dangerous', 'help']);
  const params: Record<string, string> = {};
  for (const [key, value] of flags) {
    if (GLOBAL_KEYS.has(key)) continue;
    if (typeof value !== 'string') {
      console.error(`参数 --${key} 需要一个值，例如 --${key}=值`);
      return EXIT.usage;
    }
    params[key] = value;
  }

  try {
    const outcome = await runTool(toolId, {
      params,
      allowDangerous: options.allowDangerous,
      ...(options.outDir ? { outDir: options.outDir } : {}),
      ...(options.serial ? { serial: options.serial } : {}),
      onOutput: options.verbose
        ? (channel, text) => {
            if (channel === 'command') process.stderr.write(`${text.trim()}\n`);
            else if (channel === 'stderr') process.stderr.write(`${text.trim()}\n`);
          }
        : undefined,
    });

    if (options.json) {
      console.log(JSON.stringify(outcome, null, 2));
    } else {
      console.log(outcome.summary);
      if (outcome.artifacts.length > 0) {
        for (const path of outcome.artifacts) console.log(`已保存：${path}`);
      }
    }
    return EXIT.ok;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 用法错误与执行失败分开：agent 据此决定「改参数重试」还是「放弃」
    const usage = error instanceof UsageError;
    if (options.json) {
      console.log(
        JSON.stringify({ ok: false, toolId, error: message, kind: usage ? 'usage' : 'runtime' }, null, 2),
      );
    } else {
      console.error(`${usage ? '用法错误' : '失败'}：${message}`);
    }
    return usage ? EXIT.usage : EXIT.fail;
  }
}

/** shell：在设备上跑一条原始命令 */
async function cmdShell(options: GlobalOptions, positional: string[]): Promise<number> {
  const command = positional.join(' ').trim();
  if (!command) {
    console.error('用法：webroit shell "<adb shell 命令>"');
    return EXIT.usage;
  }

  // 直接复用 NodeDriver —— 这一条不经过工具层，是留给
  // 「工具还没覆盖某个场景」时的逃生口，所以不做风险门控
  const { NodeDriver, pickDevice } = await import('@/node/adb-driver');
  const device = await pickDevice(options.serial);
  const driver = new NodeDriver(device.serial, device.model ?? device.serial);

  try {
    const result = await driver.exec(command, {
      onStdout: options.verbose ? (text) => process.stderr.write(text) : undefined,
    });
    if (options.json) {
      console.log(JSON.stringify({ ok: result.exitCode === 0, ...result }, null, 2));
    } else {
      process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    return result.exitCode === 0 ? EXIT.ok : EXIT.fail;
  } finally {
    await driver.close();
  }
}

/* ─────────────────────── 帮助 ─────────────────────── */

const HELP = `webroit —— 通过本机 adb 操作安卓设备

用法：
  webroit devices [--json]
      列出本机 adb 可见的设备及其状态

  webroit tools [--verbose] [--json] [--stats]
      列出全部功能。--verbose 附带参数说明，--json 输出机器可读目录

  webroit run <tool-id> [--参数=值 ...] [--allow-dangerous] [--json]
      执行一个功能。风险等级 2 及以上必须加 --allow-dangerous

  webroit shell "<命令>" [--serial=<序列号>] [--json]
      在设备上执行一条原始 adb shell 命令

全局选项：
  --serial=<序列号>   多台设备在线时指定目标，否则会报错退出
  --out=<目录>        截屏 / 拉取文件 / 导出 APK 的保存目录，默认当前目录
  --json              输出 JSON，供脚本或 AI agent 解析
  --verbose           显示执行的命令与进度
  --allow-dangerous   允许执行需确认（风险 2）与高危（风险 3）操作

示例：
  webroit devices
  webroit tools --verbose
  webroit run device.snapshot --json
  webroit run display.status --json
  webroit run apps.control --action=freeze --packages=com.example.app --allow-dangerous
  webroit shell "dumpsys battery"

说明：命令行走本机 adb，需要已安装 platform-tools。
      网页版走 WebUSB，不需要本机 adb，两者能力等价。`;

/* ─────────────────────── 入口 ─────────────────────── */

async function main(argv: string[]): Promise<number> {
  const { command, positional, flags } = parseArgv(argv);

  const options: GlobalOptions = {
    json: flagBool(flags, 'json'),
    verbose: flagBool(flags, 'verbose'),
    allowDangerous: flagBool(flags, 'allow-dangerous'),
    help: flagBool(flags, 'help'),
    ...(flagString(flags, 'serial') ? { serial: flagString(flags, 'serial')! } : {}),
    ...(flagString(flags, 'out') ? { outDir: flagString(flags, 'out')! } : {}),
  };

  if (options.help || command === 'help' || command === '--help') {
    console.log(HELP);
    return EXIT.ok;
  }

  try {
    switch (command) {
      case 'devices':
        return await cmdDevices(options);
      case 'tools':
        return cmdTools(options, flagBool(flags, 'stats'));
      case 'run':
        return await cmdRun(options, positional, flags);
      case 'shell':
        return await cmdShell(options, positional);
      default:
        console.error(`未知命令：${command}`);
        console.error('执行 webroit --help 查看用法');
        return EXIT.usage;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const usage = error instanceof UsageError;
    if (options.json) {
      console.log(
        JSON.stringify({ ok: false, error: message, kind: usage ? 'usage' : 'runtime' }, null, 2),
      );
    } else {
      console.error(`${usage ? '用法错误' : '失败'}：${message}`);
    }
    return usage ? EXIT.usage : EXIT.fail;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error('未预期的错误：', error);
    process.exit(EXIT.fail);
  },
);

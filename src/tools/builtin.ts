/**
 * 内置工具集：把 services 的能力包装成 Tool 对象注册进注册表。
 *
 * 这一层很薄 —— 只做三件事：
 * 1. 把 UI 传来的松散 input 转成服务方法要的参数类型
 * 2. 调服务方法
 * 3. 把返回值收拾成 ToolResult
 *
 * 所有真正干活儿的逻辑都在 services 里。工具层不许出现 adb 命令字符串，
 * 一旦出现就说明封装漏了。
 *
 * 关于「不重复」的设计约定：
 * 一组操作如果满足「同一入口、同一前置条件、结果互补」，就合并成一个带
 * action 参数的工具，而不是拆成多个独立按钮。例如：
 * - 冻结与解冻是同一件事的两个方向 → 合并为「应用启停」
 * - 分辨率 / DPI / 还原都是改显示参数 → 合并为「显示参数」
 * - 字体 / 动画 / 锁屏超时都写 settings → 合并为「系统参数」
 * - 电量 / 温度 / 电压 / 充电来源都是电池模拟 → 合并为「电池模拟」
 * 这样侧边栏不会出现十几个语义重叠的入口，用户也不必猜该点哪个。
 */

import type { Services } from '@/services/index';
import type { Tool, ToolContext, VendorId } from '@/tools/registry';
import { COMMON_KEYS } from '@/services/display.service';
import { STATUS_ICON_SLOTS } from '@/services/system.service';
import { formatBytes } from '@/core/utils';

/** 从 input 里取字符串 */
function str(input: Record<string, unknown>, key: string, fallback = ''): string {
  const value = input[key];
  return value === undefined || value === null ? fallback : String(value);
}

/** 从 input 里取数字 */
function num(input: Record<string, unknown>, key: string): number {
  return Number(input[key]);
}

/** 从 input 里取布尔 */
function bool(input: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = input[key];
  if (value === undefined || value === null) return fallback;
  return value === true || value === 'true' || value === 'on' || value === 1;
}

/**
 * 产物交付口。
 *
 * 浏览器里是「触发下载」，命令行里是「写进磁盘」—— 同一个工具在两处都要
 * 把截屏、拉取的文件、导出的 APK 交到用户手上，差别只在最后一步。
 *
 * 所以这里只留一个可替换的出口，具体实现由宿主注册：
 * 浏览器在 main.tsx 里注册下载实现，命令行注册写文件实现。
 * 本文件因此不含任何浏览器 API，能同时被两侧编译。
 */
export type FileSink = (blob: Blob, name: string) => void | Promise<void>;

let fileSink: FileSink | null = null;

/**
 * 注册产物交付口。
 *
 * 不做「默认浏览器下载」的兜底：那会让本文件重新带上 document，
 * 从而没法在 Node 侧编译。未注册时明确报错，比静默丢文件好 ——
 * 截屏和导出的 APK 拿不到，用户会以为是功能坏了。
 */
export function bindFileSink(sink: FileSink | null): void {
  fileSink = sink;
}

/** 交付一个产物 */
function deliver(blob: Blob, name: string): Promise<void> {
  if (!fileSink) {
    throw new Error('未注册产物交付方式，无法保存文件（浏览器应注册下载实现，命令行应注册写盘实现）');
  }
  return Promise.resolve(fileSink(blob, name));
}

/** 解析包名列表，逗号 / 换行 / 空格都认 */
function packageList(raw: string): string[] {
  return raw
    .split(/[,\n\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** services 从哪来 —— 由 app 层注入，避免工具层直接持有会话 */
let resolver: (() => Services | null) | null = null;

/** 注入服务解析器，应用启动时调一次 */
export function bindServices(fn: () => Services | null): void {
  resolver = fn;
}

function requireServices(): Services {
  const services = resolver?.();
  if (!services) throw new Error('设备未连接');
  return services;
}

/* ─────────────────────── 设备 ─────────────────────── */

/**
 * 设备分区里没有「读取状态」工具 —— 设备总览视图进入即自动采集，
 * 再放一张读取卡片就是同一件事的两个入口，用户会不知道该点哪个。
 */
const deviceTools: Tool[] = [
  {
    id: 'device.reboot',
    module: 'device',
    title: '重启设备',
    description: '重启系统、进入 Recovery / Bootloader / EDL，或直接关机',
    risk: 3,
    params: [
      {
        key: 'mode',
        label: '重启模式',
        type: 'select',
        required: true,
        defaultValue: 'system',
        options: [
          { label: '重启系统', value: 'system' },
          { label: 'Recovery 模式', value: 'recovery' },
          { label: 'Bootloader', value: 'bootloader' },
          { label: 'Fastbootd', value: 'fastboot' },
          { label: 'EDL（9008）', value: 'edl' },
          { label: '关机', value: 'poweroff' },
        ],
        hint: '进入 Recovery / Bootloader / EDL 后 ADB 连接会断开，属正常现象',
      },
    ],
    available: () => true,
    async run({ input }: ToolContext) {
      const mode = str(input, 'mode', 'system') as
        | 'system'
        | 'recovery'
        | 'bootloader'
        | 'fastboot'
        | 'edl'
        | 'poweroff';
      const message = await requireServices().device.reboot(mode);
      return { summary: message, destructive: mode !== 'system' };
    },
  },
];

/* ─────────────────────── 应用 ─────────────────────── */

const appTools: Tool[] = [
  {
    id: 'apps.inspect',
    module: 'apps',
    title: '查看应用详情',
    description: '版本号、安装路径、申请权限、安装与更新时间',
    risk: 0,
    params: [
      { key: 'package', label: '包名', type: 'text', required: true, placeholder: 'com.tencent.mm' },
    ],
    available: (caps) => caps.canUsePm,
    async run({ input }: ToolContext) {
      const detail = await requireServices().apps.detail(str(input, 'package'));
      return {
        summary: `${detail.name} v${detail.versionName}${detail.system ? ' · 系统应用' : ''}`,
        data: detail,
      };
    },
  },
  {
    id: 'apps.control',
    module: 'apps',
    title: '启停应用',
    description: '冻结（停用）或解冻应用，也可以强制结束它的进程',
    risk: 2,
    params: [
      { key: 'package', label: '包名', type: 'text', required: true, placeholder: 'com.tencent.mm' },
      {
        key: 'action',
        label: '动作',
        type: 'select',
        required: true,
        defaultValue: 'freeze',
        options: [
          { label: '冻结（等同于系统「停用」）', value: 'freeze' },
          { label: '解冻（恢复启用）', value: 'unfreeze' },
          { label: '强制结束进程', value: 'stop' },
        ],
        hint: '冻结后应用图标仍在，但无法启动；解冻可完全恢复原状',
      },
    ],
    available: (caps) => caps.canUsePm,
    async run({ input }: ToolContext) {
      const name = str(input, 'package');
      const action = str(input, 'action', 'freeze');
      const apps = requireServices().apps;
      if (action === 'unfreeze') {
        await apps.enable(name);
        return { summary: `${name} 已恢复启用` };
      }
      if (action === 'stop') {
        await apps.forceStop(name);
        return { summary: `${name} 进程已结束` };
      }
      await apps.disable(name);
      return { summary: `${name} 已冻结`, destructive: true };
    },
  },
  {
    id: 'apps.data',
    module: 'apps',
    title: '清除应用数据',
    description: '清空应用的账号、设置与缓存，等同于系统里的「清除全部数据」',
    risk: 3,
    params: [
      { key: 'package', label: '包名', type: 'text', required: true, placeholder: 'com.tencent.mm' },
    ],
    available: (caps) => caps.canUsePm,
    async run({ input }: ToolContext) {
      const name = str(input, 'package');
      await requireServices().apps.clearData(name);
      return { summary: `${name} 的数据已清除，需要重新登录`, destructive: true };
    },
  },
  {
    id: 'apps.installState',
    module: 'apps',
    title: '卸载与恢复',
    description: '卸载应用，或把卸载掉的系统应用重新装回来',
    risk: 3,
    params: [
      { key: 'package', label: '包名', type: 'text', required: true, placeholder: 'com.tencent.mm' },
      {
        key: 'action',
        label: '动作',
        type: 'select',
        required: true,
        defaultValue: 'uninstall',
        options: [
          { label: '卸载', value: 'uninstall' },
          { label: '卸载但保留数据', value: 'uninstall-keep' },
          { label: '恢复已卸载的系统应用', value: 'restore' },
        ],
      },
    ],
    available: (caps) => {
      if (caps.canUsePm) return true;
      return '当前设备不支持 pm 命令';
    },
    async run({ input }: ToolContext) {
      const name = str(input, 'package');
      const action = str(input, 'action', 'uninstall');
      const apps = requireServices().apps;

      if (action === 'restore') {
        if (requireServices().capabilities.sdk < 30) {
          throw new Error('恢复系统应用需要 Android 11（API 30）及以上');
        }
        await apps.restore(name);
        return { summary: `${name} 已恢复安装` };
      }
      if (action === 'uninstall-keep') {
        await apps.uninstallKeepData(name);
        return { summary: `${name} 已卸载，数据保留`, destructive: true };
      }
      await apps.uninstall(name);
      return { summary: `${name} 已卸载`, destructive: true };
    },
  },
  {
    id: 'apps.lock',
    module: 'apps',
    title: '卸载保护',
    description: '锁定后应用在桌面与商店里无法被卸载，可用于防误删',
    risk: 2,
    params: [
      { key: 'package', label: '包名', type: 'text', required: true, placeholder: 'com.tencent.mm' },
      {
        key: 'lock',
        label: '操作',
        type: 'select',
        defaultValue: 'true',
        options: [
          { label: '开启保护', value: 'true' },
          { label: '解除保护', value: 'false' },
        ],
      },
    ],
    available: (caps) => caps.canUseCmdPackage || caps.canUsePm,
    async run({ input }: ToolContext) {
      const name = str(input, 'package');
      const lock = str(input, 'lock', 'true') === 'true';
      const state = await requireServices().apps.uninstallLock(name, lock);
      return { summary: `${name} ${state ? '已开启' : '已解除'}卸载保护` };
    },
  },
  {
    id: 'apps.batch',
    module: 'apps',
    title: '批量处理',
    description: '对多个包名执行同一动作，逐条执行并汇总每条结果',
    risk: 3,
    params: [
      {
        key: 'packages',
        label: '包名列表',
        type: 'textarea',
        required: true,
        placeholder: 'com.a.b\ncom.c.d',
        hint: '每行一个，或用逗号、空格分隔',
      },
      {
        key: 'action',
        label: '动作',
        type: 'select',
        required: true,
        defaultValue: 'disable',
        options: [
          { label: '冻结', value: 'disable' },
          { label: '解冻', value: 'enable' },
          { label: '强制结束', value: 'forceStop' },
          { label: '清除数据', value: 'clearData' },
          { label: '卸载', value: 'uninstall' },
        ],
      },
    ],
    available: (caps) => caps.canUsePm,
    async run({ input }: ToolContext) {
      const names = packageList(str(input, 'packages'));
      if (names.length === 0) throw new Error('未提供包名');

      const action = str(input, 'action', 'disable') as
        | 'enable'
        | 'disable'
        | 'forceStop'
        | 'clearData'
        | 'uninstall';
      const results = await requireServices().apps.batch(names, action);
      const ok = results.filter((item) => item.success).length;
      return {
        summary: `${names.length} 个应用，成功 ${ok} 个，失败 ${names.length - ok} 个`,
        data: results,
        destructive: action !== 'enable',
      };
    },
  },
];

/* ─────────────────────── 显示与输入 ─────────────────────── */

const displayTools: Tool[] = [
  {
    id: 'display.read',
    module: 'display',
    title: '读取显示参数',
    description: '当前分辨率、屏幕密度、最小宽度 dp',
    risk: 0,
    params: [],
    available: (caps) => caps.canUseWmSize,
    async run() {
      const status = await requireServices().display.status();
      return {
        summary: `${status.width ?? '?'} × ${status.height ?? '?'} @ ${status.dpi ?? '?'} dpi`,
        data: status,
      };
    },
  },
  {
    id: 'display.write',
    module: 'display',
    title: '修改显示参数',
    description: '调整分辨率或屏幕密度，也可以还原为出厂值',
    risk: 3,
    params: [
      {
        key: 'target',
        label: '修改项',
        type: 'select',
        required: true,
        defaultValue: 'resolution',
        options: [
          { label: '分辨率', value: 'resolution' },
          { label: '屏幕密度（DPI）', value: 'density' },
          { label: '还原到出厂值', value: 'reset' },
        ],
        hint: '改错可能导致界面错位，可用「还原到出厂值」恢复',
      },
      {
        key: 'width',
        label: '宽度',
        type: 'number',
        min: 320,
        max: 7680,
        placeholder: '1080',
        hint: '仅「分辨率」需要填写',
      },
      {
        key: 'height',
        label: '高度',
        type: 'number',
        min: 320,
        max: 7680,
        placeholder: '2400',
        hint: '仅「分辨率」需要填写',
      },
      {
        key: 'density',
        label: '屏幕密度',
        type: 'number',
        min: 72,
        max: 1000,
        placeholder: '420',
        hint: '仅「屏幕密度」需要填写，单位 DPI',
      },
    ],
    available: (caps) => caps.canUseWmSize,
    async run({ input }: ToolContext) {
      const target = str(input, 'target', 'resolution');
      const display = requireServices().display;

      if (target === 'reset') {
        // 分辨率与密度分别消除覆盖值，两个都要 reset 才算真正还原
        const afterSize = await display.reset('size');
        const afterDensity = await display.reset('density');
        return {
          summary: `已还原：${afterSize.width} × ${afterSize.height} @ ${afterDensity.dpi} dpi`,
          data: afterDensity,
        };
      }

      if (target === 'density') {
        const result = await display.setDensity(num(input, 'density'), 'dpi');
        return {
          summary: `屏幕密度已改为 ${result.dpi} dpi`,
          data: result,
          destructive: true,
        };
      }

      const result = await display.setResolution(num(input, 'width'), num(input, 'height'));
      return {
        summary: `分辨率已改为 ${result.width} × ${result.height}`,
        data: result,
        destructive: true,
      };
    },
  },
  {
    id: 'display.screenshot',
    module: 'display',
    title: '截屏',
    description: '截取当前屏幕并保存到本地',
    risk: 0,
    params: [],
    available: (caps) => caps.canUseScreenshot && caps.canUseSync,
    async run() {
      const services = requireServices();
      const shot = await services.display.screenshot();
      try {
        await deliver(shot.blob, shot.name);
      } finally {
        // 无论下载是否成功，设备上的临时文件都要清掉
        await services.display.removeTemp(shot.remote);
      }
      return { summary: `已截屏：${shot.name}（${formatBytes(shot.blob.size)}）` };
    },
  },
  {
    id: 'display.input',
    module: 'display',
    title: '模拟操作',
    description: '发送按键、点击坐标、滑动或输入文字',
    risk: 2,
    params: [
      {
        key: 'kind',
        label: '操作类型',
        type: 'select',
        required: true,
        defaultValue: 'key',
        options: [
          { label: '按键', value: 'key' },
          { label: '点击坐标', value: 'tap' },
          { label: '滑动', value: 'swipe' },
          { label: '输入文字', value: 'text' },
        ],
      },
      {
        key: 'key',
        label: '按键',
        type: 'select',
        defaultValue: '4',
        options: COMMON_KEYS.map((key) => ({ label: key.label, value: String(key.code) })),
        hint: '仅「按键」需要选择',
      },
      {
        key: 'longPress',
        label: '长按按键',
        type: 'boolean',
        defaultValue: false,
        hint: '仅「按键」有效，如长按电源键弹出关机菜单',
      },
      { key: 'x1', label: '起点 X', type: 'number', min: 0, max: 16384, placeholder: '540' },
      { key: 'y1', label: '起点 Y', type: 'number', min: 0, max: 16384, placeholder: '1200' },
      {
        key: 'x2',
        label: '终点 X',
        type: 'number',
        min: 0,
        max: 16384,
        placeholder: '540',
        hint: '仅「滑动」需要填写',
      },
      {
        key: 'y2',
        label: '终点 Y',
        type: 'number',
        min: 0,
        max: 16384,
        placeholder: '400',
        hint: '仅「滑动」需要填写',
      },
      {
        key: 'text',
        label: '文字',
        type: 'text',
        placeholder: 'hello world',
        hint: '仅「输入文字」需要填写，只支持 ASCII',
      },
    ],
    available: (caps) => caps.canUseInput,
    async run({ input }: ToolContext) {
      const kind = str(input, 'kind', 'key');
      const display = requireServices().display;

      if (kind === 'tap') {
        await display.tap(num(input, 'x1'), num(input, 'y1'));
        return { summary: `已在 (${num(input, 'x1')}, ${num(input, 'y1')}) 点击` };
      }
      if (kind === 'swipe') {
        await display.swipe(
          num(input, 'x1'),
          num(input, 'y1'),
          num(input, 'x2'),
          num(input, 'y2'),
        );
        return { summary: `已从 (${num(input, 'x1')}, ${num(input, 'y1')}) 滑动到 (${num(input, 'x2')}, ${num(input, 'y2')})` };
      }
      if (kind === 'text') {
        await display.inputText(str(input, 'text'));
        return { summary: '文字已发送' };
      }

      const code = str(input, 'key', '4');
      const long = bool(input, 'longPress');
      await display.pressKey(code, long);
      const label = COMMON_KEYS.find((key) => String(key.code) === code)?.label ?? code;
      return { summary: `已发送${long ? '长按' : ''}按键：${label}` };
    },
  },
];

/* ─────────────────────── 文件 ─────────────────────── */

const fileTools: Tool[] = [
  {
    id: 'files.install',
    module: 'files',
    title: '安装 APK',
    description: '安装单个 APK，或一次选中多个分卷包完成整套安装',
    risk: 2,
    params: [
      {
        key: 'file',
        label: 'APK 文件',
        type: 'file',
        required: true,
        hint: '分卷包请一次选中全部 .apk 文件',
      },
      {
        key: 'downgrade',
        label: '允许降级',
        type: 'boolean',
        defaultValue: false,
        hint: '安装版本号低于当前已装版本的包',
      },
    ],
    available: (caps) => caps.canUsePm && caps.canUseSync,
    async run({ input, signal }: ToolContext) {
      const raw = input.file;
      const files = (Array.isArray(raw) ? raw : [raw]).filter(
        (item): item is File => item instanceof File,
      );
      if (files.length === 0) throw new Error('未选择文件');

      const results = await requireServices().files.install(files, {
        // 多文件必然是分卷包，自动走 install-create 流程
        split: files.length > 1,
        allowDowngrade: bool(input, 'downgrade'),
        signal,
      });
      const ok = results.filter((item) => item.success).length;
      return {
        summary: `安装完成：成功 ${ok} 个，失败 ${results.length - ok} 个`,
        data: results,
      };
    },
  },
  {
    id: 'files.transfer',
    module: 'files',
    title: '传输文件',
    description: '把本地文件推送到手机，或从手机拉取文件到本地',
    risk: 1,
    params: [
      {
        key: 'direction',
        label: '方向',
        type: 'select',
        required: true,
        defaultValue: 'push',
        options: [
          { label: '推送到手机', value: 'push' },
          { label: '从手机拉取', value: 'pull' },
        ],
      },
      {
        key: 'file',
        label: '本地文件',
        type: 'file',
        hint: '仅「推送到手机」需要选择',
      },
      {
        key: 'remote',
        label: '手机上的路径',
        type: 'text',
        required: true,
        defaultValue: '/sdcard/Download/',
        placeholder: '/sdcard/Download/a.txt',
        hint: '推送时以 / 结尾表示目录，会自动补上文件名；拉取时填完整文件路径',
      },
    ],
    available: (caps) => caps.canUseSync,
    async run({ input, signal }: ToolContext) {
      const direction = str(input, 'direction', 'push');
      const remote = str(input, 'remote');
      const files = requireServices().files;

      if (direction === 'pull') {
        const pulled = await files.pull(remote, signal);
        await deliver(pulled.blob, pulled.name);
        return { summary: `已拉取 ${pulled.name}（${formatBytes(pulled.blob.size)}）` };
      }

      const file = input.file;
      if (!(file instanceof File)) throw new Error('未选择文件');
      const target = await files.push(file, remote, signal);
      return { summary: `已推送到 ${target}` };
    },
  },
  {
    id: 'files.extract',
    module: 'files',
    title: '提取安装包',
    description: '把已安装应用的 APK 导出到本地，分卷应用自动打包成 zip',
    risk: 0,
    params: [
      { key: 'package', label: '包名', type: 'text', required: true, placeholder: 'com.tencent.mm' },
    ],
    available: (caps) => caps.canUsePm && caps.canUseSync,
    async run({ input }: ToolContext) {
      const result = await requireServices().files.extractApk(str(input, 'package'));
      await deliver(result.blob, result.name);
      return {
        summary: `已导出 ${result.name}（${formatBytes(result.blob.size)}）${result.split ? '，含分卷包' : ''}`,
      };
    },
  },
  {
    id: 'files.list',
    module: 'files',
    title: '浏览目录',
    description: '列出手机上某个目录的文件与子目录',
    risk: 0,
    params: [
      {
        key: 'path',
        label: '目录路径',
        type: 'text',
        required: true,
        defaultValue: '/sdcard',
        placeholder: '/sdcard',
      },
    ],
    available: () => true,
    async run({ input }: ToolContext) {
      const entries = await requireServices().files.list(str(input, 'path', '/sdcard'));
      return { summary: `共 ${entries.length} 项`, data: entries };
    },
  },
];

/* ─────────────────────── 系统调校 ─────────────────────── */

const systemTools: Tool[] = [
  {
    id: 'system.read',
    module: 'system',
    title: '读取系统参数',
    description: '当前字体缩放、三种动画倍率、自动锁屏时间',
    risk: 0,
    params: [],
    available: (caps) => caps.canUseSettings,
    async run() {
      const state = await requireServices().system.tuning();
      /*
       * 读不到时要说明「未设置」，不能显示成 ? 或 NaN。
       * 未设置是设备本来就没有这个键（部分 ROM 如此），
       * 与「读失败」是两件事，但对用户来说结果一样：当前没有生效值。
       */
      const show = (value: number | null): string => (value === null ? '未设置' : `${value}×`);
      return {
        summary: `字体 ${show(state.fontScale)} · 动画 ${show(state.windowAnimation)}`,
        data: state,
      };
    },
  },
  {
    id: 'system.write',
    module: 'system',
    title: '修改系统参数',
    description: '调整字体缩放、动画倍率或自动锁屏时间',
    risk: 1,
    params: [
      {
        key: 'key',
        label: '参数',
        type: 'select',
        required: true,
        defaultValue: 'window_animation_scale',
        options: [
          { label: '窗口动画倍率', value: 'window_animation_scale' },
          { label: '过渡动画倍率', value: 'transition_animation_scale' },
          { label: '属性动画倍率', value: 'animator_duration_scale' },
          { label: '字体缩放', value: 'font_scale' },
          { label: '自动锁屏时间（秒）', value: 'screen_off_timeout' },
        ],
      },
      {
        key: 'value',
        label: '数值',
        type: 'number',
        required: true,
        step: 0.1,
        min: 0,
        max: 86400,
        defaultValue: 0.5,
        hint: '动画倍率填 0~4（0 关闭、1 默认）；字体填 0.85~1.3；锁屏时间填 15~1800 秒',
      },
    ],
    available: (caps) => caps.canUseSettings,
    async run({ input }: ToolContext) {
      const key = str(input, 'key', 'window_animation_scale');
      const value = num(input, 'value');
      const system = requireServices().system;

      if (key === 'screen_off_timeout') {
        await system.setScreenTimeout(value);
        return { summary: `自动锁屏已设为 ${value} 秒` };
      }
      await system.setTuning(key as 'font_scale' | 'window_animation_scale' | 'transition_animation_scale' | 'animator_duration_scale', value);
      const labels: Record<string, string> = {
        window_animation_scale: '窗口动画',
        transition_animation_scale: '过渡动画',
        animator_duration_scale: '属性动画',
        font_scale: '字体缩放',
      };
      return { summary: `${labels[key] ?? key}已设为 ${value}×` };
    },
  },
  {
    id: 'system.statusIcons',
    module: 'system',
    title: '状态栏图标',
    description: '隐藏状态栏上不需要的图标，保留其余设置不变',
    risk: 1,
    params: [
      {
        key: 'hidden',
        label: '要隐藏的图标',
        type: 'text',
        defaultValue: '',
        placeholder: 'nfc, alarm_clock',
        hint: `留空表示全部恢复。可选：${STATUS_ICON_SLOTS.map((slot) => slot.key).join(' / ')}`,
      },
    ],
    available: (caps) => caps.canWriteSecureSettings,
    async run({ input }: ToolContext) {
      const hidden = packageList(str(input, 'hidden'));
      await requireServices().system.setStatusIcons(hidden);
      return {
        summary: hidden.length ? `已隐藏 ${hidden.length} 个状态栏图标` : '已恢复全部状态栏图标',
      };
    },
  },
  {
    id: 'system.immersive',
    module: 'system',
    title: '沉浸模式',
    description: '隐藏状态栏或导航栏，获得完整屏幕显示',
    risk: 1,
    params: [
      {
        key: 'kind',
        label: '模式',
        type: 'select',
        defaultValue: 'full',
        options: [
          { label: '全屏（状态栏 + 导航栏）', value: 'full' },
          { label: '仅隐藏状态栏', value: 'status' },
          { label: '仅隐藏导航栏', value: 'navigation' },
          { label: '退出沉浸模式', value: 'reset' },
        ],
      },
    ],
    available: (caps) => caps.canWriteSecureSettings,
    async run({ input }: ToolContext) {
      const kind = str(input, 'kind', 'full') as 'status' | 'navigation' | 'full' | 'reset';
      await requireServices().system.immersive(kind);
      return { summary: kind === 'reset' ? '已退出沉浸模式' : '已进入沉浸模式' };
    },
  },
  {
    id: 'system.wifi',
    module: 'system',
    title: '修复 WiFi 验证',
    description: '解决已连接 WiFi 却提示「无法访问网络」的感叹号问题',
    risk: 1,
    params: [],
    available: (caps) => caps.canUseSettings,
    async run() {
      const steps = await requireServices().system.fixWifi();
      return { summary: `已应用 ${steps.length} 项网络修正`, data: steps };
    },
  },
  {
    id: 'system.rollback',
    module: 'system',
    title: '一键还原设置',
    description: '把本次会话改过的分辨率、DPI、系统参数按逆序还原到改动前的值',
    risk: 1,
    params: [
      {
        key: 'scope',
        label: '还原范围',
        type: 'select',
        defaultValue: 'all',
        options: [
          { label: '全部改动', value: 'all' },
          { label: '仅显示参数', value: 'display' },
          { label: '仅系统参数', value: 'system' },
        ],
        hint: '只还原本次会话内的改动，不会碰本次会话之前的状态',
      },
    ],
    available: () => true,
    async run({ input }: ToolContext) {
      const services = requireServices();
      const scope = str(input, 'scope', 'all');
      const report =
        scope === 'all'
          ? await services.rollback.restoreAll()
          : await services.rollback.restoreModule(scope);

      if (report.total === 0) {
        return { summary: '本次会话没有需要还原的改动' };
      }
      return {
        summary:
          report.failed === 0
            ? `已还原 ${report.restored} 项改动`
            : `还原 ${report.restored} 项，${report.failed} 项失败（可在结果里查看原因）`,
        data: report.steps,
      };
    },
  },
  {
    id: 'system.emergency',
    module: 'system',
    title: '应急重置显示',
    description: '界面大到点不动时用这个：强制把分辨率、DPI、字体拉回物理值',
    risk: 2,
    params: [],
    available: () => true,
    async run() {
      const message = await requireServices().system.emergencyRestore();
      return { summary: message };
    },
  },
];

/* ─────────────────────── 电池 ─────────────────────── */

const batteryTools: Tool[] = [
  {
    id: 'battery.simulate',
    module: 'battery',
    title: '模拟电池',
    description: '伪造电量、温度、电压，或模拟不同的充电来源',
    risk: 2,
    params: [
      {
        key: 'kind',
        label: '模拟项目',
        type: 'select',
        required: true,
        defaultValue: 'level',
        options: [
          { label: '电量百分比', value: 'level' },
          { label: '电池温度', value: 'temperature' },
          { label: '电池电压', value: 'voltage' },
          { label: '充电状态', value: 'status' },
          { label: '充电来源', value: 'source' },
        ],
      },
      {
        key: 'value',
        label: '数值 / 选项',
        type: 'text',
        placeholder: '15',
        hint: '电量 0~100；温度 -50~150℃；电压 3000~5000mV；充电状态可填 unknown / charging / discharging / not-charging / full；充电来源可填 usb / ac / wireless / unplugged',
      },
    ],
    available: (caps) => caps.canUseDumpsys,
    async run({ input }: ToolContext) {
      const kind = str(input, 'kind', 'level');
      const raw = input.value;
      const battery = requireServices().battery;

      if (kind === 'source') {
        const source = String(raw ?? 'usb').trim() as 'usb' | 'ac' | 'wireless' | 'unplugged';
        const result = await battery.setSource(source, source !== 'unplugged');
        return {
          summary: `已模拟为 ${source} 供电状态`,
          data: result,
          destructive: true,
        };
      }

      const result = await battery.set(
        kind as 'level' | 'temperature' | 'voltage' | 'status',
        raw,
      );
      return {
        summary: `已模拟：电量 ${result.level ?? '?'}% · 温度 ${result.temperature ?? '?'}℃ · ${result.status ?? '?'}`,
        data: result,
        destructive: true,
      };
    },
  },
  {
    id: 'battery.restore',
    module: 'battery',
    title: '还原电池状态',
    description: '把模拟过的参数逐项写回真实值',
    risk: 1,
    params: [],
    available: (caps) => caps.canUseDumpsys,
    async run() {
      const message = await requireServices().battery.restore();
      return { summary: message };
    },
  },
];

/* ─────────────────────── 品牌专区 ─────────────────────── */

/**
 * 品牌工具。
 *
 * vendor 字段决定它只会在对应品牌的设备上出现 ——
 * registry 的 visibleTools() 会按当前设备品牌过滤，
 * 所以小米设备上永远不会看到三星的清单。
 */
function vendorTools(vendor: VendorId, bloatLabel: string): Tool[] {
  return [
    {
      id: `vendor.${vendor}.scan`,
      module: 'vendor',
      title: `扫描${bloatLabel}`,
      description: '列出可停用的系统组件及其当前状态，每项都标注实际作用',
      risk: 0,
      vendor,
      params: [],
      available: () => true,
      async run() {
        const items = await requireServices().vendorService.scan();
        const disabled = items.filter((item) => item.disabled).length;
        return {
          summary: `共 ${items.length} 个可停用组件，已停用 ${disabled} 个`,
          data: items,
        };
      },
    },
    {
      id: `vendor.${vendor}.disable`,
      module: 'vendor',
      title: '停用 / 恢复组件',
      description: '批量停用选中的系统组件，可随时恢复',
      risk: 2,
      vendor,
      params: [
        {
          key: 'packages',
          label: '组件包名',
          type: 'textarea',
          required: true,
          placeholder: 'com.miui.systemAdSolution',
          hint: '从扫描结果里选填；仅允许停用清单内的组件',
        },
        {
          key: 'action',
          label: '动作',
          type: 'select',
          defaultValue: 'disable',
          options: [
            { label: '停用', value: 'disable' },
            { label: '恢复', value: 'enable' },
          ],
        },
      ],
      available: () => true,
      async run({ input }: ToolContext) {
        const names = packageList(str(input, 'packages'));
        if (names.length === 0) throw new Error('未提供组件包名');
        const action = str(input, 'action', 'disable');
        const vendorService = requireServices().vendorService;

        const results =
          action === 'enable'
            ? await vendorService.enable(names)
            : await vendorService.disable(names);
        const ok = results.filter((item) => item.ok).length;
        return {
          summary: `${names.length} 个组件，${action === 'enable' ? '恢复' : '停用'}成功 ${ok} 个`,
          data: results,
          destructive: action === 'disable',
        };
      },
    },
  ];
}

const allVendorTools: Tool[] = [
  ...vendorTools('xiaomi', '系统广告与预装组件'),
  ...vendorTools('oppo', '系统广告与预装组件'),
  ...vendorTools('vivo', '系统广告与预装组件'),
  ...vendorTools('huawei', '系统广告与预装组件'),
  ...vendorTools('samsung', '系统广告与预装组件'),
];

/* ─────────────────────── 汇总 ─────────────────────── */

/** 全部内置工具 */
export const BUILTIN_TOOLS: Tool[] = [
  ...deviceTools,
  ...appTools,
  ...displayTools,
  ...fileTools,
  ...systemTools,
  ...batteryTools,
  ...allVendorTools,
];

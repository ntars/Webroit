/**
 * 品牌专属服务：各厂商 ROM 独有的可停用组件与专属设置项。
 *
 * 为什么要单独一层：
 * 同一件事在不同品牌上做法完全不同。以「关闭系统广告」为例——
 * 小米是停用 `com.miui.systemAdSolution`，OPPO 是停用
 * `com.coloros.oppoguardelf`，华为是改 `hw_app_ad` 开关。
 * 如果混在通用应用管理里，用户面对的是一个几千项的包名列表，
 * 根本不知道该动哪个。
 *
 * 所以这里按品牌维护「已知可安全停用的组件清单」，
 * 每项都标注实际作用，让用户看得懂再决定。
 *
 * 安全边界：
 * - 只做「停用」（pm disable-user），不卸载 —— 停用可一条命令完全恢复
 * - 不碰系统框架、不碰与通话/短信/输入法相关的组件
 * - 清单里的每一项都经过「停用后不影响开机与基本功能」的筛选
 */

import type { ShellContext } from '@/core/shell';
import type { VendorId } from '@/tools/registry';
import { quote } from '@/core/utils';

/** 一个可停用的组件 */
export interface BloatItem {
  /** 包名 */
  package: string;
  /** 客观功能描述，说明它负责什么 */
  label: string;
  /** 分组，用于 UI 分栏 */
  group: string;
  /** 停用后可能的影响，为空表示无明显影响 */
  impact?: string;
  /** 默认是否建议停用 */
  recommended: boolean;
}

/** 品牌设置项 */
export interface VendorSetting {
  key: string;
  label: string;
  description: string;
  /** settings 命令的作用域 */
  scope: 'system' | 'secure' | 'global';
  name: string;
  /** 开启值 */
  on: string;
  /** 关闭值 */
  off: string;
}

/** 品牌配置 */
interface VendorProfile {
  bloat: BloatItem[];
  settings: VendorSetting[];
}

/**
 * 各品牌清单。
 *
 * 只收录「停用后系统仍能正常启动与使用」的项。
 * 涉及系统框架（如 com.android.systemui）、通信（telephony）、
 * 输入法、应用商店核心服务的，一律不收。
 */
const PROFILES: Record<VendorId, VendorProfile> = {
  xiaomi: {
    bloat: [
      {
        package: 'com.miui.systemAdSolution',
        label: '系统广告服务',
        group: '广告推送',
        impact: '系统应用内的推广位会消失，不影响应用功能',
        recommended: true,
      },
      {
        package: 'com.miui.analytics',
        label: '使用数据统计',
        group: '广告推送',
        impact: '不再上报使用行为，系统更新不受影响',
        recommended: true,
      },
      {
        package: 'com.xiaomi.mipicks',
        label: '应用商店推荐位',
        group: '广告推送',
        recommended: true,
      },
      {
        package: 'com.miui.msa.global',
        label: 'MSA 广告标识服务',
        group: '广告推送',
        recommended: true,
      },
      {
        package: 'com.miui.hybrid',
        label: '快应用框架',
        group: '快应用',
        impact: '快应用无法启动，普通应用不受影响',
        recommended: false,
      },
      {
        package: 'com.miui.hybrid.accessory',
        label: '快应用支撑组件',
        group: '快应用',
        recommended: false,
      },
      {
        package: 'com.miui.videoplayer',
        label: '小米视频',
        group: '预装应用',
        recommended: false,
      },
      {
        package: 'com.miui.player',
        label: '小米音乐',
        group: '预装应用',
        recommended: false,
      },
      {
        package: 'com.xiaomi.gamecenter',
        label: '游戏中心',
        group: '预装应用',
        recommended: false,
      },
      {
        package: 'com.miui.bugreport',
        label: '用户反馈',
        group: '预装应用',
        recommended: true,
      },
      {
        package: 'com.miui.miservice',
        label: '服务与反馈',
        group: '预装应用',
        recommended: false,
      },
    ],
    settings: [
      {
        key: 'miui_optimization',
        label: 'MIUI 优化',
        description: '关闭后部分系统接口行为回归原生 Android，可能影响权限弹窗与后台限制',
        scope: 'secure',
        name: 'miui_optimization',
        on: '1',
        off: '0',
      },
    ],
  },

  oppo: {
    bloat: [
      {
        package: 'com.coloros.oppoguardelf',
        label: '系统广告与安全推广',
        group: '广告推送',
        impact: '安全中心内的推广位消失，安全扫描功能保留',
        recommended: true,
      },
      {
        package: 'com.heytap.browser',
        label: '自带浏览器',
        group: '预装应用',
        recommended: false,
      },
      {
        package: 'com.heytap.market',
        label: '软件商店',
        group: '预装应用',
        impact: '无法从商店更新应用，可改用其他渠道',
        recommended: false,
      },
      {
        package: 'com.heytap.music',
        label: '音乐',
        group: '预装应用',
        recommended: false,
      },
      {
        package: 'com.heytap.vip',
        label: '会员服务',
        group: '广告推送',
        recommended: true,
      },
      {
        package: 'com.nearme.instant.platform',
        label: '快应用平台',
        group: '快应用',
        recommended: false,
      },
      {
        package: 'com.oppo.exserviceui',
        label: '体验改善计划',
        group: '广告推送',
        recommended: true,
      },
    ],
    settings: [],
  },

  vivo: {
    bloat: [
      {
        package: 'com.vivo.abe',
        label: '行为与体验分析',
        group: '广告推送',
        recommended: true,
      },
      {
        package: 'com.vivo.browser',
        label: '自带浏览器',
        group: '预装应用',
        recommended: false,
      },
      {
        package: 'com.vivo.appstore',
        label: '应用商店',
        group: '预装应用',
        recommended: false,
      },
      {
        package: 'com.vivo.gallery',
        label: '相册',
        group: '预装应用',
        impact: '将无法查看本机照片，建议保留',
        recommended: false,
      },
      {
        package: 'com.vivo.pushservice',
        label: '系统推送服务',
        group: '广告推送',
        impact: '部分应用的通知可能无法送达',
        recommended: false,
      },
      {
        package: 'com.bbk.theme',
        label: '主题商店',
        group: '预装应用',
        recommended: false,
      },
    ],
    settings: [],
  },

  huawei: {
    bloat: [
      {
        package: 'com.huawei.android.hwouc',
        label: '系统更新',
        group: '预装应用',
        impact: '无法接收系统更新，建议保留',
        recommended: false,
      },
      {
        package: 'com.huawei.browser',
        label: '自带浏览器',
        group: '预装应用',
        recommended: false,
      },
      {
        package: 'com.huawei.appmarket',
        label: '应用市场',
        group: '预装应用',
        recommended: false,
      },
      {
        package: 'com.huawei.hwid',
        label: '华为账号服务',
        group: '系统服务',
        impact: '依赖账号的功能会失效，如云同步、查找设备',
        recommended: false,
      },
      {
        package: 'com.huawei.vassistant',
        label: '语音助手',
        group: '预装应用',
        recommended: false,
      },
      {
        package: 'com.huawei.intelligent',
        label: '智慧助手·今天',
        group: '广告推送',
        impact: '负一屏内容不再加载',
        recommended: true,
      },
    ],
    settings: [],
  },

  samsung: {
    bloat: [
      {
        package: 'com.samsung.android.app.spage',
        label: 'Samsung Free 资讯页',
        group: '广告推送',
        impact: '负一屏不再显示资讯内容',
        recommended: true,
      },
      {
        package: 'com.samsung.android.bixby.agent',
        label: 'Bixby 语音助手',
        group: '预装应用',
        recommended: false,
      },
      {
        package: 'com.samsung.android.game.gamehome',
        label: '游戏中心',
        group: '预装应用',
        recommended: false,
      },
      {
        package: 'com.samsung.android.voc',
        label: 'Samsung Members',
        group: '预装应用',
        recommended: false,
      },
      {
        package: 'com.samsung.android.themestore',
        label: '主题商店',
        group: '预装应用',
        recommended: false,
      },
    ],
    settings: [],
  },

  // 原生 Android 与其他设备没有品牌专属清单
  generic: { bloat: [], settings: [] },
};

/** 组件状态 */
export interface BloatState extends BloatItem {
  /** 当前是否已被停用 */
  disabled: boolean;
  /** 是否实际安装（有的组件在某些版本上不存在） */
  installed: boolean;
}

/** 品牌服务 */
export class VendorService {
  #shell: ShellContext;
  #vendor: VendorId;

  constructor(shell: ShellContext, vendor: VendorId) {
    this.#shell = shell;
    this.#vendor = vendor;
  }

  get vendor(): VendorId {
    return this.#vendor;
  }

  /** 当前品牌是否有专属能力 */
  get supported(): boolean {
    const profile = PROFILES[this.#vendor];
    return profile.bloat.length > 0 || profile.settings.length > 0;
  }

  /** 品牌专属设置项清单 */
  settings(): VendorSetting[] {
    return PROFILES[this.#vendor].settings;
  }

  /**
   * 读取组件清单的实际状态。
   *
   * 不逐个 `pm list packages` 查 —— 几千个包逐个查要几分钟。
   * 一次拿全量列表在内存里比对，一条命令搞定。
   */
  async scan(): Promise<BloatState[]> {
    const profile = PROFILES[this.#vendor];
    if (profile.bloat.length === 0) return [];

    const [enabledText, disabledText] = await Promise.all([
      this.#shell.text('pm list packages', { log: false, allowFailure: true }),
      this.#shell.text('pm list packages -d', { log: false, allowFailure: true }),
    ]);

    const installed = new Set(
      enabledText
        .split(/\r?\n/)
        .filter((line) => line.startsWith('package:'))
        .map((line) => line.slice(8).trim()),
    );
    const disabled = new Set(
      disabledText
        .split(/\r?\n/)
        .filter((line) => line.startsWith('package:'))
        .map((line) => line.slice(8).trim()),
    );

    return profile.bloat.map((item) => ({
      ...item,
      installed: installed.has(item.package) || disabled.has(item.package),
      disabled: disabled.has(item.package),
    }));
  }

  /**
   * 批量停用组件。
   *
   * 逐条执行并收集失败原因 —— 某些组件在特定 ROM 版本上受保护，
   * 整批一起发会中途抛错导致后面的漏掉。
   */
  async disable(packages: string[]): Promise<{ package: string; ok: boolean; message: string }[]> {
    const allowed = new Set(PROFILES[this.#vendor].bloat.map((item) => item.package));
    const results: { package: string; ok: boolean; message: string }[] = [];

    for (const name of packages) {
      // 只允许停用清单内的组件，防止有人通过改 UI 传入任意包名
      if (!allowed.has(name)) {
        results.push({ package: name, ok: false, message: '不在当前品牌的可停用清单内' });
        continue;
      }
      try {
        const output = await this.#shell.mutation(`pm disable-user --user 0 ${quote(name)}`);
        results.push({ package: name, ok: true, message: output.trim() || '已停用' });
      } catch (error) {
        results.push({
          package: name,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  /** 批量恢复组件 */
  async enable(packages: string[]): Promise<{ package: string; ok: boolean; message: string }[]> {
    const allowed = new Set(PROFILES[this.#vendor].bloat.map((item) => item.package));
    const results: { package: string; ok: boolean; message: string }[] = [];

    for (const name of packages) {
      if (!allowed.has(name)) {
        results.push({ package: name, ok: false, message: '不在当前品牌的可恢复清单内' });
        continue;
      }
      try {
        const output = await this.#shell.mutation(`pm enable ${quote(name)}`);
        results.push({ package: name, ok: true, message: output.trim() || '已恢复' });
      } catch (error) {
        results.push({
          package: name,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  /** 读品牌设置项当前值 */
  async readSetting(setting: VendorSetting): Promise<boolean | null> {
    const text = (
      await this.#shell.text(`settings get ${setting.scope} ${setting.name}`, {
        log: false,
        allowFailure: true,
      })
    ).trim();
    if (text === 'null' || text === '') return null;
    return text === setting.on;
  }

  /** 写品牌设置项 */
  async writeSetting(setting: VendorSetting, enabled: boolean): Promise<string> {
    return this.#shell.mutation(
      `settings put ${setting.scope} ${setting.name} ${enabled ? setting.on : setting.off}`,
    );
  }
}

/** 取某品牌的可停用清单（给 UI 做数量提示用，不查设备） */
export function bloatCount(vendor: VendorId): number {
  return PROFILES[vendor].bloat.length;
}

/** 取某品牌建议停用的数量 */
export function recommendedCount(vendor: VendorId): number {
  return PROFILES[vendor].bloat.filter((item) => item.recommended).length;
}

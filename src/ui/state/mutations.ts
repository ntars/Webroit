/**
 * 变更动作规格表：每一个会改动设备状态的动作，只在这里定义一次。
 *
 * 为什么要有这张表，而不是让视图直接调服务：
 *
 * 校验脚本必须能判「某个入口是否绕过了确认与审计」。如果视图里写的是
 * `current.apps.uninstall(name)`，静态扫描无法区分「这是 runMutation 的回调」
 * 还是「这是一次裸调用」—— 判据会退化成靠人眼看，等于没有。
 *
 * 所以把「服务方法 + 风险等级 + 确认文案」收进这张表：
 * 视图只表达意图（`卸载这 3 个应用`），实际的服务调用在这里。
 * 于是「视图层不得出现变更服务调用」成为一条能被正则真实执行的禁令 ——
 * 本轮实测过它拦得住：批量卸载曾经就是视图里的一行裸调用。
 *
 * 风险等级与工具卡片里的同名工具对齐（`apps.control` = 2、`apps.batch` = 3）：
 * 同一个动作从两个入口进来，问的必须是同一件事。
 */

import type { Services } from '@/services/index';
import type { VendorBatchResult } from '@/services/vendor.service';
import type { BatchResult } from '@/services/app.service';
import { runMutation, type MutationOutcome } from '@/ui/state/actions';

/** 变更动作的执行结果：取消与完成分开，调用方据此决定要不要报成功 */
export type Outcome<T> = MutationOutcome<T>;

/** 从服务集合里取审计所需的上下文 */
function ctxOf(services: Services) {
  return { shell: services.shell, serial: services.shell.driver?.serial };
}

/* ─────────────── 单个应用 ─────────────── */

/**
 * 冻结（停用）应用。风险 2：可逆，解冻即恢复，受「高危二次确认」开关影响。
 */
export function disableApp(services: Services, name: string): Promise<Outcome<string>> {
  return runMutation(
    ctxOf(services),
    {
      module: 'apps',
      action: 'apps.disable',
      label: `冻结 ${name}`,
      risk: 2,
      confirm: {
        title: `冻结 ${name}`,
        reason: '冻结后应用会从桌面消失且不再后台运行，随时可以解冻恢复。',
        detail: name,
        confirmLabel: '冻结',
      },
    },
    () => services.apps.disable(name),
  );
}

/** 启用（解冻）应用。可逆操作，不问不弹。 */
export function enableApp(services: Services, name: string): Promise<Outcome<string>> {
  return runMutation(
    ctxOf(services),
    {
      module: 'apps',
      action: 'apps.enable',
      label: `启用 ${name}`,
      risk: 1,
      confirm: { title: `启用 ${name}`, reason: '', confirmLabel: '启用' },
    },
    () => services.apps.enable(name),
  );
}

/** 强制结束进程。不影响已保存数据，可逆。 */
export function stopApp(services: Services, name: string): Promise<Outcome<string>> {
  return runMutation(
    ctxOf(services),
    {
      module: 'apps',
      action: 'apps.forceStop',
      label: `停止 ${name}`,
      risk: 1,
      confirm: { title: `停止 ${name}`, reason: '', confirmLabel: '停止' },
    },
    () => services.apps.forceStop(name),
  );
}

/* ─────────────── 批量应用 ─────────────── */

/** 批量冻结。风险 2，目标清单进确认弹层。 */
export function disableApps(services: Services, names: string[]): Promise<Outcome<BatchResult[]>> {
  return runMutation(
    ctxOf(services),
    {
      module: 'apps',
      action: 'apps.batch.disable',
      label: `批量冻结 ${names.length} 个应用`,
      risk: 2,
      confirm: {
        title: `批量冻结 ${names.length} 个应用`,
        reason: '所选应用会从桌面消失且不再后台运行，随时可以解冻恢复。',
        detail: names.join('、'),
        confirmLabel: '冻结',
      },
    },
    () => services.apps.batch(names, 'disable'),
  );
}

/** 批量启用。可逆，不问。 */
export function enableApps(services: Services, names: string[]): Promise<Outcome<BatchResult[]>> {
  return runMutation(
    ctxOf(services),
    {
      module: 'apps',
      action: 'apps.batch.enable',
      label: `批量启用 ${names.length} 个应用`,
      risk: 1,
      confirm: { title: `批量启用 ${names.length} 个应用`, reason: '', confirmLabel: '启用' },
    },
    () => services.apps.batch(names, 'enable'),
  );
}

/**
 * 批量卸载。风险 3，要求手打确认词。
 *
 * 这是本轮修掉的那个缺陷：它以前是视图里一行
 * `onClick={() => void batch('uninstall')}`，点一下就把勾选的应用全卸了。
 */
export function uninstallApps(services: Services, names: string[]): Promise<Outcome<BatchResult[]>> {
  return runMutation(
    ctxOf(services),
    {
      module: 'apps',
      action: 'apps.batch.uninstall',
      label: `批量卸载 ${names.length} 个应用`,
      risk: 3,
      confirm: {
        title: `批量卸载 ${names.length} 个应用`,
        reason:
          '所选应用将从设备上移除，普通应用的数据一并删除且无法撤销。系统应用会保留数据，可用「卸载与恢复」装回。',
        detail: names.join('、'),
        confirmLabel: '卸载',
      },
    },
    () => services.apps.batch(names, 'uninstall'),
  );
}

/* ─────────────── 品牌组件 ─────────────── */

/**
 * 停用系统组件。风险 2：与 `vendor` 分区的工具卡片同档，可随时恢复。
 *
 * 服务层内部只允许操作清单内的包名，所以这里不必再校验一遍。
 */
export function disableVendor(
  services: Services,
  packages: string[],
): Promise<Outcome<VendorBatchResult[]>> {
  return runMutation(
    ctxOf(services),
    {
      module: 'vendor',
      action: 'vendor.disable',
      label: `停用 ${packages.length} 个系统组件`,
      risk: 2,
      confirm: {
        title: `停用 ${packages.length} 个系统组件`,
        reason: '所选组件会被停用，效果等同于系统设置里的「停用」。随时可以在此恢复。',
        detail: packages.join('、'),
        confirmLabel: '停用',
      },
    },
    () => services.vendorService.disable(packages),
  );
}

/** 恢复系统组件。可逆，不问。 */
export function enableVendor(
  services: Services,
  packages: string[],
): Promise<Outcome<VendorBatchResult[]>> {
  return runMutation(
    ctxOf(services),
    {
      module: 'vendor',
      action: 'vendor.enable',
      label: `恢复 ${packages.length} 个系统组件`,
      risk: 1,
      confirm: { title: `恢复 ${packages.length} 个系统组件`, reason: '', confirmLabel: '恢复' },
    },
    () => services.vendorService.enable(packages),
  );
}

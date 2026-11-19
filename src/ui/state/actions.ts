/**
 * 变更操作的治理层：确认门 + 审计留底，只有一条路。
 *
 * 这一层的存在理由是一次实测出来的分裂：
 *
 * 同一个「卸载应用」，在工具卡片里是 `risk: 3` —— 要手打「确认」二字，
 * 且执行前后都写审计；而在应用列表的「批量卸载」按钮上，`onClick` 直接
 * 调服务层，点一下就把勾选的 N 个应用卸了，既没有确认也没有记录。
 * 品牌专区的「停用选中」同样如此。
 *
 * 两边各自实现「要不要问、要不要记」，结果必然只有一边对。
 * 所以门槛与留底收进这一个函数：视图层只描述「这是什么操作」，
 * 不再自己判断风险。
 *
 * 与 `ToolCard` 共用 `gateFor()` —— 两处判定同源，改阈值只改一处。
 */

import type { ShellContext } from '@/core/shell';
import { audited } from '@/core/audit';
import { preferences, toast } from '@/ui/state/app-state';
import { askConfirm, CONFIRM_WORD, gateFor, type ConfirmRequest } from '@/ui/state/confirm';

/** 执行变更所需的上下文 */
export interface MutationContext {
  shell: ShellContext;
  /** 审计记录里的设备序列号，便于多设备对照 */
  serial?: string;
}

/** 一次变更操作的描述 */
export interface MutationMeta {
  /** 分区 id，与 `Tool.module` 同口径 */
  module: string;
  /** 动作 id，写进审计的 action 字段 */
  action: string;
  /** 中文描述，审计列表里显示这一句 */
  label: string;
  /** 风险等级，与 `Tool.risk` 同口径（0 只读 / 1 可逆 / 2 需确认 / 3 高危） */
  risk: 0 | 1 | 2 | 3;
  /** 确认弹层的文案；risk 达到门槛时必须给 */
  confirm: Omit<ConfirmRequest, 'word'>;
}

/** 执行结果：取消与成功分开，调用方据此决定要不要报成功 */
export type MutationOutcome<T> = { status: 'ok'; value: T } | { status: 'cancelled' };

/**
 * 跑一次变更操作。
 *
 * 顺序固定为「问 -> 记水位 -> 执行 -> 补命令」，与 `ToolCard` 一致：
 * 水位必须在执行前取，否则会把上一条操作的命令算进本次记录。
 *
 * 失败时不吞异常：`audited` 已经把失败写进审计，异常继续抛给调用方，
 * 由视图层用 `explainError` 翻成「原因 + 下一步」。
 */
export async function runMutation<T>(
  ctx: MutationContext,
  meta: MutationMeta,
  run: () => Promise<T>,
): Promise<MutationOutcome<T>> {
  const gate = gateFor(meta.risk, preferences.value.confirmDangerous);

  if (gate.needsConfirm) {
    const ok = await askConfirm({
      ...meta.confirm,
      word: gate.needsWord ? CONFIRM_WORD : undefined,
    });
    // 取消不是失败，不弹红条 —— 与「连接时关掉设备选择框」同一处理
    if (!ok) return { status: 'cancelled' };
  }

  const mark = ctx.shell.commandMark();
  const value = await audited(
    {
      module: meta.module,
      action: meta.action,
      label: meta.label,
      serial: ctx.serial,
      commands: () => ctx.shell.commandsSince(mark),
    },
    run,
  );
  return { status: 'ok', value };
}

/**
 * 批量操作的成功提示。
 *
 * 放在这里而不是每个视图各写一句：批量结果的措辞要能同时说清
 * 「动了几个」与「成了几个」，失败时还得明确「其余已执行」——
 * 少这一句，用户会以为整批回滚了。
 */
export function reportBatch(count: number, ok: number, actionLabel: string): void {
  if (ok === count) {
    toast('success', `${count} 个${actionLabel}完成`);
    return;
  }
  toast(
    'error',
    `${count} 个${actionLabel}：成功 ${ok} 个，失败 ${count - ok} 个。失败项未改动，逐条原因见下方记录`,
  );
}

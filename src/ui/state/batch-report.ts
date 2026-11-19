/**
 * 批量操作的结果播报。
 *
 * 这一层解决的是一个「说了等于没说」的问题：
 *
 * 旧版 `reportBatch(count, ok, label)` 只拿到两个数字，于是部分失败时
 * 提示条上写的是「5 个冻结：成功 3 个，失败 2 个。失败项未改动，
 * 逐条原因见下方记录」—— 而「下方记录」并不存在：
 * 批量执行在 `app.service.ts` 里逐条 try/catch，失败原因被塞进
 * `BatchResult.message` 返回，视图层只数了 `success` 的个数就把数组扔了。
 * 终端里只有每条命令的原始回显，没有「哪几个没成、为什么」。
 *
 * 所以判断与措辞搬到这里，输入是完整结果数组而不是计数：
 * 谁失败、失败原因、要不要折叠，都从数据本身得出。
 *
 * 纯函数，不碰 DOM / 不读全局 —— 与 `core/error-copy.ts` 同一取向，
 * 单测与界面共用同一份判断。
 */

/** 批量结果的统一形状（应用与品牌两处服务的返回结构不同，先归一） */
export interface BatchOutcome {
  /** 目标标识：包名或组件名 */
  target: string;
  ok: boolean;
  /** 成功时为设备回显，失败时为错误原文 */
  message: string;
}

/**
 * 提示条里最多列出几条失败项。
 *
 * toast 是浮层，超过四五行的文本会把它撑成一块面板，把下面的界面盖住。
 * 所以摘要只放数字，「哪几个失败」走终端逐条列出。
 */
export const MAX_TOAST_FAILURES = 3;

/**
 * 终端里最多逐条列几行失败。
 *
 * 勾 200 个应用时全失败会刷满整屏，把上一条命令的回显顶走；
 * 超过这个数就折叠成一句「另有 N 条」，完整清单仍在「操作记录」里
 * （审计记录带全部命令与错误）。
 */
export const MAX_LISTED_FAILURES = 20;

/** 从结果数组里取失败项，保持原有顺序 */
export function pickFailures(outcomes: readonly BatchOutcome[]): BatchOutcome[] {
  return outcomes.filter((item) => !item.ok);
}

/** 成功条数 */
export function countOk(outcomes: readonly BatchOutcome[]): number {
  return outcomes.reduce((sum, item) => (item.ok ? sum + 1 : sum), 0);
}

/** 一段播报：提示条用摘要，终端用明细 */
export interface BatchReport {
  /** 提示条的语调：全成是 success，有失败就是 error */
  tone: 'success' | 'error';
  /** 提示条正文 */
  summary: string;
  /** 终端逐条明细（可能为空：全成功时不需要明细） */
  lines: string[];
}

/**
 * 生成一段完整播报。
 *
 * @param outcomes 归一化后的结果数组
 * @param actionLabel 动作名，如「冻结」「卸载」「恢复」
 */
export function buildBatchReport(
  outcomes: readonly BatchOutcome[],
  actionLabel: string,
): BatchReport {
  const total = outcomes.length;
  const ok = countOk(outcomes);
  const failures = pickFailures(outcomes);

  if (failures.length === 0) {
    return { tone: 'success', summary: `${total} 个${actionLabel}完成`, lines: [] };
  }

  /*
   * 摘要必须点名「接下来去哪儿看」。
   *
   * 「逐条原因见下方记录」这种写法是零信息：用户会去找一个不存在的东西。
   * 这里写的是界面上真实存在的区域名 —— 命令输出面板就在主区域下方。
   */
  const head = failures
    .slice(0, MAX_TOAST_FAILURES)
    .map((item) => item.target)
    .join('、');
  const more = failures.length > MAX_TOAST_FAILURES ? ' 等' : '';

  const summary =
    `${total} 个${actionLabel}：成功 ${ok} 个，失败 ${failures.length} 个。` +
    `失败的 ${head}${more} 未改动，逐条原因见下方「命令输出」`;

  const listed = failures.slice(0, MAX_LISTED_FAILURES);
  const lines = listed.map((item) => `[失败] ${item.target}：${cleanMessage(item.message)}`);

  if (failures.length > listed.length) {
    lines.push(
      `[失败] 另有 ${failures.length - listed.length} 条未逐条列出，完整清单见「操作记录」`,
    );
  }

  return { tone: 'error', summary, lines };
}

/**
 * 失败原文的清洗。
 *
 * 设备返回的多行错误（`Failure [INSTALL_FAILED...]\n  ...`）直接拼进
 * 一行会把终端排版撑乱；换行压成空格，首尾空白去掉。
 * 空消息不能留白 —— 那就又变成「失败但不知道为什么」。
 */
function cleanMessage(message: string): string {
  const text = message.replace(/\s+/g, ' ').trim();
  return text || '设备没有返回原因';
}

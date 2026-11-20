/**
 * 操作记录视图：把审计日志摆到用户眼前。
 *
 * 为什么要有这一页：
 * 审计日志写进 IndexedDB 但用户看不到，等于没有 ——
 * 「冻结了某个应用，两周后想起来却不知道当时动了哪个包」
 * 这类问题是玩机工具的真实高频痛点，唯一解是能查、能导出。
 *
 * 设计取舍：
 * - 不提供「删除单条」—— 审计记录一旦可编辑就失去可信度
 * - 只提供「导出」与「全部清除」，且清除要二次确认
 * - 失败的记录标红并显示错误原文，这比成功记录更有价值
 */

import { type FunctionComponent } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { auditLog, type AuditEntry } from '@/core/audit';
import { messageOf } from '@/core/error-copy';
import { MODULES } from '@/tools/registry';
import { preferences, toast } from '@/ui/state/app-state';
import { askConfirm, CONFIRM_WORD, gateFor } from '@/ui/state/confirm';
import { useSignal } from '@/ui/state/signal';

/** 状态对应的展示文案与颜色 */
const STATUS_META: Record<AuditEntry['status'], { label: string; tone: string }> = {
  ok: { label: '成功', tone: 'success' },
  error: { label: '失败', tone: 'danger' },
  aborted: { label: '已中止', tone: 'warning' },
};

/** 分区 ID → 中文名。用户不该在日志里读英文键 */
const MODULE_LABEL: Record<string, string> = Object.fromEntries(
  MODULES.map((module) => [module.id, module.title]),
);

/** 时间格式化：只到秒，够用且不占宽度 */
function formatTime(at: number): string {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export const AuditView: FunctionComponent = () => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState<'all' | 'error'>('all');
  /*
   * 订阅偏好而不是直接读 `preferences.value`。
   *
   * 「高危二次确认」开关决定清空要不要手打确认词。直接读 `.value` 只在渲染那一刻
   * 取值，用户在偏好面板里改了开关、回到这一页仍读旧值 —— 门槛与实际设置不一致，
   * 而这正是治理层最不该出现的偏差。
   */
  const prefs = useSignal(preferences);

  useEffect(() => {
    // subscribe 会立即回填一次当前数据，不需要额外初读
    return auditLog.subscribe(setEntries);
  }, []);

  const visible =
    filter === 'error'
      ? entries.filter((entry) => entry.status !== 'ok')
      : entries;
  // 最新在前
  const ordered = [...visible].reverse();

  const exportLog = () => {
    const { blob, name } = auditLog.export();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast('success', `已导出 ${name}`);
  };

  const clearAll = async () => {
    /*
     * 清空走全站同一个确认门，不用 `window.confirm`。
     *
     * 原实现是全仓唯一一处浏览器原生对话框。它有四个具体坏处：
     * 1. 样式不可控 —— 深色主题下弹出一张系统白框，与本项目任何一处浮层都不同源；
     * 2. 全屏 / PWA 独立窗口下可能被浏览器拦成「页面已阻止此对话框」而不显示；
     * 3. 没有手打确认词的余地，一次误点就抹掉全部追溯线索；
     * 4. **静态校验拦不住** —— `verify:copy` F 段的反向禁令查的是
     *    「视图直调变更服务方法」，`window.confirm` 不是服务调用，历轮全绿。
     *
     * 清空不可逆且不可恢复，按 risk 3 处理：不受「高危二次确认」偏好开关影响，
     * 要求手打「确认」二字。
     */
    const gate = gateFor(3, prefs.confirmDangerous);
    const ok = await askConfirm({
      title: `清空全部 ${entries.length} 条操作记录`,
      reason:
        '这份日志是本机唯一的「改过什么」追溯线索，清空后无法恢复。它不会撤销任何设备改动，只是删掉记录。',
      detail: entries.length > 0 ? '清空后会留下一条「已清空」记录，标出这条断层。' : undefined,
      confirmLabel: '清空',
      word: gate.needsWord ? CONFIRM_WORD : undefined,
    });
    if (!ok) return;

    try {
      const removed = await auditLog.clear({
        module: 'audit',
        action: 'audit.clear',
        label: `清空操作记录（${entries.length} 条）`,
      });
      toast('info', `已清空 ${removed} 条操作记录`);
    } catch (caught) {
      /*
       * 这里刻意不走 `explainError()`。
       *
       * 那个翻译器面向的是**设备**异常，兜底会让人「查数据线、重新连接」——
       * 而清空审计只动本机 IndexedDB，与数据线无关。套上去等于给出一条
       * 完全不解决问题的下一步。本地存储失败的出口只有一条：换个浏览器环境重试。
       *
       * 取原文交给 `messageOf()` 而不是手写 `instanceof Error ? ... : String(...)` ——
       * 后者是 `verify:copy` B 段明令禁止的写法，正是因为散落各处就没人负责翻译。
       */
      toast(
        'error',
        `清空失败：${messageOf(caught)}。本机存储可能处于隐私模式或配额已满，可先用「导出 JSON」留一份`,
      );
    }
  };

  return (
    <div class="stack">
      <div class="card">
        <div class="card__header">
          <div>
            <div class="card__title">操作记录</div>
            <div class="card__subtitle">
              只记录会改变设备状态的操作，最多保留最近 500 条，全部存在本机浏览器里
            </div>
          </div>
          <div class="apps__toolbar">
            <select
              class="select select--compact"
              value={filter}
              onChange={(event) =>
                setFilter((event.target as HTMLSelectElement).value as 'all' | 'error')
              }
            >
              <option value="all">全部</option>
              <option value="error">仅失败项</option>
            </select>
            <button
              type="button"
              class="btn btn--secondary btn--sm"
              onClick={exportLog}
              disabled={entries.length === 0}
            >
              导出 JSON
            </button>
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              onClick={() => void clearAll()}
              disabled={entries.length === 0}
            >
              清空
            </button>
          </div>
        </div>

        {ordered.length === 0 ? (
          <div class="empty">
            {entries.length === 0
              ? '还没有记录。执行冻结应用、修改显示参数这类操作后会出现在这里'
              : '没有符合筛选条件的记录'}
          </div>
        ) : (
          <ul class="audit">
            {ordered.map((entry) => {
              const meta = STATUS_META[entry.status];
              return (
                <li key={entry.id} class="audit__item">
                  <div class="audit__head">
                    <span class="audit__time">{formatTime(entry.at)}</span>
                    <span class={`tag tag--${meta.tone}`}>{meta.label}</span>
                    <span class="audit__label">{entry.label}</span>
                    <span class="audit__module">
                      {MODULE_LABEL[entry.module] ?? entry.module}
                    </span>
                  </div>
                  {entry.error && <div class="audit__error">{entry.error}</div>}
                  {entry.commands.length > 0 && (
                    <div class="audit__commands">
                      {entry.commands.map((command, index) => (
                        <code key={index}>{command}</code>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

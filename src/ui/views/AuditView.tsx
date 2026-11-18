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
import { MODULES } from '@/tools/registry';
import { toast } from '@/ui/state/app-state';

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
    const ok = window.confirm(
      `将删除全部 ${entries.length} 条操作记录。\n\n` +
        '这不会撤销任何设备改动，只是清掉这份本地日志。删除后无法恢复，确定继续？',
    );
    if (!ok) return;
    await auditLog.clear();
    toast('info', '操作记录已清空');
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

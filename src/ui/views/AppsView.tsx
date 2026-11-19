/**
 * 应用管理视图。
 *
 * 核心交互是「列表 + 搜索 + 选中后批量操作」，而不是一个填包名的表单 ——
 * 用户通常不认识包名，只能靠应用名找。但 PC 端 ADB 拿不到应用的中文名
 * （那是 launcher 的事），所以退一步：
 * 用包名搜索 + 系统/第三方/停用分类 + 状态可视化来补偿。
 *
 * 性能要点：应用数量常达 300+，列表用 CSS 渲染而不做虚拟滚动，
 * 因为每行只有一个文本和一个状态标签，300 行的 DOM 开销在桌面端可忽略。
 */

import { type FunctionComponent } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';

import type { PackageEntry } from '@/services/app.service';
import type { Tool } from '@/tools/registry';
import { explainError, type Explanation } from '@/core/error-copy';
import { services, toast } from '@/ui/state/app-state';
import { useSignal } from '@/ui/state/signal';
import { ToolCard } from '@/ui/components/ToolCard';
import { NeedsDevice } from '@/ui/components/NeedsDevice';
import { ErrorNotice } from '@/ui/components/ErrorNotice';

interface Props {
  tools: Tool[];
}

type Filter = 'all' | 'third' | 'system' | 'disabled';

export const AppsView: FunctionComponent<Props> = ({ tools }) => {
  const current = useSignal(services);
  const [entries, setEntries] = useState<PackageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Explanation | null>(null);
  const [filter, setFilter] = useState<Filter>('third');
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    if (!current || loading) return;
    setLoading(true);
    setError(null);
    try {
      setEntries(await current.apps.listWithState());
    } catch (caught) {
      setError(explainError(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // 筛选与搜索在内存里做，切换即时生效，不重新读设备
  const filtered = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter === 'third' && entry.system) return false;
      if (filter === 'system' && !entry.system) return false;
      if (filter === 'disabled' && !entry.disabled) return false;
      if (key && !entry.name.toLowerCase().includes(key)) return false;
      return true;
    });
  }, [entries, filter, keyword]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((entry) => entry.name)));
  };

  /** 执行单个应用的状态变更，完成后局部更新，避免整表重读 */
  const act = async (name: string, action: 'enable' | 'disable' | 'forceStop') => {
    if (!current || busy) return;
    setBusy(name);
    try {
      if (action === 'enable') await current.apps.enable(name);
      else if (action === 'disable') await current.apps.disable(name);
      else await current.apps.forceStop(name);

      setEntries((prev) =>
        prev.map((entry) =>
          entry.name === name && action !== 'forceStop'
            ? { ...entry, disabled: action === 'disable' }
            : entry,
        ),
      );
      toast('success', `${name} ${action === 'enable' ? '已启用' : action === 'disable' ? '已冻结' : '已停止'}`);
    } catch (caught) {
      const explained = explainError(caught);
      toast('error', explained.reason);
    } finally {
      setBusy(null);
    }
  };

  /** 批量操作：一次一条，串行执行避免命令堆积 */
  const batch = async (action: 'enable' | 'disable' | 'uninstall') => {
    if (!current || selected.size === 0 || busy) return;
    const names = [...selected];
    setBusy('batch');
    try {
      const results = await current.apps.batch(names, action);
      const ok = results.filter((item) => item.success).length;
      toast('success', `${names.length} 个应用，成功 ${ok} 个`);

      // 局部同步状态，不重读整表
      setEntries((prev) =>
        prev.map((entry) => {
          if (!selected.has(entry.name)) return entry;
          if (action === 'enable') return { ...entry, disabled: false };
          if (action === 'disable') return { ...entry, disabled: true };
          return entry;
        }),
      );
      setSelected(new Set());
      if (action === 'uninstall') await load();
    } catch (caught) {
      const explained = explainError(caught);
      toast('error', explained.reason);
    } finally {
      setBusy(null);
    }
  };

  /*
   * 未连接：应用列表读不到，但工具卡片照常渲染。
   * 这里不显示空表格 —— 空表格会让人以为「这台设备没有应用」，
   * 换成明确的连接提示更准确。
   */
  if (!current) {
    return (
      <div class="stack">
        <NeedsDevice reason="读取应用列表需要先连接设备" />
        {tools.length > 0 && (
          <div class="tool-grid">
            {tools.map((tool) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                expanded={expanded === tool.id}
                onToggle={() => setExpanded(expanded === tool.id ? null : tool.id)}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div class="stack">
      <section class="card card--flush">
        <div class="apps__toolbar">
          <div class="apps__search">
            <input
              class="input input--mono"
              placeholder="搜索包名…"
              value={keyword}
              onInput={(event) => setKeyword((event.target as HTMLInputElement).value)}
            />
          </div>
          <div class="segmented">
            {(
              [
                ['third', '第三方'],
                ['system', '系统'],
                ['disabled', '已停用'],
                ['all', '全部'],
              ] as [Filter, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                class="segmented__item"
                data-active={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            class="btn btn--secondary btn--sm"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? '读取中…' : '刷新'}
          </button>
        </div>

        {selected.size > 0 && (
          <div class="apps__batch">
            <span class="apps__batch-count">已选 {selected.size} 个</span>
            <button
              type="button"
              class="btn btn--secondary btn--sm"
              disabled={busy !== null}
              onClick={() => void batch('disable')}
            >
              批量冻结
            </button>
            <button
              type="button"
              class="btn btn--secondary btn--sm"
              disabled={busy !== null}
              onClick={() => void batch('enable')}
            >
              批量启用
            </button>
            <button
              type="button"
              class="btn btn--danger btn--sm"
              disabled={busy !== null}
              onClick={() => void batch('uninstall')}
            >
              批量卸载
            </button>
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              onClick={() => setSelected(new Set())}
            >
              取消选择
            </button>
          </div>
        )}

        {error && (
          <div style={{ margin: '12px' }}>
            <ErrorNotice
              explanation={error}
              title="读取应用列表失败"
              onRetry={error.retry ? () => void load() : undefined}
            />
          </div>
        )}

        <div class="apps__list">
          {filtered.length === 0 ? (
            <div class="empty">
              {loading ? (
                <>
                  <span class="spinner" />
                  <div>正在读取应用列表（首次读取约需数秒）…</div>
                </>
              ) : (
                <div>
                  <div>没有匹配的应用</div>
                  <div style={{ fontSize: '12px', marginTop: '4px' }}>
                    当前筛选为「第三方」，本机可能只有系统应用。切换到其他分类或清空搜索词试试。
                  </div>
                </div>
              )}
            </div>
          ) : (
            <table class="table">
              <thead>
                <tr>
                  <th style={{ width: '32px' }}>
                    <input
                      type="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={toggleAll}
                      aria-label="全选"
                    />
                  </th>
                  <th>包名</th>
                  <th style={{ width: '88px' }}>类型</th>
                  <th style={{ width: '72px' }}>状态</th>
                  <th style={{ width: '150px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr key={entry.name} data-selected={selected.has(entry.name)}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(entry.name)}
                        onChange={() => toggle(entry.name)}
                        aria-label={`选择 ${entry.name}`}
                      />
                    </td>
                    <td class="table__mono">{entry.name}</td>
                    <td>
                      {entry.system ? (
                        <span class="tag tag--neutral">系统</span>
                      ) : (
                        <span class="tag tag--accent">第三方</span>
                      )}
                    </td>
                    <td>
                      {entry.disabled ? (
                        <span class="tag tag--warning">已冻结</span>
                      ) : (
                        <span class="tag tag--success">运行中</span>
                      )}
                    </td>
                    <td>
                      <div class="apps__row-actions">
                        {entry.disabled ? (
                          <button
                            type="button"
                            class="btn btn--ghost btn--sm"
                            disabled={busy !== null}
                            onClick={() => void act(entry.name, 'enable')}
                          >
                            启用
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              class="btn btn--ghost btn--sm"
                              disabled={busy !== null}
                              onClick={() => void act(entry.name, 'disable')}
                            >
                              冻结
                            </button>
                            <button
                              type="button"
                              class="btn btn--ghost btn--sm"
                              disabled={busy !== null}
                              onClick={() => void act(entry.name, 'forceStop')}
                            >
                              停止
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div class="apps__footer">
          共 {entries.length} 个应用，当前显示 {filtered.length} 个
        </div>
      </section>

      {tools.length > 0 && (
        <div class="tool-grid">
          {tools.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              expanded={expanded === tool.id}
              onToggle={() => setExpanded(expanded === tool.id ? null : tool.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

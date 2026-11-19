/**
 * 品牌专区视图。
 *
 * 设计重点：让用户看懂「这一项是干什么的、停掉有什么后果」，
 * 而不是给他一个包名列表让他自己猜。
 *
 * 交互上做了一个刻意的取舍：不提供「全选停用」。
 * 一键全关听着省事，但清单里有「系统更新」这类停掉会影响安全的项，
 * 一个按钮把它们一起关掉，出问题后用户根本不知道是哪一步导致的。
 * 所以给的是「仅停用推荐项」—— 推荐项都是纯推广 / 统计类，
 * 停掉不影响任何实际功能。
 */

import { type FunctionComponent } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';

import type { BloatState } from '@/services/vendor.service';
import { vendorMeta, type Tool } from '@/tools/registry';
import { explainError, type Explanation } from '@/core/error-copy';
import { services, toast } from '@/ui/state/app-state';
import { useSignal } from '@/ui/state/signal';
import { ToolCard } from '@/ui/components/ToolCard';
import { NeedsDevice } from '@/ui/components/NeedsDevice';
import { ErrorNotice } from '@/ui/components/ErrorNotice';

interface Props {
  tools: Tool[];
}

export const VendorView: FunctionComponent<Props> = ({ tools }) => {
  const current = useSignal(services);
  const [items, setItems] = useState<BloatState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Explanation | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const meta = current ? vendorMeta(current.vendor) : null;

  const scan = async () => {
    if (!current || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await current.vendorService.scan();
      setItems(result);
      // 默认不勾选任何项 —— 停用是变更操作，不该有默认选中
      setSelected(new Set());
    } catch (caught) {
      setError(explainError(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void scan();
  }, []);

  // 按分组归类，UI 上分栏展示
  const groups = useMemo(() => {
    const map = new Map<string, BloatState[]>();
    for (const item of items) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return [...map.entries()];
  }, [items]);

  const installed = items.filter((item) => item.installed);
  const disabledCount = items.filter((item) => item.disabled).length;

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectRecommended = () => {
    // 只选「已安装、未停用、且标记为推荐」的项
    const targets = items
      .filter((item) => item.installed && !item.disabled && item.recommended)
      .map((item) => item.package);
    setSelected(new Set(targets));
  };

  const apply = async (action: 'disable' | 'enable') => {
    if (!current || selected.size === 0 || busy) return;
    setBusy(true);
    try {
      const names = [...selected];
      const results =
        action === 'enable'
          ? await current.vendorService.enable(names)
          : await current.vendorService.disable(names);
      const ok = results.filter((item) => item.ok).length;
      toast('success', `${names.length} 个组件，成功 ${ok} 个`);
      setSelected(new Set());
      await scan();
    } catch (caught) {
      const explained = explainError(caught);
      toast('error', explained.reason);
    } finally {
      setBusy(false);
    }
  };

  /*
   * 未连接：品牌要探测才知道，这里不给假品牌名，只说明连接后按品牌显示。
   * 工具卡片照常渲染（ModuleView 在预览期不做品牌过滤，会把 5 个品牌的清单都给出），
   * 但这会让访客看到一堆重复标题的卡片，所以这里改为不展示卡片，
   * 只留一句说明 —— 品牌专区的价值完全依赖真实品牌，预览收益低于噪音。
   */
  if (!current) {
    return (
      <div class="stack">
        <NeedsDevice reason="品牌专区按设备品牌显示对应的可停用组件，需要先连接设备" />
        <div class="empty">
          <div>连接后会自动识别品牌，并在此列出该品牌的可停用系统组件</div>
          <div style={{ fontSize: '12px' }}>
            目前覆盖小米 / OPPO / vivo / 华为 / 三星五个品牌类别
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="stack">
      <div class="vendor-head">
        <div>
          <h2 class="vendor-head__title">{meta?.name ?? current.capabilities.brand}</h2>
          <p class="vendor-head__desc">
            {meta?.rom ?? '当前系统'} 独有的可停用组件。这些是系统内置的推广、统计与预装应用，
            停用后不会影响系统运行，随时可以恢复。
          </p>
        </div>
        <div class="vendor-head__stats">
          <div class="vendor-head__stat">
            <span class="vendor-head__num">{installed.length}</span>
            <span class="vendor-head__label">可停用</span>
          </div>
          <div class="vendor-head__stat">
            <span class="vendor-head__num">{disabledCount}</span>
            <span class="vendor-head__label">已停用</span>
          </div>
        </div>
      </div>

      {error && (
        <ErrorNotice
          explanation={error}
          title="扫描系统组件失败"
          onRetry={error.retry ? () => void scan() : undefined}
        />
      )}

      {selected.size > 0 && (
        <div class="vendor-bar">
          <span class="apps__batch-count">已选 {selected.size} 个</span>
          <button
            type="button"
            class="btn btn--primary btn--sm"
            disabled={busy}
            onClick={() => void apply('disable')}
          >
            {busy ? '处理中…' : '停用选中'}
          </button>
          <button
            type="button"
            class="btn btn--secondary btn--sm"
            disabled={busy}
            onClick={() => void apply('enable')}
          >
            恢复选中
          </button>
          <button
            type="button"
            class="btn btn--ghost btn--sm"
            onClick={() => setSelected(new Set())}
          >
            取消
          </button>
        </div>
      )}

      {installed.length === 0 ? (
        <div class="empty">
          {loading ? (
            <>
              <span class="spinner" />
              <div>正在扫描系统组件…</div>
            </>
          ) : (
            <>
              <div>未在这台设备上找到清单内的组件</div>
              <div style={{ fontSize: '12px' }}>
                可能是系统版本较新已移除，或组件名与已知清单不一致
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          <div class="vendor-toolbar">
            <button type="button" class="btn btn--secondary btn--sm" onClick={selectRecommended}>
              选中推荐项
            </button>
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              onClick={() => void scan()}
              disabled={loading}
            >
              重新扫描
            </button>
            <span class="vendor-toolbar__tip">
              「推荐」标记的是纯推广与数据统计组件，停用不影响任何功能
            </span>
          </div>

          {groups.map(([group, list]) => (
            <section key={group} class="card card--flush">
              <div class="vendor-group">
                <div class="vendor-group__header">
                  <h3 class="vendor-group__title">{group}</h3>
                  <span class="vendor-group__count">{list.length} 项</span>
                </div>
                <div class="vendor-list">
                  {list.map((item) => (
                    <label
                      key={item.package}
                      class="vendor-item"
                      data-disabled={item.disabled}
                      data-missing={!item.installed}
                    >
                      <input
                        type="checkbox"
                        disabled={!item.installed || item.disabled}
                        checked={selected.has(item.package)}
                        onChange={() => toggle(item.package)}
                      />
                      <div class="vendor-item__body">
                        <div class="vendor-item__title-row">
                          <span class="vendor-item__title">{item.label}</span>
                          {item.recommended && (
                            <span class="tag tag--accent">推荐</span>
                          )}
                          {item.disabled && (
                            <span class="tag tag--warning">已停用</span>
                          )}
                          {!item.installed && (
                            <span class="tag tag--neutral">未安装</span>
                          )}
                        </div>
                        <div class="vendor-item__package">{item.package}</div>
                        {item.impact && (
                          <div class="vendor-item__impact">影响：{item.impact}</div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </section>
          ))}
        </>
      )}

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

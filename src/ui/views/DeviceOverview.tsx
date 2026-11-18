/**
 * 设备总览：一屏看完全部硬件与运行状态。
 *
 * 这个视图有独立的自动刷新 —— 设备信息不像应用列表那样一次读取即可，
 * 电量、CPU 频率、前台应用都是动态值。但自动刷新不能太激进：
 * WebUSB 下每条命令都是真实往返，每 2 秒刷一次会让设备一直处于忙碌状态，
 * 反而拖慢用户主动触发的操作。所以默认关闭，用户需要时手动开启。
 */

import { type FunctionComponent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import type { Tool } from '@/tools/registry';
import type { DeviceSnapshot } from '@/services/device.service';
import type { CpuCore, FocusInfo } from '@/core/utils';
import { preferences, services } from '@/ui/state/app-state';
import { useSignal } from '@/ui/state/signal';
import { ToolCard } from '@/ui/components/ToolCard';
import { NeedsDevice } from '@/ui/components/NeedsDevice';

interface Props {
  tools: Tool[];
}

interface Overview {
  snapshot: DeviceSnapshot;
  cores: CpuCore[];
  focus: FocusInfo;
}

export const DeviceOverview: FunctionComponent<Props> = ({ tools }) => {
  const current = useSignal(services);
  const prefs = useSignal(preferences);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const load = async () => {
    if (!current || loading) return;
    setLoading(true);
    setError(null);
    try {
      const [snapshot, cores, focus] = await Promise.all([
        current.device.snapshot(),
        current.device.cpuFreq().catch(() => []),
        current.device.foreground().catch(() => ({ package: '', activity: '' })),
      ]);
      setOverview({ snapshot, cores, focus });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  // 首次进入自动读一次
  useEffect(() => {
    void load();
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  // 自动刷新：5 秒间隔，比手动点击保守得多
  useEffect(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (autoRefresh) {
      timerRef.current = window.setInterval(() => void load(), 5000);
    }
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [autoRefresh, current]);

  // 低电量提示：阈值来自用户偏好，只提示不拦截
  const batteryLevel = overview?.snapshot.battery.level ?? null;
  const lowBattery =
    batteryLevel !== null &&
    batteryLevel <= prefs.batteryWarning &&
    !overview?.snapshot.battery.acPowered &&
    !overview?.snapshot.battery.usbPowered &&
    !overview?.snapshot.battery.wirelessPowered;

  /*
   * 未连接：只把「读设备数据」这块换成连接提示，工具卡片照常渲染。
   * 访客能看清本分区有哪些操作、风险几级，插线后同一屏立即变成实时数据。
   */
  if (!current) {
    return (
      <div class="stack">
        <NeedsDevice reason="读取硬件信息与运行状态需要先连接设备" />
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
      {error && (
        <div class="notice notice--danger">
          <strong>读取失败</strong>
          <p>{error}</p>
        </div>
      )}

      {lowBattery && (
        <div class="notice notice--warning">
          <strong>电量偏低（{batteryLevel}%）</strong>
          <p>
            当前设备未在充电，剩余电量已低于你设定的 {prefs.batteryWarning}% 阈值。
            进行冻结应用、刷写分区等耗时的操作前，建议先接上电源 ——
            中途断电会让设备停在未完成的状态。
          </p>
        </div>
      )}

      {overview ? (
        <>
          {/* 顶部关键指标 */}
          <div class="metrics">
            <Metric
              label="电量"
              value={overview.snapshot.battery.level === null ? '—' : `${overview.snapshot.battery.level}%`}
              hint={
                overview.snapshot.battery.temperature === null
                  ? undefined
                  : `${overview.snapshot.battery.temperature.toFixed(1)}℃`
              }
            />
            <Metric
              label="分辨率"
              value={
                overview.snapshot.display.width
                  ? `${overview.snapshot.display.width}×${overview.snapshot.display.height}`
                  : '—'
              }
              hint={
                overview.snapshot.display.dpi ? `${overview.snapshot.display.dpi} dpi` : undefined
              }
            />
            <Metric
              label="运行时长"
              value={overview.snapshot.uptime}
              hint={overview.snapshot.arch}
            />
            <Metric
              label="CPU 均值"
              value={
                overview.cores.length
                  ? `${Math.round(
                      overview.cores.reduce((sum, core) => sum + core.mhz, 0) / overview.cores.length,
                    )} MHz`
                  : '—'
              }
              hint={overview.cores.length ? `${overview.cores.length} 核` : undefined}
            />
          </div>

          {/* 详细信息 */}
          <div class="overview">
            <section class="card">
              <div class="card__header">
                <div>
                  <div class="card__title">硬件与系统</div>
                  <div class="card__subtitle">{overview.snapshot.marketName}</div>
                </div>
                <div class="overview__actions">
                  <label class="checkbox">
                    <input
                      type="checkbox"
                      checked={autoRefresh}
                      onChange={(event) => setAutoRefresh((event.target as HTMLInputElement).checked)}
                    />
                    <span class="checkbox__text">自动刷新</span>
                  </label>
                  <button
                    type="button"
                    class="btn btn--secondary btn--sm"
                    onClick={() => void load()}
                    disabled={loading}
                  >
                    {loading ? '读取中…' : '刷新'}
                  </button>
                </div>
              </div>

              <div class="kv">
                <div class="kv__key">品牌</div>
                <div class="kv__value">{overview.snapshot.brand}</div>
                <div class="kv__key">型号</div>
                <div class="kv__value">{overview.snapshot.model}</div>
                <div class="kv__key">代号</div>
                <div class="kv__value">{overview.snapshot.device}</div>
                <div class="kv__key">系统</div>
                <div class="kv__value">{overview.snapshot.android}</div>
                <div class="kv__key">架构</div>
                <div class="kv__value">
                  {overview.snapshot.arch} · {overview.snapshot.abi}
                </div>
                <div class="kv__key">内核</div>
                <div class="kv__value">{overview.snapshot.kernel}</div>
                <div class="kv__key">存储介质</div>
                <div class="kv__value">{overview.snapshot.storageType}</div>
                <div class="kv__key">主板序列号</div>
                <div class="kv__value">{overview.snapshot.boardId}</div>
                <div class="kv__key">物理分辨率</div>
                <div class="kv__value">{overview.snapshot.display.physicalSize ?? '—'}</div>
                <div class="kv__key">最小宽度</div>
                <div class="kv__value">
                  {overview.snapshot.display.dp ? `${overview.snapshot.display.dp} dp` : '—'}
                  {overview.snapshot.display.overridden && (
                    <span class="tag tag--warning" style={{ marginLeft: '6px' }}>已修改</span>
                  )}
                </div>
                <div class="kv__key">前台应用</div>
                <div class="kv__value kv__value--mono">
                  {overview.focus.package || '未识别'}
                  {overview.focus.activity && (
                    <div class="kv__sub">{overview.focus.activity}</div>
                  )}
                </div>
              </div>
            </section>

            <section class="card">
              <div class="card__header">
                <div class="card__title">CPU 核心频率</div>
              </div>
              {overview.cores.length === 0 ? (
                <div class="empty">当前设备未暴露频率节点</div>
              ) : (
                <div class="cores">
                  {overview.cores.map((core) => {
                    const max = Math.max(...overview.cores.map((item) => item.mhz), 1);
                    return (
                      <div key={core.id} class="core">
                        <span class="core__id">核心 {core.id}</span>
                        <div class="core__bar">
                          <div
                            class="core__fill"
                            style={{ width: `${Math.round((core.mhz / max) * 100)}%` }}
                          />
                        </div>
                        <span class="core__value">{core.mhz}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div class="divider" />
              <div class="kv">
                <div class="kv__key">电池状态</div>
                <div class="kv__value">
                  {overview.snapshot.battery.acPowered
                    ? '交流电充电'
                    : overview.snapshot.battery.usbPowered
                      ? 'USB 充电'
                      : overview.snapshot.battery.wirelessPowered
                        ? '无线充电'
                        : '未充电'}
                </div>
                <div class="kv__key">电压</div>
                <div class="kv__value">
                  {overview.snapshot.battery.voltage === null
                    ? '—'
                    : `${overview.snapshot.battery.voltage.toFixed(2)} V`}
                </div>
                {overview.snapshot.battery.updatesStopped && (
                  <>
                    <div class="kv__key">注意</div>
                    <div class="kv__value">
                      <span class="tag tag--warning">电池处于模拟状态</span>
                    </div>
                  </>
                )}
              </div>
            </section>
          </div>
        </>
      ) : (
        <div class="empty">
          <span class="spinner" />
          <div>正在读取设备信息…</div>
        </div>
      )}

      {/* 设备操作 */}
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

/** 顶部指标块 */
const Metric: FunctionComponent<{ label: string; value: string; hint?: string }> = ({
  label,
  value,
  hint,
}) => (
  <div class="metric">
    <div class="metric__label">{label}</div>
    <div class="metric__value">{value}</div>
    {hint && <div class="metric__hint">{hint}</div>}
  </div>
);

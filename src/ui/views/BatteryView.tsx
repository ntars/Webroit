/**
 * 电池视图。
 *
 * 两部分：
 * 1. 实时功耗采样 —— 可开关的折线图与 CSV 导出
 * 2. 模拟控制 —— 委托给注册表里的工具卡片
 *
 * 折线图自己用 SVG 画，不引图表库。原因很简单：
 * 只需要一条折线 + 坐标轴，任何图表库都比这几十行 SVG 重得多。
 */

import { type FunctionComponent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import type { PowerSample } from '@/services/battery.service';
import { BatteryService } from '@/services/battery.service';
import type { Tool } from '@/tools/registry';
import { explainError } from '@/core/error-copy';
import { services, toast } from '@/ui/state/app-state';
import { useSignal } from '@/ui/state/signal';
import { ToolCard } from '@/ui/components/ToolCard';
import { NeedsDevice } from '@/ui/components/NeedsDevice';

interface Props {
  tools: Tool[];
}

export const BatteryView: FunctionComponent<Props> = ({ tools }) => {
  const current = useSignal(services);
  const [summary, setSummary] = useState<{
    level: number | null;
    temperature: number | null;
    voltage: number | null;
    status: string;
    health: string;
    plug: string;
    simulated: boolean;
  } | null>(null);
  const [samples, setSamples] = useState<PowerSample[]>([]);
  const [watching, setWatching] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadSummary = async () => {
    if (!current) return;
    try {
      setSummary(await current.battery.summary());
    } catch {
      // 读失败不打断界面，保留旧值
    }
  };

  useEffect(() => {
    void loadSummary();
  }, []);

  // 离开页面时必须停掉采样，否则后台还在持续发命令
  useEffect(() => {
    return () => {
      abortRef.current?.abort(new Error('页面已离开'));
    };
  }, []);

  const startWatch = async () => {
    if (!current || watching) return;
    setWatching(true);
    setSamples([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await current.battery.watchPower({
        interval: 3000,
        limit: 100,
        signal: controller.signal,
        onSample: (_sample, all) => {
          setSamples([...all]);
          // 每 10 个点同步一次电量显示，避免频繁读 dumpsys
          if (all.length % 10 === 0) void loadSummary();
        },
      });
    } catch (caught) {
      // 用户主动停止采样不算故障，不弹错误提示
      const explained = explainError(caught);
      if (explained.kind !== 'cancelled') toast('error', explained.reason);
    } finally {
      setWatching(false);
      abortRef.current = null;
      void loadSummary();
    }
  };

  const stopWatch = () => {
    abortRef.current?.abort(new Error('用户已停止采样'));
  };

  const exportCsv = () => {
    if (!current || samples.length === 0) return;
    const { blob, name } = current.battery.exportCsv(samples);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast('success', `已导出 ${samples.length} 个采样点`);
  };

  const stats = BatteryService.summarize(samples);

  // 未连接：读数与采样都不可用，但模拟工具的参数与风险仍可预览
  if (!current) {
    return (
      <div class="stack">
        <NeedsDevice reason="读取电池状态与功耗采样需要先连接设备" />
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
      {/* 状态概览 */}
      <div class="metrics">
        <Metric
          label="电量"
          value={summary?.level === null || summary === null ? '—' : `${summary.level}%`}
          hint={summary?.status}
        />
        <Metric
          label="温度"
          value={summary?.temperature === null || summary === null ? '—' : `${summary.temperature.toFixed(1)}℃`}
          hint={summary?.health}
        />
        <Metric
          label="电压"
          value={summary?.voltage === null || summary === null ? '—' : `${summary.voltage.toFixed(2)} V`}
          hint={summary?.plug}
        />
        <Metric
          label="瞬时功率"
          value={samples.length ? `${(samples[samples.length - 1].watt ?? 0).toFixed(2)} W` : '—'}
          hint={samples.length ? `${(samples[samples.length - 1].milliamp ?? 0).toFixed(0)} mA` : '未采样'}
        />
      </div>

      {summary?.simulated && (
        <div class="notice notice--warning">
          <strong>电池当前处于模拟状态</strong>
          <p>
            电量、温度等数值可能与真实情况不符。使用「还原电池状态」可以恢复真实读数。
          </p>
        </div>
      )}

      {/* 功耗采样 */}
      <section class="card">
        <div class="card__header">
          <div>
            <div class="card__title">功耗采样</div>
            <div class="card__subtitle">
              每 3 秒采集一次电流电压，最多 100 个点
            </div>
          </div>
          <div class="overview__actions">
            {watching ? (
              <button type="button" class="btn btn--danger btn--sm" onClick={stopWatch}>
                停止采样
              </button>
            ) : (
              <button type="button" class="btn btn--secondary btn--sm" onClick={() => void startWatch()}>
                开始采样
              </button>
            )}
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              onClick={exportCsv}
              disabled={samples.length === 0}
            >
              导出 CSV
            </button>
          </div>
        </div>

        {samples.length > 1 ? (
          <>
            <PowerChart samples={samples} />
            <div class="stats">
              <Stat label="采样点数" value={String(stats.count)} />
              <Stat
                label="平均功率"
                value={stats.averageWatt === null ? '—' : `${stats.averageWatt.toFixed(2)} W`}
              />
              <Stat
                label="峰值功率"
                value={stats.peakWatt === null ? '—' : `${stats.peakWatt.toFixed(2)} W`}
              />
              <Stat label="持续时间" value={`${stats.durationSeconds.toFixed(0)} 秒`} />
              <Stat
                label="电量变化"
                value={
                  stats.drainPercent === null
                    ? '—'
                    : stats.drainPercent > 0
                      ? `−${stats.drainPercent}%`
                      : stats.drainPercent < 0
                        ? `+${Math.abs(stats.drainPercent)}%`
                        : '无变化'
                }
              />
            </div>
          </>
        ) : (
          <div class="empty">
            {watching ? (
              <>
                <span class="spinner" />
                <div>正在采集第 1 个数据点…</div>
              </>
            ) : (
              <div>点击「开始采样」记录一段时间内的功耗变化</div>
            )}
          </div>
        )}
      </section>

      {/* 模拟工具 */}
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

/* ─────────────────────── 折线图 ─────────────────────── */

const CHART_HEIGHT = 140;
const CHART_PADDING = { top: 12, right: 12, bottom: 22, left: 38 };

/**
 * 功耗折线图。
 *
 * viewBox 用 100 × 100 的相对坐标，让 SVG 自动缩放适配任意宽度 ——
 * 这样不需要监听 resize，也不用知道容器的像素宽度。
 */
const PowerChart: FunctionComponent<{ samples: PowerSample[] }> = ({ samples }) => {
  const points = samples.filter((sample) => sample.watt !== null) as (PowerSample & {
    watt: number;
  })[];

  if (points.length < 2) {
    return (
      <div class="empty">
        <div>有效数据点不足，画不出曲线</div>
        <div style={{ fontSize: '12px', marginTop: '4px' }}>
          设备没有返回电流值，常见于不报告瞬时功耗的机型。继续采样会重新尝试；
          也可以改用「电池诊断」里的详情读一次完整状态。
        </div>
      </div>
    );
  }

  const watts = points.map((sample) => sample.watt);
  const maxWatt = Math.max(...watts);
  const minWatt = Math.min(...watts);
  // 上下各留 10% 余量，避免曲线贴边
  const span = maxWatt - minWatt || 1;
  const top = maxWatt + span * 0.1;
  const bottom = Math.max(0, minWatt - span * 0.1);
  const range = top - bottom || 1;

  const width = 100;
  const height = 100;
  const plotW = width - (CHART_PADDING.left + CHART_PADDING.right) / 6;
  const plotH = height - (CHART_PADDING.top + CHART_PADDING.bottom) / 6;

  const coords = points.map((sample, index) => {
    const x = ((index / (points.length - 1)) * plotW + CHART_PADDING.left / 6).toFixed(3);
    const y = (plotH - ((sample.watt - bottom) / range) * plotH + CHART_PADDING.top / 6).toFixed(3);
    return { x, y, watt: sample.watt };
  });

  const path = coords.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ');
  // 填充区域：折线下方到底部闭合
  const area = `${path} L${coords[coords.length - 1].x},${(plotH + CHART_PADDING.top / 6).toFixed(3)} L${coords[0].x},${(plotH + CHART_PADDING.top / 6).toFixed(3)} Z`;

  return (
    <div class="chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        class="chart__svg"
        style={{ height: `${CHART_HEIGHT}px` }}
        role="img"
        aria-label={`功耗曲线，峰值 ${maxWatt.toFixed(2)} 瓦`}
      >
        {/* 横向网格线 */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = plotH * ratio + CHART_PADDING.top / 6;
          const value = top - range * ratio;
          return (
            <g key={ratio}>
              <line
                x1={CHART_PADDING.left / 6}
                y1={y}
                x2={width - CHART_PADDING.right / 6}
                y2={y}
                stroke="var(--border-subtle)"
                stroke-width="0.2"
              />
              <text
                x={CHART_PADDING.left / 6 - 0.8}
                y={y + 0.8}
                text-anchor="end"
                font-size="2.4"
                fill="var(--text-tertiary)"
              >
                {value.toFixed(1)}
              </text>
            </g>
          );
        })}

        <path d={area} fill="var(--accent-subtle)" />
        <path
          d={path}
          fill="none"
          stroke="var(--accent)"
          stroke-width="0.5"
          stroke-linejoin="round"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <div class="chart__footer">
        <span>起始</span>
        <span>功率（瓦）</span>
        <span>{samples[samples.length - 1].elapsed >= 1000
          ? `${(samples[samples.length - 1].elapsed / 1000).toFixed(0)} 秒`
          : '结束'}</span>
      </div>
    </div>
  );
};

/* ─────────────────────── 小组件 ─────────────────────── */

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

const Stat: FunctionComponent<{ label: string; value: string }> = ({ label, value }) => (
  <div class="stat">
    <div class="stat__label">{label}</div>
    <div class="stat__value">{value}</div>
  </div>
);

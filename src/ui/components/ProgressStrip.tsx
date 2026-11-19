/**
 * 传输进度条。
 *
 * 挂在终端面板顶部，只在有传输时出现。三条设计取舍：
 *
 * 1. **不弹模态、不盖内容**。用户此刻可能在读终端输出或翻参数，
 *    进度是旁白，不是主角。
 * 2. **总量未知时不画轨道**。拉取某些特殊文件时 `lstat` 拿不到大小，
 *    此时百分比恒为 -1 —— 画一条不动的空轨道比不画更让人焦虑，
 *    改为只显示「已传 12.3 MB」。
 * 3. **颜色只用 `--accent`**。进度是中性信息，不是成功也不是警告；
 *    用绿色会让人以为「已经完事了」。
 */

import { type FunctionComponent } from 'preact';

import { formatBytes } from '@/core/utils';
import { progress } from '@/ui/state/app-state';
import { useSignal } from '@/ui/state/signal';

export const ProgressStrip: FunctionComponent = () => {
  const current = useSignal(progress);
  if (!current) return null;

  const known = current.percent >= 0;
  const percent = known ? Math.round(current.percent) : -1;

  return (
    <div
      class="progress-strip"
      data-known={known}
      role="progressbar"
      aria-label={current.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? percent : undefined}
      aria-valuetext={
        known
          ? `${percent}%，${formatBytes(current.done)} / ${formatBytes(current.total)}`
          : `已传输 ${formatBytes(current.done)}`
      }
    >
      <span class="progress-strip__label" title={current.label}>
        {current.label}
      </span>
      {known && (
        <span class="progress-strip__track" aria-hidden="true">
          <span class="progress-strip__fill" style={{ width: `${percent}%` }} />
        </span>
      )}
      <span class="progress-strip__value">
        {known
          ? `${percent}% · ${formatBytes(current.done)} / ${formatBytes(current.total)}`
          : `已传 ${formatBytes(current.done)}`}
      </span>
    </div>
  );
};

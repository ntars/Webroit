/**
 * 统一错误提示块。
 *
 * 结构固定为三段，缺一不可：
 * 1. 发生了什么（reason）—— 一句话，不带「操作失败」这种零信息短语
 * 2. 现在做什么（next）—— 必须是可执行动作
 * 3. 原始报错（raw）—— 默认折叠，排查时展开复制
 *
 * 为什么把它抽成组件：同样的三行结构在工具卡片、应用列表、设备总览、
 * 品牌专区、连接引导五处都要出现。各写一遍的必然结果是其中两处开始偷懒，
 * 退化成只显示一句红字。
 */

import { type FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';

import type { Explanation } from '@/core/error-copy';

interface Props {
  explanation: Explanation;
  /** 标题，默认「执行失败」 */
  title?: string;
  /** 有重试入口时传入，渲染成「重试」按钮 */
  onRetry?: () => void;
  /** 重试按钮文案，默认「重试」 */
  retryLabel?: string;
}

export const ErrorNotice: FunctionComponent<Props> = ({
  explanation,
  title = '执行失败',
  onRetry,
  retryLabel = '重试',
}) => {
  const [showRaw, setShowRaw] = useState(false);
  const { reason, next, raw } = explanation;

  return (
    <div class="notice notice--danger error-notice" role="alert">
      <strong>{title}</strong>
      <p class="error-notice__reason">{reason}</p>
      {/*
        给「下一步」一个显式标签。
        没有标签时这两段在视觉上是两个等价的句子，用户会当成同一段报错读过去；
        加了标签，扫一眼就能定位到「我该做什么」那一行。
      */}
      <p class="error-notice__next">
        <span class="error-notice__label">下一步</span>
        {next}
      </p>

      <div class="error-notice__footer">
        {onRetry && (
          <button type="button" class="btn btn--secondary btn--sm" onClick={onRetry}>
            {retryLabel}
          </button>
        )}
        {/* 原文只对排查有用，默认收起，避免把界面变成日志窗口 */}
        {raw && (
          <button
            type="button"
            class="btn btn--ghost btn--sm"
            aria-expanded={showRaw}
            onClick={() => setShowRaw(!showRaw)}
          >
            {showRaw ? '收起原始报错' : '查看原始报错'}
          </button>
        )}
      </div>

      {showRaw && raw && <pre class="error-notice__raw">{raw}</pre>}
    </div>
  );
};

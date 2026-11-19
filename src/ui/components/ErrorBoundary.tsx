/**
 * 渲染错误边界。
 *
 * 为什么必须有它：
 * Preact 在渲染期抛错时会一路向上抛，找不到边界就把整棵子树从 DOM 里卸掉。
 * 实测过：某个分区算错一个字段，切进去之后 `.content` 只剩连接提示条，
 * 分区内容整块消失、没有任何提示；再切到别的分区，导航标题变了、
 * 内容区却还是那一张空壳 —— 用户会以为整个工具坏了，只会考虑刷新或换浏览器。
 *
 * 一个分区的渲染错误不该赔上整个应用。所以边界挂在「分区」这一级：
 * 坏的那一块变成一块说明 + 两个出口，其余部分照常可用。
 *
 * 三条设计约束：
 *
 * 1. **复用 `ErrorNotice`**。兜底块与普通失败提示结构一致（原因 / 下一步 / 原文折叠），
 *    否则出错时的文案质量会掉一档，而这正是最需要说清楚的时候。
 * 2. **必须能自己恢复**。`resetKey` 变化（切分区）自动清错；「重试」按钮
 *    通过换 `attempt` 强制子节点重建 —— 只把 error 置空是不够的，
 *    同一个 vnode 再 diff 一遍仍会抛同样的错。
 * 3. **上报到终端**。边界会吞掉异常，不记下来就永远查不出根因。
 */

import { Component, Fragment, type ComponentChildren } from 'preact';

import { explainError, type Explanation } from '@/core/error-copy';
import { pushOutput, toast } from '@/ui/state/app-state';
import { ErrorNotice } from '@/ui/components/ErrorNotice';

interface Props {
  children: ComponentChildren;
  /** 出错时显示的范围名，例如「应用管理」；缺省时只说「这块内容」 */
  label?: string;
  /**
   * 复位键。值一变就清掉错误状态 —— 切分区时靠它自动恢复，
   * 不需要每个调用点自己写「顺手重置一下」。
   */
  resetKey?: unknown;
  /** 点「重试」时的额外动作 */
  onRetry?: () => void;
  /**
   * 兜底块下方的补充说明。
   *
   * 不同层级的边界「还剩什么可用」不一样：分区级坏了，侧边栏与终端都还在；
   * 外壳级坏了，能走的只有刷新。写死一句会在一半场合变成假话。
   */
  note?: string;
}

interface State {
  error: Explanation | null;
  /** 重建计数：重试时 +1，给子节点换一个 key 逼它重新挂载 */
  attempt: number;
}

/** 渲染期错误的解释。
 *
 * 不走 `explainError` 的通用兜底：那句「先确认设备仍在连接状态」对渲染错误是误导 ——
 * 数据线插得再紧也不会让一个算错的字段变对。这里给的是针对这块界面的出口。
 */
function explainRenderError(caught: unknown, label: string): Explanation {
  const base = explainError(caught);
  const where = label ? `「${label}」这块内容` : '这块内容';
  return {
    ...base,
    reason: `${where}在显示时没能完成：${base.reason}`,
    next: '先点「重试」重新渲染；仍然失败就换到别的分区继续操作（其余部分不受影响），并把下方原始报错连同机型与系统版本记下来。',
    retry: true,
  };
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, attempt: 0 };

  static override getDerivedStateFromError(caught: unknown): Partial<State> {
    // 静态方法拿不到 props，先原样存异常，文案在 componentDidCatch 里补齐
    return { error: explainError(caught) };
  }

  override componentDidCatch(caught: unknown): void {
    const label = this.props.label ?? '';
    const explained = explainRenderError(caught, label);
    this.setState({ error: explained });

    /*
     * 边界会吞掉异常，不做记录就再也没人知道它发生过。
     * 终端里留一条，toast 只喊一句 —— 详细出口由兜底块承载，
     * 与 ToolCard 失败时的分工保持一致。
     */
    pushOutput('stderr', `[界面异常] ${label || '分区'}：${explained.raw || explained.reason}`);
    toast('error', '这块内容显示失败，已就地给出处理方式');
  }

  override componentDidUpdate(previous: Props): void {
    // 切分区 / 外部要求复位：清掉错误，让新内容正常渲染
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  /** 重试：清错误 + 换 key 强制重建子树 */
  private readonly retry = (): void => {
    this.setState((prev) => ({ error: null, attempt: prev.attempt + 1 }));
    this.props.onRetry?.();
  };

  override render(): ComponentChildren {
    const { error, attempt } = this.state;
    if (!error) {
      // Fragment 带 key：attempt 一变，整棵子树重新挂载，而不是复用上一轮的失败实例
      return <Fragment key={attempt}>{this.props.children}</Fragment>;
    }

    const note =
      this.props.note ??
      '界面其余部分仍然可用 —— 侧边栏、终端与其它分区不受影响。换一个分区再回来也会重新尝试渲染。';

    return (
      <div class="crash" role="alert">
        <ErrorNotice
          explanation={error}
          title="这块内容显示失败了"
          onRetry={this.retry}
          retryLabel="重试"
        />
        <p class="crash__note">{note}</p>
      </div>
    );
  }
}

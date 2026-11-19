/**
 * 全局轻提示的渲染层。
 *
 * 这个组件补的是一个「有出无口」的缺：`app-state.ts` 里的 `toast()` 被
 * 18 处调用点用来宣告执行结果（工具跑完、批量冻结、导出文件、连接成功），
 * 但 `toasts` 信号从来没有订阅者 —— 所有反馈静默消失在内存里。
 * 用户看到的是「点了执行，界面毫无变化」，分不清是成功、失败还是没点上。
 *
 * 设计取舍：
 * - 固定在右上角。右下角是命令输出面板，提示压上去会盖住用户正在看的回显。
 * - 容器 `pointer-events: none`，单条 `pointer-events: auto` ——
 *   提示飘着的时候不能挡住下面的按钮，但关闭键必须点得到。
 * - 无障碍用「每条自带 role」而不是「容器 aria-live」：
 *   live region 必须先存在于 DOM、再插入内容，才会被读屏播报；
 *   而这个容器是随第一条消息一起出现的，容器级 aria-live 对首批消息并不生效。
 *   `role="alert"` 本身就是为「插入即播报」设计的，`role="status"` 是它的温和版，
 *   所以成功/信息走 status、失败走 alert，一条一个 live region，互不降级。
 * - 最多同时显示 4 条。批量操作可能瞬间连发十几条，全铺开会顶出视口；
 *   被挤掉的条目仍在 `toast()` 的计时器里，到点自然消失，不会残留。
 * - 不做自动消失的逻辑。计时器在 `toast()` 里，那里才是「这条消息活多久」
 *   的唯一真源；组件只负责画出来和允许手动提前关掉。
 */

import { type FunctionComponent } from 'preact';

import { dismissToast, toasts } from '@/ui/state/app-state';
import { useSignal } from '@/ui/state/signal';

/** 单屏最多显示条数，超出丢最早的（越新的越可能是用户刚触发的） */
const MAX_VISIBLE = 4;

export const ToastHost: FunctionComponent = () => {
  const items = useSignal(toasts);

  // 空的时候整个不渲染：留一个常驻的空浮层只会多一层命中测试
  if (items.length === 0) return null;

  const visible = items.slice(-MAX_VISIBLE);

  return (
    <div class="toast-stack" aria-label="操作提示">
      {visible.map((item) => (
        <div
          key={item.id}
          class="toast"
          data-kind={item.kind}
          role={item.kind === 'error' ? 'alert' : 'status'}
        >
          <span class="toast__text">{item.text}</span>
          <button
            type="button"
            class="toast__close"
            onClick={() => dismissToast(item.id)}
            aria-label="关闭提示"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M5 5l14 14M19 5L5 19" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
};

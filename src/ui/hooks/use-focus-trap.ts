/**
 * 浮层焦点陷阱：把 Tab 键关在弹层里，关掉时把焦点还回去。
 *
 * 为什么需要它 —— 实测出来的（`scripts/probe-focus.mjs`）：
 *
 * 三处浮层都写了 `aria-modal="true"`，但**行为上不是模态**。偏好面板打开后
 * 按第一次 Tab，焦点直接落在背景的顶栏按钮上；走完面板内 10 个控件后
 * 又一路沿着侧边栏导航往下跑。确认弹层更糟：第一次 Tab 到「取消」，
 * 第二次就跑到背景。对键盘用户来说，「弹层盖住了屏幕」这件事不成立，
 * 他们仍在和背景交互 —— 而背景此时是一个被遮住的、不知道该不该点的界面。
 *
 * 另外两件小事同样属于这一层职责：
 * 1. **打开时把焦点搬进来**。不搬的话，焦点留在触发按钮上，第一次 Tab
 *    就从背景开始走（正是上面测到的现象）。
 * 2. **关闭时把焦点还回去**。测到的是关闭偏好面板后焦点落在侧边栏的
 *    「连接设备」上 —— 用户想接着调偏好，得从头 Tab 一遍。
 *
 * 实现上刻意不引第三方库：这里只有「算下一个该聚焦谁」一件纯逻辑，
 * 加一个依赖不划算，而把纯逻辑抽成函数后它还能进无浏览器的单测。
 */

import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';

/** 参与 Tab 循环的元素。禁用态与 `tabindex="-1"` 一律排除 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * 算下一个该聚焦的下标。
 *
 * 纯函数，所以「首尾循环」这件事能被单测直接验，不必起浏览器。
 *
 * @param current 当前焦点在候选列表里的下标；不在列表内时传负数
 * @param length  候选元素个数
 * @param shift   是否按住了 Shift（反向）
 * @returns 目标下标；没有可聚焦元素时返回 -1
 */
export function tabDestination(current: number, length: number, shift: boolean): number {
  if (length <= 0) return -1;
  if (current < 0) return shift ? length - 1 : 0;
  const next = current + (shift ? -1 : 1);
  // 取模两次：负数也能落回 [0, length)，不依赖 Math.abs
  return ((next % length) + length) % length;
}

/** 取容器内真正可见且可聚焦的元素 */
function focusablesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    // `getClientRects()` 为空说明它没被布局（display:none、或在折叠的分支里）。
    // 用 `offsetParent` 判会把 fixed 定位的合法元素也排除掉。
    (element) => element.getClientRects().length > 0,
  );
}

export interface FocusTrapOptions {
  /**
   * 挂载时是否把焦点搬进容器。默认 true。
   *
   * 弹层自己已经决定好初始焦点时传 false —— 确认弹层默认落在输入框或
   * 「取消」上，它比「第一个可聚焦元素」更有判断力，不该被这里覆盖。
   */
  autoFocus?: boolean;
  /**
   * 容器当前是否真的挂在页面上。默认 true。
   *
   * 有些弹层组件常驻挂载、内部按信号决定 `return null`（确认弹层就是这样），
   * 于是首次渲染时容器还不存在。若 effect 只依赖 ref，它会在 `ref.current`
   * 为 null 时早早返回，之后容器出现也不会再跑一次 —— 焦点陷阱等于没装。
   * 把「是否显示」也做成依赖，容器一出现就重新装。
   */
  active?: boolean;
}

/**
 * 把焦点锁在容器内。
 *
 * @param ref 容器（弹层卡片本身，不是遮罩 —— 遮罩上没有可聚焦元素）
 */
export function useFocusTrap<T extends HTMLElement>(
  ref: RefObject<T>,
  { autoFocus = true, active = true }: FocusTrapOptions = {},
): void {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    // 记录打开前的焦点，关闭时还回去。可能为空（比如用鼠标点开的）
    const previous = document.activeElement as HTMLElement | null;

    if (autoFocus) {
      const first = focusablesIn(root)[0];
      first?.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusablesIn(root);
      const destination = tabDestination(
        items.indexOf(document.activeElement as HTMLElement),
        items.length,
        event.shiftKey,
      );
      // 一律接管：交给浏览器的话，首尾两端会跳到容器外
      event.preventDefault();
      if (destination >= 0) items[destination]?.focus();
    };

    /*
     * 兜底：焦点被别的方式挪出去（脚本 focus、读屏软件的虚拟光标、
     * 点击遮罩之外的区域）时拉回来。只监听 `focusin` 而不监听 `focus`
     * 是因为前者会冒泡，一个监听器就够。
     */
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (target && root.contains(target)) return;
      focusablesIn(root)[0]?.focus();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      // 还焦点前先确认它还挂在文档里：触发按钮所在的区域可能已经换了
      if (previous && previous.isConnected) previous.focus();
    };
  }, [ref, autoFocus, active]);
}

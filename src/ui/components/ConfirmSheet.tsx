/**
 * 确认弹层：`askConfirm()` 的渲染端。
 *
 * 单例挂在外壳里，全站共用一份 —— 各视图不再自己画确认框，
 * 也就不会出现「这里要打确认词、那里点一下就走」的分裂。
 *
 * 三条行为约定：
 * 1. **带 `word` 时必须手打**，空输入与错词都让确认按钮保持禁用。
 * 2. **Esc 与点遮罩都算取消**，与偏好面板、连接步骤弹层同一套习惯。
 * 3. **默认焦点落在输入框（要打词时）或取消按钮（不要词时）**。默认聚焦
 *    「确认」是最常见的误操作来源 —— 一路回车就把应用卸了。
 */

import { type FunctionComponent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { confirmRequest, settleConfirm } from '@/ui/state/confirm';
import { useSignal } from '@/ui/state/signal';
import { useFocusTrap } from '@/ui/hooks/use-focus-trap';

export const ConfirmSheet: FunctionComponent = () => {
  const request = useSignal(confirmRequest);
  const [word, setWord] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  /*
   * Tab 必须被关在弹层里。
   *
   * 实测：没有这一层时，弹层打开后第一次 Tab 落在「取消」上，
   * **第二次就跑到背景的侧边栏导航**。背景此刻是被遮住的另一个界面，
   * 键盘用户会在那里迷路 —— 而这一层存在的理由正是「让人看清自己在确认什么」。
   *
   * `autoFocus: false`：下面的 effect 已经决定好初始焦点（有确认词落输入框，
   * 否则落「取消」），那比「第一个可聚焦元素」更有判断力，不该被覆盖。
   *
   * `active` 必须跟着请求走：本组件常驻挂载、没有请求时 `return null`，
   * 首次渲染时容器还不存在。只依赖 ref 的话 effect 会在 `ref.current === null`
   * 时提前返回，之后弹层出现也不会再装一次 —— 看着有 hook，实际没生效。
   */
  useFocusTrap(sheetRef, { autoFocus: false, active: request !== null });

  // 换了一条请求就把上一轮的输入清掉，否则「确认」二字会带进下一次
  useEffect(() => {
    setWord('');
  }, [request]);

  useEffect(() => {
    if (!request) return;
    if (request.word) inputRef.current?.focus();
    else cancelRef.current?.focus();
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') settleConfirm(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [request]);

  if (!request) return null;

  const wordOk = !request.word || word.trim() === request.word;

  return (
    <div
      class="confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={request.title}
      onClick={(event) => {
        if (event.target === event.currentTarget) settleConfirm(false);
      }}
    >
      <div class="confirm-sheet" ref={sheetRef}>
        {/*
          * 正文单独一层且可滚动，动作区留在外面。
          *
          * 理由：卡片整体可滚（T-020 之前的修法）能救回被裁的标题，
          * 但「取消 / 卸载」两个键会被推到屏幕外，用户得先滚一下才找得到 ——
          * 一个必须先滚动才能拒绝的对话框，在误触场景里等于逼人确认。
          * 所以限高落在正文上，标题与两个按钮永远留在视口内。
          */}
        <div class="confirm-sheet__body">
          <h2 class="confirm-sheet__title">{request.title}</h2>
          <p class="confirm-sheet__reason">{request.reason}</p>
          {request.detail && <p class="confirm-sheet__detail">{request.detail}</p>}
        </div>

        {request.word && (
          <div class="field">
            <label class="field__label" for="confirm-word">
              请输入「{request.word}」以继续
            </label>
            <input
              id="confirm-word"
              ref={inputRef}
              class="input input--mono"
              value={word}
              placeholder={request.word}
              autocomplete="off"
              onInput={(event) => setWord((event.target as HTMLInputElement).value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && wordOk) settleConfirm(true);
              }}
            />
          </div>
        )}

        <div class="confirm-sheet__actions">
          <button
            type="button"
            ref={cancelRef}
            class="btn btn--secondary"
            onClick={() => settleConfirm(false)}
          >
            取消
          </button>
          <button
            type="button"
            class="btn btn--danger"
            disabled={!wordOk}
            onClick={() => settleConfirm(true)}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

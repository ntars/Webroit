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

export const ConfirmSheet: FunctionComponent = () => {
  const request = useSignal(confirmRequest);
  const [word, setWord] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

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
      <div class="confirm-sheet">
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

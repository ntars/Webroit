/**
 * 工具卡片：一个工具的自助式执行单元。
 *
 * 它负责把 ParamSchema 渲染成表单、处理风险确认、调 run()、展示结果。
 * 高风险工具会要求输入确认词 —— 不是走形式的「确定吗」，
 * 而是要求手打指定文字，避免误点。
 *
 * 未连接时的行为（v0.1 起）：
 * 卡片照常展开、参数照常填写、风险标签照常显示 —— 用户可以先看清
 * 这个工具做什么再决定是否插线。只有「执行」这一步被拦下，
 * 拦住的位置就地给出连接入口，而不是把整屏换成连接引导。
 */

import { type FunctionComponent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import type { Tool, ToolResult } from '@/tools/registry';
import { RISK_LABEL } from '@/tools/registry';
import { capabilitiesFor } from '@/core/preview';
import { audited } from '@/core/audit';
import { preferences, services, toast } from '@/ui/state/app-state';
import { useSignal } from '@/ui/state/signal';
import { useConnect } from '@/ui/hooks/use-connect';
import { ResultView } from '@/ui/components/ResultView';

interface Props {
  tool: Tool;
  expanded: boolean;
  onToggle: () => void;
}

/** 危险操作要求的确认词 */
const DANGER_WORD = '确认';

export const ToolCard: FunctionComponent<Props> = ({ tool, expanded, onToggle }) => {
  const current = useSignal(services);
  const prefs = useSignal(preferences);
  const { connect, busy: connecting, message: connectMessage, supported } = useConnect();
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const param of tool.params) {
      if (param.defaultValue !== undefined) initial[param.key] = param.defaultValue;
    }
    return initial;
  });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmWord, setConfirmWord] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  // 切换展开时清掉上一轮结果，避免串味
  useEffect(() => {
    if (!expanded) {
      setResult(null);
      setError(null);
      setConfirmWord('');
    }
  }, [expanded]);

  /*
   * 未连接也照常渲染 —— 可用性判断用预览画像，卡片不会因为没连接而消失或置灰。
   * 真正的拦截发生在 execute()：拿不到 services 就转去连接，而不是静默返回。
   */
  const connected = current !== null;
  const view = capabilitiesFor(current?.capabilities ?? null);
  const availability = tool.available(view);
  const unsupported = availability !== true;
  const reason = typeof availability === 'string' ? availability : null;

  /**
   * 确认门槛。
   *
   * `confirmDangerous` 关掉后，风险 2 级（需确认）直接放行 ——
   * 用户明确表示「我知道自己在做什么，别每次都问」。
   * 但风险 3 级（高危）不受该开关影响，仍然要求手打确认词：
   * 卸载应用、清数据、进 EDL 这类操作没有撤销路径，
   * 一次误点就要重刷机，这个门槛不能由偏好开关决定。
   */
  const needsConfirm = tool.risk >= 2 && (prefs.confirmDangerous || tool.risk >= 3);
  const needsWord = tool.risk >= 3;
  const confirmOk = !needsWord || confirmWord.trim() === DANGER_WORD;

  const execute = async () => {
    if (running || connecting) return;

    /*
     * 未连接时：先连，连上就直接接着执行用户刚才点的这一次。
     *
     * 这里必须从 services.value 重新读，不能用组件闭包里的 current ——
     * 闭包里的 current 是本次渲染时的快照，connect() 成功之后它还是 null，
     * 拿它判断会让用户「明明连上了却还要再点一次」。
     * 信号本身是最新值的唯一可靠来源。
     */
    let active = services.value;
    if (!active) {
      const connectedOk = await connect();
      if (!connectedOk) return;
      active = services.value;
      if (!active) return;
    }
    const ctx = active;

    setRunning(true);
    setError(null);
    setResult(null);

    const controller = new AbortController();
    abortRef.current = controller;

    const invoke = () =>
      tool.run({
        shell: ctx.shell,
        capabilities: ctx.capabilities,
        input: values,
        signal: controller.signal,
      });

    try {
      /*
       * 风险 2 级以上的操作写审计。
       *
       * 只记变更型操作是刻意的：只读查询（读分辨率、列应用）一次会话能跑几十遍，
       * 全记下来会把真正的危险操作淹在噪音里，反而失去追溯价值。
       */
      let outcome: ToolResult;
      if (tool.risk >= 2) {
        // 记下执行前的命令水位，事后按序号切出本次执行的命令
        const mark = ctx.shell.commandMark();
        outcome = await audited(
          {
            module: tool.module,
            action: tool.id,
            label: tool.title,
            serial: ctx.shell.driver?.serial,
            commands: () => ctx.shell.commandsSince(mark),
          },
          invoke,
        );
      } else {
        outcome = await invoke();
      }

      setResult(outcome);
      toast('success', outcome.summary);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      toast('error', message);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const setValue = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <article class="tool" data-expanded={expanded} data-disabled={unsupported} data-preview={!connected}>
      {/* 设备侧不支持时才锁住展开；未连接不影响展开，用户可以先看参数与风险 */}
      <button type="button" class="tool__head" onClick={onToggle} disabled={unsupported}>
        <div class="tool__head-main">
          <div class="tool__title-row">
            <h3 class="tool__title">{tool.title}</h3>
            <span class="risk" data-level={tool.risk}>
              {RISK_LABEL[tool.risk]}
            </span>
          </div>
          <p class="tool__desc">{reason ?? tool.description}</p>
        </div>
        <span class="tool__chevron" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
      </button>

      {expanded && !unsupported && (
        <div class="tool__body">
          {tool.params.length > 0 && (
            <div class="tool__form">
              {tool.params.map((param) => (
                <ParamField
                  key={param.key}
                  param={param}
                  value={values[param.key]}
                  onChange={(value) => setValue(param.key, value)}
                />
              ))}
            </div>
          )}

          {needsConfirm && (
            <div class="confirm">
              <div class="confirm__text">
                {needsWord
                  ? `这是高风险操作，执行后可能无法自动回退。请输入「${DANGER_WORD}」以继续。`
                  : '该操作会改变设备状态，请确认无误后执行。'}
              </div>
              {needsWord && (
                <input
                  class="input input--mono confirm__input"
                  value={confirmWord}
                  placeholder={`输入 ${DANGER_WORD}`}
                  onInput={(event) => setConfirmWord((event.target as HTMLInputElement).value)}
                />
              )}
            </div>
          )}

          <div class="tool__actions">
            <button
              type="button"
              class="btn btn--primary"
              disabled={running || connecting || (needsConfirm && !confirmOk) || (!connected && !supported)}
              onClick={() => void execute()}
            >
              {connecting ? (
                <>
                  <span class="spinner" />
                  {connectMessage || '连接中…'}
                </>
              ) : running ? (
                <>
                  <span class="spinner" />
                  执行中…
                </>
              ) : connected ? (
                '执行'
              ) : (
                '连接设备后执行'
              )}
            </button>
            {running && (
              <button
                type="button"
                class="btn btn--secondary"
                onClick={() => abortRef.current?.abort(new Error('用户已取消'))}
              >
                中止
              </button>
            )}
            {!connected && supported && !connecting && (
              <span class="tool__action-note">参数可以照常填写，连接后立即沿用</span>
            )}
          </div>

          {!connected && !supported && (
            <div class="notice notice--danger">
              <strong>当前浏览器不支持 WebUSB</strong>
              <p>请改用 Chrome 或 Edge 桌面版，并通过 https 或 localhost 打开本页面。</p>
            </div>
          )}

          {error && (
            <div class="notice notice--danger">
              <strong>执行失败</strong>
              <p>{error}</p>
            </div>
          )}

          {result && <ResultView result={result} />}
        </div>
      )}
    </article>
  );
};

/* ─────────────────────── 参数渲染 ─────────────────────── */

interface ParamFieldProps {
  param: Tool['params'][number];
  value: unknown;
  onChange: (value: unknown) => void;
}

const ParamField: FunctionComponent<ParamFieldProps> = ({ param, value, onChange }) => {
  const id = `param-${param.key}`;

  if (param.type === 'boolean') {
    return (
      <label class="checkbox">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange((event.target as HTMLInputElement).checked)}
        />
        <span class="checkbox__text">
          {param.label}
          {param.hint && <span class="field__hint"> — {param.hint}</span>}
        </span>
      </label>
    );
  }

  if (param.type === 'select') {
    return (
      <div class="field">
        <label class="field__label" for={id}>{param.label}</label>
        <select
          id={id}
          class="select"
          value={String(value ?? param.defaultValue ?? '')}
          onChange={(event) => onChange((event.target as HTMLSelectElement).value)}
        >
          {param.options?.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {param.hint && <span class="field__hint">{param.hint}</span>}
      </div>
    );
  }

  if (param.type === 'textarea') {
    return (
      <div class="field">
        <label class="field__label" for={id}>{param.label}</label>
        <textarea
          id={id}
          class="input input--mono"
          placeholder={param.placeholder}
          value={String(value ?? '')}
          onInput={(event) => onChange((event.target as HTMLTextAreaElement).value)}
        />
        {param.hint && <span class="field__hint">{param.hint}</span>}
      </div>
    );
  }

  if (param.type === 'file') {
    return (
      <div class="field">
        <label class="field__label" for={id}>{param.label}</label>
        <input
          id={id}
          type="file"
          class="input"
          multiple
          onChange={(event) => {
            const input = event.target as HTMLInputElement;
            const files = input.files ? [...input.files] : [];
            onChange(files.length > 1 ? files : files[0]);
          }}
        />
        {param.hint && <span class="field__hint">{param.hint}</span>}
      </div>
    );
  }

  if (param.type === 'number') {
    return (
      <div class="field">
        <label class="field__label" for={id}>{param.label}</label>
        <input
          id={id}
          type="number"
          class="input"
          min={param.min}
          max={param.max}
          step={param.step}
          placeholder={param.placeholder}
          value={value === undefined ? '' : String(value)}
          onInput={(event) => {
            const raw = (event.target as HTMLInputElement).value;
            onChange(raw === '' ? undefined : Number(raw));
          }}
        />
        {param.hint && <span class="field__hint">{param.hint}</span>}
      </div>
    );
  }

  return (
    <div class="field">
      <label class="field__label" for={id}>{param.label}</label>
      <input
        id={id}
        type="text"
        class="input"
        placeholder={param.placeholder}
        value={String(value ?? '')}
        onInput={(event) => onChange((event.target as HTMLInputElement).value)}
      />
      {param.hint && <span class="field__hint">{param.hint}</span>}
    </div>
  );
};

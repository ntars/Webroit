/**
 * ADB 终端视图：真正的交互式 shell 会话。
 *
 * 与底部的命令回显面板不同，这里是可以连续输入、带上下文的会话——
 * 环境变量、工作目录、管道都会保留。所以必须用伪终端（pty），
 * 而不是逐条 exec。
 *
 * 输入处理要点：
 * - 单独输入 `cd xxx` 不能走 pty（cd 只影响当前 shell 进程，
 *   pty 里执行完就退出，目录不会变）。这里的做法是识别 cd 并
 *   在本地维护一个虚拟工作目录，后续命令前置 `cd <dir> &&`。
 * - `clear` 在 pty 里发 Ctrl+L 无效（pty 不是真终端模拟器），
 *   直接清屏更符合预期。
 */

import { type FunctionComponent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { services } from '@/ui/state/app-state';
import { useSignal } from '@/ui/state/signal';
import { explainError } from '@/core/error-copy';
import { NeedsDevice } from '@/ui/components/NeedsDevice';

interface HistoryLine {
  id: number;
  kind: 'command' | 'output' | 'error' | 'info';
  text: string;
}

/**
 * 快捷命令。
 *
 * 常驻在终端顶栏而不是藏进帮助文本里 ——
 * 用户把 DPI 改坏、界面点不动时，这一条是最后的自救手段，
 * 它必须在任何会话里都一眼可见、一次点击就能执行。
 */
const QUICK_COMMANDS: { label: string; command: string; hint: string }[] = [
  {
    label: '还原显示',
    command: 'wm size reset; wm density reset',
    hint: '把分辨率与屏幕密度拉回物理值，界面错位时用',
  },
  {
    label: '当前显示',
    command: 'wm size; wm density',
    hint: '查看物理值与当前覆盖值',
  },
  {
    label: '字体复位',
    command: 'settings put system font_scale 1.0',
    hint: '字体被放大到无法操作时恢复默认',
  },
];

let seed = 0;

export const TerminalView: FunctionComponent = () => {
  const current = useSignal(services);
  const [lines, setLines] = useState<HistoryLine[]>([
    { id: ++seed, kind: 'info', text: '已进入 ADB shell 会话，输入 help 查看说明' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [cwd, setCwd] = useState('/sdcard');
  const bodyRef = useRef<HTMLDivElement>(null);

  // 新输出出现时滚到底
  useEffect(() => {
    const element = bodyRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines.length]);

  const append = (kind: HistoryLine['kind'], text: string) => {
    setLines((prev) => {
      const next = [...prev, { id: ++seed, kind, text }];
      // 上限 1000 行，防止长会话吃光内存
      return next.length > 1000 ? next.slice(next.length - 1000) : next;
    });
  };

  /** 执行一条命令（未经 trim 的原始输入） */
  const exec = async (raw: string) => {
    if (!current || busy || !raw) return;

    append('command', `${cwd} $ ${raw}`);

    // 本地命令优先处理
    if (raw === 'clear') {
      setLines([]);
      return;
    }
    if (raw === 'help') {
      append(
        'info',
        [
          '可用命令：',
          '  clear            清空当前输出',
          '  cd <目录>        切换工作目录（仅影响本会话）',
          '  pwd              显示当前工作目录',
          '  其他命令          直接交给设备的 sh 执行',
        ].join('\n'),
      );
      return;
    }
    if (raw === 'pwd') {
      append('output', cwd);
      return;
    }

    // cd 特殊处理：pty 里执行 cd 不会保留状态，需在本地维护
    const cdMatch = raw.match(/^cd\s+(.+)$/);
    if (cdMatch) {
      const target = cdMatch[1].trim();
      const resolved = target.startsWith('/')
        ? target
        : `${cwd.replace(/\/$/, '')}/${target}`;
      setBusy(true);
      try {
        // 验证目标目录存在，不存在则报错且不改变 cwd
        const check = await current.shell.text(`[ -d ${JSON.stringify(resolved)} ] && echo ok || echo no`, {
          log: false,
          allowFailure: true,
        });
        if (check.trim() === 'ok') {
          setCwd(resolved.replace(/\/+/g, '/'));
        } else {
          append('error', `目录不存在：${resolved}`);
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      // 每条命令都显式带上工作目录，保证相对路径行为符合直觉
      const command = cwd === '/' ? raw : `cd ${JSON.stringify(cwd)} 2>/dev/null; ${raw}`;
      const result = await current.shell.text(command, { log: false, allowFailure: true });
      if (result.trim()) append('output', result.trimEnd());
      else append('info', '（无输出）');
    } catch (caught) {
      /*
       * 终端里的报错要「就地可读」：用户盯着这个面板敲命令，
       * 弹到右上角的 toast 会让他视线离开输出。所以两行都写进会话记录：
       * 一行原文（他熟悉这个形式），一行是翻译后的原因与出口。
       */
      const explained = explainError(caught);
      append('error', explained.raw || explained.reason);
      append('info', `原因：${explained.reason} 下一步：${explained.next}`);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    const raw = input.trim();
    if (!raw) return;
    setInput('');
    setHistory((prev) => [...prev, raw]);
    setHistoryIndex(-1);
    await exec(raw);
  };

  /** 上下键翻历史命令 */
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void run();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (history.length === 0) return;
      const next = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setInput(history[next]);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (historyIndex < 0) return;
      const next = historyIndex + 1;
      if (next >= history.length) {
        setHistoryIndex(-1);
        setInput('');
      } else {
        setHistoryIndex(next);
        setInput(history[next]);
      }
    }
  };

  // 未连接：终端必须真机才能跑，直接给连接入口比给一个输入框更诚实
  if (!current) {
    return (
      <div class="terminal-view">
        <NeedsDevice reason="ADB 终端需要先连接设备才能执行命令" />
        <div class="empty">
          <div>连接后可以直接输入 shell 命令，工作目录与命令历史在本次会话内保留</div>
          <div style={{ fontSize: '12px' }}>上方三个快捷命令可随时把显示参数拉回物理值</div>
        </div>
      </div>
    );
  }

  return (
    <div class="terminal-view">
      <div class="terminal-view__bar">
        <span class="terminal-view__path" title="当前工作目录">{cwd}</span>
        <div class="terminal-view__quick">
          {QUICK_COMMANDS.map((item) => (
            <button
              key={item.label}
              type="button"
              class="btn btn--ghost btn--sm"
              title={item.hint}
              disabled={busy}
              onClick={() => void exec(item.command)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          class="btn btn--ghost btn--sm"
          onClick={() => setLines([])}
        >
          清空
        </button>
      </div>

      <div class="terminal-view__body" ref={bodyRef}>
        {lines.map((line) => (
          <div key={line.id} class={`tv-line tv-line--${line.kind}`}>
            {line.text}
          </div>
        ))}
        {busy && (
          <div class="tv-line tv-line--info">
            <span class="spinner" /> 执行中…
          </div>
        )}
      </div>

      <div class="terminal-view__input">
        <span class="terminal-view__prompt">$</span>
        <input
          class="terminal-view__field"
          value={input}
          placeholder="输入命令，回车执行；↑↓ 翻历史"
          disabled={busy}
          onInput={(event) => setInput((event.target as HTMLInputElement).value)}
          onKeyDown={(event) => onKeyDown(event as unknown as KeyboardEvent)}
        />
        <button
          type="button"
          class="btn btn--primary btn--sm"
          onClick={() => void run()}
          disabled={busy || !input.trim()}
        >
          执行
        </button>
      </div>
    </div>
  );
};

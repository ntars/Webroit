/**
 * 命令输出面板。
 *
 * 不用 xterm.js —— 这里展示的是「只读的命令回显」，
 * 不是真正的交互式终端。xterm 会带来 300KB 的包体和一套
 * 完整的伪终端语义，而这里连光标都不需要。
 * 真正需要交互时走 ADB 终端分区，那里另开完整终端。
 *
 * 渲染策略：按频道着色、等宽字体、保留空白。
 * 命令回显前缀 $ 便于与结果区分。
 */

import { type FunctionComponent } from 'preact';

import type { TerminalLine } from '@/ui/state/app-state';

interface Props {
  lines: TerminalLine[];
  fontSize: number;
  /** 是否显示命令回显。关掉后只剩结果，界面更清爽 */
  showCommandEcho: boolean;
}

/** 频道对应的颜色类 */
const CHANNEL_CLASS: Record<string, string> = {
  command: 'term-line--command',
  result: 'term-line--result',
  stderr: 'term-line--stderr',
  info: 'term-line--info',
};

export const Terminal: FunctionComponent<Props> = ({ lines, fontSize, showCommandEcho }) => {
  // 关掉回显时过滤掉 command 频道 —— 但 info 要保留，
  // 因为「已连接」「正在探测」这类提示不属于命令，是有用信息
  const visible = showCommandEcho
    ? lines
    : lines.filter((line) => line.channel !== 'command');

  if (visible.length === 0) {
    return (
      <div class="term-empty">
        连接设备后，这里会显示每一条实际执行的命令与返回结果
      </div>
    );
  }

  return (
    <div class="term" style={{ fontSize: `${fontSize}px` }}>
      {visible.map((line) => (
        <div key={line.id} class={`term-line ${CHANNEL_CLASS[line.channel] ?? ''}`}>
          {line.text}
        </div>
      ))}
    </div>
  );
};

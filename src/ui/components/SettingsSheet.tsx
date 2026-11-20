/**
 * 偏好设置面板。
 *
 * 六项偏好分布在三处消费（终端字号与回显 → `Terminal`、二次确认 → `ToolCard`、
 * 低电量阈值 → `DeviceOverview`、侧边栏收起 → 外壳栅格），但此前界面上
 * 一个入口都没有 —— `storage.ts` 里的字段齐全、`sanitize()` 校验齐全，
 * 用户却只能开开发者工具改 localStorage。
 *
 * 两条设计取舍：
 * 1. **改即生效，不设「保存」按钮**。每一项都能立刻在界面上看到结果
 *    （字号、主题、侧边栏宽度），多一步确认只会让人怀疑到底存没存。
 *    落盘由 `updatePreferences` 一次完成。
 * 2. **`lastModule` 不在面板里**。它是导航的副产物，让用户手改「上次停在
 *    哪个分区」既没有意义，也会和实际导航状态打架。
 */

import { type FunctionComponent, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { type ThemeMode, DEFAULT_PREFERENCES } from '@/core/storage';
import { preferences, resetAllPreferences, updatePreferences } from '@/ui/state/app-state';
import { useSignal } from '@/ui/state/signal';
import { useFocusTrap } from '@/ui/hooks/use-focus-trap';

/** 主题三档的文案 */
const THEMES: [ThemeMode, string][] = [
  ['auto', '跟随系统'],
  ['light', '浅色'],
  ['dark', '深色'],
];

/** 字号上下限，与 storage.ts 的 sanitize 保持一致 */
const FONT_MIN = 10;
const FONT_MAX = 24;

/** 一行设置：左侧标题 + 说明，右侧控件 */
const Row: FunctionComponent<{
  label: string;
  hint?: string;
  children: ComponentChildren;
}> = ({ label, hint, children }) => (
  <div class="setting">
    <div class="setting__text">
      <span class="setting__label">{label}</span>
      {hint && <span class="setting__hint">{hint}</span>}
    </div>
    <div class="setting__control">{children}</div>
  </div>
);

/** 开关：用 button + role=switch，键盘与读屏都能操作 */
const Toggle: FunctionComponent<{
  on: boolean;
  label: string;
  onChange: (next: boolean) => void;
}> = ({ on, label, onChange }) => (
  <button
    type="button"
    class="switch"
    role="switch"
    aria-checked={on}
    aria-label={label}
    data-on={on}
    onClick={() => onChange(!on)}
  />
);

/**
 * 数值输入。
 *
 * 数字输入的坑在于「什么时候算用户输完了」。这里踩过两版：
 *
 * 第一版每次输入都落盘，而 `storage.ts` 的 `sanitize()` 会把越界值打回默认 ——
 * 想从 13 改成 20，敲下「2」的瞬间被判越界、改回 13，输入框自己跳字。
 *
 * 第二版改成「越界就钳到边界」，看着优雅，实际更糟：清空重打时第一个「1」
 * 会被钳成 10，接着打「5」变成 105 再被钳成 24，用户永远打不出 15。
 *
 * 所以规则按「是否为一个合法终值」判定，而不是按「数字是否越界」：
 * - 空串 / 非法：只留草稿，不落盘（清空重打是正常操作）
 * - 合法且范围内：立刻落盘，界面同步变化
 * - 越界：**不落盘**，让用户继续打字；失焦时才钳到边界并回显
 *
 * 这样「输入框里显示的数」与「真正保存的数」在失焦后必然一致，
 * 而输入过程中不会被程序改写。
 */
const NumberField: FunctionComponent<{
  value: number;
  min: number;
  max: number;
  unit: string;
  label: string;
  onCommit: (next: number) => void;
}> = ({ value, min, max, unit, label, onCommit }) => {
  const [draft, setDraft] = useState(String(value));

  // 外部重置（恢复默认）时要跟上，否则输入框还停在旧值
  useEffect(() => setDraft(String(value)), [value]);

  /** 失焦时收尾：越界钳到边界，非法回显真值 */
  const settle = () => {
    const n = Number(draft);
    if (draft === '' || !Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, Math.round(n)));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <div class="setting__stepper">
      <input
        class="input setting__number"
        type="number"
        min={min}
        max={max}
        step={1}
        value={draft}
        aria-label={label}
        onInput={(event) => {
          const raw = (event.target as HTMLInputElement).value;
          setDraft(raw);
          const n = Number(raw);
          if (Number.isInteger(n) && n >= min && n <= max) onCommit(n);
        }}
        onBlur={settle}
      />
      <span class="setting__unit">{unit}</span>
    </div>
  );
};

export const SettingsSheet: FunctionComponent<{ onClose: () => void }> = ({ onClose }) => {
  const prefs = useSignal(preferences);
  const sheetRef = useRef<HTMLDivElement>(null);

  /*
   * 焦点必须被关在面板里。
   *
   * 实测（`scripts/probe-focus.mjs`）：没有这一层时，面板打开后第一次 Tab
   * 就落在背景的顶栏按钮上，走完面板内 10 个控件后又一路沿侧边栏跑。
   * 面板写了 `aria-modal="true"`，行为上却不是模态 —— 键盘用户等于在
   * 和一个被遮住的界面交互。关闭时也要把焦点还回齿轮按钮，
   * 否则想接着调偏好得从页面开头 Tab 一遍。
   */
  useFocusTrap(sheetRef);

  // Esc 关闭：与连接步骤弹层、窄屏抽屉保持同一套习惯
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      class="settings-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="偏好设置"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div class="settings-sheet" ref={sheetRef}>
        <header class="settings-head">
          <h2 class="settings-head__title">偏好设置</h2>
          <button type="button" class="btn btn--ghost btn--sm" onClick={onClose} aria-label="关闭设置">
            关闭
          </button>
        </header>

        <div class="settings-body">
          <Row label="主题" hint="跟随系统时会随系统的深浅色实时切换">
            <div class="segmented">
              {THEMES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  class="segmented__item"
                  data-active={prefs.theme === value}
                  onClick={() => updatePreferences({ theme: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </Row>

          <Row
            label="终端字号"
            hint={`${FONT_MIN}–${FONT_MAX} px，越界值会回落到默认 ${DEFAULT_PREFERENCES.terminalFontSize} px`}
          >
            <NumberField
              value={prefs.terminalFontSize}
              min={FONT_MIN}
              max={FONT_MAX}
              unit="px"
              label="终端字号"
              onCommit={(next) => updatePreferences({ terminalFontSize: next })}
            />
          </Row>

          <Row label="显示命令回显" hint="关闭后终端只显示结果，适合只想看输出的场景">
            <Toggle
              on={prefs.showCommandEcho}
              label="显示命令回显"
              onChange={(next) => updatePreferences({ showCommandEcho: next })}
            />
          </Row>

          <Row
            label="高危操作二次确认"
            hint="关闭后风险 2 级不再弹确认；风险 3 级（卸载、清数据）不受此开关影响"
          >
            <Toggle
              on={prefs.confirmDangerous}
              label="高危操作二次确认"
              onChange={(next) => updatePreferences({ confirmDangerous: next })}
            />
          </Row>

          <Row label="低电量告警阈值" hint="低于该值且未充电时，设备总览会提示">
            <NumberField
              value={prefs.batteryWarning}
              min={1}
              max={100}
              unit="%"
              label="低电量告警阈值"
              onCommit={(next) => updatePreferences({ batteryWarning: next })}
            />
          </Row>

          <Row label="收起侧边栏" hint="桌面端只留图标，主区域让出 172 px 宽度">
            <Toggle
              on={prefs.sidebarCollapsed}
              label="收起侧边栏"
              onChange={(next) => updatePreferences({ sidebarCollapsed: next })}
            />
          </Row>
        </div>

        <footer class="settings-foot">
          <span class="settings-foot__note">
            偏好存在本机浏览器，刷新不丢；重置只清偏好，不动设备上的快照与审计记录。
          </span>
          <button type="button" class="btn btn--ghost btn--sm" onClick={resetAllPreferences}>
            恢复默认
          </button>
        </footer>
      </div>
    </div>
  );
};

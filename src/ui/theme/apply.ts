/**
 * 主题落到 DOM 的唯一入口。
 *
 * 为什么单独一个文件：主题有三条来源 —— 首屏启动、用户在设置面板里改、
 * 系统深浅色变化。三条路都要写 `data-theme`，如果各写一遍，
 * 总有一条会忘。上一版正是如此：顶栏的主题按钮只更新了偏好、没有写属性，
 * 于是用户点一下界面纹丝不动，点两下再刷新才变色。
 *
 * 这里用模块级的 `current` 记住「用户选的模式」，系统变化时先看它 ——
 * 用户从「跟随系统」切到「深色」之后，系统再变色就不该把界面抢回去。
 */

import { type ThemeMode, resolveTheme } from '@/core/storage';

/** 用户当前选择的主题模式；系统主题变化时据此判断要不要跟随 */
let current: ThemeMode = 'auto';

/** 把主题写到根元素 */
export function applyTheme(mode: ThemeMode): void {
  current = mode;
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = resolveTheme(mode);
}

/**
 * 监听系统深浅色变化。
 *
 * 只注册一次，且只在用户选的是「跟随系统」时才改动界面 ——
 * 显式选了深色的用户不该被系统设置劫持。
 */
export function watchSystemTheme(): void {
  if (typeof matchMedia === 'undefined') return;
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (current !== 'auto') return;
    document.documentElement.dataset.theme = resolveTheme('auto');
  });
}

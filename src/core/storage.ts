/**
 * 偏好设置持久化。
 *
 * 用 localStorage 而非 IndexedDB：设置项都是几十字节的小对象，
 * 需要在首屏渲染前同步读到（否则会闪一下默认主题再切成用户主题）。
 * IndexedDB 是异步的，做不到。
 *
 * 审计日志那种持续增长的列表才用 IndexedDB，见 core/audit.ts。
 */

/** 主题 */
export type ThemeMode = 'dark' | 'light' | 'auto';

/** 设置项 */
export interface Preferences {
  theme: ThemeMode;
  /** 终端字号 px */
  terminalFontSize: number;
  /** 是否显示命令日志（关掉后终端只显示结果，界面更清爽） */
  showCommandEcho: boolean;
  /** 高危操作是否要求输入确认词（默认开启，关掉等于降低安全等级） */
  confirmDangerous: boolean;
  /** 上次使用的分区 */
  lastModule: string;
  /** 侧边栏是否收起 */
  sidebarCollapsed: boolean;
  /** 低电量阈值告警 */
  batteryWarning: number;
}

const STORAGE_KEY = 'webroit:preferences';

/** 默认设置 */
export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'auto',
  terminalFontSize: 13,
  showCommandEcho: true,
  confirmDangerous: true,
  lastModule: 'device',
  sidebarCollapsed: false,
  batteryWarning: 20,
};

/** 校验并合并：任何非法字段都退回默认值，不让脏数据把 UI 弄崩 */
function sanitize(raw: unknown): Preferences {
  const input = (raw ?? {}) as Partial<Preferences>;
  const theme: ThemeMode =
    input.theme === 'dark' || input.theme === 'light' || input.theme === 'auto'
      ? input.theme
      : DEFAULT_PREFERENCES.theme;

  const fontSize = Number(input.terminalFontSize);

  return {
    theme,
    terminalFontSize:
      Number.isFinite(fontSize) && fontSize >= 10 && fontSize <= 24
        ? Math.round(fontSize)
        : DEFAULT_PREFERENCES.terminalFontSize,
    showCommandEcho:
      typeof input.showCommandEcho === 'boolean'
        ? input.showCommandEcho
        : DEFAULT_PREFERENCES.showCommandEcho,
    confirmDangerous:
      typeof input.confirmDangerous === 'boolean'
        ? input.confirmDangerous
        : DEFAULT_PREFERENCES.confirmDangerous,
    lastModule:
      typeof input.lastModule === 'string' && input.lastModule
        ? input.lastModule
        : DEFAULT_PREFERENCES.lastModule,
    sidebarCollapsed:
      typeof input.sidebarCollapsed === 'boolean'
        ? input.sidebarCollapsed
        : DEFAULT_PREFERENCES.sidebarCollapsed,
    batteryWarning:
      Number.isFinite(Number(input.batteryWarning)) &&
      Number(input.batteryWarning) >= 1 &&
      Number(input.batteryWarning) <= 100
        ? Math.round(Number(input.batteryWarning))
        : DEFAULT_PREFERENCES.batteryWarning,
  };
}

/** 读取设置 */
export function loadPreferences(): Preferences {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_PREFERENCES };
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return { ...DEFAULT_PREFERENCES };
    return sanitize(JSON.parse(text));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/** 写入设置；返回写入后的完整设置 */
export function savePreferences(patch: Partial<Preferences>): Preferences {
  const next = sanitize({ ...loadPreferences(), ...patch });
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 存储满或被禁用时静默失败，内存里的设置仍然生效
    }
  }
  return next;
}

/** 重置为默认 */
export function resetPreferences(): Preferences {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 忽略
    }
  }
  return { ...DEFAULT_PREFERENCES };
}

/**
 * 解析实际生效的主题。
 * auto 时跟随系统 prefers-color-scheme。
 */
export function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode !== 'auto') return mode;
  if (typeof matchMedia === 'undefined') return 'dark';
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * 对比度计算的唯一真源。
 *
 * 两个脚本要用同一套数学与同一份「要测哪些色对」的清单：
 * - `verify-theme.mjs` 起无头 Chrome，量真实计算样式里的颜色
 * - `verify-docs.mjs` 直接解析 tokens.css，校验 README 里写的数字
 *
 * 如果各自维护一份，就会出现「脚本说 80 对、README 说 80 对、
 * 但改了一边另一边不知道」的漂移。所以清单和公式都放这里，
 * 改一处两边同时生效，README 里的对数也能被重算出来。
 */

/** 解析 #rgb / #rrggbb / #rrggbbaa / rgb() / rgba() */
export const parseRGB = (s) => {
  if (typeof s !== 'string') return null;
  const v = s.trim();

  if (v.startsWith('#')) {
    const hex = v.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }

  const m = v.match(/(\d+(?:\.\d+)?)/g);
  if (!m) return null;
  return { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] };
};

/** 色度：RGB 最大值与最小值之差。0 表示纯中性灰 */
export const chroma = ({ r, g, b }) => Math.max(r, g, b) - Math.min(r, g, b);

/** 相对亮度（WCAG 2.x 定义） */
export const luminance = ({ r, g, b }) => {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

export const contrast = (a, b) => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};

/** 半透明前景压到背景上，换算成实际可见色再算对比度 */
export const blend = (fg, bg) =>
  fg.a >= 1
    ? fg
    : {
        r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
        g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
        b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
        a: 1,
      };

/**
 * 要校验的色对清单。前景与背景各自枚举，组合成矩阵 ——
 * 早期只写死 4 对，漏掉了三级文字、语义色、终端与控件描边，
 * 盲区里正好藏着真实缺陷。枚举化之后，新增 token 只要进清单就自动覆盖。
 */
export const MATRIX = {
  /** 页面可能出现的所有底色，从最暗到最亮 */
  bgs: ['--bg-base', '--bg-sunken', '--bg-surface', '--bg-raised', '--bg-overlay'],
  /** 文字层级：正文级，门槛 4.5:1 */
  textFgs: ['--text-primary', '--text-secondary', '--text-tertiary'],
  /** 语义色也是文字（状态标签、错误提示），同样按正文门槛 */
  semanticFgs: ['--success', '--warning', '--danger'],
  /** 终端面板是独立底色，前景只在自己的底上校验 */
  terminalFgs: [
    '--terminal-text',
    '--terminal-command',
    '--terminal-success',
    '--terminal-stderr',
    '--terminal-info',
  ],
  /** 非文字：可交互控件的边界与开关，WCAG 1.4.11 门槛 3:1 */
  uiPairs: [
    ['--border-control', '--bg-sunken', '表单控件边框在其填色上'],
    ['--border-control', '--bg-surface', '表单控件边框在卡片上'],
    ['--switch-knob', '--switch-track-off', '开关滑块在关闭态轨道上'],
  ],
  /** 每次校验的色对总数，供文档里的数字被重算 */
  get count() {
    return (
      2 * // 深色 + 浅色两套主题
      (this.textFgs.length * this.bgs.length +
        this.semanticFgs.length * this.bgs.length +
        this.terminalFgs.length +
        1 + // 强调色实底上的反色文字
        1 + // 白字在危险实底上
        this.uiPairs.length)
    );
  },
};

/** 主题里所有参与矩阵的 token 名，供 Chrome 侧一次性取全 */
export const ALL_VARS = [
  ...MATRIX.bgs,
  ...MATRIX.textFgs,
  ...MATRIX.semanticFgs,
  ...MATRIX.terminalFgs,
  '--accent',
  '--accent-contrast',
  '--danger-solid',
  '--switch-knob',
  '--switch-track-off',
  '--border-control',
  '--border-subtle',
  '--border-default',
  '--border-strong',
  '--terminal-bg',
  '--accent-text',
];

/**
 * 从 tokens.css 的文本里取出两套主题的变量。
 *
 * 只认 `:root, [data-theme='dark']` 与 `[data-theme='light']` 两个块，
 * 用最朴素的方式取 `--name: value;`，不引入 CSS 解析器 —— 这份文件
 * 由我们自己维护，格式稳定，装一个解析器只为这点事不划算。
 */
export function parseTokens(cssText) {
  // 先剥掉注释：本文件的注释就写在 token 上方，不剥离会把
  // 「/* ... */\n  --text-primary: ...」整段当成一行，导致该变量被跳过。
  const clean = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const grab = (selector) => {
    const idx = clean.indexOf(selector);
    if (idx < 0) return null;
    const start = clean.indexOf('{', idx);
    const end = clean.indexOf('}', start);
    if (start < 0 || end < 0) return null;
    const out = {};
    for (const line of clean.slice(start + 1, end).split(';')) {
      const t = line.trim();
      if (!t.startsWith('--')) continue;
      const c = t.indexOf(':');
      if (c < 0) continue;
      out[t.slice(0, c).trim()] = t.slice(c + 1).trim();
    }
    return out;
  };
  return {
    dark: grab(":root,\n[data-theme='dark']") || grab("[data-theme='dark']"),
    light: grab("[data-theme='light']"),
  };
}

/**
 * 按 MATRIX 算出全部色对的实际比值。
 * 返回 [{ theme, fgName, bgName, ratio, need }]，与 verify-theme 的顺序一致。
 */
export function computeMatrix(vars, theme) {
  const out = [];
  const ratioOn = (fgName, bgName) => {
    const fg = parseRGB(vars[fgName]);
    const bg = parseRGB(vars[bgName]);
    if (!fg || !bg) return null;
    return contrast(blend(fg, bg), bg);
  };

  for (const fgName of [...MATRIX.textFgs, ...MATRIX.semanticFgs]) {
    for (const bgName of MATRIX.bgs) {
      const ratio = ratioOn(fgName, bgName);
      out.push({ theme, fgName, bgName, ratio, need: 4.5 });
    }
  }
  for (const fgName of MATRIX.terminalFgs) {
    const ratio = ratioOn(fgName, '--terminal-bg');
    out.push({ theme, fgName, bgName: '--terminal-bg', ratio, need: 4.5 });
  }
  out.push({
    theme,
    fgName: '--accent-contrast',
    bgName: '--accent',
    ratio: ratioOn('--accent-contrast', '--accent'),
    need: 4.5,
  });
  {
    const solid = parseRGB(vars['--danger-solid']);
    out.push({
      theme,
      fgName: '#ffffff',
      bgName: '--danger-solid',
      ratio: solid ? contrast(parseRGB('#ffffff'), solid) : null,
      need: 4.5,
    });
  }
  for (const [fgName, bgName, label] of MATRIX.uiPairs) {
    out.push({ theme, fgName, bgName, label, ratio: ratioOn(fgName, bgName), need: 3 });
  }
  return out;
}

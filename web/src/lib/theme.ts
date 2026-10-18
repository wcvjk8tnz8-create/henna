/**
 * 运行时换肤：把主题色写进 :root 的 CSS 变量。
 *
 * 原理见 style.css —— Tailwind 的 --color-henna-* 指向 --brand-*，
 * 改 --brand-* 即可实时生效，不需要重新构建 CSS。
 */

export interface ThemeSpec {
  /** 主色 hex，如 #b4462f */
  primary: string;
  /** 点缀色 hex，如 #c97b3c */
  accent: string;
  /** 页面底色 hex，如 #faf6f1 */
  surface: string;
  /** 卡片圆角 px */
  radius: number;
}

export const DEFAULT_THEME: ThemeSpec = {
  primary: '#b4462f',
  accent: '#c97b3c',
  surface: '#faf6f1',
  radius: 14,
};

/** 预设主题。主色偏暖、无蓝紫，符合项目配色约束。 */
export const THEME_PRESETS: { key: string; name: string; spec: ThemeSpec }[] = [
  { key: 'henna', name: '暖赭（默认）', spec: { primary: '#b4462f', accent: '#c97b3c', surface: '#faf6f1', radius: 14 } },
  { key: 'clay', name: '陶土', spec: { primary: '#a2543a', accent: '#c08a4e', surface: '#f8f3ec', radius: 16 } },
  { key: 'ink', name: '墨黑', spec: { primary: '#33302e', accent: '#8a6f4b', surface: '#f5f4f2', radius: 8 } },
  { key: 'jade', name: '森绿', spec: { primary: '#2f6550', accent: '#7a9440', surface: '#f4f7f2', radius: 14 } },
  { key: 'wine', name: '酒红', spec: { primary: '#8c2f39', accent: '#b06a4a', surface: '#faf5f4', radius: 18 } },
  { key: 'amber', name: '琥珀', spec: { primary: '#9a6212', accent: '#c08a2e', surface: '#faf7ef', radius: 12 } },
];

/* ── 颜色工具 ───────────────────────────────────────────── */

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h.padEnd(6, '0').slice(0, 6);
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hh: number;
  if (max === r) hh = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) hh = ((b - r) / d + 2) / 6;
  else hh = ((r - g) / d + 4) / 6;
  return [hh * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 100) / 100;
  l = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) =>
    Math.round(clamp((v + m) * 255, 0, 255))
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** 相对亮度，用于判断该配白字还是深字 */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** 主色上应该用白字还是深色字 */
export function onPrimaryText(hex: string): string {
  return luminance(hex) > 0.45 ? '#1c1917' : '#ffffff';
}

/**
 * 由一个主色推导出 50~700 色阶。
 * 保留原色相与饱和度，只按明度梯度展开；
 * 主色本身若过亮/过暗，会把 500 档拉回可读区间，保证按钮对比度。
 */
export function buildScale(hex: string): Record<string, string> {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  // 500 档压到 20%~50%：太亮白字看不清，太暗则失去层次。
  // 注意不要再人为补饱和度 —— 否则黑色主色会被推成一串棕色。
  const l5 = clamp(l, 20, 50);
  const ss = clamp(s, 0, 92);
  const step: Record<string, number> = {
    '50': clamp(l5 + 45, 0, 97),
    '100': clamp(l5 + 40, 0, 95),
    '200': clamp(l5 + 31, 0, 90),
    '300': clamp(l5 + 21, 0, 82),
    '400': clamp(l5 + 10, 0, 70),
    '500': l5,
    '600': clamp(l5 - 9, 8, 100),
    '700': clamp(l5 - 18, 6, 100),
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(step)) {
    // 浅色档略微降饱和，避免荧光感
    const sAdj = v > 80 ? ss * 0.82 : v > 60 ? ss * 0.92 : ss;
    out[k] = hslToHex(h, sAdj, v);
  }
  return out;
}

/** 由底色推导 surface 的 50~300（都往更浅处展开，保证页面底色最浅） */
export function buildSurface(hex: string): Record<string, string> {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const l50 = clamp(l, 92, 98);
  const ss = clamp(s, 0, 40);
  return {
    '50': hslToHex(h, ss, l50),
    '100': hslToHex(h, ss, clamp(l50 - 4, 0, 100)),
    '200': hslToHex(h, ss, clamp(l50 - 9, 0, 100)),
    '300': hslToHex(h, ss * 1.1, clamp(l50 - 16, 0, 100)),
  };
}

/** 由点缀色推导 accent 的 400~600 */
export function buildAccent(hex: string): Record<string, string> {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const l5 = clamp(l, 38, 62);
  const ss = clamp(s, 0, 90);
  return {
    '400': hslToHex(h, ss, clamp(l5 + 9, 0, 100)),
    '500': hslToHex(h, ss, l5),
    '600': hslToHex(h, ss, clamp(l5 - 10, 6, 100)),
  };
}

/* ── 应用到 DOM ─────────────────────────────────────────── */

/** 把主题写进 :root；传 null 恢复默认 */
export function applyTheme(spec: ThemeSpec | null): void {
  const root = document.documentElement;
  const t = spec ?? DEFAULT_THEME;

  const brand = buildScale(t.primary);
  const accent = buildAccent(t.accent);
  const surface = buildSurface(t.surface);

  for (const [k, v] of Object.entries(brand)) root.style.setProperty(`--brand-${k}`, v);
  for (const [k, v] of Object.entries(accent)) root.style.setProperty(`--accent-${k}`, v);
  for (const [k, v] of Object.entries(surface)) root.style.setProperty(`--surface-${k}`, v);
  root.style.setProperty('--ui-radius', `${clamp(t.radius, 0, 28)}px`);

  // 主色上的文字颜色（按钮、标签页等）
  root.style.setProperty('--brand-on', onPrimaryText(brand['500']));

  // 同步浏览器 UI 色（移动端地址栏）
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = brand['500'];
}

/** 从设置字典里读取主题（缺省回落到默认值） */
export function themeFromSettings(st: Record<string, string> | undefined): ThemeSpec {
  const s = st ?? {};
  return {
    primary: /^#[0-9a-fA-F]{6}$/.test(s.theme_primary ?? '') ? s.theme_primary : DEFAULT_THEME.primary,
    accent: /^#[0-9a-fA-F]{6}$/.test(s.theme_accent ?? '') ? s.theme_accent : DEFAULT_THEME.accent,
    surface: /^#[0-9a-fA-F]{6}$/.test(s.theme_surface ?? '') ? s.theme_surface : DEFAULT_THEME.surface,
    radius: Number(s.theme_radius ?? DEFAULT_THEME.radius) || DEFAULT_THEME.radius,
  };
}

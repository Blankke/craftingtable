// 用法：主题是纯数据（设计变量）。CSS 直接使用 oklch 字符串；Konva 画布通过 colorToHex/colorToRgba 换算为 sRGB。
// 主题、元素样式、元素颜色是三个独立概念；本模块只负责主题 Token 与颜色换算。
import { z } from 'zod';

// ---- OKLCH 颜色数学（用于把 oklch 换算成画布可用的 sRGB，以及派生明暗/混合色）----
export interface Rgb { r: number; g: number; b: number } // 0..1

export function parseOklch(color: string): { l: number; c: number; h: number; alpha: number } | null {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?))?\s*\)$/i.exec(color.trim());
  if (!match) return null;
  const alpha = match[4] ? (match[4].endsWith('%') ? Number(match[4].slice(0, -1)) / 100 : Number(match[4])) : 1;
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]), alpha };
}
function clamp01(value: number): number { return Math.min(1, Math.max(0, value)); }

export function oklchToRgb(l: number, c: number, h: number): Rgb {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;
  const lc = l_ * l_ * l_;
  const mc = m_ * m_ * m_;
  const sc = s_ * s_ * s_;
  const r = 4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc;
  const g = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc;
  const bl = -0.0041960863 * lc - 0.7034186147 * mc + 1.7076147010 * sc;
  const gamma = (value: number) => (value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055);
  return { r: clamp01(gamma(r)), g: clamp01(gamma(g)), b: clamp01(gamma(bl)) };
}

const toHexChannel = (value: number) => Math.round(value * 255).toString(16).padStart(2, '0');

export function rgbToHex(rgb: Rgb): string {
  return `#${toHexChannel(rgb.r)}${toHexChannel(rgb.g)}${toHexChannel(rgb.b)}`;
}

/** 把任意颜色字符串（oklch / hex / rgb）换算为 #rrggbb，供 Konva 画布使用。 */
export function colorToHex(color: string): string {
  const trimmed = color.trim();
  if (trimmed.startsWith('#')) {
    if (trimmed.length === 4) return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
    return trimmed;
  }
  const oklch = parseOklch(trimmed);
  if (oklch) return rgbToHex(oklchToRgb(oklch.l, oklch.c, oklch.h));
  return trimmed;
}

/** 换算为 rgba() 字符串（0..1 透明度），供画布叠加用。 */
export function colorToRgba(color: string, alpha: number): string {
  const rgb = colorToHex(color);
  const r = parseInt(rgb.slice(1, 3), 16), g = parseInt(rgb.slice(3, 5), 16), b = parseInt(rgb.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha))})`;
}

/** 调整 OKLCH 亮度（deltaL 直接加在 L 上），返回 oklch 字符串。 */
export function adjustLightness(color: string, deltaL: number): string {
  const parsed = parseOklch(color);
  if (!parsed) return color;
  const alpha = parsed.alpha !== 1 ? ` / ${parsed.alpha}` : '';
  return `oklch(${clamp01(parsed.l + deltaL).toFixed(4)} ${parsed.c.toFixed(4)} ${parsed.h.toFixed(4)}${alpha})`;
}

/** 在 OKLab 空间混合两个 oklch 颜色（t: 0=全 a，1=全 b），返回 oklch 字符串。 */
export function mixOklch(a: string, b: string, t: number): string {
  const pa = parseOklch(a), pb = parseOklch(b);
  if (!pa || !pb) return a;
  const lerp = (x: number, y: number) => x + (y - x) * t;
  const l = lerp(pa.l, pb.l);
  const ca = pa.c * Math.cos((pa.h * Math.PI) / 180), sa = pa.c * Math.sin((pa.h * Math.PI) / 180);
  const cb = pb.c * Math.cos((pb.h * Math.PI) / 180), sb = pb.c * Math.sin((pb.h * Math.PI) / 180);
  const c1 = lerp(ca, cb), s1 = lerp(sa, sb);
  const c = Math.hypot(c1, s1);
  const h = ((Math.atan2(s1, c1) * 180) / Math.PI + 360) % 360;
  return `oklch(${l.toFixed(4)} ${c.toFixed(4)} ${h.toFixed(4)})`;
}

// ---- 主题 Schema（对齐 shadcn 命名，便于直接录入 21st.dev 参考 Token）----
export const colorTokensSchema = z.object({
  background: z.string(), foreground: z.string(), primary: z.string(), primaryForeground: z.string(),
  secondary: z.string(), accent: z.string(), muted: z.string(), mutedForeground: z.string(),
  card: z.string(), border: z.string(), ring: z.string(), destructive: z.string(),
  // 工作台补充 Token（shadcn 之外的应用级变量）
  surface: z.string(), surfaceAlt: z.string(), input: z.string(), selection: z.string(), hover: z.string(), grid: z.string()
});
export const modeTokensSchema = z.object({ tokens: colorTokensSchema, trackPalette: z.array(z.string()).min(1) });
export const themeSchema = z.object({
  id: z.string(), name: z.string(), radius: z.string(), fontFamily: z.string(), baseFontSize: z.number(),
  light: modeTokensSchema, dark: modeTokensSchema
});
export type Theme = z.infer<typeof themeSchema>;
export type ColorTokens = z.infer<typeof colorTokensSchema>;
export type ModeTokens = z.infer<typeof modeTokensSchema>;

type TokensInput = z.input<typeof colorTokensSchema>;

function mode(tokens: TokensInput, trackPalette: string[]): ModeTokens {
  return modeTokensSchema.parse({ tokens: colorTokensSchema.parse(tokens), trackPalette });
}

// ---- 内置主题 ----
// Indigo Mono：完整录入 21st.dev @serafimcloud/themes/indigo-mono 的 oklch Token（radius 0.5rem）。
const indigoMono: Theme = themeSchema.parse({
  id: 'indigo-mono', name: 'Indigo Mono', radius: '0.5rem', fontFamily: 'Microsoft YaHei', baseFontSize: 14,
  light: mode({
    background: 'oklch(0.9851 0 0)', foreground: 'oklch(0 0 0)',
    primary: 'oklch(0.5144 0.1605 267.44)', primaryForeground: 'oklch(0.97 0.014 254.604)',
    secondary: 'oklch(0.94 0 0)', accent: 'oklch(0.9214 0.0248 257.65)', muted: 'oklch(0.97 0 0)', mutedForeground: 'oklch(0.44 0 0)',
    card: 'oklch(1.00 0 267.51)', border: 'oklch(0.92 0 0)', ring: 'oklch(0.5144 0.1605 267.44)', destructive: 'oklch(0.58 0.22 27)',
    surface: 'oklch(1.00 0 267.51)', surfaceAlt: 'oklch(0.97 0 0)', input: 'oklch(1.00 0 0)',
    selection: 'oklch(0.88 0.04 257)', hover: 'oklch(0.94 0.02 257)', grid: 'oklch(0.94 0.008 257)'
  }, [
    'oklch(0.5144 0.1605 267.44)', 'oklch(0.60 0.17 290)', 'oklch(0.62 0.14 240)', 'oklch(0.48 0.18 300)',
    'oklch(0.56 0.09 267)', 'oklch(0.66 0.15 220)', 'oklch(0.44 0.14 250)', 'oklch(0.70 0.10 280)'
  ]),
  dark: mode({
    background: 'oklch(0 0 0)', foreground: 'oklch(1.00 0 0)',
    primary: 'oklch(0.5144 0.1605 267.44)', primaryForeground: 'oklch(0.97 0.014 254.604)',
    secondary: 'oklch(0.25 0 0)', accent: 'oklch(0.32 0 0)', muted: 'oklch(0.23 0 0)', mutedForeground: 'oklch(0.72 0 0)',
    card: 'oklch(0.2103 0 267.51)', border: 'oklch(0.26 0 0)', ring: 'oklch(0.5144 0.1605 267.44)', destructive: 'oklch(0.704 0.191 22.216)',
    surface: 'oklch(0.2103 0 267.51)', surfaceAlt: 'oklch(0.23 0 0)', input: 'oklch(0.23 0 0)',
    selection: 'oklch(0.32 0.06 267)', hover: 'oklch(0.30 0.04 267)', grid: 'oklch(0.18 0.01 267)'
  }, [
    'oklch(0.62 0.16 267)', 'oklch(0.68 0.15 290)', 'oklch(0.70 0.13 240)', 'oklch(0.60 0.16 300)',
    'oklch(0.66 0.08 267)', 'oklch(0.72 0.13 220)', 'oklch(0.58 0.13 250)', 'oklch(0.76 0.09 280)'
  ])
});

const modernMinimal: Theme = themeSchema.parse({
  id: 'modern-minimal', name: 'Modern Minimal', radius: '0.375rem', fontFamily: 'Segoe UI', baseFontSize: 14,
  light: mode({
    background: 'oklch(0.98 0 0)', foreground: 'oklch(0.2 0 0)', primary: 'oklch(0.55 0.16 250)', primaryForeground: 'oklch(0.98 0 0)',
    secondary: 'oklch(0.95 0 0)', accent: 'oklch(0.93 0.02 250)', muted: 'oklch(0.96 0 0)', mutedForeground: 'oklch(0.45 0 0)',
    card: 'oklch(1 0 0)', border: 'oklch(0.90 0 0)', ring: 'oklch(0.55 0.16 250)', destructive: 'oklch(0.58 0.22 27)',
    surface: 'oklch(1 0 0)', surfaceAlt: 'oklch(0.96 0 0)', input: 'oklch(1 0 0)', selection: 'oklch(0.90 0.03 250)', hover: 'oklch(0.95 0.02 250)', grid: 'oklch(0.93 0 0)'
  }, [
    'oklch(0.55 0.16 250)', 'oklch(0.55 0.16 210)', 'oklch(0.60 0.14 285)', 'oklch(0.50 0.15 180)',
    'oklch(0.58 0.12 30)', 'oklch(0.55 0.15 320)', 'oklch(0.50 0.12 90)', 'oklch(0.45 0.14 250)'
  ]),
  dark: mode({
    background: 'oklch(0.16 0 0)', foreground: 'oklch(0.95 0 0)', primary: 'oklch(0.62 0.15 250)', primaryForeground: 'oklch(0.12 0 0)',
    secondary: 'oklch(0.25 0 0)', accent: 'oklch(0.28 0.02 250)', muted: 'oklch(0.23 0 0)', mutedForeground: 'oklch(0.68 0 0)',
    card: 'oklch(0.20 0 0)', border: 'oklch(0.28 0 0)', ring: 'oklch(0.62 0.15 250)', destructive: 'oklch(0.70 0.19 22)',
    surface: 'oklch(0.20 0 0)', surfaceAlt: 'oklch(0.23 0 0)', input: 'oklch(0.23 0 0)', selection: 'oklch(0.30 0.05 250)', hover: 'oklch(0.28 0.03 250)', grid: 'oklch(0.22 0 0)'
  }, [
    'oklch(0.62 0.15 250)', 'oklch(0.62 0.15 210)', 'oklch(0.66 0.13 285)', 'oklch(0.58 0.14 180)',
    'oklch(0.64 0.12 30)', 'oklch(0.62 0.14 320)', 'oklch(0.58 0.11 90)', 'oklch(0.54 0.13 250)'
  ])
});

const softPastel: Theme = themeSchema.parse({
  id: 'soft-pastel', name: 'Soft Pastel', radius: '0.75rem', fontFamily: 'Microsoft YaHei', baseFontSize: 14,
  light: mode({
    background: 'oklch(0.975 0.01 20)', foreground: 'oklch(0.35 0.03 300)', primary: 'oklch(0.75 0.09 320)', primaryForeground: 'oklch(0.30 0.04 320)',
    secondary: 'oklch(0.95 0.02 80)', accent: 'oklch(0.92 0.05 250)', muted: 'oklch(0.96 0.015 60)', mutedForeground: 'oklch(0.55 0.03 300)',
    card: 'oklch(0.99 0.01 20)', border: 'oklch(0.92 0.02 300)', ring: 'oklch(0.75 0.09 320)', destructive: 'oklch(0.65 0.16 20)',
    surface: 'oklch(0.99 0.01 20)', surfaceAlt: 'oklch(0.96 0.015 60)', input: 'oklch(0.99 0.01 20)', selection: 'oklch(0.90 0.05 320)', hover: 'oklch(0.94 0.03 320)', grid: 'oklch(0.93 0.02 300)'
  }, [
    'oklch(0.75 0.09 320)', 'oklch(0.75 0.10 250)', 'oklch(0.78 0.10 180)', 'oklch(0.80 0.12 80)',
    'oklch(0.74 0.11 20)', 'oklch(0.76 0.09 290)', 'oklch(0.78 0.10 140)', 'oklch(0.73 0.09 40)'
  ]),
  dark: mode({
    background: 'oklch(0.22 0.02 300)', foreground: 'oklch(0.94 0.02 300)', primary: 'oklch(0.78 0.10 320)', primaryForeground: 'oklch(0.20 0.03 320)',
    secondary: 'oklch(0.30 0.02 300)', accent: 'oklch(0.32 0.04 250)', muted: 'oklch(0.28 0.02 300)', mutedForeground: 'oklch(0.75 0.02 300)',
    card: 'oklch(0.26 0.02 300)', border: 'oklch(0.32 0.02 300)', ring: 'oklch(0.78 0.10 320)', destructive: 'oklch(0.70 0.15 20)',
    surface: 'oklch(0.26 0.02 300)', surfaceAlt: 'oklch(0.28 0.02 300)', input: 'oklch(0.28 0.02 300)', selection: 'oklch(0.38 0.06 320)', hover: 'oklch(0.34 0.04 320)', grid: 'oklch(0.28 0.02 300)'
  }, [
    'oklch(0.78 0.10 320)', 'oklch(0.78 0.10 250)', 'oklch(0.80 0.09 180)', 'oklch(0.82 0.11 80)',
    'oklch(0.76 0.10 20)', 'oklch(0.79 0.09 290)', 'oklch(0.80 0.09 140)', 'oklch(0.76 0.09 40)'
  ])
});

const morandi: Theme = themeSchema.parse({
  id: 'morandi', name: 'Morandi', radius: '0.5rem', fontFamily: 'Georgia', baseFontSize: 14,
  light: mode({
    background: 'oklch(0.93 0.008 80)', foreground: 'oklch(0.35 0.02 80)', primary: 'oklch(0.55 0.03 130)', primaryForeground: 'oklch(0.97 0.01 80)',
    secondary: 'oklch(0.88 0.01 80)', accent: 'oklch(0.86 0.02 130)', muted: 'oklch(0.90 0.01 80)', mutedForeground: 'oklch(0.52 0.015 80)',
    card: 'oklch(0.95 0.01 80)', border: 'oklch(0.84 0.012 80)', ring: 'oklch(0.55 0.03 130)', destructive: 'oklch(0.55 0.10 30)',
    surface: 'oklch(0.95 0.01 80)', surfaceAlt: 'oklch(0.90 0.01 80)', input: 'oklch(0.95 0.01 80)', selection: 'oklch(0.83 0.025 130)', hover: 'oklch(0.88 0.02 130)', grid: 'oklch(0.87 0.012 80)'
  }, [
    'oklch(0.55 0.03 130)', 'oklch(0.56 0.03 200)', 'oklch(0.58 0.03 30)', 'oklch(0.54 0.035 300)',
    'oklch(0.55 0.025 90)', 'oklch(0.57 0.03 250)', 'oklch(0.52 0.03 170)', 'oklch(0.56 0.03 20)'
  ]),
  dark: mode({
    background: 'oklch(0.25 0.008 80)', foreground: 'oklch(0.90 0.015 80)', primary: 'oklch(0.62 0.03 130)', primaryForeground: 'oklch(0.20 0.01 80)',
    secondary: 'oklch(0.32 0.01 80)', accent: 'oklch(0.34 0.02 130)', muted: 'oklch(0.30 0.01 80)', mutedForeground: 'oklch(0.70 0.015 80)',
    card: 'oklch(0.28 0.01 80)', border: 'oklch(0.34 0.012 80)', ring: 'oklch(0.62 0.03 130)', destructive: 'oklch(0.65 0.10 30)',
    surface: 'oklch(0.28 0.01 80)', surfaceAlt: 'oklch(0.30 0.01 80)', input: 'oklch(0.30 0.01 80)', selection: 'oklch(0.38 0.025 130)', hover: 'oklch(0.36 0.02 130)', grid: 'oklch(0.30 0.012 80)'
  }, [
    'oklch(0.62 0.03 130)', 'oklch(0.63 0.03 200)', 'oklch(0.65 0.03 30)', 'oklch(0.61 0.035 300)',
    'oklch(0.62 0.025 90)', 'oklch(0.64 0.03 250)', 'oklch(0.59 0.03 170)', 'oklch(0.63 0.03 20)'
  ])
});

const vintagePaper: Theme = themeSchema.parse({
  id: 'vintage-paper', name: 'Vintage Paper', radius: '0.25rem', fontFamily: 'Georgia', baseFontSize: 15,
  light: mode({
    background: 'oklch(0.94 0.02 90)', foreground: 'oklch(0.32 0.03 60)', primary: 'oklch(0.50 0.06 45)', primaryForeground: 'oklch(0.96 0.02 90)',
    secondary: 'oklch(0.90 0.02 90)', accent: 'oklch(0.87 0.03 70)', muted: 'oklch(0.92 0.02 90)', mutedForeground: 'oklch(0.48 0.03 60)',
    card: 'oklch(0.95 0.02 90)', border: 'oklch(0.82 0.025 70)', ring: 'oklch(0.50 0.06 45)', destructive: 'oklch(0.52 0.12 25)',
    surface: 'oklch(0.95 0.02 90)', surfaceAlt: 'oklch(0.92 0.02 90)', input: 'oklch(0.96 0.02 90)', selection: 'oklch(0.85 0.04 70)', hover: 'oklch(0.90 0.03 80)', grid: 'oklch(0.86 0.02 80)'
  }, [
    'oklch(0.50 0.06 45)', 'oklch(0.48 0.06 20)', 'oklch(0.52 0.05 90)', 'oklch(0.49 0.06 140)',
    'oklch(0.51 0.06 200)', 'oklch(0.50 0.05 300)', 'oklch(0.48 0.06 250)', 'oklch(0.53 0.05 60)'
  ]),
  dark: mode({
    background: 'oklch(0.20 0.02 80)', foreground: 'oklch(0.90 0.02 90)', primary: 'oklch(0.62 0.06 45)', primaryForeground: 'oklch(0.20 0.02 90)',
    secondary: 'oklch(0.30 0.02 80)', accent: 'oklch(0.33 0.03 70)', muted: 'oklch(0.27 0.02 80)', mutedForeground: 'oklch(0.72 0.02 90)',
    card: 'oklch(0.24 0.02 80)', border: 'oklch(0.34 0.025 70)', ring: 'oklch(0.62 0.06 45)', destructive: 'oklch(0.65 0.12 25)',
    surface: 'oklch(0.24 0.02 80)', surfaceAlt: 'oklch(0.27 0.02 80)', input: 'oklch(0.27 0.02 80)', selection: 'oklch(0.40 0.04 70)', hover: 'oklch(0.36 0.03 80)', grid: 'oklch(0.30 0.02 80)'
  }, [
    'oklch(0.62 0.06 45)', 'oklch(0.60 0.06 20)', 'oklch(0.64 0.05 90)', 'oklch(0.61 0.06 140)',
    'oklch(0.63 0.06 200)', 'oklch(0.62 0.05 300)', 'oklch(0.60 0.06 250)', 'oklch(0.65 0.05 60)'
  ])
});

const darkStudio: Theme = themeSchema.parse({
  id: 'dark-studio', name: 'Dark Studio', radius: '0.5rem', fontFamily: 'Segoe UI', baseFontSize: 14,
  light: mode({
    background: 'oklch(0.97 0 0)', foreground: 'oklch(0.16 0 0)', primary: 'oklch(0.55 0.15 260)', primaryForeground: 'oklch(0.98 0 0)',
    secondary: 'oklch(0.94 0 0)', accent: 'oklch(0.91 0.02 260)', muted: 'oklch(0.95 0 0)', mutedForeground: 'oklch(0.46 0 0)',
    card: 'oklch(1 0 0)', border: 'oklch(0.90 0 0)', ring: 'oklch(0.55 0.15 260)', destructive: 'oklch(0.58 0.22 27)',
    surface: 'oklch(1 0 0)', surfaceAlt: 'oklch(0.95 0 0)', input: 'oklch(1 0 0)', selection: 'oklch(0.89 0.03 260)', hover: 'oklch(0.94 0.02 260)', grid: 'oklch(0.92 0 0)'
  }, [
    'oklch(0.55 0.15 260)', 'oklch(0.56 0.14 290)', 'oklch(0.54 0.15 220)', 'oklch(0.55 0.14 320)',
    'oklch(0.57 0.13 180)', 'oklch(0.53 0.14 250)', 'oklch(0.58 0.13 30)', 'oklch(0.56 0.13 340)'
  ]),
  dark: mode({
    background: 'oklch(0.14 0.01 260)', foreground: 'oklch(0.90 0.01 260)', primary: 'oklch(0.60 0.15 260)', primaryForeground: 'oklch(0.14 0.01 260)',
    secondary: 'oklch(0.22 0.01 260)', accent: 'oklch(0.25 0.02 260)', muted: 'oklch(0.20 0.01 260)', mutedForeground: 'oklch(0.64 0.01 260)',
    card: 'oklch(0.18 0.01 260)', border: 'oklch(0.26 0.01 260)', ring: 'oklch(0.60 0.15 260)', destructive: 'oklch(0.68 0.19 22)',
    surface: 'oklch(0.18 0.01 260)', surfaceAlt: 'oklch(0.20 0.01 260)', input: 'oklch(0.20 0.01 260)', selection: 'oklch(0.28 0.05 260)', hover: 'oklch(0.25 0.03 260)', grid: 'oklch(0.20 0.01 260)'
  }, [
    'oklch(0.60 0.15 260)', 'oklch(0.61 0.14 290)', 'oklch(0.59 0.15 220)', 'oklch(0.60 0.14 320)',
    'oklch(0.62 0.13 180)', 'oklch(0.58 0.14 250)', 'oklch(0.63 0.13 30)', 'oklch(0.61 0.13 340)'
  ])
});

const cyberpunk: Theme = themeSchema.parse({
  id: 'cyberpunk', name: 'Cyberpunk', radius: '0.25rem', fontFamily: 'Consolas', baseFontSize: 14,
  light: mode({
    background: 'oklch(0.97 0.01 290)', foreground: 'oklch(0.22 0.04 290)', primary: 'oklch(0.55 0.20 300)', primaryForeground: 'oklch(0.98 0 0)',
    secondary: 'oklch(0.93 0.02 200)', accent: 'oklch(0.90 0.08 180)', muted: 'oklch(0.94 0.02 290)', mutedForeground: 'oklch(0.48 0.03 290)',
    card: 'oklch(0.99 0.01 290)', border: 'oklch(0.88 0.03 300)', ring: 'oklch(0.55 0.20 300)', destructive: 'oklch(0.60 0.22 25)',
    surface: 'oklch(0.99 0.01 290)', surfaceAlt: 'oklch(0.94 0.02 290)', input: 'oklch(0.99 0.01 290)', selection: 'oklch(0.86 0.10 300)', hover: 'oklch(0.92 0.06 300)', grid: 'oklch(0.91 0.03 300)'
  }, [
    'oklch(0.55 0.20 300)', 'oklch(0.56 0.18 180)', 'oklch(0.58 0.19 260)', 'oklch(0.55 0.19 330)',
    'oklch(0.57 0.17 140)', 'oklch(0.54 0.19 220)', 'oklch(0.56 0.18 30)', 'oklch(0.55 0.18 80)'
  ]),
  dark: mode({
    background: 'oklch(0.13 0.03 290)', foreground: 'oklch(0.90 0.03 200)', primary: 'oklch(0.65 0.20 300)', primaryForeground: 'oklch(0.13 0.03 290)',
    secondary: 'oklch(0.22 0.04 200)', accent: 'oklch(0.28 0.10 180)', muted: 'oklch(0.20 0.03 290)', mutedForeground: 'oklch(0.66 0.04 290)',
    card: 'oklch(0.17 0.03 290)', border: 'oklch(0.30 0.06 300)', ring: 'oklch(0.65 0.20 300)', destructive: 'oklch(0.70 0.22 25)',
    surface: 'oklch(0.17 0.03 290)', surfaceAlt: 'oklch(0.20 0.03 290)', input: 'oklch(0.20 0.03 290)', selection: 'oklch(0.38 0.12 300)', hover: 'oklch(0.30 0.08 300)', grid: 'oklch(0.22 0.05 300)'
  }, [
    'oklch(0.65 0.20 300)', 'oklch(0.66 0.18 180)', 'oklch(0.68 0.19 260)', 'oklch(0.65 0.19 330)',
    'oklch(0.67 0.17 140)', 'oklch(0.64 0.19 220)', 'oklch(0.66 0.18 30)', 'oklch(0.65 0.18 80)'
  ])
});

const natureBotanical: Theme = themeSchema.parse({
  id: 'nature', name: 'Nature / Botanical', radius: '0.75rem', fontFamily: 'Georgia', baseFontSize: 14,
  light: mode({
    background: 'oklch(0.97 0.012 150)', foreground: 'oklch(0.30 0.03 150)', primary: 'oklch(0.50 0.10 150)', primaryForeground: 'oklch(0.97 0.012 150)',
    secondary: 'oklch(0.94 0.02 150)', accent: 'oklch(0.90 0.05 120)', muted: 'oklch(0.95 0.015 150)', mutedForeground: 'oklch(0.50 0.03 150)',
    card: 'oklch(0.99 0.012 150)', border: 'oklch(0.88 0.02 150)', ring: 'oklch(0.50 0.10 150)', destructive: 'oklch(0.58 0.18 25)',
    surface: 'oklch(0.99 0.012 150)', surfaceAlt: 'oklch(0.95 0.015 150)', input: 'oklch(0.99 0.012 150)', selection: 'oklch(0.86 0.05 150)', hover: 'oklch(0.92 0.035 150)', grid: 'oklch(0.91 0.02 150)'
  }, [
    'oklch(0.50 0.10 150)', 'oklch(0.52 0.10 120)', 'oklch(0.48 0.10 90)', 'oklch(0.54 0.09 180)',
    'oklch(0.50 0.10 30)', 'oklch(0.49 0.10 200)', 'oklch(0.53 0.09 60)', 'oklch(0.47 0.10 130)'
  ]),
  dark: mode({
    background: 'oklch(0.20 0.02 150)', foreground: 'oklch(0.92 0.02 150)', primary: 'oklch(0.60 0.10 150)', primaryForeground: 'oklch(0.20 0.02 150)',
    secondary: 'oklch(0.30 0.02 150)', accent: 'oklch(0.34 0.05 120)', muted: 'oklch(0.27 0.02 150)', mutedForeground: 'oklch(0.70 0.02 150)',
    card: 'oklch(0.24 0.02 150)', border: 'oklch(0.33 0.02 150)', ring: 'oklch(0.60 0.10 150)', destructive: 'oklch(0.68 0.17 25)',
    surface: 'oklch(0.24 0.02 150)', surfaceAlt: 'oklch(0.27 0.02 150)', input: 'oklch(0.27 0.02 150)', selection: 'oklch(0.38 0.06 150)', hover: 'oklch(0.33 0.04 150)', grid: 'oklch(0.28 0.025 150)'
  }, [
    'oklch(0.60 0.10 150)', 'oklch(0.62 0.10 120)', 'oklch(0.58 0.10 90)', 'oklch(0.64 0.09 180)',
    'oklch(0.60 0.10 30)', 'oklch(0.59 0.10 200)', 'oklch(0.63 0.09 60)', 'oklch(0.57 0.10 130)'
  ])
});

export const themes: Theme[] = [indigoMono, modernMinimal, softPastel, morandi, vintagePaper, darkStudio, cyberpunk, natureBotanical];
export const defaultThemeId = 'indigo-mono';

export function themeById(id: string): Theme {
  return themes.find(theme => theme.id === id) ?? indigoMono;
}

// ---- sRGB 反向换算（用于把 Pantone/自定义十六进制主色转回 oklch 派生主题）----
export function hexToRgb(hex: string): Rgb | null {
  const trimmed = hex.trim().replace(/^#/, '');
  const full = trimmed.length === 3 ? trimmed.split('').map(c => c + c).join('') : trimmed;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return { r: parseInt(full.slice(0, 2), 16) / 255, g: parseInt(full.slice(2, 4), 16) / 255, b: parseInt(full.slice(4, 6), 16) / 255 };
}

function srgbToLinear(value: number): number { return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4); }

export function rgbToOklch(rgb: Rgb): { l: number; c: number; h: number } {
  const r = srgbToLinear(rgb.r), g = srgbToLinear(rgb.g), b = srgbToLinear(rgb.b);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const lc = Math.cbrt(l), mc = Math.cbrt(m), sc = Math.cbrt(s);
  const L = 0.2104542553 * lc + 0.7936177850 * mc - 0.0040720468 * sc;
  const a = 1.9779984951 * lc - 2.4285922050 * mc + 0.4505937099 * sc;
  const bb = 0.0259040371 * lc + 0.7827717662 * mc - 0.8086757660 * sc;
  const c = Math.hypot(a, bb);
  const h = (Math.atan2(bb, a) * 180) / Math.PI;
  return { l: clamp01(L), c, h: (h + 360) % 360 };
}

export function hexToOklch(hex: string): string | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const { l, c, h } = rgbToOklch(rgb);
  return `oklch(${l.toFixed(4)} ${c.toFixed(4)} ${h.toFixed(4)})`;
}

/** 判断颜色是否偏暗（用于选取对比文字色）。支持 oklch 与 hex。 */
export function isDarkColor(color: string): boolean {
  const oklch = parseOklch(color);
  if (oklch) return oklch.l < 0.55;
  const rgb = hexToRgb(color);
  if (rgb) {
    const luminance = 0.2126 * srgbToLinear(rgb.r) + 0.7152 * srgbToLinear(rgb.g) + 0.0722 * srgbToLinear(rgb.b);
    return luminance < 0.36;
  }
  return false;
}

/** 由主色派生一套协调配色（围绕 primary 派生浅色/深色/强调/选中/悬停）。 */
export function deriveTheme(base: Theme, id: string, name: string, primary: string): Theme {
  const primaryOklch = parseOklch(primary) ? primary : (hexToOklch(primary) ?? base.light.tokens.primary);
  const contrast = isDarkColor(primaryOklch) ? 'oklch(0.98 0 0)' : 'oklch(0.18 0 0)';
  const deriveTokens = (tokens: ColorTokens, palette: string[]): ModeTokens => mode({
    ...tokens,
    primary: primaryOklch, ring: primaryOklch, primaryForeground: contrast,
    accent: mixOklch(primaryOklch, tokens.background, 0.86),
    selection: mixOklch(primaryOklch, tokens.background, 0.78),
    hover: mixOklch(primaryOklch, tokens.background, 0.9)
  }, [primaryOklch, ...palette.slice(1)]);
  return themeSchema.parse({ ...base, id, name, light: deriveTokens(base.light.tokens, base.light.trackPalette), dark: deriveTokens(base.dark.tokens, base.dark.trackPalette) });
}

/** 按插入序从调色板稳定分配素材颜色；调色板耗尽时按轮次调整亮度扩展，保证协调且易区分。返回 hex。 */
export function autoTrackColor(palette: string[], index: number): string {
  if (!palette.length) return '#8888ff';
  const source = palette[index % palette.length];
  const cycle = Math.floor(index / palette.length);
  const base = cycle === 0 ? source : (cycle % 2 === 0 ? adjustLightness(source, cycle * 0.09) : adjustLightness(source, -cycle * 0.09));
  return colorToHex(base);
}


import { BoundedCache } from './boundedCache';
// 用法：canvasDisplayObject(object, tokens) 为当前主题派生画布样式，不改写保存的颜色。
// 文字和线条按实际背景补足对比度；填充使用同色相的主题表面，照片与视频像素不参与转换。
import type { CanvasObject } from './document';
import { styleOf } from './appearance';
import { colorToHex, hexToRgb, oklchToRgb, rgbToHex, rgbToOklch, type ColorTokens, type Rgb } from './theme';

const luminance = (rgb: Rgb) => {
  const linear = (value: number) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  return .2126 * linear(rgb.r) + .7152 * linear(rgb.g) + .0722 * linear(rgb.b);
};
export function canvasContrast(a: string, b: string): number {
  const first = hexToRgb(colorToHex(a)), second = hexToRgb(colorToHex(b));
  if (!first || !second) return 1;
  const x = luminance(first), y = luminance(second);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
const inkCache = new BoundedCache<string, string>(1024, 256 * 1024);
const fillCache = new BoundedCache<string, string>(256, 64 * 1024);
export function canvasInk(color: string, backgrounds: string[], minimum = 4.5): string {
  const key = JSON.stringify([color, backgrounds, minimum]), cached = inkCache.get(key);
  if (cached !== undefined) return cached;
  const result = computeInk(color, backgrounds, minimum);
  inkCache.set(key, result, (key.length + result.length) * 2);
  return result;
}
function computeInk(color: string, backgrounds: string[], minimum: number): string {
  const rgb = hexToRgb(colorToHex(color));
  if (!rgb) return color;
  const original = rgbToHex(rgb);
  if (backgrounds.every(background => canvasContrast(original, background) >= minimum)) return original;
  const { l, c, h } = rgbToOklch(rgb);
  const dark = luminance(hexToRgb(colorToHex(backgrounds[0])) ?? { r: 0, g: 0, b: 0 }) < .18;
  const end = dark ? 1 : 0;
  for (let step = 1; step <= 30; step++) {
    const result = rgbToHex(oklchToRgb(l + (end - l) * step / 30, c * (1 - step / 45), h));
    if (backgrounds.every(background => canvasContrast(result, background) >= minimum)) return result;
  }
  return dark ? '#ffffff' : '#000000';
}
function canvasFill(color: string, background: string): string {
  const key = JSON.stringify([color, background]), cached = fillCache.get(key);
  if (cached !== undefined) return cached;
  const result = computeFill(color, background);
  fillCache.set(key, result, (key.length + result.length) * 2);
  return result;
}
function computeFill(color: string, background: string): string {
  const rgb = hexToRgb(colorToHex(color));
  if (!rgb) return color;
  const { l, c, h } = rgbToOklch(rgb);
  const dark = luminance(hexToRgb(colorToHex(background)) ?? { r: 0, g: 0, b: 0 }) < .18;
  return rgbToHex(oklchToRgb(dark ? Math.min(l, .38) : Math.max(l, .88), Math.min(c, .15), h));
}
export function canvasDisplayObject<T extends CanvasObject>(object: T, tokens: ColorTokens): T {
  const base = styleOf(object), background = colorToHex(tokens.background);
  const fill = canvasFill(base.fill, background), gradientColor = canvasFill(base.gradientColor, background);
  const surfaces = [background, ...(base.fillEnabled && hexToRgb(fill) ? [fill, ...(base.gradient ? [gradientColor] : [])] : [])];
  const style = { ...base, fill, gradientColor, stroke: canvasInk(base.stroke, surfaces, 3) };
  return { ...object, style, ...('fill' in object ? { fill, stroke: style.stroke } : {}), ...('color' in object || 'fill' in object ? { color: canvasInk(object.color ?? colorToHex(tokens.foreground), surfaces, object.kind === 'media' || object.kind === 'stroke' ? 3 : 4.5) } : {}) };
}

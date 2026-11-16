// 用法：npm.cmd exec -- vitest run src/core/theme.test.ts。验证 OKLCH 换算与主题数据完整性。
import { describe, expect, it } from 'vitest';
import { adjustLightness, colorToHex, colorToRgba, mixOklch, parseOklch, themeById, themes, themeSchema } from './theme';

describe('主题 Token 与颜色换算', () => {
  it('oklch 黑白端点换算为 sRGB 黑白', () => {
    expect(colorToHex('oklch(0 0 0)')).toBe('#000000');
    expect(colorToHex('oklch(1 0 0)')).toBe('#ffffff');
  });
  it('十六进制颜色直接透传，短格式展开', () => {
    expect(colorToHex('#4f6bed')).toBe('#4f6bed');
    expect(colorToHex('#abc')).toBe('#aabbcc');
  });
  it('oklch 换算结果始终是合法 6 位十六进制', () => {
    for (const color of ['oklch(0.5144 0.1605 267.44)', 'oklch(0.9851 0 0)', 'oklch(0.704 0.191 22.216)']) {
      expect(colorToHex(color)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  it('解析 oklch 的透明度并生成 rgba', () => {
    expect(parseOklch('oklch(0.5 0.1 267 / 50%)')?.alpha).toBe(0.5);
    expect(parseOklch('oklch(0.5 0.1 267)')?.alpha).toBe(1);
    expect(colorToRgba('oklch(0.5 0.1 267)', 0.14)).toMatch(/^rgba\(\d+, \d+, \d+, 0\.14\)$/);
  });
  it('调整亮度与混合色返回可解析的 oklch', () => {
    const lightened = adjustLightness('oklch(0.5 0.1 267)', 0.2);
    expect(parseOklch(lightened)?.l).toBeCloseTo(0.7);
    const mixed = mixOklch('oklch(0 0 0)', 'oklch(1 0 0)', 0.5);
    expect(parseOklch(mixed)?.l).toBeCloseTo(0.5);
  });
  it('所有内置主题通过 schema 校验，明暗两套 Token 与调色板齐全', () => {
    expect(themes.length).toBeGreaterThanOrEqual(6);
    for (const theme of themes) {
      expect(() => themeSchema.parse(theme)).not.toThrow();
      expect(Object.keys(theme.light.tokens).length).toBe(18);
      expect(Object.keys(theme.dark.tokens).length).toBe(18);
      expect(theme.light.trackPalette.length).toBeGreaterThanOrEqual(6);
      expect(theme.dark.trackPalette.length).toBeGreaterThanOrEqual(6);
    }
  });
  it('默认主题可解析，未知 id 回退到默认', () => {
    expect(themeById('indigo-mono').id).toBe('indigo-mono');
    expect(themeById('not-a-theme').id).toBe('indigo-mono');
  });
});

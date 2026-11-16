// 用法：npm.cmd exec -- vitest run src/core/design.test.ts。验证 Pantone 颜色库、自动配色与元素样式预设。
import { describe, expect, it } from 'vitest';
import { pantoneColors } from './pantone';
import { autoTrackColor } from './theme';
import { arrowHeadStyles, arrowLineStyles, mediaTrackStylePresets, shapeStylePresets, stylePresetsFor, textStylePresets } from './elementStyles';

describe('Pantone 年度色库', () => {
  it('覆盖 2000–2025，且 2016、2021 双年度色齐全', () => {
    const years = new Set(pantoneColors.map(color => color.year));
    for (let year = 2000; year <= 2025; year++) expect(years.has(year)).toBe(true);
    expect(pantoneColors.filter(color => color.year === 2016)).toHaveLength(2);
    expect(pantoneColors.filter(color => color.year === 2021)).toHaveLength(2);
  });
  it('每条都有合法色号与 hex', () => {
    for (const color of pantoneColors) {
      expect(color.pantone).toMatch(/^\d{2}-\d{4}$/);
      expect(color.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe('素材自动配色', () => {
  const palette = ['oklch(0.5 0.16 267)', 'oklch(0.6 0.17 290)', 'oklch(0.62 0.14 240)'];
  it('按插入序稳定分配，连续三轨颜色互不相同', () => {
    const assigned = [0, 1, 2].map(index => autoTrackColor(palette, index));
    expect(new Set(assigned).size).toBe(3);
    expect(autoTrackColor(palette, 0)).toBe(autoTrackColor(palette, 0));
  });
  it('调色板耗尽时仍返回协调且可区分的扩展色', () => {
    const extended = autoTrackColor(palette, 3);
    expect(extended).toMatch(/^#[0-9a-f]{6}$/);
    expect(extended).not.toBe(autoTrackColor(palette, 0));
  });
});

describe('元素样式预设', () => {
  it('各类对象均有预设，且样式补丁字段合法', () => {
    expect(shapeStylePresets.length).toBeGreaterThanOrEqual(6);
    expect(textStylePresets.length).toBeGreaterThanOrEqual(4);
    expect(mediaTrackStylePresets.length).toBeGreaterThanOrEqual(3);
    expect(stylePresetsFor('rectangle')).toEqual(shapeStylePresets);
    expect(stylePresetsFor('text')).toEqual(textStylePresets);
    expect(stylePresetsFor('media')).toEqual(mediaTrackStylePresets);
  });
  it('箭头线型与头部样式库齐全（含 draw.io 风格）', () => {
    expect(arrowLineStyles.map(item => item.id)).toContain('dashed');
    expect(arrowLineStyles.map(item => item.id)).toContain('dash-dot');
    expect(arrowHeadStyles.map(item => item.id)).toEqual(expect.arrayContaining(['none', 'arrow', 'open', 'diamond', 'circle', 'square', 'block']));
  });
});

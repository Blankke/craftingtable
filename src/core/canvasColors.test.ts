// 使用范例：npm.cmd exec -- vitest run src/core/canvasColors.test.ts。
// 验证主题切换的可读性、来源颜色保留和图片像素引用稳定。
import { describe, expect, it } from 'vitest';
import { themes, colorToHex } from './theme';
import { canvasContrast, canvasDisplayObject, canvasInk } from './canvasColors';
import type { CanvasObject } from './document';
import { canvasTextFromPlainText } from './canvasText';

describe('画布主题配色', () => {
  it('深浅主题下文字与线条保持对比，切换不修改源样式', () => {
    const source: CanvasObject = { id: crypto.randomUUID(), kind: 'rectangle', x: 0, y: 0, width: 180, height: 90, groupId: null, fill: '#ffffff', stroke: '#111111', color: '#172033', text: canvasTextFromPlainText('现场说明') };
    const original = structuredClone(source);
    for (const mode of ['light', 'dark'] as const) {
      const tokens = themes[0][mode].tokens, rendered = canvasDisplayObject(source, tokens);
      expect(canvasContrast(rendered.color!, colorToHex(tokens.background))).toBeGreaterThanOrEqual(4.5);
      expect(canvasContrast(rendered.color!, rendered.style!.fill)).toBeGreaterThanOrEqual(4.5);
      expect(canvasContrast(rendered.style!.stroke, colorToHex(tokens.background))).toBeGreaterThanOrEqual(3);
    }
    expect(source).toEqual(original);
  });
  it('浅色与深色原字色都能适配相反主题，已有可读颜色保持不变', () => {
    expect(canvasContrast(canvasInk('#111111', ['#000000']), '#000000')).toBeGreaterThanOrEqual(4.5);
    expect(canvasContrast(canvasInk('#eeeeee', ['#ffffff']), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(canvasInk('#172033', ['#ffffff'])).toBe('#172033');
  });
  it('没有显式字色的形状在深色模式下也能看清正文', () => {
    const shape: CanvasObject = { id: crypto.randomUUID(), kind: 'rectangle', x: 0, y: 0, width: 220, height: 120, groupId: null, fill: '#fff', stroke: '#123456', text: canvasTextFromPlainText('场景分镜') };
    const rendered = canvasDisplayObject(shape, themes[0].dark.tokens);
    expect(canvasContrast(rendered.color!, rendered.style!.fill)).toBeGreaterThanOrEqual(4.5);
    expect(shape.color).toBeUndefined();
  });
  it('图片内容、尺寸和裁剪不因主题变化而改写', () => {
    const image: CanvasObject = { id: crypto.randomUUID(), kind: 'image', assetId: crypto.randomUUID(), x: 0, y: 0, width: 100, height: 80, groupId: null, crop: { x: .1, y: .1, width: .8, height: .8 } };
    expect(canvasDisplayObject(image, themes[0].dark.tokens)).toMatchObject(image);
  });
});

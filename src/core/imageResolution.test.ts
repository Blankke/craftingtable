// 用法：npm run test:unit；验证缩放、设备密度和裁剪共同决定解码尺寸。
import { expect, it } from 'vitest';
import { imagePreviewEdge } from './imageResolution';
it('按实际屏幕像素取档位，限制单图预览并为裁剪保留足够细节', () => {
  expect(imagePreviewEdge(200, 100, 1, 1)).toBe(256);
  expect(imagePreviewEdge(200, 100, 2, 1.5)).toBe(1024);
  expect(imagePreviewEdge(200, 100, .5, 1)).toBe(128);
  expect(imagePreviewEdge(200, 100, 1, 1, { width: .1, height: 1 })).toBe(2048);
  expect(imagePreviewEdge(10000)).toBe(4096);
});

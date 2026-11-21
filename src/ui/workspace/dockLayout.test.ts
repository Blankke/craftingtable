import { describe, expect, it } from 'vitest';
import { clampHeight, clampWidth, DOCK_MIN_HEIGHT, loadDockLayout, normalizeHeights } from './dockLayout';

describe('分栏尺寸归一化', () => {
  it('按当前比例把面板总高度分配到可见面板', () => {
    const heights = { tools: 200, library: 200, properties: 400 };
    const normalized = normalizeHeights(heights, ['tools', 'library', 'properties'], 800);
    expect(normalized.tools + normalized.library + normalized.properties).toBeCloseTo(800, 1);
    expect(normalized.tools).toBeCloseTo(200);
    expect(normalized.library).toBeCloseTo(200);
    expect(normalized.properties).toBeCloseTo(400);
  });

  it('每块不低于最小高度', () => {
    const heights = { tools: 10, library: 10, properties: 10 };
    const normalized = normalizeHeights(heights, ['tools', 'library', 'properties'], 200);
    expect(normalized.tools).toBeGreaterThanOrEqual(DOCK_MIN_HEIGHT);
    expect(normalized.library).toBeGreaterThanOrEqual(DOCK_MIN_HEIGHT);
    expect(normalized.properties).toBeGreaterThanOrEqual(DOCK_MIN_HEIGHT);
  });
  it('两个小面板触底时从大面板重新分配空间，总高度不超出可用区域', () => {
    const normalized = normalizeHeights({ tools: 120, library: 120, properties: 1400 }, ['tools', 'library', 'properties'], 500);
    expect(normalized).toEqual({ tools: 120, library: 120, properties: 260 });
    expect(Object.values(normalized).reduce((sum, height) => sum + height, 0)).toBe(500);
  });

  it('空可见面板保持原值', () => {
    const heights = { tools: 200, library: 200, properties: 400 };
    expect(normalizeHeights(heights, [], 800)).toEqual(heights);
  });
});

describe('最小高度与宽度限幅', () => {
  it('高度下限为 120', () => {
    expect(clampHeight(0)).toBe(120);
    expect(clampHeight(300)).toBe(300);
  });
  it('宽度限幅到 [280, maxWidth]', () => {
    expect(clampWidth(100, 1000)).toBe(280);
    expect(clampWidth(400, 1000)).toBe(400);
    expect(clampWidth(2000, 1000)).toBe(1000);
  });
});

describe('本地持久化', () => {
  it('读取并限幅存储值', () => {
    const storage = { getItem: () => JSON.stringify({ width: 5000, heights: { tools: 5, library: 300, properties: 460 } }) };
    const layout = loadDockLayout(storage);
    expect(layout.width).toBe(4000);
    expect(layout.heights.tools).toBe(120);
    expect(layout.heights.library).toBe(300);
    expect(layout.heights.properties).toBe(460);
  });
  it('存储损坏时回退默认值', () => {
    const storage = { getItem: () => 'not-json' };
    const layout = loadDockLayout(storage);
    expect(layout.width).toBe(360);
    expect(layout.heights.tools).toBe(230);
  });
  it('无存储时回退默认值', () => {
    const layout = loadDockLayout({ getItem: () => null });
    expect(layout.width).toBe(360);
  });
});

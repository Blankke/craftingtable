import { describe, expect, it } from 'vitest';
import { trackTicks } from './ticks';

describe('源时间刻度', () => {
  it('裁剪和显示比例变化后仍标示源素材时间', () => {
    const original = trackTicks(0, 10_000_000, 100);
    const trimmed = trackTicks(3_000_000, 10_000_000, 100);
    const zoomed = trackTicks(3_000_000, 10_000_000, 25);
    expect(original[0]).toMatchObject({ timeUs: 0, label: '0:00', x: 0 });
    expect(trimmed[0]).toMatchObject({ timeUs: 3_000_000, label: '0:03', x: 0 });
    expect(zoomed[0].timeUs).toBe(4_000_000);
    expect(zoomed[0].x).toBe(25);
  });
});

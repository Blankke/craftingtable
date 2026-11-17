import { describe, expect, it } from 'vitest';
import { aggregatePeaks, decodeWaveform, encodeWaveform, resampleColumns, WAVEFORM_HEADER_BYTES, WAVEFORM_MAGIC, WAVEFORM_VERSION } from './waveform';

describe('音频峰值聚合', () => {
  it('按列率把采样聚合为正负峰值', () => {
    // 采样率 8，目标 4 列/秒，每列 2 个采样：列 0 = [1, -1]，列 1 = [2, -2]。
    const pcm = new Int16Array([1, -1, 2, -2, 3, -3, 4, -4]);
    const columns = aggregatePeaks(pcm, 8, 4);
    expect(columns.length).toBe(8);
    expect([...columns]).toEqual([-1, 1, -2, 2, -3, 3, -4, 4]);
  });

  it('空输入仍生成至少一列且归零', () => {
    const columns = aggregatePeaks(new Int16Array(0), 8000, 120);
    expect(columns.length).toBe(2);
    expect([...columns]).toEqual([0, 0]);
  });
});

describe('二进制缓存编解码', () => {
  it('往返保持峰值数据与元信息', () => {
    const peaks = { samplesPerSecond: 120, sampleRate: 8000, durationUs: 1_234_567, columns: new Int16Array([-32000, 32000, -5, 5, 0, 0]) };
    const decoded = decodeWaveform(encodeWaveform(peaks));
    expect(decoded).not.toBeNull();
    expect(decoded!.samplesPerSecond).toBe(120);
    expect(decoded!.sampleRate).toBe(8000);
    expect(decoded!.durationUs).toBe(1_234_567);
    expect([...decoded!.columns]).toEqual([-32000, 32000, -5, 5, 0, 0]);
  });

  it('缓存失效：magic 不符返回 null', () => {
    const buffer = encodeWaveform({ samplesPerSecond: 120, sampleRate: 8000, durationUs: 1_000_000, columns: new Int16Array([-1, 1]) });
    new DataView(buffer).setUint32(0, WAVEFORM_MAGIC ^ 0xffffffff, true);
    expect(decodeWaveform(buffer)).toBeNull();
  });

  it('缓存失效：版本不符返回 null', () => {
    const buffer = encodeWaveform({ samplesPerSecond: 120, sampleRate: 8000, durationUs: 1_000_000, columns: new Int16Array([-1, 1]) });
    new DataView(buffer).setUint32(4, WAVEFORM_VERSION + 1, true);
    expect(decodeWaveform(buffer)).toBeNull();
  });

  it('缓存失效：截断的二进制返回 null', () => {
    const buffer = encodeWaveform({ samplesPerSecond: 120, sampleRate: 8000, durationUs: 1_000_000, columns: new Int16Array([-1, 1]) });
    expect(decodeWaveform(buffer.slice(0, WAVEFORM_HEADER_BYTES - 1))).toBeNull();
  });
});

describe('按像素重采样', () => {
  it('把裁剪区间映射到像素列并聚合正负峰值', () => {
    // 4 列峰值，samplesPerSecond = 4，覆盖 1 秒；inUs=0.25s, outUs=0.75s 即 2 列。
    const peaks = { samplesPerSecond: 4, sampleRate: 8, durationUs: 1_000_000, columns: new Int16Array([-10, 10, -20, 20, -30, 30, -40, 40]) };
    const columns = resampleColumns(peaks, 250_000, 750_000, 2);
    expect(columns).toEqual([{ min: -20, max: 20 }, { min: -30, max: 30 }]);
  });

  it('像素宽度为 0 或区间无效时返回空数组', () => {
    const peaks = { samplesPerSecond: 4, sampleRate: 8, durationUs: 1_000_000, columns: new Int16Array([-1, 1]) };
    expect(resampleColumns(peaks, 0, 1_000_000, 0)).toEqual([]);
    expect(resampleColumns(peaks, 1_000_000, 0, 10)).toEqual([]);
  });
});

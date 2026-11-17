// 用法：后台 worker 把单声道 PCM 聚合为峰值列后 encodeWaveform 写入缓存；渲染端 fetch 文件后 decodeWaveform 再按像素重采样。
// 峰值缓存带固定版本头，解码时校验，避免旧的 PNG 波形路径或损坏文件被误用。数据为纯内存操作，不依赖 Node 或 DOM。
// 与媒体相关的唯一事实是源文件：缩放、拉长、裁剪与改色都只在渲染端重采样，不重新分析音频。

// 文件头：magic(4) + version(4) + samplesPerSecond(4) + sampleRate(4) + durationUs(8) + columnCount(4) = 28 字节。
// 每列紧接两个 int16（min, max），共 columnCount * 4 字节。
export const WAVEFORM_MAGIC = 0x5746504b; // 'WFPK'
export const WAVEFORM_VERSION = 1;
export const WAVEFORM_HEADER_BYTES = 28;
// 峰值列率上限：每秒最多 120 列，保证长短音频的缓存体积都有界。
export const WAVEFORM_SAMPLES_PER_SECOND = 120;

export interface WaveformPeaks {
  /** 每秒峰值列数（≤120）。 */
  samplesPerSecond: number;
  /** 解码时的采样率，仅用于诊断，重采样不依赖它。 */
  sampleRate: number;
  /** 源音频总时长（微秒）。 */
  durationUs: number;
  /** 每列一个 [min, max]，长度 = columnCount * 2。 */
  columns: Int16Array;
}

/** 把单声道 16-bit PCM 采样聚合为正负峰值列；每列覆盖约 sampleRate / samplesPerSecond 个采样。 */
export function aggregatePeaks(pcm: Int16Array, sampleRate: number, samplesPerSecond: number): Int16Array {
  const columnCount = Math.max(1, Math.ceil(pcm.length * samplesPerSecond / sampleRate));
  const columns = new Int16Array(columnCount * 2);
  for (let column = 0; column < columnCount; column++) {
    columns[column * 2] = 32767;
    columns[column * 2 + 1] = -32768;
  }
  for (let index = 0; index < pcm.length; index++) {
    const column = Math.min(columnCount - 1, Math.floor(index * samplesPerSecond / sampleRate));
    const value = pcm[index];
    if (value < columns[column * 2]) columns[column * 2] = value;
    if (value > columns[column * 2 + 1]) columns[column * 2 + 1] = value;
  }
  // 极端短音频可能留下空列；空列归零避免画出反向的「实心」竖线。
  for (let column = 0; column < columnCount; column++) {
    if (columns[column * 2] > columns[column * 2 + 1]) { columns[column * 2] = 0; columns[column * 2 + 1] = 0; }
  }
  return columns;
}

/** 序列化为带版本头的紧凑二进制缓存。 */
export function encodeWaveform(peaks: WaveformPeaks): ArrayBuffer {
  const byteLength = WAVEFORM_HEADER_BYTES + peaks.columns.length * 2;
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, WAVEFORM_MAGIC, true);
  view.setUint32(4, WAVEFORM_VERSION, true);
  view.setUint32(8, Math.max(1, Math.round(peaks.samplesPerSecond)), true);
  view.setUint32(12, Math.max(1, Math.round(peaks.sampleRate)), true);
  view.setFloat64(16, peaks.durationUs, true);
  view.setUint32(24, peaks.columns.length / 2, true);
  for (let index = 0; index < peaks.columns.length; index++) view.setInt16(WAVEFORM_HEADER_BYTES + index * 2, peaks.columns[index], true);
  return buffer;
}

/** 解析二进制缓存；magic 或版本不符（缓存失效/损坏）时返回 null，由调用方重新分析。 */
export function decodeWaveform(buffer: ArrayBuffer): WaveformPeaks | null {
  if (buffer.byteLength < WAVEFORM_HEADER_BYTES) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== WAVEFORM_MAGIC || view.getUint32(4, true) !== WAVEFORM_VERSION) return null;
  const samplesPerSecond = view.getUint32(8, true);
  const sampleRate = view.getUint32(12, true);
  const durationUs = view.getFloat64(16, true);
  const columnCount = view.getUint32(24, true);
  const expected = WAVEFORM_HEADER_BYTES + columnCount * 4;
  if (!Number.isFinite(durationUs) || samplesPerSecond <= 0 || columnCount <= 0 || buffer.byteLength < expected) return null;
  const columns = new Int16Array(buffer, WAVEFORM_HEADER_BYTES, columnCount * 2);
  return { samplesPerSecond, sampleRate, durationUs, columns };
}

/** 把峰值列按裁剪区间与像素宽度重新聚合到屏幕列，供画布绘制 1px 垂直峰值线。 */
export function resampleColumns(peaks: WaveformPeaks, inUs: number, outUs: number, pixelWidth: number): { min: number; max: number }[] {
  const result: { min: number; max: number }[] = [];
  const width = Math.max(0, Math.floor(pixelWidth));
  if (width <= 0 || outUs <= inUs) return result;
  const columnCount = peaks.columns.length / 2;
  const spanUs = (outUs - inUs) / width;
  for (let pixel = 0; pixel < width; pixel++) {
    const startUs = inUs + pixel * spanUs;
    const endUs = inUs + (pixel + 1) * spanUs;
    const first = Math.min(columnCount - 1, Math.max(0, Math.floor(startUs * peaks.samplesPerSecond / 1_000_000)));
    const last = Math.min(columnCount - 1, Math.max(first, Math.floor((endUs - 1) * peaks.samplesPerSecond / 1_000_000)));
    let min = 32767, max = -32768;
    for (let column = first; column <= last; column++) {
      const lo = peaks.columns[column * 2], hi = peaks.columns[column * 2 + 1];
      if (lo < min) min = lo;
      if (hi > max) max = hi;
    }
    if (min > max) { min = 0; max = 0; }
    result.push({ min, max });
  }
  return result;
}

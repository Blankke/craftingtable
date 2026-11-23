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

/** 流式接收 s16le 字节；只保留峰值，不在内存拼接整段 PCM。支持分块落在半个采样处。 */
export class StreamingPeaks {
  private storage = new Int16Array(0);
  private samples = 0;
  private lowByte: number | null = null;
  constructor(readonly sampleRate: number, readonly samplesPerSecond: number) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isFinite(samplesPerSecond) || samplesPerSecond <= 0) throw Error('峰值采样率无效');
  }
  private reserve(columns: number): void {
    if (this.storage.length >= columns * 2) return;
    const next = new Int16Array(Math.max(columns * 2, this.storage.length * 2, 1024));
    next.set(this.storage);
    for (let i = this.storage.length; i < next.length; i += 2) { next[i] = 32767; next[i + 1] = -32768; }
    this.storage = next;
  }
  private sample(low: number, high: number): void {
    const column = Math.floor(this.samples * this.samplesPerSecond / this.sampleRate);
    this.reserve(column + 1);
    const value = ((high << 8 | low) << 16) >> 16, offset = column * 2;
    if (value < this.storage[offset]) this.storage[offset] = value;
    if (value > this.storage[offset + 1]) this.storage[offset + 1] = value;
    this.samples++;
  }
  push(bytes: Uint8Array): void {
    let offset = 0;
    if (this.lowByte !== null && bytes.length) { this.sample(this.lowByte, bytes[0]); this.lowByte = null; offset = 1; }
    for (; offset + 1 < bytes.length; offset += 2) this.sample(bytes[offset], bytes[offset + 1]);
    if (offset < bytes.length) this.lowByte = bytes[offset];
  }
  finish(): WaveformPeaks {
    // 与整段聚合的末列边界一致；残缺的最后一个字节不构成采样。
    const count = Math.max(1, Math.ceil(this.samples * this.samplesPerSecond / this.sampleRate));
    this.reserve(count);
    const columns = this.storage.slice(0, count * 2);
    for (let i = 0; i < columns.length; i += 2) if (columns[i] > columns[i + 1]) { columns[i] = 0; columns[i + 1] = 0; }
    return { columns, sampleRate: this.sampleRate, samplesPerSecond: this.samplesPerSecond, durationUs: Math.round(this.samples / this.sampleRate * 1_000_000) };
  }
}

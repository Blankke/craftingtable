// 用法：MediaAnalysisController.reconcile(editor.document)；仅对已提交的媒体输入调度分析。
// 每条轨道独立持有任务，新增/修改其他对象不会清空波形、缩略图或取消在途任务。
import type { ProjectDocument } from './document';

export type MediaAnalysis = { waveform?: { path: string; samplesPerSecond: number; durationUs: number }; frames?: { path: string; timeUs: number }[]; processing?: boolean; progress?: number; taskId?: string; error?: string; errorCode?: string; retryable?: boolean };
export type AnalysisRequest = { assetId: string; assetPath: string; kind: 'audio' | 'video'; inUs: number; outUs: number; pixelsPerSecond: number; taskId: string };
type AnalysisResponse = { ok: true; result: MediaAnalysis } | { ok: false; error: { code: string; message: string; retryable: boolean } };
type Entry = { key: string; taskId: string; pending: boolean; state: MediaAnalysis };

export class MediaAnalysisController {
  private entries = new Map<string, Entry>();
  private disposed = false;
  constructor(private readonly api: { analyzeAsset(request: AnalysisRequest): Promise<AnalysisResponse>; cancelTask(taskId: string): Promise<unknown> }, private readonly publish: (state: Record<string, MediaAnalysis>) => void) {}

  reconcile(document: ProjectDocument, retry = false): void {
    if (this.disposed) return;
    const desired = new Map<string, { key: string; request: Omit<AnalysisRequest, 'taskId'> }>();
    for (const object of document.objects) {
      if (object.kind !== 'media') continue;
      const asset = document.assets.find(item => item.id === object.assetId);
      if (!asset || asset.status === 'missing' || (asset.kind !== 'audio' && asset.kind !== 'video')) continue;
      const request = { assetId: asset.id, assetPath: asset.path, kind: asset.kind, inUs: object.inUs, outUs: object.outUs, pixelsPerSecond: object.pixelsPerSecond };
      // 音频整段峰值只依赖源文件；视频抽帧额外依赖裁剪区间与时间比例。
      const key = JSON.stringify(asset.kind === 'audio' ? [asset.id, asset.path, asset.kind] : Object.values(request));
      desired.set(object.id, { key, request });
    }
    let changed = false;
    for (const [id, entry] of this.entries) {
      if (desired.has(id)) continue;
      this.entries.delete(id);
      this.cancel(entry);
      changed = true;
    }
    for (const [id, { key, request }] of desired) {
      const previous = this.entries.get(id);
      if (previous?.key === key && !(retry && previous.state.retryable && previous.state.error)) continue;
      if (previous) this.cancel(previous);
      // 同一媒体生成新抽帧期间保留已有结果，避免短暂白屏；完成后一次替换。
      const retained = previous?.state;
      const taskId = crypto.randomUUID();
      const entry: Entry = { key, taskId, pending: true, state: { waveform: retained?.waveform, frames: retained?.frames, processing: true, progress: 0, taskId } };
      this.entries.set(id, entry);
      changed = true;
      void this.api.analyzeAsset({ ...request, taskId }).then(result => {
        if (this.disposed || this.entries.get(id) !== entry) return;
        entry.pending = false;
        entry.state = result.ok ? result.result : { ...entry.state, processing: false, error: result.error.message, errorCode: result.error.code, retryable: result.error.retryable };
        this.emit();
      }).catch(error => {
        if (this.disposed || this.entries.get(id) !== entry) return;
        entry.pending = false;
        entry.state = { ...entry.state, processing: false, error: String(error), errorCode: 'BACKEND', retryable: true };
        this.emit();
      });
    }
    if (changed) this.emit();
  }

  progress(taskId: string, percent: number): void {
    if (this.disposed) return;
    const entry = [...this.entries.values()].find(item => item.taskId === taskId && item.pending);
    if (!entry) return;
    entry.state = { ...entry.state, progress: percent };
    this.emit();
  }
  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) this.cancel(entry);
    this.entries.clear();
  }
  private cancel(entry: Entry): void { if (entry.pending) void this.api.cancelTask(entry.taskId).catch(() => undefined); }
  private emit(): void { this.publish(Object.fromEntries([...this.entries].map(([id, entry]) => [id, entry.state]))); }
}

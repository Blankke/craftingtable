// 使用范例：npm exec -- vitest run src/core/mediaAnalysis.test.ts；验证任务稳定性、隔离和异步乱序。
import { describe, expect, it, vi } from 'vitest';
import { MediaAnalysisController, type AnalysisRequest, type MediaAnalysis } from './mediaAnalysis';
import { newDocument } from './document';
import { Editor } from './editor';

function setup() {
  const document = newDocument('媒体稳定性');
  for (const kind of ['audio', 'video'] as const) {
    const id = crypto.randomUUID();
    document.assets.push({ id, kind, name: kind, path: `assets/${id}`, status: 'ready' });
    document.objects.push({ id: crypto.randomUUID(), kind: 'media', assetId: id, x: 0, y: 0, width: 200, height: 100, groupId: null, inUs: 0, outUs: 2e6, pixelsPerSecond: 100 });
  }
  document.objects.push({ id: crypto.randomUUID(), kind: 'rectangle', x: 0, y: 0, width: 100, height: 50, groupId: null, fill: '#fff', stroke: '#000' });
  const pending: ((result: { ok: true; result: MediaAnalysis } | { ok: false; error: { code: string; message: string; retryable: boolean } }) => void)[] = [];
  const api = { analyzeAsset: vi.fn((_request: AnalysisRequest) => new Promise<Parameters<typeof pending[number]>[0]>(resolve => pending.push(resolve))), cancelTask: vi.fn(async (_id: string) => undefined) };
  let state: Record<string, MediaAnalysis> = {};
  const controller = new MediaAnalysisController(api, next => { state = next; });
  const editor = new Editor(document);
  editor.subscribe(() => controller.reconcile(editor.committedDocument));
  controller.reconcile(editor.committedDocument);
  return { document, editor, api, controller, pending, state: () => state };
}
const finish = async (resolve: ReturnType<typeof setup>['pending'][number], result: MediaAnalysis = {}) => { resolve({ ok: true, result }); await Promise.resolve(); };

describe('媒体分析按轨道调度', () => {
  it('其他对象预览、取消、提交、撤销均保留原任务与结果', async () => {
    const s = setup();
    await finish(s.pending[0], { waveform: { path: 'cache/a.bin', durationUs: 2e6, samplesPerSecond: 120 } });
    await finish(s.pending[1], { frames: [{ path: 'cache/v.jpg', timeUs: 0 }] });
    const before = s.state();
    s.editor.preview(draft => { draft.objects[2].width = 180; });
    s.editor.cancelPreview();
    s.editor.preview(draft => { draft.objects[2].rotation = 45; });
    s.editor.commitPreview(); s.editor.undo(); s.editor.redo();
    expect(s.api.analyzeAsset).toHaveBeenCalledTimes(2);
    expect(s.api.cancelTask).not.toHaveBeenCalled();
    expect(s.state()).toBe(before);
  });
  it('媒体预览不分析，提交视频区间只刷新对应轨道，并在完成前保留画面', async () => {
    const s = setup();
    await finish(s.pending[0]);
    await finish(s.pending[1], { frames: [{ path: 'cache/old.jpg', timeUs: 0 }] });
    s.editor.preview(draft => { const video = draft.objects[1]; if (video.kind === 'media') video.outUs = 1e6; });
    expect(s.api.analyzeAsset).toHaveBeenCalledTimes(2);
    s.editor.commitPreview();
    expect(s.api.analyzeAsset).toHaveBeenCalledTimes(3);
    expect(s.state()[s.document.objects[1].id].frames?.[0].path).toBe('cache/old.jpg');
    await finish(s.pending[2], { frames: [{ path: 'cache/new.jpg', timeUs: 0 }] });
    expect(s.state()[s.document.objects[1].id].frames?.[0].path).toBe('cache/new.jpg');
    s.editor.execute(draft => { const audio = draft.objects[0]; if (audio.kind === 'media') { audio.inUs = 500_000; audio.pixelsPerSecond = 400; } });
    expect(s.api.analyzeAsset).toHaveBeenCalledTimes(3);
  });
  it('删除、重新关联与乱序响应不会污染剩余轨道', async () => {
    const s = setup(), originalId = s.document.objects[0].id;
    s.editor.execute(draft => { draft.assets[1].path = 'assets/relinked.mp4'; });
    expect(s.api.analyzeAsset).toHaveBeenCalledTimes(3);
    expect(s.api.cancelTask).toHaveBeenCalledTimes(1);
    await finish(s.pending[2], { frames: [{ path: 'cache/new.jpg', timeUs: 0 }] });
    await finish(s.pending[1], { frames: [{ path: 'cache/stale.jpg', timeUs: 0 }] });
    expect(s.state()[s.document.objects[1].id].frames?.[0].path).toBe('cache/new.jpg');
    s.editor.deleteObjects([originalId]);
    await finish(s.pending[0]);
    expect(s.state()[originalId]).toBeUndefined();
    expect(s.api.cancelTask).toHaveBeenCalledTimes(2);
  });
  it('只重试失败任务，项目关闭后的进度与结果不会回写', async () => {
    const s = setup();
    s.pending[0]({ ok: false, error: { code: 'TIMEOUT', message: '超时', retryable: true } });
    await Promise.resolve();
    await finish(s.pending[1]);
    s.controller.reconcile(s.editor.committedDocument, true);
    expect(s.api.analyzeAsset).toHaveBeenCalledTimes(3);
    const state = s.state();
    s.controller.dispose();
    s.controller.progress(s.api.analyzeAsset.mock.calls[2][0].taskId, 90);
    await finish(s.pending[2]);
    expect(s.state()).toBe(state);
  });
});

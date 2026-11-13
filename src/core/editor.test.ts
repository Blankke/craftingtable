import { describe, expect, it } from 'vitest';
import { Editor } from './editor';
import { newDocument, resolveAnchor } from './document';

describe('时间锚点与撤销', () => {
  it('显示比例与裁剪相互独立，裁剪外连接可恢复', () => {
    const document = newDocument('测试');
    const assetId = crypto.randomUUID();
    const mediaId = crypto.randomUUID();
    document.assets.push({ id: assetId, name: 'test.wav', path: 'assets/test.wav', kind: 'audio', status: 'ready', durationUs: 10_000_000 });
    document.objects.push({ id: mediaId, kind: 'media', assetId, x: 10, y: 20, width: 300, height: 80, groupId: null, inUs: 0, outUs: 10_000_000, pixelsPerSecond: 30 });
    const editor = new Editor(document);
    const textId = editor.annotate(mediaId, 5_000_000, { x: 400, y: 100 });
    const anchor = editor.document.connections[0].from;
    expect(resolveAnchor(editor.document, anchor)?.x).toBe(160);
    editor.execute(draft => { const media = draft.objects[0]; if (media.kind === 'media') media.pixelsPerSecond = 60; });
    expect(resolveAnchor(editor.document, anchor)?.x).toBe(310);
    editor.execute(draft => { const media = draft.objects[0]; if (media.kind === 'media') media.inUs = 6_000_000; });
    expect(resolveAnchor(editor.document, anchor)).toBeNull();
    editor.undo();
    expect(resolveAnchor(editor.document, anchor)?.x).toBe(310);
    editor.deleteObjects([textId]);
    expect(editor.document.markers).toHaveLength(1);
    expect(editor.document.connections).toHaveLength(0);
    editor.undo();
    expect(editor.document.connections).toHaveLength(1);
  });
});

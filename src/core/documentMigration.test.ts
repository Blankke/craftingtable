// 用法：npm.cmd exec -- vitest run src/core/documentMigration.test.ts。验证历史项目升级为当前唯一格式。
import { describe, expect, it } from 'vitest';
import { newDocument, readProjectDocument } from './document';

const legacyNote = (id = crypto.randomUUID()) => ({
  id, name: '正文',
  typography: { fontFamily: 'Georgia', fontSize: 17, lineHeight: 2, marginX: 72, marginY: 56, ruledSpacing: 34 },
  blocks: [{ kind: 'text' as const, text: '跨段正文', highlights: [], annotations: [] }]
});

describe('项目格式迁移', () => {
  it('无笔记的历史项目保留对象、素材、标记、连线和相机', () => {
    const source = newDocument('旧项目');
    const assetId = crypto.randomUUID(), objectId = crypto.randomUUID(), markerId = crypto.randomUUID();
    source.assets.push({ id: assetId, name: '音乐', path: 'assets/music.wav', kind: 'audio', status: 'ready' });
    source.objects.push({ id: objectId, kind: 'media', assetId, x: 10, y: 20, width: 100, height: 60, groupId: null, inUs: 0, outUs: 1_000_000, pixelsPerSecond: 100 });
    source.markers.push({ id: markerId, mediaId: objectId, timeUs: 500_000, note: '节点' });
    source.connections.push({ id: crypto.randomUUID(), from: { kind: 'time', markerId }, to: { kind: 'free', point: { x: 500, y: 300 } }, routing: 'elbow' });
    source.camera = { x: 12, y: 24, scale: 1.5 };
    const { notes: _notes, ...legacy } = { ...source, schemaVersion: 1 as const };
    const result = readProjectDocument(legacy);
    expect(result.migrated).toBe(true);
    expect(result.document).toMatchObject({ schemaVersion: 3, assets: source.assets, objects: source.objects, markers: source.markers, connections: source.connections, camera: source.camera, notes: [] });
  });

  it('带分块笔记的历史项目转为单一正文且保留缩略图关系', () => {
    const source = newDocument('已有笔记');
    const note = legacyNote();
    source.objects.push({ id: crypto.randomUUID(), kind: 'note', noteId: note.id, x: 0, y: 0, width: 200, height: 120, groupId: null });
    const document = readProjectDocument({ ...source, schemaVersion: 2, notes: [note] }).document;
    expect(document.notes[0].document.content[0]).toMatchObject({ type: 'paragraph' });
    expect(document.notes[0].document.content[0].content?.[0]).toMatchObject({ text: '跨段正文' });
    expect(document.objects[0]).toMatchObject({ kind: 'note', noteId: note.id });
  });

  it('无效关系拒绝迁移，未来格式拒绝降级', () => {
    const source = newDocument('错误');
    source.objects.push({ id: crypto.randomUUID(), kind: 'image', assetId: crypto.randomUUID(), x: 0, y: 0, width: 100, height: 100, groupId: null });
    expect(() => readProjectDocument({ ...source, schemaVersion: 1, notes: [] })).toThrow('对象素材不存在');
    expect(() => readProjectDocument({ ...source, schemaVersion: 4 })).toThrow('不支持的项目格式版本');
  });
});

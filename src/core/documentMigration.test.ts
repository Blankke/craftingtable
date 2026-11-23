// 用法：npm.cmd exec -- vitest run src/core/documentMigration.test.ts。验证历史项目升级为当前唯一格式。
import { describe, expect, it } from 'vitest';
import { newDocument, readProjectDocument } from './document';
import { canvasTextFromMarkdown, canvasTextPlainText } from './canvasText';

const legacyNote = (id = crypto.randomUUID()) => ({
  id, name: '正文',
  typography: { fontFamily: 'Georgia', fontSize: 17, lineHeight: 2, marginX: 72, marginY: 56, ruledSpacing: 34 },
  blocks: [{ kind: 'text' as const, text: '跨段正文', highlights: [], annotations: [] }]
});

describe('项目格式迁移', () => {
  it('纯文字画布升级为富文本，默认提示移出正文且形状与连接保持原样', () => {
    const source = newDocument('已有画布');
    const common = { x: 30, y: 40, width: 240, height: 90, groupId: null };
    const textId = crypto.randomUUID(), shapeId = crypto.randomUUID();
    const legacy = { ...source, schemaVersion: 3, objects: [
      { ...common, id: textId, kind: 'text', text: '双击编辑文字', fontSize: 18, color: '#222', align: 'left' },
      { ...common, id: shapeId, kind: 'rectangle', fill: 'transparent', stroke: '#222', text: '**已有原稿**\n第二行' }
    ], connections: [{ id: crypto.randomUUID(), from: { kind: 'object', objectId: textId }, to: { kind: 'object', objectId: shapeId }, routing: 'straight' }] };
    const { document, migrated } = readProjectDocument(legacy);
    expect(migrated).toBe(true);
    expect(document.objects[0]).toMatchObject({ ...common, text: { type: 'doc', content: [{ type: 'paragraph' }] } });
    const shape = document.objects[1];
    expect('text' in shape && canvasTextPlainText(shape.text)).toBe('**已有原稿**\n第二行');
    expect(document.connections).toEqual(legacy.connections);
    expect(readProjectDocument(document).migrated).toBe(false);
  });
  it('当前正文只接受结构化格式并保留 Markdown 转换后的样式', () => {
    const source = newDocument('富文本');
    source.objects.push({ id: crypto.randomUUID(), kind: 'text', x: 0, y: 0, width: 320, height: 90, groupId: null, fontSize: 18, color: '#222', align: 'left', text: canvasTextFromMarkdown('# 标题\n\n**内容**') });
    expect(readProjectDocument(source)).toEqual({ document: source, migrated: false });
    expect(() => readProjectDocument({ ...source, objects: [{ ...source.objects[0], text: '# 旧字段' }] })).toThrow();
  });
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
    expect(result.document).toMatchObject({ schemaVersion: 4, assets: source.assets, objects: source.objects, markers: source.markers, connections: source.connections, camera: source.camera, notes: [] });
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
    expect(() => readProjectDocument({ ...source, schemaVersion: 99 })).toThrow('不支持的项目格式版本');
  });
});

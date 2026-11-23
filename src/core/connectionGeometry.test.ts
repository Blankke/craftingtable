// 用法：npm.cmd run test:unit。验证连接几何、混合选区移动、复制及一次撤销。
import { describe, expect, it } from 'vitest';
import { newDocument, resolveAnchor, type CanvasObject } from './document';
import { connectionAnchorAt, connectionIntersectsRect, translatedSelection } from './connectionGeometry';
import { Editor } from './editor';
import { copyCanvasSelection, pasteCanvasSelection } from './canvasClipboard';

const shape = (): CanvasObject => ({ id: crypto.randomUUID(), kind: 'rectangle', x: 100, y: 100, width: 200, height: 100, fill: '#fff', stroke: '#333', groupId: null });
describe('附着点与混合选区', () => {
  it.each([.2, 1, 4])('缩放 %s 时磁吸保持屏幕半径并在离开后释放', scale => {
    const doc = newDocument('磁吸'); const object = shape(); doc.objects.push(object); doc.camera.scale = scale;
    const attached = connectionAnchorAt(doc, { x: 300 + 8 / scale, y: 150 });
    expect(attached).toEqual({ kind: 'object', objectId: object.id, port: 'e' });
    expect(connectionAnchorAt(doc, { x: 300 + 14 / scale, y: 150 }, attached)).toEqual(attached);
    expect(connectionAnchorAt(doc, { x: 300 + 18 / scale, y: 150 }, attached).kind).toBe('free');
  });
  it('图片、叠图、音频、文本和图形共用附着点，音频取实际时间宽度', () => {
    const base = shape(), assetId = crypto.randomUUID();
    const image = { ...base, kind: 'image' as const, assetId };
    const objects: CanvasObject[] = [base, image, { ...base, kind: 'imageStack', images: [image, { ...image, id: crypto.randomUUID() }] },
      { ...base, kind: 'media', assetId, inUs: 0, outUs: 5_000_000, pixelsPerSecond: 80 },
      { ...base, kind: 'text', text: { type: 'doc', content: [{ type: 'paragraph', content: [] }] }, fontSize: 18, color: '#333', align: 'left' }];
    for (const object of objects) {
      const doc = newDocument('附着点'); doc.objects.push(object);
      const x = object.kind === 'media' ? 500 : 300;
      const anchor = connectionAnchorAt(doc, { x, y: 150 });
      expect(anchor).toEqual({ kind: 'object', objectId: object.id, port: 'e' });
      expect(resolveAnchor(doc, anchor)).toEqual({ x, y: 150 });
    }
  });
  it('附着点在旋转、缩放对象后跟随，命中半径按屏幕计算', () => {
    const doc = newDocument('连接'); const object = shape(); object.rotation = 90; doc.objects.push(object); doc.camera.scale = .5;
    const anchor = connectionAnchorAt(doc, { x: 200, y: 260 });
    expect(anchor).toEqual({ kind: 'object', objectId: object.id, port: 'e' });
    object.width = 400;
    expect(resolveAnchor(doc, anchor)).toEqual({ x: 300, y: 350 });
  });
  it.each(['straight', 'elbow', 'curve'] as const)('%s 框选按路径相交判断，空白外接框不会误选', routing => {
    const doc = newDocument('连接'); const connection = { id: crypto.randomUUID(), routing, from: { kind: 'free' as const, point: { x: 0, y: 0 } }, to: { kind: 'free' as const, point: { x: 200, y: 100 } } };
    const hit = routing === 'elbow' ? { left: 90, right: 110, top: -5, bottom: 5 } : { left: 90, right: 110, top: 40, bottom: 60 };
    expect(connectionIntersectsRect(doc, connection, hit)).toBe(true);
    expect(connectionIntersectsRect(doc, connection, { left: 0, right: 10, top: 90, bottom: 100 })).toBe(false);
  });
  it('对象和连线一起移动时附着端不重复位移，另一端跟随，撤销恢复', () => {
    const doc = newDocument('连接'); const object = shape(); doc.objects.push(object);
    const connection = { id: crypto.randomUUID(), routing: 'straight' as const, from: { kind: 'object' as const, objectId: object.id, port: 'e' as const }, to: { kind: 'free' as const, point: { x: 500, y: 150 } } }; doc.connections.push(connection);
    const editor = new Editor(doc), preview = translatedSelection(editor.document, [object.id], [connection.id], { x: 30, y: 40 });
    editor.execute(draft => { draft.objects = preview.objects; draft.connections = preview.connections; });
    expect(resolveAnchor(editor.document, editor.document.connections[0].from)).toEqual({ x: 330, y: 190 });
    expect(editor.document.connections[0].to).toEqual({ kind: 'free', point: { x: 530, y: 190 } });
    expect(doc.objects[0].x).toBe(100);
    editor.undo(); expect(editor.document.objects).toEqual(doc.objects); expect(editor.document.connections).toEqual(doc.connections);
    const detached = translatedSelection(editor.document, [], [connection.id], { x: 20, y: 10 });
    expect(detached.connections[0].from).toEqual({ kind: 'free', point: { x: 320, y: 160 } });
  });
  it('混合复制保留所选对象的端点引用，混合删除只占一次历史', () => {
    const doc = newDocument('连接'); const a = shape(), b = shape(); b.x = 500; doc.objects.push(a, b);
    doc.connections.push({ id: crypto.randomUUID(), routing: 'straight', from: { kind: 'object', objectId: a.id, port: 'e' }, to: { kind: 'object', objectId: b.id, port: 'w' } });
    const editor = new Editor(doc), copy = copyCanvasSelection(editor, [a.id], [doc.connections[0].id]);
    const pasted = pasteCanvasSelection(editor, copy);
    expect(pasted.connections).toHaveLength(1);
    expect(editor.document.connections.at(-1)?.from).toMatchObject({ objectId: pasted.objects[0], port: 'e' });
    expect(editor.document.connections.at(-1)?.to.kind).toBe('free');
    editor.undo(); editor.deleteObjects([a.id], [doc.connections[0].id]);
    expect(editor.document.connections).toHaveLength(0); expect(editor.document.objects).toHaveLength(1);
    editor.undo(); expect(editor.document.objects).toEqual(doc.objects); expect(editor.document.connections).toEqual(doc.connections);
  });
});

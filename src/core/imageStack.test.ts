// 使用范例：npm.cmd exec -- vitest run src/core/imageStack.test.ts。
// 叠图需要保护原图身份、备注、裁剪与连线，验证收起/拆开和复制删除的真实数据关系。
import { describe, expect, it } from 'vitest';
import { Editor } from './editor';
import { documentSchema, newDocument, objectAssetIds, resolveAnchor, validateRelations, type CanvasObject } from './document';

function fixture() {
  const document = newDocument('叠图验收');
  const images: Extract<CanvasObject, { kind: 'image' }>[] = Array.from({ length: 3 }, (_, index) => {
    const assetId = crypto.randomUUID();
    document.assets.push({ id: assetId, name: `图片${index + 1}.png`, path: `assets/${index + 1}.png`, kind: 'image', status: 'ready' });
    return { id: crypto.randomUUID(), kind: 'image', assetId, x: 50 + index * 250, y: 80, width: 200, height: 120, groupId: null, caption: `第${index + 1}张备注`, crop: { x: .1, y: .1, width: .8, height: .8 } };
  });
  document.objects.push(...images);
  document.connections.push({ id: crypto.randomUUID(), from: { kind: 'object', objectId: images[0].id }, to: { kind: 'object', objectId: images[1].id }, routing: 'straight' });
  return { editor: new Editor(document), images };
}
describe('图片叠放', () => {
  it('收起与拆开保留图像、备注、裁剪和连接，并各自一次撤销', () => {
    const { editor, images } = fixture();
    const stackId = editor.stackImages(images.map(image => image.id));
    expect(editor.document.objects).toHaveLength(1);
    expect(editor.document.connections).toHaveLength(1);
    expect(resolveAnchor(editor.document, editor.document.connections[0].from)).not.toBeNull();
    expect(() => validateRelations(documentSchema.parse(JSON.parse(JSON.stringify(editor.document))))).not.toThrow();
    expect(objectAssetIds(editor.document.objects[0])).toEqual(images.map(image => image.assetId));
    editor.unstackImages(stackId);
    images.forEach((image, index) => expect(editor.document.objects[index]).toMatchObject(image));
    editor.undo(); expect(editor.document.objects[0].kind).toBe('imageStack');
    editor.undo(); expect(editor.document.objects).toEqual(images);
  });
  it('移动、缩放后的拆开以叠图当前位置恢复，图片备注独立', () => {
    const { editor, images } = fixture();
    const id = editor.stackImages(images.map(image => image.id));
    editor.execute(draft => { const stack = draft.objects[0]; if (stack.kind === 'imageStack') { stack.x += 40; stack.width *= 2; stack.height *= 2; stack.images[1].caption = '修改第二张'; } });
    editor.unstackImages(id);
    expect(editor.document.objects[0]).toMatchObject({ x: 90, width: 400, caption: '第1张备注' });
    expect(editor.document.objects[1]).toMatchObject({ x: 590, width: 400, caption: '修改第二张' });
  });
  it('复制重建内部身份，删除清理连接，收起状态保护素材引用', () => {
    const { editor, images } = fixture();
    const id = editor.stackImages(images.map(image => image.id));
    expect(() => editor.removeAsset(images[1].assetId)).toThrow('素材仍被画布对象引用');
    const [copyId] = editor.duplicateObjects([id]);
    const original = editor.document.objects[0], copy = editor.document.objects[1];
    if (original.kind !== 'imageStack' || copy.kind !== 'imageStack') throw Error('叠图丢失');
    expect(copy.images[0].id).not.toBe(original.images[0].id);
    expect(copy.images.map(image => image.caption)).toEqual(original.images.map(image => image.caption));
    expect(editor.document.connections).toHaveLength(2);
    editor.deleteObjects([id]); expect(editor.document.objects[0].id).toBe(copyId); expect(editor.document.connections).toHaveLength(1);
    editor.deleteObjects([copyId]); expect(editor.document.connections).toHaveLength(0);
  });
  it('叠图可继续合并单图，一次撤销恢复原容器，拆开保留变换和备注', () => {
    const { editor, images } = fixture();
    const first = editor.stackImages(images.slice(0, 2).map(image => image.id));
    editor.execute(draft => {
      const stack = draft.objects[0]; stack.x += 40; stack.width *= 2; stack.height *= 2; stack.rotation = 90;
      draft.connections.push({ id: crypto.randomUUID(), from: { kind: 'object', objectId: first }, to: { kind: 'object', objectId: images[2].id }, routing: 'straight' });
    });
    const before = structuredClone(editor.document);
    const merged = editor.stackImages([first, images[2].id]);
    const stack = editor.document.objects[0];
    if (stack.kind !== 'imageStack') throw Error('叠图丢失');
    expect(stack.images.map(image => image.id)).toEqual(images.map(image => image.id));
    expect(editor.document.connections[1].from).toMatchObject({ objectId: images[0].id });
    editor.undo();
    expect(editor.document.objects).toEqual(before.objects);
    expect(editor.document.connections).toEqual(before.connections);
    editor.redo(); editor.unstackImages(merged);
    expect(editor.document.objects[0]).toMatchObject({ x: 90, y: 80, width: 400, height: 240, rotation: 90, caption: images[0].caption, crop: images[0].crop });
    expect(editor.document.objects[1].x).toBeCloseTo(90);
    expect(editor.document.objects[1]).toMatchObject({ y: 580, width: 400, height: 240, rotation: 90, caption: images[1].caption });
    expect(editor.document.objects[2]).toMatchObject(images[2]);
  });
  it('两个叠图合并为同一层图片，保留素材和连接并能一次撤销', () => {
    const { editor, images } = fixture();
    const [fourth] = editor.duplicateObjects([images[2].id]);
    const first = editor.stackImages(images.slice(0, 2).map(image => image.id));
    const second = editor.stackImages([images[2].id, fourth]);
    editor.execute(draft => { draft.connections.push({ id: crypto.randomUUID(), from: { kind: 'object', objectId: first }, to: { kind: 'object', objectId: second }, routing: 'straight' }); });
    const before = structuredClone(editor.document);
    editor.stackImages([first, second]);
    expect(editor.document.objects).toHaveLength(1);
    const stack = editor.document.objects[0];
    if (stack.kind !== 'imageStack') throw Error('叠图丢失');
    expect(stack.images.map(image => image.id)).toEqual([...images.map(image => image.id), fourth]);
    expect(stack.images.every(image => image.kind === 'image')).toBe(true);
    expect(() => validateRelations(documentSchema.parse(editor.document))).not.toThrow();
    editor.undo();
    expect(editor.document.objects).toEqual(before.objects);
    expect(editor.document.connections).toEqual(before.connections);
  });
  it('排序首图保留不同尺寸图片的世界几何、备注和连接，并支持撤销重做', () => {
    const { editor, images } = fixture();
    editor.execute(draft => { draft.objects[1].width = 340; draft.objects[1].height = 95; });
    const id = editor.stackImages(images.map(image => image.id));
    editor.execute(draft => { const stack = draft.objects[0]; stack.width *= 1.7; stack.height *= .8; stack.rotation = 37; stack.x += 40; });
    const before = editor.document;
    const expected = new Editor(before); expected.unstackImages(id);
    editor.reorderStackImage(id, images[0].id, images[2].id);
    const sorted = editor.document.objects[0];
    if (sorted.kind !== 'imageStack') throw Error('叠图丢失');
    expect(sorted.images.map(image => image.id)).toEqual([images[1].id, images[2].id, images[0].id]);
    expect(sorted.images[2].caption).toBe(images[0].caption);
    expect(editor.document.connections).toEqual(before.connections);
    editor.undo(); expect(editor.document.objects).toEqual(before.objects);
    editor.redo(); editor.unstackImages(id);
    for (const actual of editor.document.objects) {
      const previous = expected.document.objects.find(image => image.id === actual.id)!;
      for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) expect(actual[key]).toBeCloseTo(previous[key]!);
    }
  });
  it('锁定、同位和无效身份排序不产生历史', () => {
    const { editor, images } = fixture();
    const id = editor.stackImages(images.map(image => image.id));
    const before = editor.document;
    editor.reorderStackImage(id, images[0].id, images[0].id);
    editor.reorderStackImage(id, 'missing', images[0].id);
    expect(editor.document).toBe(before);
    editor.execute(draft => { draft.objects[0].locked = true; });
    const locked = editor.document;
    editor.reorderStackImage(id, images[0].id, images[1].id);
    expect(editor.document).toBe(locked);
    editor.undo(); expect(editor.document.objects[0].locked).toBeUndefined();
  });

});

// 用法：npm.cmd exec -- vitest run src/core/appearance.test.ts。验证图片几何与标记关系的持久化契约。
import { describe, expect, it } from 'vitest';
import { lockStandardShape, resizeObject, restoredImageRatio, styleOf } from './appearance';
import { documentSchema, newDocument, shapeKinds, type CanvasObject } from './document';
import { Editor } from './editor';
import { hasShapeGeometry, shapeGroups, shapePath, standardShapeRatio } from './shapeGeometry';
import { shapeLabels } from './appearance';

describe('图片、样式与显式标记', () => {
  it('标准比例锁恢复规则图形，宽高输入和撤销保存保持一致', () => {
    for (const kind of shapeKinds) {
      const document = newDocument('比例锁');
      document.objects.push({ id: crypto.randomUUID(), kind, x: 30, y: 40, width: 300, height: 120, groupId: null, fill: '#fff', stroke: '#000' });
      const editor = new Editor(document);
      editor.execute(draft => lockStandardShape(draft.objects[0], true));
      const locked = editor.document.objects[0];
      expect(locked.x + locked.width / 2).toBeCloseTo(180);
      expect(locked.width / locked.height).toBeCloseTo(standardShapeRatio(kind));
      editor.preview(draft => resizeObject(draft.objects[0], 220, 120)); editor.commitPreview();
      expect(editor.document.objects[0].width / editor.document.objects[0].height).toBeCloseTo(standardShapeRatio(kind));
      expect(documentSchema.parse(JSON.parse(JSON.stringify(editor.document)))).toEqual(editor.document);
      editor.undo(); expect(editor.document.objects[0].height).toBe(120);
      editor.execute(draft => { lockStandardShape(draft.objects[0], false); resizeObject(draft.objects[0], 240, 120); });
      expect(editor.document.objects[0].width / editor.document.objects[0].height).toBe(2);
    }
  });
  it('锁定的五角星外顶点落在同一个圆上，三角形与六边形使用真实外接框比例', () => {
    expect(standardShapeRatio('triangle')).toBeCloseTo(2 / Math.sqrt(3));
    expect(standardShapeRatio('hexagon')).toBeCloseTo(2 / Math.sqrt(3));
    const points = [...shapePath('star')!.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map(match => ({ x: Number(match[1]) * standardShapeRatio('star'), y: Number(match[2]) }));
    const center = { x: 50 * standardShapeRatio('star'), y: 100 / (1 + Math.cos(Math.PI / 5)) };
    const distances = points.filter((_, index) => index % 2 === 0).map(point => Math.hypot(point.x - center.x, point.y - center.y));
    for (const distance of distances) expect(distance).toBeCloseTo(distances[0], 5);
  });
  const image = (): Extract<CanvasObject, { kind: 'image' }> => ({ id: crypto.randomUUID(), kind: 'image', assetId: crypto.randomUUID(), x: 0, y: 0, width: 400, height: 200, aspectLocked: true, groupId: null });
  it('锁定比例时宽高输入和手柄缩放使用同一比例，解锁后独立改变', () => {
    const object = image();
    resizeObject(object, 600, 500); expect([object.width, object.height]).toEqual([600, 300]);
    resizeObject(object, 600, 150, 'height'); expect([object.width, object.height]).toEqual([300, 150]);
    object.aspectLocked = false; resizeObject(object, 600, 500); expect([object.width, object.height]).toEqual([600, 500]);
  });
  it('所有基本形状的样式、文本和图片裁剪能完整往返保存，越界裁剪被拒绝', () => {
    const document = newDocument('属性');
    for (const kind of shapeKinds) {
      const object: CanvasObject = { id: crypto.randomUUID(), kind, x: 0, y: 0, width: 100, height: 60, groupId: null, fill: '#fff', stroke: '#000', text: '中文' };
      object.style = { ...styleOf(object), gradient: true, opacity: .4, dash: 'dashed' }; document.objects.push(object);
    }
    const object = image(); object.crop = { x: .1, y: .2, width: .7, height: .6 }; document.objects.push(object);
    expect(documentSchema.parse(JSON.parse(JSON.stringify(document)))).toEqual(document);
    object.crop.width = 1; expect(documentSchema.safeParse(document).success).toBe(false);
  });
  it('还原图片比例：无裁剪用自然尺寸，有裁剪按可见区域，保持高度不变', () => {
    expect(restoredImageRatio(undefined, 400, 200)).toBe(2);
    expect(restoredImageRatio({ width: .5, height: .25 }, 400, 200)).toBe(4);
    // 高度 150 时还原比例重算宽度：150 * 4 = 600。
    expect(150 * restoredImageRatio({ width: .5, height: .25 }, 400, 200)).toBe(600);
  });
  it('四类图库完整覆盖每个可保存图形，且不存在退化为方块的预览定义', () => {
    const grouped = Object.values(shapeGroups).flat();
    expect(new Set(grouped)).toEqual(new Set(shapeKinds));
    expect(new Set(grouped).size).toBe(shapeKinds.length);
    for (const kind of shapeKinds) {
      expect(shapeLabels).toHaveProperty(kind);
      expect(hasShapeGeometry(kind)).toBe(true);
    }
  });
  it('笔记只引用已有标记；撤销笔记保留标记，取消预览不改修订号', () => {
    const document = newDocument('标记'), assetId = crypto.randomUUID(), mediaId = crypto.randomUUID();
    document.assets.push({ id: assetId, kind: 'audio', name: 'a.wav', path: 'assets/a.wav', status: 'ready' });
    document.objects.push({ id: mediaId, kind: 'media', assetId, x: 0, y: 0, width: 100, height: 90, groupId: null, inUs: 0, outUs: 10e6, pixelsPerSecond: 30 });
    const editor = new Editor(document);
    expect(() => editor.annotateMarker(crypto.randomUUID(), { x: 100, y: 100 })).toThrow('请先选择');
    const markerId = editor.addMarker(mediaId, 2e6);
    editor.annotateMarker(markerId, { x: 300, y: 100 });
    expect(editor.document.markers).toHaveLength(1);
    expect(editor.document.connections[0].from).toEqual({ kind: 'time', markerId });
    editor.undo(); expect(editor.document.objects).toHaveLength(1); expect(editor.document.markers).toHaveLength(1);
    const revision = editor.document.revision;
    editor.preview(draft => { draft.objects[0].x = 200; }); editor.cancelPreview();
    expect(editor.document.objects[0].x).toBe(0); expect(editor.document.revision).toBe(revision);
  });
});

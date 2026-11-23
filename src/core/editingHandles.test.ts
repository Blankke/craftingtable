// 使用范例：npm.cmd exec -- vitest run src/core/editingHandles.test.ts。
// 验证四角缩放固定对角、旋转吸附和撤销边界，避免只测试绘制属性。
import { describe, it, expect } from 'vitest';
import { resizeFromCorner } from './appearance';
import { connectionAnchorAt } from './connectionGeometry';
import { newDocument, type CanvasObject } from './document';
import { Editor } from './editor';

const rectangle = (): CanvasObject => ({ id: crypto.randomUUID(), kind: 'rectangle', x: 100, y: 70, width: 240, height: 120, rotation: 37, groupId: null, fill: '#fff', stroke: '#123456' });
function cornerPoint(object: CanvasObject, x: number, y: number) {
  const angle = (object.rotation ?? 0) * Math.PI / 180, dx = (x - .5) * object.width, dy = (y - .5) * object.height;
  return { x: object.x + object.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle), y: object.y + object.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle) };
}
describe('画布手柄', () => {
  it('四角缩放及比例锁始终固定对角的世界坐标', () => {
    for (const corner of ['nw', 'ne', 'sw', 'se'] as const) for (const aspectLocked of [true, false]) {
      const object = { ...rectangle(), aspectLocked };
      const x = corner.includes('w') ? 1 : 0, y = corner.includes('n') ? 1 : 0;
      const fixed = cornerPoint(object, x, y), resized = resizeFromCorner(object, corner, 60, -30), after = cornerPoint(resized, x, y);
      expect(after.x).toBeCloseTo(fixed.x); expect(after.y).toBeCloseTo(fixed.y);
      expect(resized.width).toBeGreaterThanOrEqual(12); expect(resized.height).toBeGreaterThanOrEqual(12);
      if (aspectLocked) expect(resized.width / resized.height).toBe(1);
      expect(object.width).toBe(240);
    }
  });
  it('端点吸附顶层旋转对象及显式连接点，空白区域保持自由端点', () => {
    const document = newDocument('端点'), object = rectangle(); document.objects.push(object);
    expect(connectionAnchorAt(document, { x: 220, y: 130 })).toEqual({ kind: 'object', objectId: object.id });
    object.connectionPoints = [{ id: crypto.randomUUID(), x: 1, y: 0 }];
    expect(connectionAnchorAt(document, cornerPoint(object, 1, 0))).toEqual({ kind: 'object', objectId: object.id, pointId: object.connectionPoints[0].id });
    const point = { x: -200, y: -300 }; expect(connectionAnchorAt(document, point)).toEqual({ kind: 'free', point });
  });
  it('空预览不吞掉实际提交；端点多次预览只需一次撤销', () => {
    const document = newDocument('撤销'), object = rectangle(); document.objects.push(object);
    document.connections.push({ id: crypto.randomUUID(), from: { kind: 'object', objectId: object.id }, to: { kind: 'free', point: { x: 500, y: 500 } }, routing: 'straight' });
    const editor = new Editor(document), before = editor.document.connections;
    editor.preview(draft => { draft.connections[0].from = { kind: 'free', point: { x: 20, y: 30 } }; });
    editor.preview(draft => { draft.connections[0].from = { kind: 'free', point: { x: 40, y: 50 } }; });
    editor.commitPreview(); editor.preview(() => undefined); editor.undo();
    expect(editor.document.connections).toEqual(before);
    editor.redo(); expect(editor.document.connections[0].from).toEqual({ kind: 'free', point: { x: 40, y: 50 } });
  });
});

// 用法：npm.cmd run test:unit -- src/core/shapeAdjustments.test.ts。检查调节点限幅、路径、保存和撤销。
import { describe, expect, it } from 'vitest';
import { adjustedShape, shapeAdjustmentHandles, shapePath, shapeRadius } from './shapeGeometry';
import { documentSchema, newDocument, readProjectDocument } from './document';
import { Editor } from './editor';

describe('可调整形状与书写方向', () => {
  const base = { width: 200, height: 100 };
  it('历史结构化正文格式统一升级并保留对象', () => {
    const source = { ...newDocument('历史项目'), schemaVersion: 4 };
    const result = readProjectDocument(source);
    expect(result.migrated).toBe(true);
    expect(result.document).toEqual({ ...source, schemaVersion: 5 });
  });
  it('圆角随最短边缩放，调节点与几何一致', () => {
    const object = { ...base, kind: 'roundedRectangle' };
    expect(shapeRadius(object)).toBe(15);
    const adjustments = adjustedShape(object, 'radius', { x: 100, y: 0 });
    expect(adjustments.radius).toBe(.5);
    expect(shapeAdjustmentHandles({ ...object, adjustments })[0].x).toBe(50);
  });
  it.each(['callout', 'speech'])('%s 引出角可移动到四边且进入正文时收起', kind => {
    for (const [x, y] of [[-50, 40], [250, 40], [100, -50], [100, 150]]) {
      const a = adjustedShape({ ...base, kind }, 'tail', { x, y });
      expect(shapePath(kind, a)).toContain(`L${x / 2} ${y}`);
    }
    expect(shapePath(kind, { tailX: .5, tailY: .4 })).not.toContain('L');
  });
  it.each(['rightArrow', 'leftArrow', 'upArrow', 'downArrow'])('%s 调节点往返保持同一参数', kind => {
    const object = { ...base, kind, adjustments: { head: .3, shaft: .4 } };
    for (const handle of shapeAdjustmentHandles(object)) {
      const adjusted = adjustedShape(object, handle.id, handle);
      expect(adjusted.head).toBeCloseTo(object.adjustments.head, 12);
      expect(adjusted.shaft).toBeCloseTo(object.adjustments.shaft, 12);
    }
    expect(shapePath(kind, object.adjustments)).not.toContain('NaN');
  });
  it('形状参数、文字方向存盘并单次撤销', () => {
    const doc = newDocument('参数');
    doc.objects.push({ ...base, kind: 'roundedRectangle', id: crypto.randomUUID(), groupId: null, x: 0, y: 0, fill: '#fff', stroke: '#000' });
    const editor = new Editor(doc);
    editor.preview(draft => { const object = draft.objects[0]; if ('fill' in object) { object.adjustments = { radius: .3 }; object.writingMode = 'vertical-rl'; } });
    editor.commitPreview();
    expect(documentSchema.parse(JSON.parse(JSON.stringify(editor.document))).objects[0]).toMatchObject({ adjustments: { radius: .3 }, writingMode: 'vertical-rl' });
    editor.undo(); expect(editor.document.objects).toEqual(doc.objects);
  });
});

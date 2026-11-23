// 用法：npm.cmd run test:unit -- src/core/canvasTransform.test.ts。验证统一虚影、附着跟随及异步数据隔离。
import { describe, expect, it } from 'vitest';
import { newDocument, type CanvasObject } from './document';
import { translatedSelection, connectionPoints } from './connectionGeometry';
import { applyCanvasTransform, transformGhosts } from './canvasTransform';
import { resizeFromCorner, styleOf } from './appearance';
import { Editor } from './editor';

function fixture() {
  const document = newDocument('统一虚影');
  const object: CanvasObject = { id: crypto.randomUUID(), kind: 'rectangle', x: 100, y: 100, width: 200, height: 100, groupId: null, fill: '#fff', stroke: '#333' };
  document.objects.push(object);
  document.connections.push({ id: crypto.randomUUID(), routing: 'straight', from: { kind: 'object', objectId: object.id, port: 'e' }, to: { kind: 'free', point: { x: 500, y: 150 } } },
    { id: crypto.randomUUID(), routing: 'elbow', from: { kind: 'free', point: { x: 100, y: 350 } }, to: { kind: 'free', point: { x: 400, y: 350 } } });
  return document;
}

describe('对象与箭头的统一变换预览', () => {
  it.each(['对象', '箭头', '混合'] as const)('%s 拖动保留原件、按相同位移生成虚影，一次提交与撤销', mode => {
    const editor = new Editor(fixture()), source = editor.document;
    const ids = mode === '箭头' ? [] : [source.objects[0].id];
    const connections = mode === '对象' ? [] : [source.connections[1].id];
    const preview = { source, document: translatedSelection(source, ids, connections, { x: 30, y: 20 }) };
    const ghosts = transformGhosts(preview);
    expect(ghosts.objects).toHaveLength(ids.length);
    expect(ghosts.connections).toHaveLength(mode === '混合' ? 2 : 1);
    expect(editor.document).toBe(source); expect(editor.canUndo).toBe(false);
    if (ids.length) expect(connectionPoints(preview.document, ghosts.connections[0])).toEqual([330, 170, 500, 150]);
    editor.execute(draft => applyCanvasTransform(draft, preview));
    expect(editor.document.objects[0].x).toBe(ids.length ? 130 : 100);
    expect(source.objects[0].x).toBe(100);
    editor.undo(); expect(editor.document).toEqual({ ...source, revision: 2 }); expect(editor.canUndo).toBe(false);
  });
  it('移动/缩放提交保留手势期间的异步更新，缩放附着连线同步预览', () => {
    const editor = new Editor(fixture()), source = editor.document;
    const resized = resizeFromCorner(source.objects[0], 'se', 50, 40);
    const preview = { source, document: { ...source, objects: [resized] } };
    expect(connectionPoints(preview.document, transformGhosts(preview).connections[0])).toEqual([350, 170, 500, 150]);
    editor.execute(draft => { draft.objects[0].style = { ...styleOf(draft.objects[0]), opacity: .6 }; draft.connections[0].style = { label: '异步更新' }; });
    editor.execute(draft => applyCanvasTransform(draft, preview));
    expect(editor.document.objects[0]).toMatchObject({ width: 250, height: 140, style: { opacity: .6 } });
    expect(editor.document.connections[0].style?.label).toBe('异步更新');
    editor.undo(); expect(editor.document.objects[0]).toMatchObject({ width: 200, style: { opacity: .6 } });
  });
});

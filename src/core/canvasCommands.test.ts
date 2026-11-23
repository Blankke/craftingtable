// 使用范例：npm.cmd exec -- vitest run src/core/canvasCommands.test.ts。
// 覆盖右键与快捷键共用的层级、锁定、复制快照和跨笔记移动，确保一次操作可完整撤销。
import { describe, expect, it } from 'vitest';
import { newDocument, resolveAnchor, type CanvasObject } from './document';
import { Editor } from './editor';
import { canvasTextFromPlainText, canvasTextPlainText } from './canvasText';
import { copyCanvasSelection, pasteCanvasSelection } from './canvasClipboard';
import { newNote } from './note';
function fixture() {
  const document = newDocument('菜单');
  document.objects = Array.from({ length: 4 }, (_, i): CanvasObject => ({ id: crypto.randomUUID(), kind: 'text', x: i * 200, y: 30, width: 160, height: 60, groupId: null, text: canvasTextFromPlainText(`第${i}项`), fontSize: 18, color: '#000', align: 'left' }));
  return { editor: new Editor(document), ids: document.objects.map(object => object.id) };
}
describe('画布菜单命令', () => {
  it('多选上下移动一层保持内部顺序，并能一次撤销', () => {
    const { editor, ids } = fixture();
    editor.reorderObjects(ids.slice(1, 3), 'forward'); expect(editor.document.objects.map(object => object.id)).toEqual([ids[0], ids[3], ids[1], ids[2]]);
    editor.undo(); expect(editor.document.objects.map(object => object.id)).toEqual(ids);
    editor.reorderObjects(ids.slice(1, 3), 'backward'); expect(editor.document.objects.map(object => object.id)).toEqual([ids[1], ids[2], ids[0], ids[3]]);
    editor.reorderObjects(ids.slice(1, 3), 'front'); expect(editor.document.objects.map(object => object.id)).toEqual([ids[0], ids[3], ids[1], ids[2]]);
  });
  it('组合锁定后拒绝移动、删除和层级变更，解锁后可编辑', () => {
    const { editor, ids } = fixture(); editor.group(ids.slice(0, 2)); editor.setLocked([ids[0]], true);
    const before = structuredClone(editor.document);
    editor.moveObjects([ids[0]], 50, 30); editor.deleteObjects([ids[0]]); editor.reorderObjects([ids[0]], 'front');
    expect(editor.document).toEqual(before);
    editor.setLocked([ids[0]], false); editor.moveObjects([ids[0]], 50, 30);
    expect(editor.document.objects.slice(0, 2).map(object => object.x)).toEqual([50, 250]);
  });
  it('复制保存当时的内容，剪切后可粘贴完整组合并重建身份', () => {
    const { editor, ids } = fixture(); editor.group(ids.slice(0, 2));
    const snapshot = copyCanvasSelection(editor, [ids[0]]);
    editor.execute(draft => { const object = draft.objects[0]; if (object.kind === 'text') object.text = canvasTextFromPlainText('随后修改'); });
    editor.deleteObjects([ids[0]]);
    const pasted = pasteCanvasSelection(editor, snapshot).objects;
    expect(pasted).toHaveLength(2); expect(pasted.every(id => !ids.includes(id))).toBe(true);
    const copy = editor.document.objects.find(object => object.id === pasted[0])!;
    expect(copy.kind === 'text' && canvasTextPlainText(copy.text)).toBe('第0项');
    expect(copy.groupId).not.toBe(snapshot.objects[0].groupId);
    editor.undo(); expect(editor.document.objects).toHaveLength(2);
  });
  it('画布对象格式统一切换并支持撤销', () => {
    const { editor, ids } = fixture(); editor.formatObjects(ids.slice(0, 2), 'bold');
    expect(editor.document.objects.slice(0, 2).every(object => object.style?.bold)).toBe(true);
    editor.formatObjects(ids.slice(0, 2), 'bold'); expect(editor.document.objects.slice(0, 2).every(object => !object.style?.bold)).toBe(true);
    editor.undo(); expect(editor.document.objects.slice(0, 2).every(object => object.style?.bold)).toBe(true);
  });
  it('对象复制不带走无关自由连线，单独复制连线可在剪切后恢复', () => {
    const { editor, ids } = fixture();
    const lineId = crypto.randomUUID(), freeId = crypto.randomUUID();
    editor.execute(draft => { draft.connections.push({ id: lineId, from: { kind: 'object', objectId: ids[0] }, to: { kind: 'object', objectId: ids[1] }, routing: 'elbow' }, { id: freeId, from: { kind: 'free', point: { x: 20, y: 20 } }, to: { kind: 'free', point: { x: 30, y: 40 } }, routing: 'straight' }); });
    expect(copyCanvasSelection(editor, ids.slice(0, 2)).connections.map(item => item.id)).toEqual([lineId]);
    const snapshot = copyCanvasSelection(editor, [], [lineId]);
    expect(snapshot.objects).toHaveLength(0); expect(snapshot.connections[0].from.kind).toBe('free');
    editor.deleteConnections([lineId]);
    const copied = pasteCanvasSelection(editor, snapshot);
    expect(copied.objects).toHaveLength(0); expect(copied.connections).toHaveLength(1);
    expect(editor.document.connections.at(-1)?.routing).toBe('elbow');
    editor.undo(); expect(editor.document.connections.map(item => item.id)).toEqual([freeId]);
  });
  it('空形状也能设置格式，自定义连接点随旋转与位置更新', () => {
    const { editor, ids } = fixture(), pointId = crypto.randomUUID();
    editor.execute(draft => { draft.objects[0] = { id: ids[0], kind: 'rectangle', x: 100, y: 100, width: 100, height: 100, fill: '#fff', stroke: '#000', groupId: null, rotation: 90, connectionPoints: [{ id: pointId, x: 1, y: .5 }] }; });
    editor.formatObjects([ids[0]], 'bold'); expect(editor.document.objects[0].style?.bold).toBe(true);
    expect(resolveAnchor(editor.document, { kind: 'object', objectId: ids[0], pointId })).toEqual({ x: 150, y: 200 });
    editor.moveObjects([ids[0]], 10, 30);
    expect(resolveAnchor(editor.document, { kind: 'object', objectId: ids[0], pointId })).toEqual({ x: 160, y: 230 });
  });
  it('所选笔记内容与批注一次移入另一篇，撤销同时恢复两篇', () => {
    const document = newDocument('笔记移动'), source = newNote('来源'), target = newNote('目标');
    const id = crypto.randomUUID(); source.annotations = [{ id, note: '现场描述', color: '#efc969' }];
    source.document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '采访', marks: [{ type: 'noteAnnotation', attrs: { id } }] }] }] };
    document.notes.push(source, target); const editor = new Editor(document);
    editor.moveNoteSelection(source.id, target.id, canvasTextFromPlainText(''), source.document);
    expect(canvasTextPlainText(editor.document.notes[0].document)).toBe('');
    expect(canvasTextPlainText(editor.document.notes[1].document)).toContain('采访');
    expect(editor.document.notes[1].annotations[0].id).not.toBe(id);
    editor.undo(); expect(editor.document.notes).toEqual(document.notes);
  });
});

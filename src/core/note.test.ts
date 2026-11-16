// 用法：npm.cmd exec -- vitest run src/core/note.test.ts。验证结构化笔记正文、素材引用和批注锚点。
import { describe, expect, it } from 'vitest';
import { newNote, noteAnnotationIds, noteAssetIds, noteSchema, noteText } from './note';
import { Editor } from './editor';
import { newDocument, documentSchema } from './document';

describe('笔记模型与命令', () => {
  it('新笔记提供单一空 Tiptap 文档，且能通过 schema 校验', () => {
    const note = newNote('随笔');
    expect(note.typography).toMatchObject({ fontSize: 17, lineHeight: 2, marginX: 72 });
    expect(note.document).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [] }] });
    expect(() => noteSchema.parse(note)).not.toThrow();
  });
  it('文档包含笔记并能完整往返保存', () => {
    const document = newDocument('笔记项目');
    document.notes.push(newNote('第一篇'));
    document.objects.push({ id: crypto.randomUUID(), kind: 'note', noteId: document.notes[0].id, x: 0, y: 0, width: 180, height: 120, groupId: null });
    expect(documentSchema.parse(JSON.parse(JSON.stringify(document)))).toEqual(document);
  });
  it('创建、更新、放置与删除笔记可撤销，删除笔记同时删除缩略图对象', () => {
    const editor = new Editor(newDocument('笔记'));
    const noteId = editor.createNote('随记');
    editor.updateNote(noteId, note => { note.document.content = [{ type: 'paragraph', content: [{ type: 'text', text: '正文' }] }]; });
    expect(noteText(editor.document.notes[0])).toBe('正文');
    const objectId = editor.addNoteObject(noteId, { x: 50, y: 60 });
    expect(editor.document.objects[0]).toMatchObject({ kind: 'note', noteId, id: objectId });
    editor.deleteNote(noteId);
    expect(editor.document.notes).toHaveLength(0);
    editor.undo();
    expect(editor.document.notes).toHaveLength(1);
  });
  it('引用不存在笔记的对象会被校验拒绝', () => {
    const document = newDocument('校验');
    document.objects.push({ id: crypto.randomUUID(), kind: 'note', noteId: crypto.randomUUID(), x: 0, y: 0, width: 100, height: 100, groupId: null });
    expect(() => new Editor(document)).toThrow('对象笔记不存在');
  });
  it('批注可跨段复用稳定 ID，删除 mark 后保留失效批注', () => {
    const editor = new Editor(newDocument('批注'));
    const id = editor.createNote('正文');
    const annotationId = crypto.randomUUID();
    editor.updateNote(id, note => {
      note.document.content = [
        { type: 'paragraph', content: [{ type: 'text', text: '第一段', marks: [{ type: 'noteAnnotation', attrs: { id: annotationId } }] }] },
        { type: 'paragraph', content: [{ type: 'text', text: '第二段', marks: [{ type: 'noteAnnotation', attrs: { id: annotationId } }] }] }
      ];
      note.annotations.push({ id: annotationId, note: '跨段说明', color: '#ffd97a' });
    });
    expect(noteAnnotationIds(editor.document.notes[0].document)).toEqual(new Set([annotationId]));
    editor.updateNote(id, note => { note.document.content = [{ type: 'paragraph', content: [{ type: 'text', text: '删除引用' }] }]; });
    expect(editor.document.notes[0].annotations[0]).toMatchObject({ id: annotationId, orphaned: true });
  });
  it('笔记图片引用项目素材，复制笔记时同步重写批注 ID 和 mark', () => {
    const editor = new Editor(newDocument('共享'));
    const assetId = crypto.randomUUID(), noteId = editor.createNote('随笔'), annotationId = crypto.randomUUID();
    editor.execute(draft => draft.assets.push({ id: assetId, name: '图', path: 'assets/a.png', kind: 'image', status: 'ready' }));
    editor.updateNote(noteId, note => {
      note.document.content = [{ type: 'paragraph', content: [{ type: 'text', text: '原文', marks: [{ type: 'noteAnnotation', attrs: { id: annotationId } }] }] }, { type: 'projectImage', attrs: { assetId, width: 320, align: 'center' } }];
      note.annotations.push({ id: annotationId, note: '说明', color: '#ffd97a' });
    });
    expect(noteAssetIds(editor.document.notes[0])).toEqual([assetId]);
    const copyId = editor.duplicateNote(noteId);
    const copy = editor.document.notes.find(note => note.id === copyId)!;
    expect(noteText(copy)).toBe('原文');
    expect(copy.annotations[0].id).not.toBe(annotationId);
    expect([...noteAnnotationIds(copy.document)][0]).toBe(copy.annotations[0].id);
  });
});

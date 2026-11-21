// 用法：npx vitest run src/ui/notes/NoteSearch.test.ts。验证跨格式查找位置与从后向前替换的正文完整性。
import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { findNoteMatches } from './NoteSearch';

const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'inline*', group: 'block' }, text: { group: 'inline' }, hardBreak: { inline: true, group: 'inline' } }, marks: { bold: {} } });
describe('笔记查找与替换', () => {
  it('跨格式查找保留位置，不跨段落合并文本', () => {
    const document = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('环境'), schema.text('声音', [schema.mark('bold')]), schema.text('测试')]), schema.node('paragraph', null, schema.text('声音'))]);
    expect(findNoteMatches(document, '环境声音')).toEqual([{ from: 1, to: 5 }]);
    expect(findNoteMatches(document, '测试声音')).toEqual([]);
    expect(findNoteMatches(document, '')).toEqual([]);
  });
  it('忽略英文大小写并正确处理 emoji 后面的字符位置', () => {
    const document = schema.node('doc', null, [schema.node('paragraph', null, schema.text('🎬 Mix MIX'))]);
    expect(findNoteMatches(document, 'mix')).toEqual([{ from: 4, to: 7 }, { from: 8, to: 11 }]);
  });
  it('大小写转换会变长的字符不影响后续位置，特殊符号按字面查找', () => {
    const document = schema.node('doc', null, [schema.node('paragraph', null, schema.text('İ MIX [音频]'))]);
    expect(findNoteMatches(document, 'mix')).toEqual([{ from: 3, to: 6 }]);
    expect(findNoteMatches(document, '[音频]')).toEqual([{ from: 7, to: 11 }]);
  });
  it('一次事务替换全部结果，不因替换长度变化破坏后续匹配', () => {
    const document = schema.node('doc', null, [schema.node('paragraph', null, schema.text('声音与声音'))]);
    const state = EditorState.create({ schema, doc: document });
    const transaction = state.tr;
    for (const range of findNoteMatches(document, '声音').reverse()) transaction.insertText('现场录音', range.from, range.to);
    expect(transaction.doc.textContent).toBe('现场录音与现场录音');
  });
});

// 使用范例：editor.view.dispatch(editor.state.tr.setMeta(noteSearchKey, { query, current: 0 }))。
// 查找装饰独立于正文，不会写入项目，也不会污染撤销历史。跨粗体、链接等 mark 的匹配仍保留正确位置。
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const noteSearchKey = new PluginKey<{ query: string; current: number }>('noteSearch');
export function findNoteMatches(document: Node, query: string): { from: number; to: number }[] {
  const matches: { from: number; to: number }[] = [];
  if (!query) return matches;
  const matcher = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  document.descendants((node, position) => {
    if (!node.isTextblock) return;
    const text = node.textBetween(0, node.content.size, '\n', '\uFFFC');
    for (const match of text.matchAll(matcher)) matches.push({ from: position + 1 + match.index, to: position + 1 + match.index + match[0].length });
    return false;
  });
  return matches;
}

export const NoteSearch = Extension.create({
  name: 'noteSearch',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: noteSearchKey,
      state: { init: () => ({ query: '', current: 0 }), apply: (transaction, value) => transaction.getMeta(noteSearchKey) ?? value },
      props: {
        decorations(state) {
          const search = noteSearchKey.getState(state)!;
          return DecorationSet.create(state.doc, findNoteMatches(state.doc, search.query).map((match, index) => Decoration.inline(match.from, match.to, { class: index === search.current ? 'note-search-match is-current' : 'note-search-match' })));
        }
      }
    })];
  }
});

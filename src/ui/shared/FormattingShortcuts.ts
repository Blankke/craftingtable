// 用法：加入 Tiptap extensions；笔记与画布使用相同格式键位，不拦截输入法组合输入。
import { Extension, type Editor } from '@tiptap/core';
import { canvasTextFromPlainText } from '../../core/canvasText';
import { AllSelection, TextSelection } from '@tiptap/pm/state';

export function toggleTextList(editor: Editor, type: 'bulletList' | 'orderedList' | 'taskList'): boolean {
  // 全选使用的 AllSelection 位于文档根节点，Tiptap 无法识别所在列表。
  // 转为正文范围，并排除自动追加的空段落，让再次执行真正解除列表。
  if (editor.state.selection instanceof AllSelection) {
    const doc = editor.state.doc, trailing = doc.lastChild;
    const end = doc.content.size - (doc.childCount > 1 && trailing?.type.name === 'paragraph' && !trailing.content.size ? trailing.nodeSize : 0);
    const selection = TextSelection.between(doc.resolve(0), doc.resolve(end));
    editor.view.dispatch(editor.state.tr.setSelection(selection));
  }
  return type === 'bulletList' ? editor.commands.toggleBulletList() : type === 'orderedList' ? editor.commands.toggleOrderedList() : editor.commands.toggleTaskList();
}
export async function pastePlainText(editor: Editor): Promise<void> {
  const selection = editor.state.selection.getBookmark(), source = await window.workbench!.readClipboardText();
  if (editor.isDestroyed || !editor.isEditable || !source) return;
  const range = selection.resolve(editor.state.doc); editor.commands.setTextSelection({ from: range.from, to: range.to });
  editor.chain().focus().insertContent(canvasTextFromPlainText(source).content).run();
}
export const FormattingShortcuts = Extension.create({
  name: 'workbenchFormattingShortcuts', priority: 1100,
  addKeyboardShortcuts() {
    const editor = this.editor;
    const size = (delta: number) => editor.chain().setFontSize(`${Math.max(8, Math.min(200, (parseFloat(editor.getAttributes('textStyle').fontSize) || 18) + delta))}px`).run();
    return {
      'Mod-b': () => editor.commands.toggleBold(), 'Mod-i': () => editor.commands.toggleItalic(), 'Mod-u': () => editor.commands.toggleUnderline(),
      'Mod-Shift-x': () => editor.commands.toggleStrike(), 'Mod-e': () => editor.commands.toggleCode(),
      'Mod-\\': () => editor.chain().unsetAllMarks().clearNodes().run(),
      'Mod-Shift-l': () => editor.commands.setTextAlign('left'), 'Mod-Shift-e': () => editor.commands.setTextAlign('center'), 'Mod-Shift-r': () => editor.commands.setTextAlign('right'), 'Mod-Shift-j': () => editor.commands.setTextAlign('justify'),
      'Mod-Shift-7': () => toggleTextList(editor, 'orderedList'), 'Mod-Shift-8': () => toggleTextList(editor, 'bulletList'), 'Mod-Shift-9': () => toggleTextList(editor, 'taskList'),
      'Mod-Alt-0': () => editor.commands.setParagraph(),
      ...Object.fromEntries(([1, 2, 3, 4, 5, 6] as const).map(level => [`Mod-Alt-${level}`, () => editor.commands.setHeading({ level })])),
      'Mod-Shift->': () => size(2), 'Mod-Shift-<': () => size(-2),
      'Mod-k': () => { editor.view.dom.dispatchEvent(new CustomEvent('workbench:edit-link')); return true; },
      'Mod-Shift-v': () => { void pastePlainText(editor); return true; }
    };
  }
});

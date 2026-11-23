// 用法：挂在 Tiptap 编辑器旁；菜单打开时保留选区，命令直接进入正文撤销历史，格式键位由 FormattingShortcuts 统一。
import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { SelectionBookmark } from '@tiptap/pm/state';
import { Bold, Italic, Underline, Strikethrough, Code, Eraser, Paintbrush, AlignLeft, AlignCenter, AlignRight, AlignJustify, List, ListOrdered, ListTodo, Quote, Code2, Heading, Pilcrow, Plus, Link2, ExternalLink, Search, Scissors, Copy, ClipboardPaste, ClipboardType, MousePointer2, Table2, ImagePlus, Minus, Undo2, Redo2, MessageSquare, FileInput } from 'lucide-react';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { CommandDialog } from './CommandDialog';
import { pastePlainText, toggleTextList } from './FormattingShortcuts';
import { useLanguage } from './language';
export function RichTextContextMenu({ editor, notes = [], onFind, onImage, onComment, onMove, readMode = false, host }: {
  editor: Editor | null; notes?: { id: string; name: string }[]; onFind?(text: string): void; onImage?(): void; onComment?(): void; onMove?(id: string): void; readMode?: boolean; host?: HTMLElement | null;
}) {
  const { t } = useLanguage();
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null), [link, setLink] = useState<string | null>(null);
  const selection = useRef<SelectionBookmark | null>(null);
  const restore = () => { if (!editor || editor.isDestroyed || !selection.current) return; try { const range = selection.current.resolve(editor.state.doc); editor.view.dispatch(editor.state.tr.setSelection(range)); } catch { /* 正文已被其他命令改变时使用当前有效选区。 */ } };
  useEffect(() => {
    if (!editor) return;
    const element = host ?? editor.view.dom;
    const show = (event: MouseEvent) => {
      if ((event.target as Element).closest('input,textarea') || !(event.target as Element).closest('.tiptap,.note-markdown-preview')) return;
      event.preventDefault(); event.stopPropagation(); selection.current = editor.state.selection.getBookmark(); setPosition({ x: event.clientX, y: event.clientY });
    };
    const keepSelection = (event: MouseEvent) => { if (event.button === 2 && !editor.state.selection.empty && (event.target as Element).closest('.tiptap')) event.preventDefault(); };
    const editLink = () => { selection.current = editor.state.selection.getBookmark(); setLink(editor.getAttributes('link').href ?? ''); };
    const key = (event: KeyboardEvent) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const box = editor.view.coordsAtPos(editor.state.selection.from); selection.current = editor.state.selection.getBookmark(); setPosition({ x: box.left, y: box.bottom }); } };
    element.addEventListener('contextmenu', show); element.addEventListener('mousedown', keepSelection); editor.view.dom.addEventListener('workbench:edit-link', editLink); editor.view.dom.addEventListener('keydown', key);
    return () => { element.removeEventListener('contextmenu', show); element.removeEventListener('mousedown', keepSelection); editor.view.dom.removeEventListener('workbench:edit-link', editLink); editor.view.dom.removeEventListener('keydown', key); };
  }, [editor, host, readMode]);
  if (!editor) return null;
  const editable = editor.isEditable && !readMode, selected = !editor.state.selection.empty;
  // 同步恢复正文焦点与选区，避免 Tiptap 的下一帧 focus 回写覆盖随后输入。
  const run = (command: () => unknown) => { restore(); editor.view.focus(); command(); };
  const clip = (command: 'copy' | 'cut' | 'paste') => { restore(); requestAnimationFrame(() => { if (editor.isDestroyed) return; if (!readMode) editor.view.focus(); void window.workbench!.clipboardCommand(command); }); };
  const text = readMode ? window.getSelection()?.toString() ?? '' : editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n');
  const marks: MenuItem[] = [
    { id: 'bold', label: t('粗体', 'Bold'), icon: <Bold/>, shortcut: 'Ctrl+B', checked: editor.isActive('bold'), run: () => run(() => editor.commands.toggleBold()) },
    { id: 'italic', label: t('斜体', 'Italic'), icon: <Italic/>, shortcut: 'Ctrl+I', checked: editor.isActive('italic'), run: () => run(() => editor.commands.toggleItalic()) },
    { id: 'underline', label: t('下划线', 'Underline'), icon: <Underline/>, shortcut: 'Ctrl+U', checked: editor.isActive('underline'), run: () => run(() => editor.commands.toggleUnderline()) },
    { id: 'strike', label: t('删除线', 'Strikethrough'), icon: <Strikethrough/>, shortcut: 'Ctrl+Shift+X', checked: editor.isActive('strike'), run: () => run(() => editor.commands.toggleStrike()) },
    { id: 'code', label: t('行内代码', 'Inline code'), icon: <Code/>, shortcut: 'Ctrl+E', checked: editor.isActive('code'), run: () => run(() => editor.commands.toggleCode()) },
    { id: 'clear', label: t('清除格式', 'Clear formatting'), icon: <Eraser/>, shortcut: 'Ctrl+\\', separator: true, run: () => run(() => editor.chain().unsetAllMarks().clearNodes().run()) }
  ];
  const paragraph: MenuItem[] = [
    { id: 'paragraph', label: t('正文', 'Paragraph'), icon: <Pilcrow/>, shortcut: 'Ctrl+Alt+0', checked: editor.isActive('paragraph'), run: () => run(() => editor.commands.setParagraph()) },
    ...([1, 2, 3, 4, 5, 6] as const).map(level => ({ id: `heading-${level}`, label: t(`标题 ${level}`, `Heading ${level}`), icon: <Heading/>, shortcut: `Ctrl+Alt+${level}`, checked: editor.isActive('heading', { level }), run: () => run(() => editor.commands.setHeading({ level })) })),
    ...([{ id: 'left', label: t('左对齐', 'Align left'), icon: <AlignLeft/>, key: 'L' }, { id: 'center', label: t('居中对齐', 'Align center'), icon: <AlignCenter/>, key: 'E' }, { id: 'right', label: t('右对齐', 'Align right'), icon: <AlignRight/>, key: 'R' }, { id: 'justify', label: t('两端对齐', 'Justify'), icon: <AlignJustify/>, key: 'J' }]).map((item, index) => ({ ...item, separator: index === 0, shortcut: `Ctrl+Shift+${item.key}`, checked: editor.isActive({ textAlign: item.id }), run: () => run(() => editor.commands.setTextAlign(item.id)) })),
    { id: 'bullets', label: t('无序列表', 'Bullet list'), icon: <List/>, shortcut: 'Ctrl+Shift+8', separator: true, run: () => run(() => toggleTextList(editor, 'bulletList')) },
    { id: 'numbers', label: t('有序列表', 'Numbered list'), icon: <ListOrdered/>, shortcut: 'Ctrl+Shift+7', run: () => run(() => toggleTextList(editor, 'orderedList')) },
    { id: 'tasks', label: t('待办清单', 'Checklist'), icon: <ListTodo/>, shortcut: 'Ctrl+Shift+9', run: () => run(() => toggleTextList(editor, 'taskList')) },
    { id: 'quote', label: t('引用', 'Quote'), icon: <Quote/>, run: () => run(() => editor.commands.toggleBlockquote()) },
    { id: 'codeBlock', label: t('代码块', 'Code block'), icon: <Code2/>, run: () => run(() => editor.commands.toggleCodeBlock()) }
  ];
  const items: MenuItem[] = [
    ...(notes.length ? [{ id: 'internal-link', label: t('新增笔记链接', 'Add note link'), icon: <Link2/>, disabled: !editable, children: notes.map(note => ({ id: note.id, label: note.name, run: () => run(() => editor.commands.insertContent({ type: 'text', text: `[[${note.name}${text ? `|${text}` : ''}]]` })) })) }] : []),
    { id: 'link', label: t('新增外部链接', 'Add external link'), icon: <ExternalLink/>, shortcut: 'Ctrl+K', disabled: !editable, run: () => { restore(); setLink(editor.getAttributes('link').href ?? ''); } },
    ...(onFind ? [{ id: 'find', label: text ? t(`查找“${text.slice(0, 22)}${text.length > 22 ? '…' : ''}”`, `Find “${text.slice(0, 22)}”`) : t('查找正文', 'Find in note'), icon: <Search/>, shortcut: 'Ctrl+F', separator: true, run: () => onFind(text) }] : []),
    ...(onMove && notes.length ? [{ id: 'move', label: t('将所选内容移动到其他笔记中', 'Move selection to note'), icon: <FileInput/>, disabled: !editable || !selected, children: notes.map(note => ({ id: note.id, label: note.name, run: () => { restore(); onMove(note.id); } })) }] : []),
    { id: 'format', label: t('文本格式', 'Text format'), icon: <Paintbrush/>, disabled: !editable, children: marks },
    { id: 'paragraphs', label: t('段落设置', 'Paragraph settings'), icon: <Pilcrow/>, disabled: !editable, children: paragraph },
    { id: 'insert', label: t('插入', 'Insert'), icon: <Plus/>, disabled: !editable, children: [
      { id: 'table', label: t('表格', 'Table'), icon: <Table2/>, run: () => run(() => editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true })) },
      { id: 'divider', label: t('分隔线', 'Divider'), icon: <Minus/>, run: () => run(() => editor.commands.setHorizontalRule()) },
      ...(onImage ? [{ id: 'image', label: t('图片…', 'Image…'), icon: <ImagePlus/>, run: () => { restore(); onImage(); } }] : []),
      ...(onComment ? [{ id: 'comment', label: t('批注', 'Comment'), icon: <MessageSquare/>, disabled: !selected, run: () => { restore(); onComment(); } }] : [])
    ] },
    ...(editor.isActive('table') && editable ? [{ id: 'table-edit', label: t('编辑表格', 'Edit table'), icon: <Table2/>, children: [
      { id: 'row', label: t('添加行', 'Add row'), run: () => run(() => editor.commands.addRowAfter()) }, { id: 'column', label: t('添加列', 'Add column'), run: () => run(() => editor.commands.addColumnAfter()) },
      { id: 'delete-row', label: t('删除行', 'Delete row'), run: () => run(() => editor.commands.deleteRow()) }, { id: 'delete-column', label: t('删除列', 'Delete column'), run: () => run(() => editor.commands.deleteColumn()) }, { id: 'delete-table', label: t('删除表格', 'Delete table'), danger: true, run: () => run(() => editor.commands.deleteTable()) }
    ] }] : []),
    { id: 'cut', label: t('剪切', 'Cut'), icon: <Scissors/>, shortcut: 'Ctrl+X', disabled: !editable || !selected, separator: true, run: () => clip('cut') },
    { id: 'copy', label: t('复制', 'Copy'), icon: <Copy/>, shortcut: 'Ctrl+C', disabled: !text && !selected, run: () => clip('copy') },
    { id: 'paste', label: t('粘贴', 'Paste'), icon: <ClipboardPaste/>, shortcut: 'Ctrl+V', disabled: !editable, run: () => clip('paste') },
    { id: 'plain', label: t('以纯文本形式粘贴', 'Paste as plain text'), icon: <ClipboardType/>, shortcut: 'Ctrl+Shift+V', disabled: !editable, run: () => { restore(); void pastePlainText(editor); } },
    { id: 'all', label: t('全选', 'Select all'), icon: <MousePointer2/>, shortcut: 'Ctrl+A', run: () => { if (editable) run(() => editor.commands.selectAll()); else { const element = host?.querySelector('.note-markdown-preview article'); if (element) { const range = document.createRange(); range.selectNodeContents(element); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range); } } } },
    { id: 'undo', label: t('撤销', 'Undo'), icon: <Undo2/>, shortcut: 'Ctrl+Z', separator: true, disabled: !editable || !editor.can().undo(), run: () => run(() => editor.commands.undo()) },
    { id: 'redo', label: t('重做', 'Redo'), icon: <Redo2/>, shortcut: 'Ctrl+Y', disabled: !editable || !editor.can().redo(), run: () => run(() => editor.commands.redo()) }
  ];
  return <>{position && <ContextMenu {...position} label={t('正文右键菜单', 'Text context menu')} items={items} onClose={() => setPosition(null)} onRestoreFocus={() => { if (editable) editor.view.focus(); }}/>} {link !== null && <CommandDialog title={t('编辑链接', 'Edit link')} fields={[{ key: 'href', label: t('链接地址', 'Link URL'), value: link }]} onClose={() => setLink(null)} onRestoreFocus={() => { if (!editor.isDestroyed) editor.view.focus(); }} onSubmit={({ href }) => { const url = href.trim(); if (url && !/^(https?:\/\/|mailto:)/i.test(url)) throw Error(t('请输入 https:// 或 mailto: 链接', 'Enter an https:// or mailto: link')); run(() => url ? editor.chain().extendMarkRange('link').setLink({ href: url }).run() : editor.chain().extendMarkRange('link').unsetLink().run()); }}/>}</>;
}

// 单编辑器笔记界面：Tiptap JSON 是正文唯一事实，批注 mark 与右侧卡片通过稳定 ID 关联。
// 用法：由 NotesWorkspace 承载；字体和字号优先作用于选区，无选区时更新正文默认值，图片通过项目 IPC 导入。
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor as TiptapEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { AlignLeft, AlignCenter, AlignRight, ArrowDown, ArrowUp, Bold, Italic, Underline, Strikethrough, Highlighter, List, ListOrdered, ListTodo, Quote, Code2, Minus, ImagePlus, Link2, Table2, Undo2, Redo2, MessageSquare, ListTree, Columns2, BookOpen, PenLine, Search, X, Maximize2, Minimize2, Settings2, Download, Trash2, FileText, Plus } from 'lucide-react';
import { IconButton, PanelResizeHandle } from '../shared/EditorControls';
import { NoteSearch, findNoteMatches, noteSearchKey } from './NoteSearch';
import { Mark, Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import type { Note } from '../../core/note';
import { noteAnnotationIds, noteDocumentSchema } from '../../core/note';
import type { ProjectDocument } from '../../core/document';
import { mediaSource } from '../media/mediaSource';
import { useLanguage } from '../shared/language';
import { useTheme } from '../theme/themeStore';
import { colorToHex } from '../../core/theme';
import { exportNoteMarkdown, renderNoteMarkdown } from '../../core/noteMarkdown';
import { NoteAnnotationLinks } from './NoteAnnotationLinks';
import 'katex/dist/katex.min.css';

const annotationColors = ['#efc969', '#8fc9a3', '#8cb8e8', '#de9ebd'];
const FONT_FAMILIES = ['Georgia', 'Microsoft YaHei', 'SimSun', 'Arial', 'monospace'];
const BUBBLE_OPTIONS = { placement: 'top' as const, offset: 8 };
// 选区仍保留时，焦点也必须位于正文或浮动菜单，避免填写批注后工具条继续遮挡正文。
const showBubble = ({ editor, element }: { editor: TiptapEditor; element: HTMLElement }) => editor.isEditable && (editor.view.hasFocus() || element.contains(document.activeElement)) && !editor.state.selection.empty && !!editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to).trim();
type ImageSelection = { position: number; width: number; align: 'left' | 'center' | 'right' } | null;

const NoteAnnotation = Mark.create({
  name: 'noteAnnotation',
  inclusive: false,
  addAttributes() { return { color: { default: '#efc969', renderHTML: attributes => ({ style: `--annotation-color: ${attributes.color}` }) }, id: { default: null, parseHTML: element => element.getAttribute('data-note-annotation'), renderHTML: attributes => attributes.id ? { 'data-note-annotation': attributes.id } : {} } }; },
  parseHTML() { return [{ tag: 'span[data-note-annotation]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes({ class: 'note-annotation-mark' }, HTMLAttributes), 0]; }
});

const ProjectImage = Node.create({
  name: 'projectImage', group: 'block', atom: true, draggable: true,
  addAttributes() { return {
    assetId: { default: '', parseHTML: element => element.getAttribute('data-project-asset'), renderHTML: attributes => ({ 'data-project-asset': attributes.assetId }) },
    src: { default: '', parseHTML: element => element.getAttribute('src'), renderHTML: attributes => ({ src: attributes.src }) },
    width: { default: 320, parseHTML: element => Number(element.getAttribute('width')) || 320, renderHTML: attributes => ({ width: attributes.width }) },
    align: { default: 'center', parseHTML: element => element.getAttribute('data-align') || 'center', renderHTML: attributes => ({ 'data-align': attributes.align }) }
  }; },
  parseHTML() { return [{ tag: 'img[data-project-asset]' }]; },
  renderHTML({ HTMLAttributes }) { return ['img', mergeAttributes({ class: 'note-project-image' }, HTMLAttributes)]; }
});

function updateImageNodes(value: unknown, assets: ProjectDocument['assets']): JSONContent {
  if (!value || typeof value !== 'object') return { type: 'doc', content: [] };
  const node = value as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
  const attrs = node.type === 'projectImage' && typeof node.attrs?.assetId === 'string'
    ? { ...node.attrs, src: mediaSource(assets.find(asset => asset.id === node.attrs!.assetId)?.path ?? '') }
    : node.attrs;
  return { ...node, ...(attrs ? { attrs } : {}), ...(node.content ? { content: node.content.map(item => updateImageNodes(item, assets)) } : {}) } as JSONContent;
}

// 阅读与分屏使用同一套 Markdown 渲染器，保留源字符位置以关联批注。
function MarkdownPreview({ document, assets, notes, style, onOpenNote }: { document: Note['document']; assets: ProjectDocument['assets']; notes: Note[]; style?: CSSProperties; onOpenNote(id: string): void }) {
  const html = renderNoteMarkdown(document, assets, notes, path => mediaSource(path));
  return <section className="note-markdown-preview" style={style} aria-label="Markdown 预览" onClick={event => {
    const target = (event.target as Element).closest<HTMLElement>('[data-open-note]');
    if (target?.dataset.openNote) onOpenNote(target.dataset.openNote);
  }}><article dangerouslySetInnerHTML={{ __html: html }} /></section>;
}

export function NoteEditor({ note, assets, notes, onOpenNote, initialReadMode = false, onChange, onImportImages }: {
  note: Note; assets: ProjectDocument['assets']; notes: Note[]; onOpenNote(id: string): void; initialReadMode?: boolean;
  onChange(change: (draft: Note) => void): void; onImportImages(files: File[]): Promise<ProjectDocument['assets']>;
}) {
  const { t } = useLanguage();
  const { tokens } = useTheme();
  const [annotationColor, setAnnotationColor] = useState('#efc969');
  const [readingSelection, setReadingSelection] = useState<{ from: number; to: number; left: number; top: number } | null>(null);
  const [readMode, setReadMode] = useState(initialReadMode);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [assistOpen, setAssistOpen] = useState(true);
  const [assistTab, setAssistTab] = useState<'outline' | 'comments'>('outline');
  const [typographyOpen, setTypographyOpen] = useState(false);
  const [annotationWidth, setAnnotationWidth] = useState(248);
  const [previewWidth, setPreviewWidth] = useState(420);
  const [focusMode, setFocusMode] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [ruled, setRuled] = useState(true);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [error, setError] = useState('');
  const [layoutWidth, setLayoutWidth] = useState(1000);
  const [paperViewportWidth, setPaperViewportWidth] = useState(240);
  const layoutRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [activeAnnotation, setActiveAnnotation] = useState<string | null>(null);
  const [imageSelection, setImageSelection] = useState<ImageSelection>(null);
  const [selectionStyle, setSelectionStyle] = useState<{ fontFamily?: string; fontSize?: string } | null>(null);
  const [imageToolbarPos, setImageToolbarPos] = useState<{ top: number; left: number } | null>(null);
  const paperRef = useRef<HTMLDivElement | null>(null);
  const imageToolsRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  useEffect(() => {
    const element = layoutRef.current;
    const paper = paperRef.current;
    if (!element || !paper) return;
    const observer = new ResizeObserver(() => {
      setLayoutWidth(element.clientWidth);
      // clientWidth 扣除了系统滚动条，确保不同 Windows 缩放下版心计算仍准确。
      setPaperViewportWidth(paper.clientWidth);
    });
    observer.observe(element);
    observer.observe(paper);
    return () => observer.disconnect();
  }, []);
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), Highlight.configure({ multicolor: true }), TextStyleKit.configure({ color: false, backgroundColor: false, lineHeight: false }), TaskList, TaskItem.configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' }, a11y: { checkboxLabel: node => t(`完成：${node.textContent}`, `Complete: ${node.textContent}`) } }), TableKit.configure({ table: { resizable: true } }), TextAlign.configure({ types: ['heading', 'paragraph'] }), NoteSearch, NoteAnnotation, ProjectImage],
    content: updateImageNodes(note.document, assets),
    immediatelyRender: false,
    enableInputRules: false,
    enablePasteRules: false,
    shouldRerenderOnTransaction: false,
    editable: !initialReadMode,
    onUpdate: ({ editor: active }) => {
      const document = noteDocumentSchema.parse(active.getJSON());
      onChangeRef.current(draft => { draft.document = document; });
    },
    onSelectionUpdate: ({ editor: active }) => {
      const node = (active.state.selection as typeof active.state.selection & { node?: { type: { name: string }; attrs: Record<string, unknown> } }).node ?? active.state.selection.$from.nodeAfter;
      if (node?.type.name === 'projectImage') {
        setImageSelection({ position: active.state.selection.from, width: Number(node.attrs.width) || 320, align: node.attrs.align as 'left' | 'center' | 'right' });
      } else setImageSelection(null);
      // 非空选区显示对应 mark；无选区交由排版控件显示整篇默认值。
      if (active.state.selection.empty) setSelectionStyle(null);
      else {
        const attrs = active.getAttributes('textStyle') as { fontFamily?: string; fontSize?: string };
        setSelectionStyle({ fontFamily: attrs.fontFamily ?? note.typography.fontFamily, fontSize: attrs.fontSize ?? `${note.typography.fontSize}px` });
      }
    }
  }, [note.id]);
  // 仅跟随正文和选区更新工具状态，浮动菜单自身的布局事务不会触发 React 循环重绘。
  useEditorState({ editor, selector: ({ editor: active }) => ({ document: active?.state.doc, from: active?.state.selection.from, to: active?.state.selection.to, marks: active?.state.storedMarks }) });
  useEffect(() => {
    const paper = paperRef.current, toolbar = imageToolsRef.current;
    if (!editor || editor.isDestroyed || !imageSelection || !paper || !toolbar) return;
    const anchor = editor.view.nodeDOM(imageSelection.position);
    if (!(anchor instanceof HTMLElement)) return;
    let live = true;
    // 相对真实图片定位，滚动、缩放、对齐或尺寸变化后重新计算，工具条始终限制在正文边界内。
    const stop = autoUpdate(anchor, toolbar, () => {
      void computePosition(anchor, toolbar, { placement: 'top-start', middleware: [offset(8), flip({ boundary: paper }), shift({ boundary: paper, padding: 8 })] })
        .then(({ x, y }) => { if (live) setImageToolbarPos({ top: y, left: x }); });
    });
    return () => { live = false; stop(); };
  }, [editor, imageSelection, note.document]);
  useEffect(() => { if (editor && !editor.isDestroyed) editor.setEditable(!readMode); }, [editor, readMode]);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = JSON.stringify(editor.getJSON());
    // 新扩展会补齐默认属性，比较同一 schema 的规范化结果，避免普通选区变化重置正文。
    const incoming = editor.schema.nodeFromJSON(updateImageNodes(note.document, assets)).toJSON();
    if (current !== JSON.stringify(incoming)) editor.commands.setContent(incoming, { emitUpdate: false });
  }, [editor, note.document, assets]);
  useEffect(() => { setReadMode(initialReadMode); setActiveAnnotation(null); }, [note.id, initialReadMode]);
  useEffect(() => {
    const update = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) { setReadingSelection(null); return; }
      const range = selection.getRangeAt(0);
      const preview = range.startContainer.parentElement?.closest('.note-markdown-preview');
      if (!preview || !preview.contains(range.endContainer) || !layoutRef.current?.contains(preview)) { setReadingSelection(null); return; }
      const selected: number[] = [];
      // 每个 span 携带渲染字符对应的源位置，重复原文、跨段落和 Markdown 粗体也能定位同一选区。
      for (const element of Array.from(preview.querySelectorAll<HTMLElement>('[data-note-positions]'))) {
        if (!range.intersectsNode(element)) continue;
        const positions = element.dataset.notePositions?.split(',').map(Number) ?? [];
        const offset = (node: globalThis.Node, at: number) => {
          const prefix = document.createRange(); prefix.selectNodeContents(element); prefix.setEnd(node, at);
          return prefix.toString().length;
        };
        const start = element.contains(range.startContainer) ? offset(range.startContainer, range.startOffset) : 0;
        const end = element.contains(range.endContainer) ? offset(range.endContainer, range.endOffset) : positions.length;
        selected.push(...positions.slice(start, end).filter(position => position >= 0));
      }
      if (!selected.length) { setReadingSelection(null); return; }
      const rect = range.getBoundingClientRect();
      setReadingSelection({ from: Math.min(...selected), to: Math.max(...selected) + 1, left: Math.max(8, Math.min(window.innerWidth - 310, rect.left)), top: Math.max(8, rect.top - 44) });
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, [readMode, previewOpen]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && !event.shiftKey) { event.preventDefault(); setFindOpen(true); setReadMode(false); requestAnimationFrame(() => findRef.current?.focus()); }
      if (event.key === 'Escape') { setFindOpen(false); setTypographyOpen(false); setLinkOpen(false); setFocusMode(false); }
    };
    addEventListener('keydown', keydown); return () => removeEventListener('keydown', keydown);
  }, []);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!popoverRef.current?.contains(event.target as globalThis.Node) && !(event.target as Element).closest('[data-note-popover-trigger]')) { setTypographyOpen(false); setLinkOpen(false); } };
    if (typographyOpen || linkOpen) addEventListener('pointerdown', close);
    return () => removeEventListener('pointerdown', close);
  }, [typographyOpen, linkOpen]);
  const matches = editor ? findNoteMatches(editor.state.doc, query) : [];
  const currentMatch = Math.min(matchIndex, Math.max(0, matches.length - 1));
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(noteSearchKey, { query: findOpen ? query : '', current: currentMatch }));
  }, [editor, query, findOpen, currentMatch]);
  const typo = note.typography;
  const ruleSpacing = Math.round(typo.fontSize * typo.lineHeight);
  const setTypography = (patch: Partial<typeof typo>) => onChange(draft => { draft.typography = { ...draft.typography, ...patch }; });
  // 工具栏保留编辑器选区；文本格式与正文修改进入同一条 Tiptap 撤销历史。
  const runSelectionCommand = (command: (active: TiptapEditor) => void) => {
    if (!editor) return;
    command(editor);
  };
  const addAnnotation = () => {
    let id: string | null = null;
    runSelectionCommand(active => {
      if (active.state.selection.empty) return;
      id = crypto.randomUUID();
      onChange(draft => { draft.annotations.push({ id: id!, note: '', color: annotationColor }); });
      active.chain().setMark('noteAnnotation', { id, color: annotationColor }).run();
      setReadingSelection(null);
    });
    if (id) { setActiveAnnotation(id); setAssistOpen(true); setAssistTab('comments'); }
  };
  const removeAnnotation = (id: string) => onChange(draft => {
    draft.annotations = draft.annotations.filter(item => item.id !== id);
    const removeMarks = (nodes: typeof draft.document.content) => {
      for (const node of nodes) {
        if (node.marks) node.marks = node.marks.filter(mark => !(mark.type === 'noteAnnotation' && mark.attrs?.id === id));
        if (node.content) removeMarks(node.content);
      }
    };
    removeMarks(draft.document.content);
  });
  const insertImage = (assetId: string, position?: number, providedAsset?: ProjectDocument['assets'][number]) => {
    const asset = providedAsset ?? assets.find(item => item.id === assetId);
    if (!editor || !asset || asset.kind !== 'image') return;
    const chain = editor.chain().focus();
    if (position !== undefined) chain.setTextSelection(position);
    chain.insertContent({ type: 'projectImage', attrs: { assetId, src: mediaSource(asset.path), width: 320, align: 'center' } }).run();
  };
  const updateSelectedImage = (attrs: Partial<{ width: number; align: 'left' | 'center' | 'right' }>) => {
    if (!editor || !imageSelection) return;
    editor.chain().setNodeSelection(imageSelection.position).updateAttributes('projectImage', attrs).run();
  };
  const importAtCursor = async (files: File[], dropPosition?: number) => {
    if (!editor || !files.length) return;
    const position = dropPosition ?? editor.state.selection.from;
    try {
      const imported = await onImportImages(files);
      if (editor.isDestroyed) return;
      // 逆序插入同一位置，使多张图片在正文中维持用户选择的顺序。
      for (const asset of imported.filter(item => item.kind === 'image').reverse()) insertImage(asset.id, Math.min(position, editor.state.doc.content.size), asset);
    } catch (cause) { setError(t('图片导入失败', 'Image import failed') + `: ${String(cause)}`); }
  };
  const setFontFamily = (fontFamily: string) => runSelectionCommand(active => { active.chain().setFontFamily(fontFamily).run(); });
  const setFontSize = (fontSize: string) => runSelectionCommand(active => { active.chain().setFontSize(`${fontSize}px`).run(); });
  const used = noteAnnotationIds(note.document);
  const annotations = note.annotations.filter(annotation => annotation.orphaned || used.has(annotation.id));
  const outline: { text: string; level: number; position: number }[] = [];
  editor?.state.doc.descendants((node, position) => {
    const markdownHeading = node.isTextblock ? /^(#{1,3})\s+(.+)$/.exec(node.textContent) : null;
    if (node.type.name === 'heading') outline.push({ text: node.textContent, level: node.attrs.level, position });
    else if (markdownHeading) outline.push({ text: markdownHeading[2], level: markdownHeading[1].length, position });
  });
  const jumpTo = (position: number) => {
    if (!editor) return;
    if (readMode) setReadMode(false);
    requestAnimationFrame(() => { if (!editor.isDestroyed) editor.chain().focus().setTextSelection(position + 1).scrollIntoView().run(); });
  };
  const moveMatch = (delta: number) => {
    if (!matches.length || !editor) return;
    const index = (currentMatch + delta + matches.length) % matches.length;
    setMatchIndex(index);
    editor.commands.setTextSelection(matches[index]);
    editor.commands.scrollIntoView();
  };
  const replaceMatches = (all: boolean) => {
    if (!editor || readMode || !matches.length) return;
    const ranges = all ? [...matches].reverse() : [matches[currentMatch]];
    const transaction = closeHistory(editor.state.tr);
    for (const range of ranges) transaction.insertText(replacement, range.from, range.to);
    editor.view.dispatch(transaction);
    editor.view.dispatch(closeHistory(editor.state.tr));
  };
  const exportNote = async () => {
    if (!editor) return;
    const body = exportNoteMarkdown(note.document, assets);
    try { await window.workbench!.exportNote({ name: note.name, markdown: `# ${note.name}\n\n${body}` }); }
    catch (cause) { setError(t('导出失败', 'Export failed') + `: ${String(cause)}`); }
  };
  const showAssist = assistOpen && !focusMode;
  const assistMax = Math.max(200, layoutWidth - (previewOpen ? 490 : 325));
  const assistWidth = Math.min(annotationWidth, assistMax);
  const mainWidth = layoutWidth - (showAssist ? assistWidth + 5 : 0);
  const splitMax = Math.max(240, mainWidth - 245);
  const splitWidth = Math.min(previewWidth, splitMax);
  // 版心以实际正文列为依据，分屏时至少保留 208px 文字区域。
  const paperMargin = Math.min(typo.marginX, Math.max(8, (paperViewportWidth - 208) / 2));
  const characters = editor?.state.doc.textContent.replace(/\s/g, '').length ?? 0;
  const zoomBy = (delta: number) => setZoom(value => Math.max(75, Math.min(150, value + delta)));
  const formatActions = [
    { icon: Bold, label: t('粗体', 'Bold'), active: editor?.isActive('bold'), run: () => editor?.chain().focus().toggleBold().run() },
    { icon: Italic, label: t('斜体', 'Italic'), active: editor?.isActive('italic'), run: () => editor?.chain().focus().toggleItalic().run() },
    { icon: Underline, label: t('下划线', 'Underline'), active: editor?.isActive('underline'), run: () => editor?.chain().focus().toggleUnderline().run() },
    { icon: Strikethrough, label: t('删除线', 'Strikethrough'), active: editor?.isActive('strike'), run: () => editor?.chain().focus().toggleStrike().run() },
    { icon: Highlighter, label: t('划线', 'Highlight'), active: editor?.isActive('highlight'), run: () => editor?.chain().setHighlight({ color: annotationColor }).run() }
  ];
  return <div className={`note-editor${focusMode ? ' is-focused' : ''}`}>
    <div className="note-commandbar">
      <div className="note-breadcrumb"><FileText size={15} /><span>{note.name || t('未命名笔记', 'Untitled note')}</span></div>
      <div className="note-command-actions">
        <IconButton icon={Search} label={t('查找正文', 'Find in note')} aria-pressed={findOpen} onClick={() => { setFindOpen(value => !value); setReadMode(false); requestAnimationFrame(() => findRef.current?.focus()); }} />
        <IconButton icon={ListTree} label={t('目录', 'Outline')} aria-pressed={showAssist && assistTab === 'outline'} onClick={() => { setAssistOpen(!showAssist || assistTab !== 'outline'); setAssistTab('outline'); }} />
        <IconButton icon={MessageSquare} label={showAssist && assistTab === 'comments' ? t('收起批注', 'Hide comments') : t('打开批注', 'Show comments')} aria-pressed={showAssist && assistTab === 'comments'} onClick={() => { setAssistOpen(!showAssist || assistTab !== 'comments'); setAssistTab('comments'); }} />
        <IconButton icon={Columns2} label={previewOpen ? t('关闭预览', 'Close preview') : t('分屏预览', 'Split preview')} aria-pressed={previewOpen} onClick={() => { setPreviewOpen(value => !value); setReadMode(false); }} />
        <IconButton icon={focusMode ? Minimize2 : Maximize2} label={focusMode ? t('退出专注模式', 'Exit focus mode') : t('专注模式', 'Focus mode')} aria-pressed={focusMode} onClick={() => setFocusMode(value => !value)} />
        <span className="toolbar-divider" />
        <button className="note-reading-button" aria-label={readMode ? t('编辑模式', 'Edit') : t('渲染模式', 'Read')} aria-pressed={readMode} onClick={() => { setReadMode(value => !value); setPreviewOpen(false); setFindOpen(false); setImageSelection(null); }}>{readMode ? <PenLine size={15} /> : <BookOpen size={15} />}{readMode ? t('编辑', 'Edit') : t('阅读', 'Read')}</button>
        <IconButton icon={Download} label={t('导出 Markdown', 'Export Markdown')} onClick={exportNote} />
      </div>
    </div>
    {!readMode && <div className="note-toolbar" role="toolbar" aria-label={t('正文格式', 'Text formatting')}>
      <div className="note-format-scroll">
        <IconButton icon={Undo2} label={t('撤销正文', 'Undo text')} disabled={!editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()} />
        <IconButton icon={Redo2} label={t('重做正文', 'Redo text')} disabled={!editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()} />
        <span className="toolbar-divider" />
        <select className="note-block-select" aria-label={t('段落样式', 'Paragraph style')} value={editor?.isActive('heading') ? String(editor.getAttributes('heading').level) : 'paragraph'} onChange={event => runSelectionCommand(active => { const level = Number(event.target.value); if (level) active.chain().focus().setHeading({ level: level as 1 | 2 | 3 }).run(); else active.chain().focus().setParagraph().run(); })}>
          <option value="paragraph">{t('正文', 'Paragraph')}</option>{[1, 2, 3].map(level => <option key={level} value={level}>{t(`标题 ${level}`, `Heading ${level}`)}</option>)}
        </select>
        <span className="toolbar-divider" />
        {formatActions.filter(action => action.icon !== Highlighter).map(action => <IconButton key={action.label} icon={action.icon} label={action.label} aria-pressed={action.active} onMouseDown={event => event.preventDefault()} onClick={action.run} />)}
        <span className="toolbar-divider" />
        <IconButton icon={List} label={t('无序列表', 'Bullet list')} aria-pressed={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
        <IconButton icon={ListOrdered} label={t('有序列表', 'Numbered list')} aria-pressed={editor?.isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
        <IconButton icon={ListTodo} label={t('待办清单', 'Checklist')} aria-pressed={editor?.isActive('taskList')} onClick={() => editor?.chain().focus().toggleTaskList().run()} />
        <IconButton icon={Quote} label={t('引用', 'Quote')} aria-pressed={editor?.isActive('blockquote')} onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
        <IconButton icon={Code2} label={t('代码块', 'Code block')} aria-pressed={editor?.isActive('codeBlock')} onClick={() => editor?.chain().focus().toggleCodeBlock().run()} />
        <span className="toolbar-divider" />
        <IconButton icon={Table2} label={t('插入表格', 'Insert table')} onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
        <IconButton icon={Link2} label={t('插入链接', 'Insert link')} data-note-popover-trigger aria-pressed={editor?.isActive('link')} onClick={() => { setTypographyOpen(false); setLinkOpen(value => !value); setLinkUrl(editor?.getAttributes('link').href ?? ''); }} />
        <IconButton icon={Minus} label={t('分隔线', 'Divider')} onClick={() => editor?.chain().focus().setHorizontalRule().run()} />
      </div>
      <div className="note-popovers" ref={popoverRef}>
        <IconButton icon={Settings2} label={t('排版', 'Typesetting')} aria-expanded={typographyOpen} onClick={() => { setLinkOpen(false); setTypographyOpen(value => !value); }} />
        {typographyOpen && <div className="note-start-group editor-popover" role="dialog" aria-label={t('排版设置', 'Typography settings')}>
          <div className="popover-title"><strong>{t('排版', 'Typography')}</strong><IconButton icon={X} label={t('关闭排版', 'Close typography')} onClick={() => setTypographyOpen(false)} /></div>
          <label>{t('字体', 'Font')}<select aria-label={t('字体', 'Font')} disabled={!selectionStyle} value={selectionStyle?.fontFamily ?? ''} onChange={event => { if (selectionStyle) setFontFamily(event.target.value); else setTypography({ fontFamily: event.target.value }); }}><option value=""></option>{FONT_FAMILIES.map(font => <option key={font} value={font}>{font}</option>)}</select></label>
          <label>{t('字号', 'Size')}<input aria-label={t('字号', 'Font size')} type="number" min="10" max="96" disabled={!selectionStyle} value={selectionStyle?.fontSize ? parseInt(selectionStyle.fontSize, 10) : ''} onChange={event => { const value = Math.max(10, Math.min(96, Number(event.target.value) || 17)); if (selectionStyle) setFontSize(String(value)); else setTypography({ fontSize: value }); }} /></label>
          <label>{t('行距', 'Line height')}<input aria-label={t('行距', 'Line height')} type="number" min="1" max="3" step="0.1" value={typo.lineHeight} onChange={event => setTypography({ lineHeight: Math.max(1, Math.min(3, Number(event.target.value) || 1.8)) })} /></label>
          <label>{t('版心', 'Text margins')}<input aria-label={t('版心', 'Margins')} type="number" min="24" max="160" value={typo.marginX} onChange={event => setTypography({ marginX: Math.max(24, Math.min(160, Number(event.target.value) || 72)) })} /></label>
          <div className="note-align-tools">{([{ value: 'left', icon: AlignLeft, label: t('左对齐', 'Align left') }, { value: 'center', icon: AlignCenter, label: t('居中对齐', 'Align center') }, { value: 'right', icon: AlignRight, label: t('右对齐', 'Align right') }]).map(align => <IconButton key={align.value} icon={align.icon} label={align.label} aria-pressed={editor?.isActive({ textAlign: align.value })} onClick={() => editor?.chain().focus().setTextAlign(align.value).run()} />)}</div>
          <label>{t('显示横线', 'Ruled lines')}<input type="checkbox" checked={ruled} onChange={event => setRuled(event.target.checked)} /></label>
        </div>}
        {linkOpen && <form className="editor-popover note-link-popover" onSubmit={event => { event.preventDefault(); const href = linkUrl.trim(); if (!href) editor?.chain().focus().extendMarkRange('link').unsetLink().run(); else if (/^(https?:\/\/|mailto:)/i.test(href)) editor?.chain().focus().extendMarkRange('link').setLink({ href }).run(); else { setError(t('请输入 https:// 或 mailto: 链接', 'Enter an https:// or mailto: link')); return; } setLinkOpen(false); }}><label>{t('链接地址', 'Link URL')}<input autoFocus type="text" aria-label={t('链接地址', 'Link URL')} placeholder="https://" value={linkUrl} onChange={event => setLinkUrl(event.target.value)} /></label><button type="submit">{t('应用', 'Apply')}</button></form>}
      </div>
      <input ref={fileRef} hidden type="file" accept="image/*" multiple onChange={event => { void importAtCursor(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    </div>}
    {!readMode && editor?.isActive('table') && <div className="note-table-toolbar"><span>{t('表格', 'Table')}</span><button onClick={() => editor.chain().focus().addRowAfter().run()}>{t('添加行', 'Add row')}</button><button onClick={() => editor.chain().focus().addColumnAfter().run()}>{t('添加列', 'Add column')}</button><button onClick={() => editor.chain().focus().deleteRow().run()}>{t('删除行', 'Delete row')}</button><button onClick={() => editor.chain().focus().deleteColumn().run()}>{t('删除列', 'Delete column')}</button><button onClick={() => editor.chain().focus().deleteTable().run()}>{t('删除表格', 'Delete table')}</button></div>}
    {findOpen && <div className="note-findbar"><Search size={16} /><input ref={findRef} aria-label={t('查找内容', 'Find text')} placeholder={t('查找内容', 'Find text')} value={query} onChange={event => { setQuery(event.target.value); setMatchIndex(0); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); moveMatch(event.shiftKey ? -1 : 1); } }} /><span className="note-find-count">{matches.length ? currentMatch + 1 : 0} / {matches.length}</span><IconButton icon={ArrowUp} label={t('上一个结果', 'Previous result')} disabled={!matches.length} onClick={() => moveMatch(-1)} /><IconButton icon={ArrowDown} label={t('下一个结果', 'Next result')} disabled={!matches.length} onClick={() => moveMatch(1)} /><input aria-label={t('替换为', 'Replace with')} placeholder={t('替换为', 'Replace with')} value={replacement} onChange={event => setReplacement(event.target.value)} /><button disabled={!matches.length} onClick={() => replaceMatches(false)}>{t('替换', 'Replace')}</button><button disabled={!matches.length} onClick={() => replaceMatches(true)}>{t('全部替换', 'Replace all')}</button><IconButton icon={X} label={t('关闭查找', 'Close find')} onClick={() => setFindOpen(false)} /></div>}
    {error && <div className="note-error" role="alert">{error}<IconButton icon={X} label={t('关闭提示', 'Dismiss')} onClick={() => setError('')} /></div>}
    <div ref={layoutRef} className={`note-layout${previewOpen ? ' note-layout-preview' : ''}${layoutWidth < 720 ? ' is-compact' : ''}`}>
      <div className="note-main-panes">
      <div ref={paperRef} className={`note-paper${ruled ? ' is-ruled' : ''}`} style={{ fontSize: typo.fontSize * zoom / 100, fontFamily: typo.fontFamily, ['--note-line-height' as string]: typo.lineHeight, ['--note-rule' as string]: `${ruleSpacing * zoom / 100}px`, ['--note-margin-x' as string]: `${paperMargin}px`, ['--note-margin-y' as string]: `${typo.marginY}px` }}>
        <input className="note-title" aria-label={t('笔记名称', 'Note name')} value={note.name} onChange={event => onChange(draft => { draft.name = event.target.value; })} />
        {readMode ? <MarkdownPreview document={note.document} assets={assets} notes={notes} onOpenNote={onOpenNote} /> : <EditorContent editor={editor} className="note-text note-tiptap" onKeyDown={event => {
          if (event.key !== ' ' || !editor) return;
          const before = editor.state.selection.$from.parent.textBetween(0, editor.state.selection.$from.parentOffset, '\n', '\0');
          if (/^(#{1,6}|[-*+]|\d+\.)$/.test(before)) { event.preventDefault(); editor.view.dispatch(editor.state.tr.insertText(' ')); }
        }} onClick={event => { if (!(event.target as Element).closest('.note-project-image')) setImageSelection(null); }} onDragOver={event => { if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault(); }} onDrop={event => { const files = Array.from(event.dataTransfer.files).filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void importAtCursor(files, editor?.view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos); } }} onPaste={event => { const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void importAtCursor(files); } }} />}
        {imageSelection && <div ref={imageToolsRef} className="note-image-tools" style={{ top: imageToolbarPos?.top ?? 0, left: imageToolbarPos?.left ?? 0, visibility: imageToolbarPos ? 'visible' : 'hidden' }}>
          <label>{t('图片宽度', 'Image width')}<input aria-label={t('图片宽度', 'Image width')} type="number" min="80" max="1600" disabled={readMode} value={imageSelection.width} onChange={event => { const width = Math.max(80, Math.min(1600, Number(event.target.value) || 320)); setImageSelection({ ...imageSelection, width }); updateSelectedImage({ width }); }} /></label>
          {(['left', 'center', 'right'] as const).map(align => <button key={align} disabled={readMode} aria-pressed={imageSelection.align === align} onMouseDown={event => event.preventDefault()} onClick={() => { setImageSelection({ ...imageSelection, align }); updateSelectedImage({ align }); }}>{t(({ left: '左', center: '中', right: '右' })[align], align)}</button>)}
        </div>}
      </div>
      {previewOpen && <><PanelResizeHandle label={t('调整预览宽度', 'Resize preview')} value={splitWidth} min={240} max={splitMax} direction={-1} onChange={setPreviewWidth} onReset={() => setPreviewWidth(420)} /><MarkdownPreview document={note.document} assets={assets} notes={notes} onOpenNote={onOpenNote} style={{ flex: `0 0 ${splitWidth}px` }} /></>}
      </div>
      {showAssist && <><PanelResizeHandle label={t('调整辅助栏宽度', 'Resize assistant panel')} value={assistWidth} min={200} max={assistMax} direction={-1} onChange={setAnnotationWidth} onReset={() => setAnnotationWidth(248)} />
        <aside className="note-assist" style={{ width: assistWidth }}>
          <div className="note-assist-tabs line-tabs" role="tablist" aria-label={t('笔记辅助栏', 'Note assistant panel')}><button role="tab" aria-selected={assistTab === 'outline'} onClick={() => setAssistTab('outline')}>{t('目录', 'Outline')}</button><button role="tab" aria-selected={assistTab === 'comments'} onClick={() => setAssistTab('comments')}>{t('批注', 'Comments')}<span>{annotations.length || ''}</span></button><IconButton icon={X} label={t('收起辅助栏', 'Close assistant panel')} onClick={() => setAssistOpen(false)} /></div>
          {assistTab === 'outline' ? <nav className="note-outline" aria-label={t('文档大纲', 'Document outline')}>
            <button className="outline-title" onClick={() => paperRef.current?.scrollTo({ top: 0 })}>{note.name || t('未命名笔记', 'Untitled note')}</button>
            {outline.map(heading => <button key={heading.position} style={{ paddingLeft: 16 + (heading.level - 1) * 14 }} onClick={() => jumpTo(heading.position)} title={heading.text}>{heading.text || t('空标题', 'Empty heading')}</button>)}
            {!outline.length && <p className="editor-empty">{t('暂无标题', 'No headings')}</p>}
          </nav> : <div className="note-annotations">
            {annotations.length === 0 && <div className="note-comments-empty"><MessageSquare size={24} strokeWidth={1.4} /><span>{t('暂无批注', 'No comments')}</span><button disabled={editor?.state.selection.empty} onMouseDown={event => event.preventDefault()} onClick={addAnnotation}><Plus size={14} />{t('添加批注', 'Add comment')}</button></div>}
            {annotations.map((annotation, index) => <div key={annotation.id} data-annotation-card={annotation.id} style={{ ['--annotation-color' as string]: annotation.color }} className={`note-annotation${activeAnnotation === annotation.id ? ' is-active' : ''}`}>
              <div className="annotation-heading"><button onClick={() => { paperRef.current?.querySelector<HTMLElement>(`[data-note-annotation="${annotation.id}"]`)?.scrollIntoView({ block: 'center' }); setActiveAnnotation(annotation.id); }}><MessageSquare size={13} />{t('批注', 'Comment')} {index + 1}</button><IconButton icon={Trash2} label={t('删除批注', 'Delete annotation')} onClick={() => removeAnnotation(annotation.id)} /></div>
              {annotation.orphaned && <span className="note-reference-lost">{t('引用原文已删除', 'Reference deleted')}</span>}
              {activeAnnotation === annotation.id
                ? <textarea autoFocus value={annotation.note} onChange={event => onChange(draft => { const target = draft.annotations.find(item => item.id === annotation.id); if (target) target.note = event.target.value; })} onBlur={() => setActiveAnnotation(null)} placeholder={t('批注内容…', 'Annotation…')} />
                : <button className="note-annotation-text" onClick={() => setActiveAnnotation(annotation.id)}>{annotation.note || t('写批注…', 'Write annotation…')}</button>}
            </div>)}
          </div>}
        </aside></>}
    </div>
    {showAssist && assistTab === 'comments' && <NoteAnnotationLinks container={layoutRef} annotations={annotations} document={note.document} activeId={activeAnnotation} />}
    {readingSelection && <div className="note-bubble-menu note-reading-menu" style={{ position: 'fixed', left: readingSelection.left, top: readingSelection.top }} onMouseDown={event => event.preventDefault()}>
      {annotationColors.map(color => <button key={color} className="annotation-color" aria-label={`划线 ${color}`} style={{ background: color }} onClick={() => { setAnnotationColor(color); editor?.chain().setTextSelection(readingSelection).setHighlight({ color }).run(); setReadingSelection(null); }} />)}
      <button onClick={() => { editor?.chain().setTextSelection(readingSelection).unsetHighlight().run(); setReadingSelection(null); }}>清除划线</button>
      <button onClick={() => { editor?.commands.setTextSelection(readingSelection); addAnnotation(); }}><MessageSquare size={15} />批注</button>
    </div>}
    <footer className="note-statusbar"><span>{characters.toLocaleString()} {t('字', 'characters')}</span><span>{t(`约 ${Math.max(1, Math.ceil(characters / 400))} 分钟`, `~${Math.max(1, Math.ceil(characters / 400))} min read`)}</span><span className="note-status-spacer" /><span>{readMode ? t('阅读', 'Read') : t('编辑', 'Edit')}</span><IconButton icon={Minus} label={t('缩小正文', 'Zoom out')} disabled={zoom <= 75} onClick={() => zoomBy(-10)} /><button className="note-zoom-value" title={t('重置缩放', 'Reset zoom')} onClick={() => setZoom(100)}>{zoom}%</button><IconButton icon={Plus} label={t('放大正文', 'Zoom in')} disabled={zoom >= 150} onClick={() => zoomBy(10)} /></footer>
    {editor && !readMode && <BubbleMenu editor={editor} shouldShow={showBubble} options={BUBBLE_OPTIONS}>
      <div className="note-bubble-menu">
        {formatActions.map(action => <IconButton key={action.label} icon={action.icon} label={action.label} aria-pressed={action.active} onMouseDown={event => event.preventDefault()} onClick={action.run} />)}
        <span className="toolbar-divider" />{annotationColors.map(color => <button key={color} className="annotation-color" aria-label={`划线 ${color}`} style={{ background: color }} onMouseDown={event => event.preventDefault()} onClick={() => { setAnnotationColor(color); editor.chain().setHighlight({ color }).run(); }} />)}
        <button onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().unsetHighlight().run()}>清除划线</button><span className="toolbar-divider" /><button onMouseDown={event => event.preventDefault()} onClick={addAnnotation}><MessageSquare size={15} />{t('批注', 'Annotate')}</button>
      </div>
    </BubbleMenu>}
  </div>;
}

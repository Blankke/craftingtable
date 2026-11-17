// 单编辑器笔记界面：Tiptap JSON 是正文唯一事实，批注 mark 与右侧卡片通过稳定 ID 关联。
// 字体与字号作用于非空文字选区（TextStyleKit mark）；行距与版心作为整篇设置。选中文字显示浮动菜单，图片只经拖入/粘贴导入并附带上下文尺寸与对齐工具。
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, type Editor as TiptapEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { Mark, Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import type { Note } from '../core/note';
import { noteAnnotationIds, noteDocumentSchema } from '../core/note';
import type { ProjectDocument } from '../core/document';
import { mediaSource } from './mediaSource';
import { useLanguage } from './language';
import { useTheme } from './themeStore';
import { colorToHex } from '../core/theme';

const FONT_FAMILIES = ['Georgia', 'Microsoft YaHei', 'SimSun', 'Arial', 'monospace'];
type AnnotationLayout = { id: string; top: number; sourceY: number; orphaned: boolean };
type ImageSelection = { position: number; width: number; align: 'left' | 'center' | 'right' } | null;

const NoteAnnotation = Mark.create({
  name: 'noteAnnotation',
  inclusive: false,
  addAttributes() { return { id: { default: null, parseHTML: element => element.getAttribute('data-note-annotation'), renderHTML: attributes => attributes.id ? { 'data-note-annotation': attributes.id } : {} } }; },
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

/** 测量字体盒度量，用于把首行基线对齐到行网格第一条横线。 */
// 预览与编辑共享同一份 Tiptap JSON；Markdown 快捷输入形成的语义块可即时预览。
function MarkdownPreview({ document, assets }: { document: JSONContent; assets: ProjectDocument['assets'] }) {
  const renderChildren = (nodes: JSONContent[] | undefined): ReactNode => nodes?.map((node, index) => renderNode(node, index)) ?? null;
  const renderText = (node: JSONContent, key: number) => {
    let content: ReactNode = node.text ?? '';
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') content = <strong key={`${key}-bold`}>{content}</strong>;
      else if (mark.type === 'italic') content = <em key={`${key}-italic`}>{content}</em>;
      else if (mark.type === 'underline') content = <u key={`${key}-underline`}>{content}</u>;
      else if (mark.type === 'strike') content = <s key={`${key}-strike`}>{content}</s>;
      else if (mark.type === 'highlight') content = <mark key={`${key}-highlight`}>{content}</mark>;
      else if (mark.type === 'code') content = <code key={`${key}-code`}>{content}</code>;
      else if (mark.type === 'noteAnnotation') content = <mark key={`${key}-annotation`} className="note-preview-annotation">{content}</mark>;
    }
    return <span key={key}>{content}</span>;
  };
  const renderNode = (node: JSONContent, key: number): ReactNode => {
    const children = renderChildren(node.content);
    if (node.type === 'text') return renderText(node, key);
    if (node.type === 'paragraph') return <p key={key}>{children}</p>;
    if (node.type === 'heading') { const Tag = `h${Math.min(3, Math.max(1, Number(node.attrs?.level) || 1))}` as 'h1' | 'h2' | 'h3'; return <Tag key={key}>{children}</Tag>; }
    if (node.type === 'bulletList') return <ul key={key}>{children}</ul>;
    if (node.type === 'orderedList') return <ol key={key}>{children}</ol>;
    if (node.type === 'listItem') return <li key={key}>{children}</li>;
    if (node.type === 'blockquote') return <blockquote key={key}>{children}</blockquote>;
    if (node.type === 'codeBlock') return <pre key={key}><code>{children}</code></pre>;
    if (node.type === 'hardBreak') return <br key={key} />;
    if (node.type === 'horizontalRule') return <hr key={key} />;
    if (node.type === 'projectImage') {
      const asset = assets.find(item => item.id === node.attrs?.assetId);
      return asset ? <img key={key} className="note-preview-image" src={mediaSource(asset.path)} alt={asset.name} style={{ width: Math.min(Number(node.attrs?.width) || 320, 640) }} /> : null;
    }
    return <span key={key}>{children}</span>;
  };
  return <section className="note-markdown-preview" aria-label="Markdown 预览"><div className="note-preview-label">Markdown 预览</div><article>{renderNode(document, 0)}</article></section>;
}

export function NoteEditor({ note, assets, initialReadMode = false, onChange, onImportImages }: {
  note: Note; assets: ProjectDocument['assets']; initialReadMode?: boolean;
  onChange(change: (draft: Note) => void): void; onImportImages(files: File[]): Promise<ProjectDocument['assets']>;
}) {
  const { t } = useLanguage();
  const { tokens } = useTheme();
  const annotationColor = colorToHex(tokens.selection);
  const [readMode, setReadMode] = useState(initialReadMode);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [annotationsOpen, setAnnotationsOpen] = useState(true);
  const [activeAnnotation, setActiveAnnotation] = useState<string | null>(null);
  const [annotationLayout, setAnnotationLayout] = useState<AnnotationLayout[]>([]);
  const [imageSelection, setImageSelection] = useState<ImageSelection>(null);
  const [selectionStyle, setSelectionStyle] = useState<{ fontFamily?: string; fontSize?: string } | null>(null);
  const [imageToolbarPos, setImageToolbarPos] = useState<{ top: number; left: number } | null>(null);
  const paperRef = useRef<HTMLDivElement | null>(null);
  const selectionRef = useRef<{ from: number; to: number } | null>(null);
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const assetsRef = useRef(assets); assetsRef.current = assets;
  const editor = useEditor({
    extensions: [StarterKit, Highlight, TextStyleKit.configure({ color: false, backgroundColor: false, lineHeight: false }), NoteAnnotation, ProjectImage],
    content: updateImageNodes(note.document, assets),
    editable: !initialReadMode,
    onUpdate: ({ editor: active }) => {
      const document = noteDocumentSchema.parse(active.getJSON());
      onChangeRef.current(draft => { draft.document = document; });
    },
    onSelectionUpdate: ({ editor: active }) => {
      if (!active.state.selection.empty) selectionRef.current = { from: active.state.selection.from, to: active.state.selection.to };
      const node = (active.state.selection as typeof active.state.selection & { node?: { type: { name: string }; attrs: Record<string, unknown> } }).node ?? active.state.selection.$from.nodeAfter;
      if (node?.type.name === 'projectImage') {
        setImageSelection({ position: active.state.selection.from, width: Number(node.attrs.width) || 320, align: node.attrs.align as 'left' | 'center' | 'right' });
        updateImageToolbarPos(active, active.state.selection.from);
      } else if (!active.state.selection.empty) setImageSelection(null);
      // 字体/字号仅作用于非空选区；无选区显示为空。
      if (active.state.selection.empty) setSelectionStyle(null);
      else {
        const attrs = active.getAttributes('textStyle') as { fontFamily?: string; fontSize?: string };
        setSelectionStyle({ fontFamily: attrs.fontFamily ?? note.typography.fontFamily, fontSize: attrs.fontSize ?? `${note.typography.fontSize}px` });
      }
    }
  }, [note.id]);
  const updateImageToolbarPos = (active: TiptapEditor, position: number) => {
    const paper = paperRef.current;
    if (!paper) return;
    try {
      const start = active.view.coordsAtPos(position);
      const box = paper.getBoundingClientRect();
      setImageToolbarPos({ top: start.top - box.top - 38, left: start.left - box.left });
    } catch { setImageToolbarPos(null); }
  };
  useEffect(() => { editor?.setEditable(!readMode); }, [editor, readMode]);
  // 阅读模式正文只读，但允许选择文字：把浏览器原生选区映射回 ProseMirror，让浮动菜单也能在只读正文上执行划线与批注。
  useEffect(() => {
    if (!editor || !readMode) return;
    const onSelectionChange = () => {
      const dom = window.getSelection();
      if (!dom || !dom.rangeCount || dom.isCollapsed || !dom.anchorNode || !dom.focusNode || !editor.view.dom.contains(dom.anchorNode)) {
        if (editor.isEditable) editor.setEditable(false);
        return;
      }
      try {
        const anchor = editor.view.posAtDOM(dom.anchorNode, dom.anchorOffset);
        const focus = editor.view.posAtDOM(dom.focusNode, dom.focusOffset);
        if (anchor !== focus) {
          if (!editor.isEditable) editor.setEditable(true);
          editor.commands.setTextSelection({ from: Math.min(anchor, focus), to: Math.max(anchor, focus) });
        }
      } catch { /* 无法映射的浏览器选区保持现状 */ }
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => { document.removeEventListener('selectionchange', onSelectionChange); };
  }, [editor, readMode]);
  useEffect(() => {
    if (!editor) return;
    const current = JSON.stringify(editor.getJSON());
    const incoming = JSON.stringify(updateImageNodes(note.document, assets));
    if (current !== incoming) editor.commands.setContent(updateImageNodes(note.document, assets), { emitUpdate: false });
  }, [editor, note.document, assets]);
  useEffect(() => { setReadMode(initialReadMode); setActiveAnnotation(null); }, [note.id, initialReadMode]);
  const typo = note.typography;
  const ruleSpacing = Math.max(typo.ruledSpacing, Math.round(typo.fontSize * typo.lineHeight));
  const setTypography = (patch: Partial<typeof typo>) => onChange(draft => { draft.typography = { ...draft.typography, ...patch }; });
  // 阅读模式保持正文不可直接输入；划线与批注是明确允许的选择性写操作，短暂打开命令通道后立即恢复锁定。
  const runSelectionCommand = (command: (active: TiptapEditor) => void) => {
    if (!editor) return;
    const restoreLocked = readMode;
    if (readMode && !editor.isEditable) editor.setEditable(true);
    const domSelection = window.getSelection();
    let mappedDomSelection = false;
    if (domSelection?.rangeCount && domSelection.anchorNode && domSelection.focusNode && editor.view.dom.contains(domSelection.anchorNode) && editor.view.dom.contains(domSelection.focusNode)) {
      try {
        const anchor = editor.view.posAtDOM(domSelection.anchorNode, domSelection.anchorOffset);
        const focus = editor.view.posAtDOM(domSelection.focusNode, domSelection.focusOffset);
        if (anchor !== focus) {
          editor.commands.setTextSelection({ from: Math.min(anchor, focus), to: Math.max(anchor, focus) });
          mappedDomSelection = true;
        }
      } catch { /* 无法映射的浏览器原生选区保持现有编辑器选区 */ }
    }
    if (!mappedDomSelection && readMode && selectionRef.current) editor.commands.setTextSelection(selectionRef.current);
    command(editor);
    if (!editor.state.selection.empty) selectionRef.current = { from: editor.state.selection.from, to: editor.state.selection.to };
    if (restoreLocked) editor.setEditable(false);
  };
  const addAnnotation = () => {
    let id: string | null = null;
    runSelectionCommand(active => {
      if (active.state.selection.empty) return;
      id = crypto.randomUUID();
      onChange(draft => { draft.annotations.push({ id: id!, note: '', color: annotationColor }); });
      requestAnimationFrame(() => runSelectionCommand(next => next.chain().setMark('noteAnnotation', { id }).run()));
    });
    if (id) setActiveAnnotation(id);
  };
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
  const importAtCursor = async (files: File[]) => {
    if (!editor || !files.length) return;
    const position = editor.state.selection.from;
    const imported = await onImportImages(files);
    for (const asset of imported.filter(item => item.kind === 'image')) insertImage(asset.id, position, asset);
  };
  const setFontFamily = (fontFamily: string) => runSelectionCommand(active => { active.chain().setFontFamily(fontFamily).run(); });
  const setFontSize = (fontSize: string) => runSelectionCommand(active => { active.chain().setFontSize(`${fontSize}px`).run(); });
  const used = noteAnnotationIds(note.document);
  const annotations = note.annotations.filter(annotation => annotation.orphaned || used.has(annotation.id));
  // mark 的实际行盒是唯一定位依据；同一批注跨段时取最靠前的可见标记。
  useLayoutEffect(() => {
    const paper = paperRef.current;
    if (!paper) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = paper.getBoundingClientRect();
        let previousBottom = 0;
        const next = annotations.map(annotation => {
          const marks = Array.from(paper.querySelectorAll<HTMLElement>(`[data-note-annotation="${annotation.id}"]`));
          const mark = marks.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
          const sourceY = mark ? mark.getBoundingClientRect().top - box.top + mark.getBoundingClientRect().height / 2 : previousBottom + 18;
          const top = Math.max(0, sourceY - 28, previousBottom + 10);
          previousBottom = top + 76;
          return { id: annotation.id, top, sourceY, orphaned: !mark };
        });
        setAnnotationLayout(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
      });
    };
    update();
    const observer = new ResizeObserver(update); observer.observe(paper);
    paper.addEventListener('scroll', update, { passive: true });
    addEventListener('resize', update);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); paper.removeEventListener('scroll', update); removeEventListener('resize', update); };
  }, [annotations, note.document, typo.marginX, typo.marginY, typo.fontSize, typo.lineHeight]);
  return <div className="note-editor">
    <header className="note-toolbar">
      <input className="note-title" aria-label={t('笔记名称', 'Note name')} value={note.name} onChange={event => onChange(draft => { draft.name = event.target.value; })} />
      <div className="note-start-group" aria-label={t('开始', 'Home')}>
        <span className="note-start-label">{t('开始', 'Home')}</span>
        <label className="note-inline-control">{t('字体', 'Font')}<select aria-label={t('字体', 'Font')} value={selectionStyle?.fontFamily ?? ''} onChange={event => setFontFamily(event.target.value)}><option value=""></option>{FONT_FAMILIES.map(font => <option key={font} value={font}>{font}</option>)}</select></label>
        <label className="note-inline-control">{t('字号', 'Size')}<input aria-label={t('字号', 'Font size')} type="number" min="10" max="96" value={selectionStyle?.fontSize ? parseInt(selectionStyle.fontSize, 10) : ''} placeholder="" onChange={event => { const value = Math.max(10, Math.min(96, Number(event.target.value) || 10)); setFontSize(String(value)); }} /></label>
        <label className="note-inline-control">{t('行距', 'Line height')}<input aria-label={t('行距', 'Line height')} type="number" min="1" max="3" step="0.1" value={typo.lineHeight} onChange={event => setTypography({ lineHeight: Math.max(1, Math.min(3, Number(event.target.value) || 2)) })} /></label>
        <label className="note-inline-control">{t('版心', 'Margins')}<input aria-label={t('版心', 'Margins')} type="number" min="24" max="160" value={typo.marginX} onChange={event => setTypography({ marginX: Math.max(24, Math.min(160, Number(event.target.value) || 72)) })} /></label>
      </div>
      <button aria-pressed={annotationsOpen} onClick={() => setAnnotationsOpen(value => !value)}>{annotationsOpen ? t('收起批注', 'Hide notes') : t('打开批注', 'Show notes')}</button>
      <button aria-pressed={previewOpen} onClick={() => setPreviewOpen(value => !value)}>{previewOpen ? t('关闭预览', 'Close preview') : t('分屏预览', 'Split preview')}</button>
      <button aria-pressed={readMode} onClick={() => { setReadMode(value => !value); setActiveAnnotation(null); }}>{readMode ? t('编辑模式', 'Edit') : t('阅读模式', 'Read')}</button>
    </header>
    <div className={`note-layout${previewOpen ? ' note-layout-preview' : ''}`}>
      {annotationsOpen && <aside className="note-annotations">
        <svg className="note-annotation-lines" aria-hidden="true">{annotationLayout.map(layout => !layout.orphaned && <path key={layout.id} d={`M35 ${layout.sourceY}H18V${layout.top + 28}H0`} />)}</svg>
        {annotations.map(annotation => { const layout = annotationLayout.find(item => item.id === annotation.id); return <div key={annotation.id} className="note-annotation" style={{ top: layout?.top ?? 0 }}>
          <span className="note-annotation-dot" />
          {annotation.orphaned && <span className="note-reference-lost">{t('引用原文已删除', 'Reference deleted')}</span>}
          {activeAnnotation === annotation.id
            ? <textarea autoFocus value={annotation.note} onChange={event => onChange(draft => { const target = draft.annotations.find(item => item.id === annotation.id); if (target) target.note = event.target.value; })} onBlur={() => setActiveAnnotation(null)} placeholder={t('批注内容…', 'Annotation…')} />
            : <button className="note-annotation-text" onClick={() => setActiveAnnotation(annotation.id)}>{annotation.note || t('写批注…', 'Write annotation…')}</button>}
          <button className="note-annotation-del" aria-label={t('删除批注', 'Delete annotation')} onClick={() => onChange(draft => { draft.annotations = draft.annotations.filter(item => item.id !== annotation.id); })}>×</button>
        </div>; })}
      </aside>}
      <div ref={paperRef} className="note-paper" style={{ padding: `0 ${typo.marginX}px`, fontSize: typo.fontSize, fontFamily: typo.fontFamily, ['--note-rule' as string]: `${ruleSpacing}px`, ['--note-margin-y' as string]: `${typo.marginY}px`, ['--note-baseline' as string]: `${ruleSpacing - Math.max(3, Math.round(typo.fontSize * .14))}px` }}>
        <EditorContent editor={editor} className="note-text note-tiptap" onClick={event => { if (!(event.target as Element).closest('.note-project-image')) setImageSelection(null); }} onDragOver={event => { if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault(); }} onDrop={event => { const files = Array.from(event.dataTransfer.files).filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void importAtCursor(files); } }} onPaste={event => { const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void importAtCursor(files); } }} />
        {imageSelection && imageToolbarPos && <div className="note-image-tools" style={{ top: imageToolbarPos.top, left: imageToolbarPos.left }}>
          <label>{t('图片宽度', 'Image width')}<input aria-label={t('图片宽度', 'Image width')} type="number" min="80" max="1600" disabled={readMode} value={imageSelection.width} onChange={event => { const width = Math.max(80, Math.min(1600, Number(event.target.value) || 320)); setImageSelection({ ...imageSelection, width }); updateSelectedImage({ width }); }} /></label>
          {(['left', 'center', 'right'] as const).map(align => <button key={align} disabled={readMode} aria-pressed={imageSelection.align === align} onMouseDown={event => event.preventDefault()} onClick={() => { setImageSelection({ ...imageSelection, align }); updateSelectedImage({ align }); }}>{t(({ left: '左', center: '中', right: '右' })[align], align)}</button>)}
        </div>}
      </div>
      {previewOpen && <MarkdownPreview document={note.document} assets={assets} />}
    </div>
    {editor && <BubbleMenu editor={editor} shouldShow={({ editor: active }) => !active.state.selection.empty} options={{ placement: 'top', offset: 8 }}>
      <div className="note-bubble-menu">
        <button aria-pressed={editor.isActive('paragraph')} onMouseDown={event => event.preventDefault()} onClick={() => runSelectionCommand(active => active.chain().setParagraph().run())}>{t('段落', 'Paragraph')}</button>
        <button aria-pressed={editor.isActive('heading', { level: 2 })} onMouseDown={event => event.preventDefault()} onClick={() => runSelectionCommand(active => active.chain().toggleHeading({ level: 2 }).run())}>{t('标题', 'Heading')}</button>
        <button aria-pressed={editor.isActive('bold')} onMouseDown={event => event.preventDefault()} onClick={() => runSelectionCommand(active => active.chain().toggleBold().run())}>{t('粗体', 'Bold')}</button>
        <button aria-pressed={editor.isActive('italic')} onMouseDown={event => event.preventDefault()} onClick={() => runSelectionCommand(active => active.chain().toggleItalic().run())}>{t('斜体', 'Italic')}</button>
        <button aria-pressed={editor.isActive('underline')} onMouseDown={event => event.preventDefault()} onClick={() => runSelectionCommand(active => active.chain().toggleUnderline().run())}>{t('下划线', 'Underline')}</button>
        <button aria-pressed={editor.isActive('strike')} onMouseDown={event => event.preventDefault()} onClick={() => runSelectionCommand(active => active.chain().toggleStrike().run())}>{t('删除线', 'Strikethrough')}</button>
        <button aria-pressed={editor.isActive('highlight')} onMouseDown={event => event.preventDefault()} onClick={() => runSelectionCommand(active => active.chain().toggleHighlight().run())}>{t('划线', 'Highlight')}</button>
        <button onMouseDown={event => event.preventDefault()} onClick={addAnnotation}>{t('批注', 'Annotate')}</button>
      </div>
    </BubbleMenu>}
  </div>;
}

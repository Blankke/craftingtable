// 单编辑器笔记界面：Tiptap JSON 是正文唯一事实，批注 mark 与右侧卡片通过稳定 ID 关联。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor as TiptapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import { Mark, Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import type { Note } from '../core/note';
import { noteAnnotationIds, noteDocumentSchema } from '../core/note';
import type { ProjectDocument } from '../core/document';
import { mediaSource } from './mediaSource';
import { useLanguage } from './language';

const highlightColors = ['#ffd97a', '#ffb3a7', '#b3e5c8', '#a7d8ff', '#e6c3ff', '#ffd1e8'];
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

export function NoteEditor({ note, assets, initialReadMode = false, onBack, onChange, onImportImages }: {
  note: Note; assets: ProjectDocument['assets']; initialReadMode?: boolean;
  onBack(): void; onChange(change: (draft: Note) => void): void; onImportImages(files: File[]): Promise<ProjectDocument['assets']>;
}) {
  const { t } = useLanguage();
  const [readMode, setReadMode] = useState(initialReadMode);
  const [activeAnnotation, setActiveAnnotation] = useState<string | null>(null);
  const [annotationLayout, setAnnotationLayout] = useState<AnnotationLayout[]>([]);
  const [imageSelection, setImageSelection] = useState<ImageSelection>(null);
  const paperRef = useRef<HTMLDivElement | null>(null);
  const selectionRef = useRef<{ from: number; to: number } | null>(null);
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const assetsRef = useRef(assets); assetsRef.current = assets;
  const editor = useEditor({
    extensions: [StarterKit, Highlight.configure({ multicolor: true }), NoteAnnotation, ProjectImage],
    content: updateImageNodes(note.document, assets),
    editable: !initialReadMode,
    onUpdate: ({ editor: active }) => {
      const document = noteDocumentSchema.parse(active.getJSON());
      onChangeRef.current(draft => { draft.document = document; });
    },
    onSelectionUpdate: ({ editor: active }) => {
      if (!active.state.selection.empty) selectionRef.current = { from: active.state.selection.from, to: active.state.selection.to };
      const node = (active.state.selection as typeof active.state.selection & { node?: { type: { name: string }; attrs: Record<string, unknown> } }).node ?? active.state.selection.$from.nodeAfter;
      if (node?.type.name === 'projectImage') setImageSelection({ position: active.state.selection.from, width: Number(node.attrs.width) || 320, align: node.attrs.align as 'left' | 'center' | 'right' });
      // updateAttributes 期间 ProseMirror 可能短暂把 NodeSelection 变为折叠选区；
      // 此时保留现有图片工具，避免输入宽度后对齐控件消失。
      else if (!active.state.selection.empty) setImageSelection(null);
    }
  }, [note.id]);
  useEffect(() => { editor?.setEditable(!readMode); }, [editor, readMode]);
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
    const restoreLocked = readMode && !editor.isEditable;
    if (restoreLocked) editor.setEditable(true);
    // contenteditable=false 时浏览器仍可选择文字，但不会总是触发 ProseMirror 的 selection 更新；
    // 先把 DOM 选区换算为文档位置，保证阅读模式的划线和批注绑定实际选中文字。
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
      id = crypto.randomUUID(); const color = '#ffd97a';
      // 先写入批注实体，随后再写正文 mark；任一保存时刻都满足“mark 必有元数据”的关系校验。
      onChange(draft => { draft.annotations.push({ id: id!, note: '', color }); });
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
    // 属性按钮以保存的 NodeSelection 作为目标，不依赖输入控件引发的临时折叠选区。
    editor.chain().setNodeSelection(imageSelection.position).updateAttributes('projectImage', attrs).run();
  };
  const importAtCursor = async (files: File[]) => {
    if (!editor || !files.length) return;
    const position = editor.state.selection.from;
    const imported = await onImportImages(files);
    for (const asset of imported.filter(item => item.kind === 'image')) insertImage(asset.id, position, asset);
  };
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
          // 卡片高度会随文字变化，使用保守最小间距避免堆叠；布局每次重绘都会再校准。
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
      <button onClick={onBack}>{t('‹ 返回画布', '‹ Back to canvas')}</button>
      <input className="note-title" aria-label={t('笔记名称', 'Note name')} value={note.name} onChange={event => onChange(draft => { draft.name = event.target.value; })} />
      <button aria-pressed={readMode} onClick={() => { setReadMode(value => !value); setActiveAnnotation(null); }}>{readMode ? t('编辑模式', 'Edit') : t('阅读模式', 'Read')}</button>
      <label>{t('字号', 'Size')}<input aria-label={t('字号', 'Font size')} type="number" min="12" max="32" value={typo.fontSize} onChange={e => setTypography({ fontSize: Math.max(12, Math.min(32, Number(e.target.value) || 17)) })} /></label>
      <label>{t('行距', 'Line height')}<input aria-label={t('行距', 'Line height')} type="number" min="1" max="3" step="0.1" value={typo.lineHeight} onChange={e => setTypography({ lineHeight: Math.max(1, Math.min(3, Number(e.target.value) || 2)) })} /></label>
      <label>{t('字体', 'Font')}<select value={typo.fontFamily} onChange={e => setTypography({ fontFamily: e.target.value })}>{['Georgia', 'Microsoft YaHei', 'SimSun', 'Arial'].map(font => <option key={font}>{font}</option>)}</select></label>
      <label>{t('版心', 'Margins')}<input aria-label={t('版心', 'Margins')} type="number" min="24" max="160" value={typo.marginX} onChange={e => setTypography({ marginX: Math.max(24, Math.min(160, Number(e.target.value) || 72)) })} /></label>
    </header>
    <div className="note-actions">
      {highlightColors.map(color => <button key={color} className="note-highlight" aria-label={color} style={{ background: color }} onMouseDown={event => event.preventDefault()} onClick={() => runSelectionCommand(active => active.chain().toggleHighlight({ color }).run())}>{t('划线', 'Highlight')}</button>)}
      <button onMouseDown={event => event.preventDefault()} onClick={addAnnotation}>{t('＋ 批注', '＋ Annotate')}</button>
      <select value="" aria-label={t('插入图片', 'Insert image')} disabled={readMode} onChange={event => { if (event.target.value) insertImage(event.target.value); }}><option value="">{t('＋ 插入图片…', '＋ Insert image…')}</option>{assets.filter(asset => asset.kind === 'image').map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select>
      {imageSelection && <><label>{t('图片宽度', 'Image width')}<input aria-label={t('图片宽度', 'Image width')} type="number" min="80" max="1600" disabled={readMode} value={imageSelection.width} onChange={event => { const width = Math.max(80, Math.min(1600, Number(event.target.value) || 320)); setImageSelection({ ...imageSelection, width }); updateSelectedImage({ width }); }} /></label>{(['left', 'center', 'right'] as const).map(align => <button key={align} disabled={readMode} aria-pressed={imageSelection.align === align} onMouseDown={event => event.preventDefault()} onClick={() => { setImageSelection({ ...imageSelection, align }); updateSelectedImage({ align }); }}>{t(({ left: '左', center: '中', right: '右' })[align], align)}</button>)}</>}
    </div>
    <div className="note-layout">
      <div ref={paperRef} className="note-paper" style={{ padding: `${typo.marginY}px ${typo.marginX}px`, fontSize: typo.fontSize, lineHeight: typo.lineHeight, fontFamily: typo.fontFamily, backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${ruleSpacing - 1}px, rgba(105,138,170,.28) ${ruleSpacing - 1}px, rgba(105,138,170,.28) ${ruleSpacing}px)` }}>
        <EditorContent editor={editor} className="note-text note-tiptap" onClick={event => { if (!(event.target as Element).closest('.note-project-image')) setImageSelection(null); }} onDragOver={event => { if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault(); }} onDrop={event => { const files = Array.from(event.dataTransfer.files).filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void importAtCursor(files); } }} onPaste={event => { const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); void importAtCursor(files); } }} />
      </div>
      <aside className="note-annotations">
        <svg className="note-annotation-lines" aria-hidden="true">{annotationLayout.map(layout => !layout.orphaned && <path key={layout.id} d={`M0 ${layout.sourceY}H18V${layout.top + 28}H34`} />)}</svg>
        {annotations.map(annotation => { const layout = annotationLayout.find(item => item.id === annotation.id); return <div key={annotation.id} className="note-annotation" style={{ borderColor: annotation.color, top: layout?.top ?? 0 }}>
          <span className="note-annotation-dot" style={{ background: annotation.color }} />
          {annotation.orphaned && <span className="note-reference-lost">{t('引用原文已删除', 'Reference deleted')}</span>}
          {activeAnnotation === annotation.id
            ? <textarea autoFocus value={annotation.note} onChange={event => onChange(draft => { const target = draft.annotations.find(item => item.id === annotation.id); if (target) target.note = event.target.value; })} onBlur={() => setActiveAnnotation(null)} placeholder={t('批注内容…', 'Annotation…')} />
            : <button className="note-annotation-text" onClick={() => setActiveAnnotation(annotation.id)}>{annotation.note || t('写批注…', 'Write annotation…')}</button>}
          <button className="note-annotation-del" aria-label={t('删除批注', 'Delete annotation')} onClick={() => onChange(draft => { draft.annotations = draft.annotations.filter(item => item.id !== annotation.id); })}>×</button>
        </div>; })}
      </aside>
    </div>
  </div>;
}

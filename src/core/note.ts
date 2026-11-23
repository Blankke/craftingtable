// 笔记的唯一正文契约：一份 Tiptap JSON 文档；图片节点只保存项目素材 ID，批注由稳定 ID 的 mark 锚定。
import { z } from 'zod';
import { richTextDocumentSchema, type RichTextNode, type RichTextDocument } from './richText';

export const noteTypographySchema = z.object({
  fontFamily: z.string(), fontSize: z.number().positive(), lineHeight: z.number().positive(),
  marginX: z.number().nonnegative(), marginY: z.number().nonnegative(), ruledSpacing: z.number().positive()
});

export const noteAnnotationSchema = z.object({ id: z.string().uuid(), note: z.string(), color: z.string(), orphaned: z.boolean().optional() });
export const noteSchema = z.object({ id: z.string().uuid(), name: z.string(), typography: noteTypographySchema, document: richTextDocumentSchema, annotations: z.array(noteAnnotationSchema) });
export type Note = z.infer<typeof noteSchema>;

// 仅供迁移入口解析历史文件，应用其他位置不得再依赖分块格式。
export const legacyNoteSchema = z.object({
  id: z.string().uuid(), name: z.string(), typography: noteTypographySchema,
  blocks: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('text'), text: z.string(), highlights: z.array(z.object({ id: z.string().uuid(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), color: z.string() })).default([]), annotations: z.array(z.object({ id: z.string().uuid(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), note: z.string(), color: z.string(), orphaned: z.boolean().optional() })).default([]) }),
    z.object({ kind: z.literal('image'), assetId: z.string().uuid(), width: z.number().positive(), align: z.enum(['left', 'center', 'right']).default('center') })
  ]))
});
export type LegacyNote = z.infer<typeof legacyNoteSchema>;

const paragraph = (content: RichTextNode[] = []): RichTextNode => ({ type: 'paragraph', content });

function legacyTextNode(block: Extract<LegacyNote['blocks'][number], { kind: 'text' }>): RichTextNode {
  const boundaries = new Set([0, block.text.length]);
  for (const range of [...block.highlights, ...block.annotations]) { boundaries.add(Math.max(0, Math.min(block.text.length, range.start))); boundaries.add(Math.max(0, Math.min(block.text.length, range.end))); }
  const positions = [...boundaries].sort((a, b) => a - b);
  const content: RichTextNode[] = [];
  for (let index = 0; index < positions.length - 1; index++) {
    const start = positions[index], end = positions[index + 1], text = block.text.slice(start, end);
    if (!text) continue;
    const marks: NonNullable<RichTextNode['marks']> = [];
    const highlight = block.highlights.find(range => range.start <= start && range.end >= end);
    if (highlight) marks.push({ type: 'highlight', attrs: { color: highlight.color } });
    for (const annotation of block.annotations.filter(range => !range.orphaned && range.start <= start && range.end >= end)) marks.push({ type: 'noteAnnotation', attrs: { id: annotation.id } });
    content.push({ type: 'text', text, ...(marks.length ? { marks } : {}) });
  }
  return paragraph(content);
}

export function migrateLegacyNote(legacy: LegacyNote): Note {
  return {
    id: legacy.id, name: legacy.name, typography: legacy.typography,
    document: { type: 'doc', content: legacy.blocks.map(block => block.kind === 'text'
      ? legacyTextNode(block)
      : ({ type: 'projectImage', attrs: { assetId: block.assetId, width: block.width, align: block.align } })) },
    annotations: legacy.blocks.flatMap(block => block.kind === 'text' ? block.annotations.map(({ id, note, color, orphaned }) => ({ id, note, color, ...(orphaned ? { orphaned } : {}) })) : [])
  };
}

export function newNote(name: string): Note {
  return {
    id: crypto.randomUUID(), name,
    typography: { fontFamily: 'Georgia', fontSize: 17, lineHeight: 2, marginX: 72, marginY: 56, ruledSpacing: 34 },
    document: { type: 'doc', content: [paragraph()] }, annotations: []
  };
}

export function noteText(note: Pick<Note, 'document'>): string {
  const collect = (nodes: RichTextNode[] | undefined): string => (nodes ?? []).map(node => node.type === 'text' ? node.text ?? '' : node.type === 'projectImage' ? '' : collect(node.content)).join((nodes ?? []).some(node => node.type === 'paragraph' || node.type === 'heading') ? '\n' : '');
  return collect(note.document.content).replace(/\n{3,}/g, '\n\n').trim();
}

export function noteAssetIds(note: Pick<Note, 'document'>): string[] {
  const ids = new Set<string>();
  const visit = (nodes: RichTextNode[] | undefined) => (nodes ?? []).forEach(node => { if (node.type === 'projectImage' && typeof node.attrs?.assetId === 'string') ids.add(node.attrs.assetId); visit(node.content); });
  visit(note.document.content);
  return [...ids];
}

export function noteAnnotationIds(document: RichTextDocument): Set<string> {
  const ids = new Set<string>();
  const visit = (nodes: RichTextNode[] | undefined) => (nodes ?? []).forEach(node => { node.marks?.forEach(mark => { if (mark.type === 'noteAnnotation' && typeof mark.attrs?.id === 'string') ids.add(mark.attrs.id); }); visit(node.content); });
  visit(document.content);
  return ids;
}

export function refreshAnnotationReferences(note: Note): void {
  const used = noteAnnotationIds(note.document);
  note.annotations = note.annotations.map(annotation => ({ ...annotation, ...(used.has(annotation.id) ? { orphaned: false } : { orphaned: true }) }));
}

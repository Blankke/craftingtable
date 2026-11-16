import { z } from 'zod';
import { legacyNoteSchema, migrateLegacyNote, noteAnnotationIds, noteAssetIds, noteSchema } from './note';

// 所有时间均为源素材的整数微秒，路径均相对项目目录。
export const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export const assetSchema = z.object({
  id: z.string().uuid(), name: z.string(), path: z.string(),
  kind: z.enum(['video', 'audio', 'image', 'text']), durationUs: z.number().int().nonnegative().optional(),
  status: z.enum(['ready', 'missing', 'unsupported', 'processing']).default('ready'),
  thumbnail: z.string().optional(), content: z.string().optional()
});
// 图库采用固定的 draw.io 24.7 基础定义；工具预览和画布共用同一标识与路径。
export const shapeKinds = ['rectangle', 'roundedRectangle', 'ellipse', 'diamond', 'triangle', 'hexagon', 'parallelogram', 'trapezoid', 'cylinder', 'document', 'cloud', 'star', 'callout', 'cross', 'arrowShape', 'actor', 'folder', 'heart', 'lightning', 'moon', 'ring', 'speech', 'cube', 'leftArrow', 'rightArrow', 'upArrow', 'downArrow', 'leftRightArrow', 'upDownArrow', 'quadArrow', 'process', 'terminator', 'data', 'predefinedProcess', 'manualInput', 'manualOperation', 'delay', 'display', 'multidocument', 'preparation', 'offPage', 'internalStorage', 'merge'] as const;
// 样式与文本为所有可绘制对象共用，避免形状文字与独立文字出现两套编辑契约。
export const visualStyleSchema = z.object({
  fillEnabled: z.boolean(), fill: z.string(), gradient: z.boolean(), gradientColor: z.string(), gradientDirection: z.enum(['vertical', 'horizontal']),
  strokeEnabled: z.boolean(), stroke: z.string(), strokeWidth: z.number().min(0).max(40), dash: z.enum(['solid', 'dashed', 'dotted']),
  perimeter: z.number().min(0).max(100), opacity: z.number().min(0).max(1),
  fontFamily: z.string(), bold: z.boolean(), italic: z.boolean(), underline: z.boolean(), verticalAlign: z.enum(['top', 'middle', 'bottom'])
});
const base = { id: z.string().uuid(), x: z.number().finite(), y: z.number().finite(), width: z.number().positive(), height: z.number().positive(), rotation: z.number().finite().optional(), groupId: z.string().uuid().nullable(), style: visualStyleSchema.optional() };
export const objectSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('text'), text: z.string(), fontSize: z.number().positive(), color: z.string(), align: z.enum(['left', 'center', 'right']), assetId: z.string().uuid().optional() }),
  z.object({ ...base, kind: z.enum(shapeKinds), fill: z.string(), stroke: z.string(), text: z.string().optional(), fontSize: z.number().positive().optional(), color: z.string().optional(), align: z.enum(['left', 'center', 'right']).optional() }),
  z.object({ ...base, kind: z.literal('image'), assetId: z.string().uuid(), aspectLocked: z.boolean().optional(), crop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).refine(crop => crop.x + crop.width <= 1.000001 && crop.y + crop.height <= 1.000001, '裁剪区域超出原图').optional() }),
  z.object({ ...base, kind: z.literal('media'), assetId: z.string().uuid(), inUs: z.number().int().nonnegative(), outUs: z.number().int().nonnegative(), pixelsPerSecond: z.number().positive(), color: z.string().optional(), autoColor: z.boolean().optional() }),
  z.object({ ...base, kind: z.literal('note'), noteId: z.string().uuid() }),
  z.object({ ...base, kind: z.literal('stroke'), points: z.array(pointSchema).min(2), color: z.string(), strokeWidth: z.number().positive() })
]);
export const anchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('free'), point: pointSchema }),
  z.object({ kind: z.literal('object'), objectId: z.string().uuid() }),
  z.object({ kind: z.literal('time'), markerId: z.string().uuid() })
]);
// 连接线样式：默认虚线、实心箭头；可选起止头部与线型（对齐 draw.io）。
export const connectionStyleSchema = z.object({
  color: z.string().optional(),
  strokeWidth: z.number().min(0).max(40).optional(),
  dash: z.enum(['solid', 'dashed', 'dotted', 'dash-dot', 'custom']).optional(),
  customDash: z.array(z.number().positive().max(100)).min(2).max(8).optional(),
  rounded: z.boolean().optional(), opacity: z.number().min(0).max(1).optional(),
  headSize: z.number().min(4).max(64).optional(), label: z.string().max(200).optional(),
  startHead: z.enum(['none', 'arrow', 'open', 'diamond', 'circle', 'square', 'block']).optional(),
  endHead: z.enum(['none', 'arrow', 'open', 'diamond', 'circle', 'square', 'block']).optional()
});
export type ConnectionStyle = z.infer<typeof connectionStyleSchema>;
export const documentSchema = z.object({
  schemaVersion: z.literal(3), id: z.string().uuid(), name: z.string(), revision: z.number().int().nonnegative(),
  camera: z.object({ x: z.number(), y: z.number(), scale: z.number().positive() }),
  assets: z.array(assetSchema), objects: z.array(objectSchema),
  groups: z.array(z.object({ id: z.string().uuid(), parentId: z.string().uuid().nullable() })),
  markers: z.array(z.object({ id: z.string().uuid(), mediaId: z.string().uuid(), timeUs: z.number().int().nonnegative(), note: z.string() })),
  connections: z.array(z.object({ id: z.string().uuid(), from: anchorSchema, to: anchorSchema, routing: z.enum(['straight', 'elbow', 'curve']), style: connectionStyleSchema.optional() })),
  notes: z.array(noteSchema)
});
export type ProjectDocument = z.infer<typeof documentSchema>;
export type CanvasObject = ProjectDocument['objects'][number];
export type Anchor = ProjectDocument['connections'][number]['from'];

// 历史格式只在读取入口保留，迁移成功后应用中仅流转当前契约。
const legacyDocumentSchema = documentSchema.omit({ schemaVersion: true, notes: true }).extend({ schemaVersion: z.union([z.literal(1), z.literal(2)]), notes: z.array(legacyNoteSchema).optional() });
export function readProjectDocument(raw: unknown): { document: ProjectDocument; migrated: boolean } {
  const version = z.object({ schemaVersion: z.number().int() }).parse(raw).schemaVersion;
  if (version === 3) {
    const document = documentSchema.parse(raw);
    validateRelations(document);
    return { document, migrated: false };
  }
  if (version !== 1 && version !== 2) throw Error(`不支持的项目格式版本：${version}`);
  const legacy = legacyDocumentSchema.parse(raw);
  const document = documentSchema.parse({ ...legacy, schemaVersion: 3, notes: (legacy.notes ?? []).map(migrateLegacyNote) });
  validateRelations(document);
  return { document, migrated: true };
}

export function newDocument(name: string): ProjectDocument {
  return { schemaVersion: 3, id: crypto.randomUUID(), name, revision: 0, camera: { x: 0, y: 0, scale: 1 }, assets: [], objects: [], groups: [], markers: [], connections: [], notes: [] };
}

export function mediaWidth(object: Extract<CanvasObject, { kind: 'media' }>): number {
  // 轨道宽度仅由源区间和时间显示比例决定，不加入隐含的最小宽度。
  return (object.outUs - object.inUs) / 1_000_000 * object.pixelsPerSecond;
}

export function resolveAnchor(document: ProjectDocument, anchor: Anchor, towards?: { x: number; y: number }): { x: number; y: number } | null {
  if (anchor.kind === 'free') return anchor.point;
  if (anchor.kind === 'object') {
    const object = document.objects.find(item => item.id === anchor.objectId);
    if (!object) return null;
    const halfWidth = (object.kind === 'media' ? mediaWidth(object) : object.width) / 2, halfHeight = object.height / 2;
    const center = { x: object.x + halfWidth, y: object.y + halfHeight };
    if (!towards) return center;
    // 连线止于对象边界；周长间距控制边框与箭头之间的留白。
    const dx = towards.x - center.x, dy = towards.y - center.y, distance = Math.hypot(dx, dy);
    if (!distance) return center;
    const factor = object.kind === 'ellipse' ? 1 / Math.sqrt((dx / halfWidth) ** 2 + (dy / halfHeight) ** 2) : Math.min(halfWidth / Math.abs(dx || Number.EPSILON), halfHeight / Math.abs(dy || Number.EPSILON));
    const offset = Math.min(1, factor + (object.style?.perimeter ?? 0) / distance);
    return { x: center.x + dx * offset, y: center.y + dy * offset };
  }
  const marker = document.markers.find(item => item.id === anchor.markerId);
  const media = document.objects.find(item => item.id === marker?.mediaId);
  if (!marker || media?.kind !== 'media' || marker.timeUs < media.inUs || marker.timeUs > media.outUs) return null;
  return { x: media.x + (marker.timeUs - media.inUs) / 1_000_000 * media.pixelsPerSecond, y: media.y + media.height / 2 };
}

export function validateRelations(document: ProjectDocument): void {
  const objectIds = new Set(document.objects.map(item => item.id));
  const assetIds = new Set(document.assets.map(item => item.id));
  const markerIds = new Set(document.markers.map(item => item.id));
  const groupIds = new Set(document.groups.map(item => item.id));
  const noteIds = new Set(document.notes.map(item => item.id));
  for (const note of document.notes) {
    for (const assetId of noteAssetIds(note)) if (!assetIds.has(assetId)) throw Error('笔记图片素材不存在');
    const annotationIds = new Set(note.annotations.map(annotation => annotation.id));
    if (annotationIds.size !== note.annotations.length) throw Error('笔记批注 ID 重复');
    for (const annotationId of noteAnnotationIds(note.document)) if (!annotationIds.has(annotationId)) throw Error('笔记批注锚点不存在');
  }
  for (const object of document.objects) {
    if (object.groupId && !groupIds.has(object.groupId)) throw Error('对象分组不存在');
    if ('assetId' in object && object.assetId && !assetIds.has(object.assetId)) throw Error('对象素材不存在');
    if (object.kind === 'note' && !noteIds.has(object.noteId)) throw Error('对象笔记不存在');
    if (object.kind === 'media' && object.inUs >= object.outUs) throw Error('裁剪区间无效');
  }
  for (const marker of document.markers) if (document.objects.find(item => item.id === marker.mediaId)?.kind !== 'media') throw Error('标记轨道不存在');
  for (const connection of document.connections) for (const anchor of [connection.from, connection.to]) {
    if (anchor.kind === 'object' && !objectIds.has(anchor.objectId)) throw Error('连线对象不存在');
    if (anchor.kind === 'time' && !markerIds.has(anchor.markerId)) throw Error('连线标记不存在');
  }
  for (const group of document.groups) if (group.parentId && !groupIds.has(group.parentId)) throw Error('父分组不存在');
  for (const group of document.groups) {
    const seen = new Set([group.id]);
    let parentId = group.parentId;
    while (parentId) {
      if (seen.has(parentId)) throw Error('分组层级存在循环');
      seen.add(parentId);
      parentId = document.groups.find(item => item.id === parentId)?.parentId ?? null;
    }
  }
}

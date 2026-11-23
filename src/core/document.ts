import { z } from 'zod';
import { richTextDocumentSchema } from './richText';
import { canvasTextFromPlainText, emptyCanvasText } from './canvasText';
import { legacyNoteSchema, migrateLegacyNote, noteAnnotationIds, noteAssetIds, noteSchema } from './note';

// 所有时间均为源素材的整数微秒，路径均相对项目目录。
export const PROJECT_SCHEMA_VERSION = 5;
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
// 形状调节点和书写方向随对象保存；所有渲染与导出使用同一组归一化参数。
export const shapeAdjustmentSchema = z.object({ radius: z.number().min(0).max(.5).optional(), tailX: z.number().min(-1).max(2).optional(), tailY: z.number().min(-1).max(2).optional(), inset: z.number().min(0).max(.45).optional(), shaft: z.number().min(.1).max(.9).optional(), head: z.number().min(.1).max(.9).optional() });
const writingMode = z.enum(['horizontal-tb', 'vertical-rl']).optional();
const base = { id: z.string().uuid(), x: z.number().finite(), y: z.number().finite(), width: z.number().positive(), height: z.number().positive(), rotation: z.number().finite().optional(), groupId: z.string().uuid().nullable(), style: visualStyleSchema.optional(), locked: z.boolean().optional(), name: z.string().max(200).optional(), description: z.string().max(10_000).optional(), href: z.string().max(4096).optional(), connectionPoints: z.array(z.object({ id: z.string().uuid(), x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).max(32).optional() };
const imageObjectSchema = z.object({ ...base, kind: z.literal('image'), assetId: z.string().uuid(), caption: z.string().optional(), aspectLocked: z.boolean().optional(), crop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).refine(crop => crop.x + crop.width <= 1.000001 && crop.y + crop.height <= 1.000001, '裁剪区域超出原图').optional() });
export const objectSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('text'), text: richTextDocumentSchema, fontSize: z.number().positive(), color: z.string(), align: z.enum(['left', 'center', 'right']), writingMode, assetId: z.string().uuid().optional() }),
  z.object({ ...base, kind: z.enum(shapeKinds), adjustments: shapeAdjustmentSchema.optional(), aspectLocked: z.boolean().optional(), fill: z.string(), stroke: z.string(), text: richTextDocumentSchema.optional(), fontSize: z.number().positive().optional(), color: z.string().optional(), align: z.enum(['left', 'center', 'right']).optional(), writingMode }),
  imageObjectSchema,
  z.object({ ...base, kind: z.literal('media'), assetId: z.string().uuid(), inUs: z.number().int().nonnegative(), outUs: z.number().int().nonnegative(), pixelsPerSecond: z.number().positive(), color: z.string().optional(), autoColor: z.boolean().optional() }),
  z.object({ ...base, kind: z.literal('note'), noteId: z.string().uuid() }),
  z.object({ ...base, kind: z.literal('stroke'), points: z.array(pointSchema).min(2), color: z.string(), strokeWidth: z.number().positive() }),
  // 叠图保留每张原图的身份、相对位置、裁剪与备注，收起后仍可还原和连接。
  z.object({ ...base, kind: z.literal('imageStack'), images: z.array(imageObjectSchema).min(2) })
]);
// 标准附着点由对象局部坐标定义，旋转、缩放和媒体时间宽度变化后自动跟随。
export const DEFAULT_CONNECTION_PORTS = [{ id: 'n', x: .5, y: 0 }, { id: 'e', x: 1, y: .5 }, { id: 's', x: .5, y: 1 }, { id: 'w', x: 0, y: .5 }] as const;
export const anchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('free'), point: pointSchema }),
  z.object({ kind: z.literal('object'), objectId: z.string().uuid(), pointId: z.string().uuid().optional(), port: z.enum(['n', 'e', 's', 'w']).optional() }),
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
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION), id: z.string().uuid(), name: z.string(), revision: z.number().int().nonnegative(),
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
export function objectAssetIds(object: CanvasObject): string[] {
  return object.kind === 'imageStack' ? object.images.map(image => image.assetId) : 'assetId' in object && object.assetId ? [object.assetId] : [];
}
export function objectMemberIds(object: CanvasObject): string[] {
  return object.kind === 'imageStack' ? [object.id, ...object.images.map(image => image.id)] : [object.id];
}

// 历史格式只在读取入口保留，迁移成功后应用中仅流转当前契约。
const legacyObjectSchema = z.discriminatedUnion('kind', [
  objectSchema.options[0].extend({ text: z.string() }),
  objectSchema.options[1].extend({ text: z.string().optional() }),
  ...objectSchema.options.slice(2)
]);
const legacyBase = documentSchema.omit({ schemaVersion: true, notes: true, objects: true }).extend({ objects: z.array(legacyObjectSchema) });
const legacyDocumentSchema = legacyBase.extend({ schemaVersion: z.union([z.literal(1), z.literal(2)]), notes: z.array(legacyNoteSchema).optional() });
const plainTextDocumentSchema = legacyBase.extend({ schemaVersion: z.literal(3), notes: z.array(noteSchema) });
export function readProjectDocument(raw: unknown): { document: ProjectDocument; migrated: boolean } {
  const version = z.object({ schemaVersion: z.number().int() }).parse(raw).schemaVersion;
  if (version === PROJECT_SCHEMA_VERSION) {
    const document = documentSchema.parse(raw);
    validateRelations(document);
    return { document, migrated: false };
  }
  if (version === 4) {
    // 旧运行时会丢弃新增几何与书写方向字段，升级格式以让进程版本核对阻止这种静默丢失。
    const previous = documentSchema.extend({ schemaVersion: z.literal(4) }).parse(raw);
    const document = documentSchema.parse({ ...previous, schemaVersion: PROJECT_SCHEMA_VERSION });
    validateRelations(document); return { document, migrated: true };
  }
  if (![1, 2, 3].includes(version)) throw Error(`不支持的项目格式版本：${version}`);
  const legacy = version === 3 ? plainTextDocumentSchema.parse(raw) : legacyDocumentSchema.parse(raw);
  const objects = legacy.objects.map(object => {
    if (!('text' in object) || typeof object.text !== 'string') return object;
    // 历史默认提示只属于空态；其余已有正文按原文字保留，避免把用户原稿误作 Markdown。
    const placeholder = object.kind === 'text' && ['双击编辑文字', 'Double click to edit'].includes(object.text);
    return { ...object, text: placeholder ? emptyCanvasText() : canvasTextFromPlainText(object.text) };
  });
  const notes = legacy.schemaVersion === 3 ? legacy.notes : (legacy.notes ?? []).map(migrateLegacyNote);
  const document = documentSchema.parse({ ...legacy, schemaVersion: PROJECT_SCHEMA_VERSION, objects, notes });
  validateRelations(document);
  return { document, migrated: true };
}

export function newDocument(name: string): ProjectDocument {
  return { schemaVersion: PROJECT_SCHEMA_VERSION, id: crypto.randomUUID(), name, revision: 0, camera: { x: 0, y: 0, scale: 1 }, assets: [], objects: [], groups: [], markers: [], connections: [], notes: [] };
}

export function mediaWidth(object: Extract<CanvasObject, { kind: 'media' }>): number {
  // 轨道宽度仅由源区间和时间显示比例决定，不加入隐含的最小宽度。
  return (object.outUs - object.inUs) / 1_000_000 * object.pixelsPerSecond;
}

export function resolveAnchor(document: ProjectDocument, anchor: Anchor, towards?: { x: number; y: number }): { x: number; y: number } | null {
  if (anchor.kind === 'free') return anchor.point;
  if (anchor.kind === 'object') {
    const object = document.objects.find(item => objectMemberIds(item).includes(anchor.objectId));
    if (!object) return null;
    const halfWidth = (object.kind === 'media' ? mediaWidth(object) : object.width) / 2, halfHeight = object.height / 2;
    const center = { x: object.x + halfWidth, y: object.y + halfHeight };
    const point = object.connectionPoints?.find(point => point.id === anchor.pointId) ?? DEFAULT_CONNECTION_PORTS.find(point => point.id === anchor.port);
    if (point) {
      const x = (point.x * 2 - 1) * halfWidth, y = (point.y * 2 - 1) * halfHeight, angle = (object.rotation ?? 0) * Math.PI / 180;
      return { x: center.x + x * Math.cos(angle) - y * Math.sin(angle), y: center.y + x * Math.sin(angle) + y * Math.cos(angle) };
    }
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
  const allObjectIds = document.objects.flatMap(objectMemberIds);
  const objectIds = new Set(allObjectIds);
  if (objectIds.size !== allObjectIds.length) throw Error('画布对象 ID 重复');
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
    if (objectAssetIds(object).some(id => !assetIds.has(id))) throw Error('对象素材不存在');
    if (object.kind === 'imageStack' && object.images.some(image => image.groupId !== null)) throw Error('叠图内部图片不能另属分组');
    if (object.kind === 'note' && !noteIds.has(object.noteId)) throw Error('对象笔记不存在');
    if (object.kind === 'media' && object.inUs >= object.outUs) throw Error('裁剪区间无效');
  }
  const objectsById = new Map(document.objects.map(object => [object.id, object]));
  for (const marker of document.markers) if (objectsById.get(marker.mediaId)?.kind !== 'media') throw Error('标记轨道不存在');
  for (const connection of document.connections) for (const anchor of [connection.from, connection.to]) {
    if (anchor.kind === 'object' && !objectIds.has(anchor.objectId)) throw Error('连线对象不存在');
    if (anchor.kind === 'time' && !markerIds.has(anchor.markerId)) throw Error('连线标记不存在');
  }
  for (const group of document.groups) if (group.parentId && !groupIds.has(group.parentId)) throw Error('父分组不存在');
  const groupsById = new Map<string, ProjectDocument['groups'][number]>();
  for (const group of document.groups) if (!groupsById.has(group.id)) groupsById.set(group.id, group);
  for (const group of document.groups) {
    const seen = new Set([group.id]);
    let parentId = group.parentId;
    while (parentId) {
      if (seen.has(parentId)) throw Error('分组层级存在循环');
      seen.add(parentId);
      parentId = groupsById.get(parentId)?.parentId ?? null;
    }
  }
}

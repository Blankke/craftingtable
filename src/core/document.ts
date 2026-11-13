import { z } from 'zod';

// 所有时间均为源素材的整数微秒，路径均相对项目目录。
export const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export const assetSchema = z.object({
  id: z.string().uuid(), name: z.string(), path: z.string(),
  kind: z.enum(['video', 'audio', 'image', 'text']), durationUs: z.number().int().nonnegative().optional(),
  status: z.enum(['ready', 'missing', 'unsupported', 'processing']).default('ready'),
  thumbnail: z.string().optional()
});
const base = { id: z.string().uuid(), x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), groupId: z.string().uuid().nullable() };
export const objectSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('text'), text: z.string(), fontSize: z.number().positive(), color: z.string(), align: z.enum(['left', 'center', 'right']), assetId: z.string().uuid().optional() }),
  z.object({ ...base, kind: z.literal('rectangle'), fill: z.string(), stroke: z.string() }),
  z.object({ ...base, kind: z.literal('ellipse'), fill: z.string(), stroke: z.string() }),
  z.object({ ...base, kind: z.literal('diamond'), fill: z.string(), stroke: z.string() }),
  z.object({ ...base, kind: z.literal('image'), assetId: z.string().uuid() }),
  z.object({ ...base, kind: z.literal('media'), assetId: z.string().uuid(), inUs: z.number().int().nonnegative(), outUs: z.number().int().nonnegative(), pixelsPerSecond: z.number().positive() }),
  z.object({ ...base, kind: z.literal('stroke'), points: z.array(pointSchema).min(2), color: z.string(), strokeWidth: z.number().positive() })
]);
export const anchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('free'), point: pointSchema }),
  z.object({ kind: z.literal('object'), objectId: z.string().uuid() }),
  z.object({ kind: z.literal('time'), markerId: z.string().uuid() })
]);
export const documentSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().uuid(), name: z.string(), revision: z.number().int().nonnegative(),
  camera: z.object({ x: z.number(), y: z.number(), scale: z.number().positive() }),
  assets: z.array(assetSchema), objects: z.array(objectSchema),
  groups: z.array(z.object({ id: z.string().uuid(), parentId: z.string().uuid().nullable() })),
  markers: z.array(z.object({ id: z.string().uuid(), mediaId: z.string().uuid(), timeUs: z.number().int().nonnegative(), note: z.string() })),
  connections: z.array(z.object({ id: z.string().uuid(), from: anchorSchema, to: anchorSchema, routing: z.enum(['straight', 'elbow']) }))
});
export type ProjectDocument = z.infer<typeof documentSchema>;
export type CanvasObject = ProjectDocument['objects'][number];
export type Anchor = ProjectDocument['connections'][number]['from'];

export function newDocument(name: string): ProjectDocument {
  return { schemaVersion: 1, id: crypto.randomUUID(), name, revision: 0, camera: { x: 0, y: 0, scale: 1 }, assets: [], objects: [], groups: [], markers: [], connections: [] };
}

export function mediaWidth(object: Extract<CanvasObject, { kind: 'media' }>): number {
  return Math.max(120, (object.outUs - object.inUs) / 1_000_000 * object.pixelsPerSecond);
}

export function resolveAnchor(document: ProjectDocument, anchor: Anchor): { x: number; y: number } | null {
  if (anchor.kind === 'free') return anchor.point;
  if (anchor.kind === 'object') {
    const object = document.objects.find(item => item.id === anchor.objectId);
    return object ? { x: object.x + object.width / 2, y: object.y + object.height / 2 } : null;
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
  for (const object of document.objects) {
    if (object.groupId && !groupIds.has(object.groupId)) throw Error('对象分组不存在');
    if ('assetId' in object && object.assetId && !assetIds.has(object.assetId)) throw Error('对象素材不存在');
    if (object.kind === 'media' && object.inUs >= object.outUs) throw Error('裁剪区间无效');
  }
  for (const marker of document.markers) if (!objectIds.has(marker.mediaId)) throw Error('标记轨道不存在');
  for (const connection of document.connections) for (const anchor of [connection.from, connection.to]) {
    if (anchor.kind === 'object' && !objectIds.has(anchor.objectId)) throw Error('连线对象不存在');
    if (anchor.kind === 'time' && !markerIds.has(anchor.markerId)) throw Error('连线标记不存在');
  }
  for (const group of document.groups) if (group.parentId && !groupIds.has(group.parentId)) throw Error('父分组不存在');
}

// 用法：以 { source, document } 保存移动/缩放预览；transformGhosts 派生虚影，applyCanvasTransform 在松手时一次提交。
import { objectMemberIds, type Anchor, type ProjectDocument } from './document';

export type CanvasTransformPreview = { source: ProjectDocument; document: ProjectDocument };

/** 未变实体保持引用共享，只绘制变化对象、变化连线及其附着连线。 */
export function transformGhosts({ source, document }: CanvasTransformPreview) {
  const originals = new Map(source.objects.map(object => [object.id, object]));
  const objects = document.objects.filter(object => object !== originals.get(object.id));
  const changedIds = new Set(objects.flatMap(objectMemberIds));
  const changedMarkers = new Set(document.markers.filter(marker => changedIds.has(marker.mediaId)).map(marker => marker.id));
  const follows = (anchor: Anchor) => anchor.kind === 'object' ? changedIds.has(anchor.objectId) : anchor.kind === 'time' && changedMarkers.has(anchor.markerId);
  const connectionsById = new Map(source.connections.map(connection => [connection.id, connection]));
  const connections = document.connections.filter(connection => connection !== connectionsById.get(connection.id) || follows(connection.from) || follows(connection.to));
  return { objects, connections };
}

/** 只合并手势改变的几何，避免覆盖拖动期间异步更新的素材、正文和样式。 */
export function applyCanvasTransform(draft: ProjectDocument, { source, document }: CanvasTransformPreview): void {
  const originals = new Map(source.objects.map(object => [object.id, object]));
  const objects = new Map(document.objects.filter(object => object !== originals.get(object.id)).map(object => [object.id, object]));
  for (const object of draft.objects) {
    const preview = objects.get(object.id), original = originals.get(object.id);
    if (!preview || !original || object.kind !== preview.kind) continue;
    for (const key of ['x', 'y', 'width', 'height'] as const) if (preview[key] !== original[key]) object[key] = preview[key];
    if (object.kind === 'stroke' && preview.kind === 'stroke') object.points = preview.points.map(point => ({ ...point }));
  }
  const originalConnections = new Map(source.connections.map(connection => [connection.id, connection]));
  const connections = new Map(document.connections.filter(connection => connection !== originalConnections.get(connection.id)).map(connection => [connection.id, connection]));
  for (const connection of draft.connections) {
    const preview = connections.get(connection.id);
    if (preview) { connection.from = structuredClone(preview.from); connection.to = structuredClone(preview.to); }
  }
}

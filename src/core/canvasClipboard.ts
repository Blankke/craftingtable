// 用法：copyCanvasSelection(editor, ids) 生成复制时快照；pasteCanvasSelection 支持剪切后、修改原件后仍正确粘贴。
import { documentSchema, newDocument, objectAssetIds, objectMemberIds, resolveAnchor, type ProjectDocument } from './document';
import { noteAssetIds } from './note';
import { Editor } from './editor';
export const CANVAS_CLIPBOARD_MIME = 'application/x-craftingtable-objects';

export function copyCanvasSelection(editor: Editor, ids: string[], connectionIds: string[] = []): ProjectDocument {
  const source = editor.document, selected = editor.expandObjectIds(ids), result = newDocument(source.name);
  result.id = source.id;
  result.objects = structuredClone(source.objects.filter(object => selected.has(object.id)));
  const members = new Set(result.objects.flatMap(objectMemberIds));
  result.markers = structuredClone(source.markers.filter(marker => members.has(marker.mediaId)));
  const markers = new Set(result.markers.map(marker => marker.id));
  result.connections = structuredClone(source.connections.filter(connection => [connection.from, connection.to].some(anchor => anchor.kind !== 'free') && [connection.from, connection.to].every(anchor => anchor.kind === 'free' || (anchor.kind === 'object' ? members.has(anchor.objectId) : markers.has(anchor.markerId)))));
  // 单独复制连线时固定当前端点位置，粘贴后成为独立连线，不带走原对象。
  for (const connection of source.connections.filter(connection => connectionIds.includes(connection.id) && !result.connections.some(item => item.id === connection.id))) {
    const start = resolveAnchor(source, connection.from), end = resolveAnchor(source, connection.to);
    const from = resolveAnchor(source, connection.from, end ?? undefined), to = resolveAnchor(source, connection.to, start ?? undefined);
    if (from && to) result.connections.push({ ...structuredClone(connection), from: { kind: 'free', point: from }, to: { kind: 'free', point: to } });
  }
  const groups = new Set<string>();
  for (const object of result.objects) { let id = object.groupId; while (id) { groups.add(id); id = source.groups.find(group => group.id === id)?.parentId ?? null; } }
  result.groups = structuredClone(source.groups.filter(group => groups.has(group.id)));
  result.notes = structuredClone(source.notes.filter(note => result.objects.some(object => object.kind === 'note' && object.noteId === note.id)));
  const assets = new Set([...result.objects.flatMap(objectAssetIds), ...result.notes.flatMap(noteAssetIds)]);
  result.assets = structuredClone(source.assets.filter(asset => assets.has(asset.id)));
  return result;
}

export function pasteCanvasSelection(editor: Editor, raw: unknown, offset = { x: 32, y: 32 }): { objects: string[]; connections: string[] } {
  const snapshot = documentSchema.parse(raw);
  if (snapshot.id !== editor.document.id) throw Error('请在来源项目中粘贴这些对象');
  // 重用复制命令生成对象、内部图片、分组、标记和连线的新身份。
  const temporary = new Editor(snapshot), ids = temporary.duplicateObjects(snapshot.objects.map(object => object.id), offset);
  const beforeGroups = new Set(snapshot.groups.map(group => group.id)), beforeMarkers = new Set(snapshot.markers.map(marker => marker.id)), beforeConnections = new Set(snapshot.connections.map(connection => connection.id));
  const freeConnections = snapshot.connections.flatMap(connection => connection.from.kind === 'free' && connection.to.kind === 'free' ? [{ ...connection, id: crypto.randomUUID(), from: { kind: 'free' as const, point: { x: connection.from.point.x + offset.x, y: connection.from.point.y + offset.y } }, to: { kind: 'free' as const, point: { x: connection.to.point.x + offset.x, y: connection.to.point.y + offset.y } } }] : []);
  editor.execute(draft => {
    for (const asset of snapshot.assets) if (!draft.assets.some(current => current.id === asset.id)) draft.assets.push(asset);
    for (const note of snapshot.notes) if (!draft.notes.some(current => current.id === note.id)) draft.notes.push(note);
    draft.objects.push(...temporary.document.objects.filter(object => ids.includes(object.id)).map(object => ({ ...object, locked: false })));
    draft.groups.push(...temporary.document.groups.filter(group => !beforeGroups.has(group.id)));
    draft.markers.push(...temporary.document.markers.filter(marker => !beforeMarkers.has(marker.id)));
    draft.connections.push(...temporary.document.connections.filter(connection => !beforeConnections.has(connection.id)));
    draft.connections.push(...freeConnections);
  });
  return { objects: ids, connections: freeConnections.map(connection => connection.id) };
}

import { documentSchema, type CanvasObject, type ConnectionStyle, type ProjectDocument, validateRelations } from './document';
import { newNote, noteAssetIds, refreshAnnotationReferences, type Note } from './note';

export type Arrangement = 'left' | 'center-x' | 'right' | 'top' | 'middle-y' | 'bottom' | 'distribute-x' | 'distribute-y';

// 命令提交完整事实快照；一次手势只在结束时提交一次，撤销粒度与用户操作一致。
export class Editor {
  private current: ProjectDocument;
  private undoStack: ProjectDocument[] = [];
  private redoStack: ProjectDocument[] = [];
  private previewBase: ProjectDocument | null = null;
  private listeners = new Set<() => void>();
  constructor(document: ProjectDocument) { this.current = documentSchema.parse(document); validateRelations(this.current); }
  get document(): ProjectDocument { return this.current; }
  get isPreviewing(): boolean { return this.previewBase !== null; }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private emit(): void { this.listeners.forEach(listener => listener()); }
  execute(change: (draft: ProjectDocument) => void): void {
    if (this.previewBase) this.commitPreview();
    const draft = structuredClone(this.current);
    change(draft);
    validateRelations(draft);
    documentSchema.parse(draft);
    if (JSON.stringify(draft) === JSON.stringify(this.current)) return;
    this.undoStack.push(this.current);
    this.redoStack = [];
    draft.revision = this.current.revision + 1;
    this.current = draft;
    this.emit();
  }
  preview(change: (draft: ProjectDocument) => void): void {
    if (!this.previewBase) this.previewBase = this.current;
    const draft = structuredClone(this.previewBase);
    change(draft);
    validateRelations(draft);
    documentSchema.parse(draft);
    this.current = draft;
    this.emit();
  }
  commitPreview(): void {
    const base = this.previewBase;
    if (!base) return;
    this.previewBase = null;
    if (JSON.stringify(base) === JSON.stringify(this.current)) return;
    this.undoStack.push(base);
    this.redoStack = [];
    this.current = { ...this.current, revision: base.revision + 1 };
    this.emit();
  }
  cancelPreview(): void {
    if (!this.previewBase) return;
    this.current = this.previewBase;
    this.previewBase = null;
    this.emit();
  }
  undo(): void { if (this.previewBase) { this.cancelPreview(); return; } const prior = this.undoStack.pop(); if (!prior) return; this.redoStack.push(this.current); this.current = { ...prior, revision: this.current.revision + 1 }; this.emit(); }
  redo(): void { const next = this.redoStack.pop(); if (!next) return; this.undoStack.push(this.current); this.current = { ...next, revision: this.current.revision + 1 }; this.emit(); }
  deleteObjects(ids: string[]): void {
    this.execute(draft => {
      const removed = new Set(ids);
      const removedMarkers = new Set(draft.markers.filter(marker => removed.has(marker.mediaId)).map(marker => marker.id));
      draft.objects = draft.objects.filter(object => !removed.has(object.id));
      draft.markers = draft.markers.filter(marker => !removedMarkers.has(marker.id));
      draft.connections = draft.connections.filter(connection => [connection.from, connection.to].every(anchor =>
        anchor.kind === 'free' || (anchor.kind === 'object' && !removed.has(anchor.objectId)) || (anchor.kind === 'time' && !removedMarkers.has(anchor.markerId))));
      this.pruneEmptyGroups(draft);
    });
  }
  addObject(object: CanvasObject): void { this.execute(draft => { draft.objects.push(object); }); }
  removeAsset(id: string): void {
    if (this.current.objects.some(object => 'assetId' in object && object.assetId === id)) throw Error('素材仍被画布对象引用');
    if (this.current.notes.some(note => noteAssetIds(note).includes(id))) throw Error('素材仍被笔记引用');
    this.execute(draft => { draft.assets = draft.assets.filter(asset => asset.id !== id); });
  }
  moveMarker(id: string, timeUs: number): void {
    this.execute(draft => { const marker = draft.markers.find(item => item.id === id); if (marker) marker.timeUs = Math.max(0, Math.round(timeUs)); });
  }
  deleteMarker(id: string): void {
    this.execute(draft => {
      draft.markers = draft.markers.filter(marker => marker.id !== id);
      draft.connections = draft.connections.filter(connection => [connection.from, connection.to].every(anchor => anchor.kind !== 'time' || anchor.markerId !== id));
    });
  }
  expandObjectIds(ids: string[], document: ProjectDocument = this.current): Set<string> {
    const selected = new Set(ids);
    const groups = new Map(document.groups.map(group => [group.id, group]));
    const selectedGroups = new Set(document.objects.filter(object => selected.has(object.id)).map(object => object.groupId).filter((id): id is string => id !== null));
    for (const object of document.objects) {
      let groupId = object.groupId;
      while (groupId) {
        if (selectedGroups.has(groupId)) { selected.add(object.id); break; }
        groupId = groups.get(groupId)?.parentId ?? null;
      }
    }
    return selected;
  }
  duplicateObjects(ids: string[], offset = { x: 32, y: 32 }): string[] {
    const objectMap = new Map<string, string>();
    const markerMap = new Map<string, string>();
    this.execute(draft => {
      const selected = this.expandObjectIds(ids, draft);
      const originals = draft.objects.filter(object => selected.has(object.id));
      for (const original of originals) objectMap.set(original.id, crypto.randomUUID());
      const groupsById = new Map(draft.groups.map(group => [group.id, group]));
      const copiedGroupIds = new Set<string>();
      for (const original of originals) {
        let groupId = original.groupId;
        while (groupId) { copiedGroupIds.add(groupId); groupId = groupsById.get(groupId)?.parentId ?? null; }
      }
      const groupMap = new Map([...copiedGroupIds].map(id => [id, crypto.randomUUID()]));
      draft.groups.push(...draft.groups.filter(group => copiedGroupIds.has(group.id)).map(group => ({ id: groupMap.get(group.id)!, parentId: group.parentId ? groupMap.get(group.parentId) ?? null : null })));
      draft.objects.push(...originals.map(original => ({ ...structuredClone(original), id: objectMap.get(original.id)!, x: original.x + offset.x, y: original.y + offset.y, groupId: original.groupId ? groupMap.get(original.groupId) ?? null : null })));
      const markers = draft.markers.filter(marker => objectMap.has(marker.mediaId));
      for (const marker of markers) markerMap.set(marker.id, crypto.randomUUID());
      draft.markers.push(...markers.map(marker => ({ ...marker, id: markerMap.get(marker.id)!, mediaId: objectMap.get(marker.mediaId)! })));
      for (const connection of [...draft.connections]) {
        const mapAnchor = (anchor: typeof connection.from) => {
          if (anchor.kind === 'object') return objectMap.has(anchor.objectId) ? { ...anchor, objectId: objectMap.get(anchor.objectId)! } : null;
          if (anchor.kind === 'time') return markerMap.has(anchor.markerId) ? { ...anchor, markerId: markerMap.get(anchor.markerId)! } : null;
          return { ...anchor, point: { x: anchor.point.x + offset.x, y: anchor.point.y + offset.y } };
        };
        const from = mapAnchor(connection.from), to = mapAnchor(connection.to);
        if (from && to) draft.connections.push({ id: crypto.randomUUID(), from, to, routing: connection.routing, style: connection.style ? structuredClone(connection.style) : undefined });
      }
    });
    return [...objectMap.values()];
  }
  private pruneEmptyGroups(draft: ProjectDocument): void {
    let changed = true;
    while (changed) {
      const used = new Set([...draft.objects.map(object => object.groupId), ...draft.groups.map(group => group.parentId)]);
      const before = draft.groups.length;
      draft.groups = draft.groups.filter(group => used.has(group.id));
      changed = draft.groups.length !== before;
    }
  }
  group(ids: string[]): void {
    this.execute(draft => {
      const selected = draft.objects.filter(object => ids.includes(object.id));
      if (selected.length < 2) return;
      const id = crypto.randomUUID();
      const sameParent = selected.every(object => object.groupId === selected[0].groupId);
      if (sameParent) {
        // 同一现有组中的选中对象组成子组，保留原组的其余成员。
        draft.groups.push({ id, parentId: selected[0].groupId });
        selected.forEach(object => { object.groupId = id; });
      } else {
        // 混合选择时把已有组作为整体纳入新组，避免打散其内部嵌套结构。
        draft.groups.push({ id, parentId: null });
        const groups = new Map(draft.groups.map(group => [group.id, group]));
        const roots = new Set<string>();
        for (const object of selected) {
          if (!object.groupId) { object.groupId = id; continue; }
          let rootId = object.groupId;
          while (groups.get(rootId)?.parentId) rootId = groups.get(rootId)!.parentId!;
          if (rootId !== id) roots.add(rootId);
        }
        for (const rootId of roots) groups.get(rootId)!.parentId = id;
      }
      this.pruneEmptyGroups(draft);
    });
  }
  ungroup(id: string): void {
    this.execute(draft => {
      const group = draft.groups.find(item => item.id === id);
      if (!group) return;
      draft.objects.forEach(object => { if (object.groupId === id) object.groupId = group.parentId; });
      draft.groups.forEach(item => { if (item.parentId === id) item.parentId = group.parentId; });
      draft.groups = draft.groups.filter(item => item.id !== id);
      this.pruneEmptyGroups(draft);
    });
  }
  moveObject(id: string, x: number, y: number): void {
    const object = this.current.objects.find(item => item.id === id);
    if (object) this.moveObjects([id], x - object.x, y - object.y);
  }
  moveObjects(ids: string[], dx: number, dy: number): void {
    if ((!dx && !dy) || !ids.length) return;
    this.execute(draft => {
      const selectedIds = this.expandObjectIds(ids, draft);
      for (const member of draft.objects) {
        if (selectedIds.has(member.id)) {
          member.x += dx; member.y += dy;
          if (member.kind === 'stroke') member.points = member.points.map(point => ({ x: point.x + dx, y: point.y + dy }));
        }
      }
    });
  }
  arrangeObjects(ids: string[], arrangement: Arrangement): void {
    if (ids.length < 2) return;
    this.execute(draft => {
      const selected = draft.objects.filter(object => ids.includes(object.id));
      if (selected.length < 2) return;
      const widthOf = (object: CanvasObject) => object.kind === 'media' ? (object.outUs - object.inUs) / 1_000_000 * object.pixelsPerSecond : object.width;
      const left = Math.min(...selected.map(object => object.x)), right = Math.max(...selected.map(object => object.x + widthOf(object)));
      const top = Math.min(...selected.map(object => object.y)), bottom = Math.max(...selected.map(object => object.y + object.height));
      if (arrangement === 'left') selected.forEach(object => { object.x = left; });
      if (arrangement === 'center-x') selected.forEach(object => { object.x = (left + right - widthOf(object)) / 2; });
      if (arrangement === 'right') selected.forEach(object => { object.x = right - widthOf(object); });
      if (arrangement === 'top') selected.forEach(object => { object.y = top; });
      if (arrangement === 'middle-y') selected.forEach(object => { object.y = (top + bottom - object.height) / 2; });
      if (arrangement === 'bottom') selected.forEach(object => { object.y = bottom - object.height; });
      if (arrangement === 'distribute-x') {
        const ordered = [...selected].sort((a, b) => a.x - b.x);
        const occupied = ordered.reduce((sum, object) => sum + widthOf(object), 0);
        const gap = (right - left - occupied) / Math.max(1, ordered.length - 1);
        let cursor = left; ordered.forEach(object => { object.x = cursor; cursor += widthOf(object) + gap; });
      }
      if (arrangement === 'distribute-y') {
        const ordered = [...selected].sort((a, b) => a.y - b.y);
        const occupied = ordered.reduce((sum, object) => sum + object.height, 0);
        const gap = (bottom - top - occupied) / Math.max(1, ordered.length - 1);
        let cursor = top; ordered.forEach(object => { object.y = cursor; cursor += object.height + gap; });
      }
    });
  }
  addMarker(mediaId: string, timeUs: number): string {
    const id = crypto.randomUUID();
    this.execute(draft => {
      const media = draft.objects.find(item => item.id === mediaId);
      if (media?.kind !== 'media') throw Error('请先选中媒体轨道');
      draft.markers.push({ id, mediaId, timeUs: Math.round(Math.max(media.inUs, Math.min(media.outUs, timeUs))), note: '' });
    });
    return id;
  }
  annotateMarker(markerId: string, target: { x: number; y: number } | string): string {
    const textId = typeof target === 'string' ? '' : crypto.randomUUID();
    this.execute(draft => {
      const marker = draft.markers.find(item => item.id === markerId);
      if (!marker) throw Error('请先选择已存在的标记');
      if (typeof target !== 'string') draft.objects.push({ id: textId, kind: 'text', x: target.x, y: target.y, width: 220, height: 72, groupId: null, text: marker.note, fontSize: 16, color: '#172033', align: 'left' });
      draft.connections.push({ id: crypto.randomUUID(), from: { kind: 'time', markerId }, to: { kind: 'object', objectId: typeof target === 'string' ? target : textId }, routing: 'straight' });
    });
    return textId;
  }
  updateConnectionStyle(id: string, patch: Partial<ConnectionStyle>): void {
    this.execute(draft => {
      const connection = draft.connections.find(item => item.id === id);
      if (!connection) return;
      connection.style = { ...(connection.style ?? {}), ...patch };
    });
  }
  deleteConnections(ids: string[]): void {
    if (!ids.length) return;
    this.execute(draft => { draft.connections = draft.connections.filter(connection => !ids.includes(connection.id)); });
  }
  createNote(name: string): string {
    const note = newNote(name);
    this.execute(draft => { draft.notes.push(note); });
    return note.id;
  }
  duplicateNote(id: string): string {
    const source = this.current.notes.find(item => item.id === id);
    if (!source) throw Error('笔记不存在');
    const copy = structuredClone(source);
    copy.id = crypto.randomUUID();
    copy.name = `${source.name} 副本`;
    // 副本的批注 ID 与锚点同步重写，原笔记和它的画布缩略图保持不变。
    const idMap = new Map(copy.annotations.map(annotation => [annotation.id, crypto.randomUUID()]));
    copy.annotations = copy.annotations.map(annotation => ({ ...annotation, id: idMap.get(annotation.id)! }));
    const rewriteMarks = (nodes: Note['document']['content']) => nodes.forEach(node => {
      node.marks = node.marks?.map(mark => mark.type === 'noteAnnotation' && typeof mark.attrs?.id === 'string'
        ? { ...mark, attrs: { ...mark.attrs, id: idMap.get(mark.attrs.id) ?? mark.attrs.id } }
        : mark);
      if (node.content) rewriteMarks(node.content);
    });
    rewriteMarks(copy.document.content);
    this.execute(draft => { draft.notes.push(copy); });
    return copy.id;
  }
  updateNote(id: string, change: (note: Note) => void): void {
    this.execute(draft => { const note = draft.notes.find(item => item.id === id); if (note) { change(note); refreshAnnotationReferences(note); } });
  }
  addNoteObject(noteId: string, position: { x: number; y: number }): string {
    const objectId = crypto.randomUUID();
    this.execute(draft => {
      if (!draft.notes.some(note => note.id === noteId)) throw Error('笔记不存在');
      draft.objects.push({ id: objectId, kind: 'note', noteId, x: position.x, y: position.y, width: 180, height: 120, groupId: null });
    });
    return objectId;
  }
  deleteNote(id: string): void {
    this.execute(draft => {
      draft.notes = draft.notes.filter(note => note.id !== id);
      draft.objects = draft.objects.filter(object => object.kind !== 'note' || object.noteId !== id);
    });
  }
}

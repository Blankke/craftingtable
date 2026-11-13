import { documentSchema, type CanvasObject, type ProjectDocument, validateRelations } from './document';

// 命令提交完整事实快照；一次手势只在结束时提交一次，撤销粒度与用户操作一致。
export class Editor {
  private current: ProjectDocument;
  private undoStack: ProjectDocument[] = [];
  private redoStack: ProjectDocument[] = [];
  private listeners = new Set<() => void>();
  constructor(document: ProjectDocument) { this.current = documentSchema.parse(document); validateRelations(this.current); }
  get document(): ProjectDocument { return this.current; }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private emit(): void { this.listeners.forEach(listener => listener()); }
  execute(change: (draft: ProjectDocument) => void): void {
    const draft = structuredClone(this.current);
    change(draft);
    validateRelations(draft);
    documentSchema.parse(draft);
    this.undoStack.push(this.current);
    this.redoStack = [];
    draft.revision = this.current.revision + 1;
    this.current = draft;
    this.emit();
  }
  undo(): void { const prior = this.undoStack.pop(); if (!prior) return; this.redoStack.push(this.current); this.current = { ...prior, revision: this.current.revision + 1 }; this.emit(); }
  redo(): void { const next = this.redoStack.pop(); if (!next) return; this.undoStack.push(this.current); this.current = { ...next, revision: this.current.revision + 1 }; this.emit(); }
  deleteObjects(ids: string[]): void {
    this.execute(draft => {
      const removed = new Set(ids);
      const removedMarkers = new Set(draft.markers.filter(marker => removed.has(marker.mediaId)).map(marker => marker.id));
      draft.objects = draft.objects.filter(object => !removed.has(object.id));
      draft.markers = draft.markers.filter(marker => !removedMarkers.has(marker.id));
      draft.connections = draft.connections.filter(connection => [connection.from, connection.to].every(anchor =>
        anchor.kind === 'free' || (anchor.kind === 'object' && !removed.has(anchor.objectId)) || (anchor.kind === 'time' && !removedMarkers.has(anchor.markerId))));
    });
  }
  addObject(object: CanvasObject): void { this.execute(draft => { draft.objects.push(object); }); }
  group(ids: string[]): void { this.execute(draft => { const id = crypto.randomUUID(); draft.groups.push({ id, parentId: null }); draft.objects.forEach(object => { if (ids.includes(object.id)) object.groupId = id; }); }); }
  ungroup(id: string): void { this.execute(draft => { const group = draft.groups.find(item => item.id === id); draft.objects.forEach(object => { if (object.groupId === id) object.groupId = group?.parentId ?? null; }); draft.groups.forEach(item => { if (item.parentId === id) item.parentId = group?.parentId ?? null; }); draft.groups = draft.groups.filter(item => item.id !== id); }); }
  annotate(mediaId: string, timeUs: number, target: { x: number; y: number } | string): string {
    const textId = typeof target === 'string' ? '' : crypto.randomUUID();
    this.execute(draft => {
      const markerId = crypto.randomUUID();
      draft.markers.push({ id: markerId, mediaId, timeUs, note: '' });
      if (typeof target !== 'string') draft.objects.push({ id: textId, kind: 'text', x: target.x, y: target.y, width: 220, height: 72, groupId: null, text: '', fontSize: 16, color: '#172033', align: 'left' });
      draft.connections.push({ id: crypto.randomUUID(), from: { kind: 'time', markerId }, to: { kind: 'object', objectId: typeof target === 'string' ? target : textId }, routing: 'straight' });
    });
    return textId;
  }
}

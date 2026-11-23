import { shareSnapshot } from './shareSnapshot';
import { documentSchema, objectAssetIds, objectMemberIds, type CanvasObject, type ConnectionStyle, type ProjectDocument, validateRelations } from './document';
import { newNote, noteAssetIds, noteAnnotationIds, refreshAnnotationReferences, type Note } from './note';
import type { RichTextDocument } from './richText';
import { canvasTextFromPlainText } from './canvasText';
import { styleOf } from './appearance';

export type Arrangement = 'left' | 'center-x' | 'right' | 'top' | 'middle-y' | 'bottom' | 'distribute-x' | 'distribute-y';

// 拆开和继续合并共用世界坐标换算，避免叠图移动、缩放或旋转后丢失图片位置。
function expandedStackImages(stack: Extract<CanvasObject, { kind: 'imageStack' }>): Extract<CanvasObject, { kind: 'image' }>[] {
  const scaleX = stack.width / stack.images[0].width, scaleY = stack.height / stack.images[0].height;
  const radians = (stack.rotation ?? 0) * Math.PI / 180;
  return stack.images.map(image => {
    const cx = (image.x + image.width / 2) * scaleX - stack.width / 2, cy = (image.y + image.height / 2) * scaleY - stack.height / 2;
    return { ...structuredClone(image), x: stack.x + stack.width / 2 + cx * Math.cos(radians) - cy * Math.sin(radians) - image.width * scaleX / 2,
      y: stack.y + stack.height / 2 + cx * Math.sin(radians) + cy * Math.cos(radians) - image.height * scaleY / 2,
      width: image.width * scaleX, height: image.height * scaleY, rotation: (image.rotation ?? 0) + (stack.rotation ?? 0), groupId: stack.groupId };
  });
}

// 命令提交完整事实快照；一次手势只在结束时提交一次，撤销粒度与用户操作一致。
export class Editor {
  private current: ProjectDocument;
  private undoStack: ProjectDocument[] = [];
  private redoStack: ProjectDocument[] = [];
  private previewBase: ProjectDocument | null = null;
  private listeners = new Set<() => void>();
  constructor(document: ProjectDocument, private normalizeObject: (object: CanvasObject) => void = () => {}, private initializeObject: (object: CanvasObject) => CanvasObject = object => object) { this.current = documentSchema.parse(document); this.current.objects.forEach(this.normalizeObject); validateRelations(this.current); }
  get document(): ProjectDocument { return this.current; }
  // 后台副作用读取最近提交，连续预览只影响画布显示，不取消已有媒体任务。
  get committedDocument(): ProjectDocument { return this.previewBase ?? this.current; }
  get isPreviewing(): boolean { return this.previewBase !== null; }
  get canUndo(): boolean { return this.undoStack.length > 0 || this.isPreviewing; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private emit(): void { this.listeners.forEach(listener => listener()); }
  // 相机变化不影响对象与引用关系；只复制并校验相机，仍按原粒度保存、撤销和递增修订。
  updateCamera(change: (camera: ProjectDocument['camera']) => void): void {
    if (this.previewBase) this.commitPreview();
    const camera = { ...this.current.camera };
    change(camera);
    const next = documentSchema.shape.camera.parse(camera), old = this.current.camera;
    if (next.x === old.x && next.y === old.y && next.scale === old.scale) return;
    this.undoStack.push(this.current); this.redoStack = [];
    this.current = { ...this.current, camera: next, revision: this.current.revision + 1 };
    this.emit();
  }
  execute(change: (draft: ProjectDocument) => void): void {
    if (this.previewBase) this.commitPreview();
    const draft = structuredClone(this.current);
    change(draft);
    draft.objects.forEach(this.normalizeObject);
    validateRelations(draft);
    documentSchema.parse(draft);
    const shared = shareSnapshot(this.current, draft);
    if (shared === this.current) return;
    this.undoStack.push(this.current);
    this.redoStack = [];
    shared.revision = this.current.revision + 1;
    this.current = shared;
    this.emit();
  }
  preview(change: (draft: ProjectDocument) => void): void {
    if (!this.previewBase) this.previewBase = this.current;
    const draft = structuredClone(this.previewBase);
    change(draft);
    draft.objects.forEach(this.normalizeObject);
    validateRelations(draft);
    documentSchema.parse(draft);
    this.current = shareSnapshot(this.previewBase, draft);
    this.emit();
  }
  commitPreview(): void {
    const base = this.previewBase;
    if (!base) return;
    this.previewBase = null;
    if (base === this.current) return;
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
  undo(): void {
    if (this.previewBase) {
      const changed = this.current !== this.previewBase;
      this.cancelPreview();
      // 无改动的预览不应吞掉一次撤销，合并/拆分仍由实际提交历史恢复。
      if (changed) return;
    }
    const prior = this.undoStack.pop(); if (!prior) return;
    this.redoStack.push(this.current); this.current = { ...prior, revision: this.current.revision + 1 }; this.emit();
  }
  redo(): void { const next = this.redoStack.pop(); if (!next) return; this.undoStack.push(this.current); this.current = { ...next, revision: this.current.revision + 1 }; this.emit(); }
  deleteObjects(ids: string[], connectionIds: string[] = []): void {
    this.execute(draft => {
      const selected = this.expandObjectIds(ids, draft);
      if (draft.objects.some(object => selected.has(object.id) && object.locked)) return;
      const removed = new Set(draft.objects.filter(object => selected.has(object.id)).flatMap(objectMemberIds));
      const removedMarkers = new Set(draft.markers.filter(marker => removed.has(marker.mediaId)).map(marker => marker.id));
      draft.objects = draft.objects.filter(object => !removed.has(object.id));
      draft.markers = draft.markers.filter(marker => !removedMarkers.has(marker.id));
      draft.connections = draft.connections.filter(connection => !connectionIds.includes(connection.id) && [connection.from, connection.to].every(anchor =>
        anchor.kind === 'free' || (anchor.kind === 'object' && !removed.has(anchor.objectId)) || (anchor.kind === 'time' && !removedMarkers.has(anchor.markerId))));
      this.pruneEmptyGroups(draft);
    });
  }
  addObject(object: CanvasObject): void { this.execute(draft => { draft.objects.push(this.initializeObject(object)); }); }
  setLocked(ids: string[], locked: boolean): void {
    this.execute(draft => { const selected = this.expandObjectIds(ids, draft); draft.objects.forEach(object => { if (selected.has(object.id)) object.locked = locked; }); });
  }
  reorderObjects(ids: string[], order: 'front' | 'back' | 'forward' | 'backward'): void {
    this.execute(draft => {
      const selected = this.expandObjectIds(ids, draft);
      if (draft.objects.some(object => selected.has(object.id) && object.locked)) return;
      const chosen = draft.objects.filter(object => selected.has(object.id)), others = draft.objects.filter(object => !selected.has(object.id));
      if (order === 'front') draft.objects = [...others, ...chosen];
      else if (order === 'back') draft.objects = [...chosen, ...others];
      // 从移动方向反向遍历，使连续多选只跨过相邻的一层，内部顺序保持稳定。
      else if (order === 'forward') { for (let i = draft.objects.length - 2; i >= 0; i--) if (selected.has(draft.objects[i].id) && !selected.has(draft.objects[i + 1].id)) [draft.objects[i], draft.objects[i + 1]] = [draft.objects[i + 1], draft.objects[i]]; }
      else { for (let i = 1; i < draft.objects.length; i++) if (selected.has(draft.objects[i].id) && !selected.has(draft.objects[i - 1].id)) [draft.objects[i], draft.objects[i - 1]] = [draft.objects[i - 1], draft.objects[i]]; }
    });
  }
  formatObjects(ids: string[], format: 'bold' | 'italic' | 'underline' | 'left' | 'center' | 'right' | 'larger' | 'smaller'): void {
    const selected = this.expandObjectIds(ids);
    if (this.current.objects.some(object => selected.has(object.id) && object.locked)) return;
    const targets = this.current.objects.filter(object => selected.has(object.id) && ('text' in object || 'fill' in object));
    const mark = format === 'bold' || format === 'italic' || format === 'underline' ? format : null;
    const enabled = mark ? !targets.every(object => styleOf(object)[mark]) : false;
    this.execute(draft => {
      for (const object of draft.objects.filter(object => targets.some(target => target.id === object.id))) {
        if (!('text' in object || 'fill' in object)) continue;
        if (mark) {
          object.style = { ...styleOf(object), [mark]: enabled };
          // 整个对象的格式由样式统一控制，清除相同的内联标记避免关闭粗体后仍残留。
          const clear = (nodes: NonNullable<typeof object.text>['content']) => nodes.forEach(node => { if (node.marks) node.marks = node.marks.filter(item => item.type !== mark); if (node.content) clear(node.content); });
          if (object.text) clear(object.text.content);
        } else if (format === 'larger' || format === 'smaller') {
          object.fontSize = Math.max(8, Math.min(200, (object.fontSize ?? 18) + (format === 'larger' ? 2 : -2)));
          const clearSize = (nodes: NonNullable<typeof object.text>['content']) => nodes.forEach(node => { node.marks?.forEach(mark => { if (mark.type === 'textStyle' && mark.attrs) delete mark.attrs.fontSize; }); if (node.content) clearSize(node.content); });
          if (object.text) clearSize(object.text.content);
        } else if (format === 'left' || format === 'center' || format === 'right') {
          object.align = format;
          const clearAlignment = (nodes: NonNullable<typeof object.text>['content']) => nodes.forEach(node => { if (node.attrs) delete node.attrs.textAlign; if (node.content) clearAlignment(node.content); });
          if (object.text) clearAlignment(object.text.content);
        }
      }
    });
  }
  ungroupObjects(ids: string[]): void {
    this.execute(draft => {
      const selected = this.expandObjectIds(ids, draft);
      if (draft.objects.some(object => selected.has(object.id) && object.locked)) return;
      const roots = new Set<string>();
      for (const object of draft.objects.filter(object => selected.has(object.id))) { let id = object.groupId; while (id && draft.groups.find(group => group.id === id)?.parentId) id = draft.groups.find(group => group.id === id)!.parentId; if (id) roots.add(id); }
      draft.objects.forEach(object => { if (object.groupId && roots.has(object.groupId)) object.groupId = null; });
      draft.groups.forEach(group => { if (group.parentId && roots.has(group.parentId)) group.parentId = null; });
      draft.groups = draft.groups.filter(group => !roots.has(group.id)); this.pruneEmptyGroups(draft);
    });
  }
  removeAsset(id: string): void {
    if (this.current.objects.some(object => objectAssetIds(object).includes(id))) throw Error('素材仍被画布对象引用');
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
    const copiedIds: string[] = [];
    this.execute(draft => {
      const selected = this.expandObjectIds(ids, draft);
      const originals = draft.objects.filter(object => selected.has(object.id));
      for (const original of originals) {
        for (const id of objectMemberIds(original)) objectMap.set(id, crypto.randomUUID());
        copiedIds.push(objectMap.get(original.id)!);
      }
      const groupsById = new Map(draft.groups.map(group => [group.id, group]));
      const copiedGroupIds = new Set<string>();
      for (const original of originals) {
        let groupId = original.groupId;
        while (groupId) { copiedGroupIds.add(groupId); groupId = groupsById.get(groupId)?.parentId ?? null; }
      }
      const groupMap = new Map([...copiedGroupIds].map(id => [id, crypto.randomUUID()]));
      draft.groups.push(...draft.groups.filter(group => copiedGroupIds.has(group.id)).map(group => ({ id: groupMap.get(group.id)!, parentId: group.parentId ? groupMap.get(group.parentId) ?? null : null })));
      draft.objects.push(...originals.map(original => {
        const copy = { ...structuredClone(original), id: objectMap.get(original.id)!, x: original.x + offset.x, y: original.y + offset.y, groupId: original.groupId ? groupMap.get(original.groupId) ?? null : null };
        if (copy.kind === 'imageStack') copy.images.forEach(image => { image.id = objectMap.get(image.id)!; });
        return copy;
      }));
      const markers = draft.markers.filter(marker => objectMap.has(marker.mediaId));
      for (const marker of markers) markerMap.set(marker.id, crypto.randomUUID());
      draft.markers.push(...markers.map(marker => ({ ...marker, id: markerMap.get(marker.id)!, mediaId: objectMap.get(marker.mediaId)! })));
      for (const connection of [...draft.connections]) {
        if (connection.from.kind === 'free' && connection.to.kind === 'free') continue;
        const mapAnchor = (anchor: typeof connection.from) => {
          if (anchor.kind === 'object') return objectMap.has(anchor.objectId) ? { ...anchor, objectId: objectMap.get(anchor.objectId)! } : null;
          if (anchor.kind === 'time') return markerMap.has(anchor.markerId) ? { ...anchor, markerId: markerMap.get(anchor.markerId)! } : null;
          return { ...anchor, point: { x: anchor.point.x + offset.x, y: anchor.point.y + offset.y } };
        };
        const from = mapAnchor(connection.from), to = mapAnchor(connection.to);
        if (from && to) draft.connections.push({ id: crypto.randomUUID(), from, to, routing: connection.routing, style: connection.style ? structuredClone(connection.style) : undefined });
      }
    });
    return copiedIds;
  }
  stackImages(ids: string[]): string {
    const id = crypto.randomUUID();
    this.execute(draft => {
      const selected = draft.objects.filter(object => ids.includes(object.id));
      if (selected.some(object => object.locked)) return;
      if (selected.length < 2 || selected.some(object => object.kind !== 'image' && object.kind !== 'imageStack')) throw Error('请选择至少两个图片或叠图对象');
      const images = selected.flatMap(object => object.kind === 'imageStack' ? expandedStackImages(object) : object.kind === 'image' ? [object] : []);
      const cover = images[0], index = draft.objects.indexOf(selected[0]);
      const stack: CanvasObject = { id, kind: 'imageStack', x: cover.x, y: cover.y, width: cover.width, height: cover.height, groupId: selected.every(object => object.groupId === selected[0].groupId) ? selected[0].groupId : null,
        images: images.map(image => ({ ...structuredClone(image), x: image.x - cover.x, y: image.y - cover.y, groupId: null })) };
      // 合并为一层图片列表，原叠图的连线落在其封面身份上，拆开和撤销均可继续追踪。
      const oldCovers = new Map(selected.flatMap(object => object.kind === 'imageStack' ? [[object.id, object.images[0].id] as const] : []));
      for (const connection of draft.connections) for (const anchor of [connection.from, connection.to]) {
        if (anchor.kind === 'object' && oldCovers.has(anchor.objectId)) { anchor.objectId = oldCovers.get(anchor.objectId)!; delete anchor.pointId; }
      }
      draft.objects = draft.objects.filter(object => !ids.includes(object.id));
      draft.objects.splice(index, 0, this.initializeObject(stack));
      this.pruneEmptyGroups(draft);
    });
    return id;
  }
  reorderStackImage(id: string, imageId: string, targetId: string): void {
    this.execute(draft => {
      const stack = draft.objects.find(object => object.id === id);
      if (stack?.kind !== 'imageStack' || stack.locked) return;
      const from = stack.images.findIndex(image => image.id === imageId), to = stack.images.findIndex(image => image.id === targetId);
      if (from < 0 || to < 0 || from === to) return;
      const cover = stack.images[0];
      const scaleX = stack.width / cover.width, scaleY = stack.height / cover.height;
      stack.images.splice(to, 0, stack.images.splice(from, 1)[0]);
      if (stack.images[0] === cover) return;
      // 新封面使用自身尺寸；补偿旋转中心变化，拆开后每张图的世界坐标和比例保持不变。
      const width = stack.images[0].width * scaleX, height = stack.images[0].height * scaleY;
      const dx = (width - stack.width) / 2, dy = (height - stack.height) / 2, angle = (stack.rotation ?? 0) * Math.PI / 180;
      stack.x += dx * Math.cos(angle) - dy * Math.sin(angle) - dx;
      stack.y += dx * Math.sin(angle) + dy * Math.cos(angle) - dy;
      stack.width = width; stack.height = height;
    });
  }
  unstackImages(id: string): string[] {
    const restored: string[] = [];
    this.execute(draft => {
      const index = draft.objects.findIndex(object => object.id === id), stack = draft.objects[index];
      if (stack?.kind !== 'imageStack' || stack.locked) return;
      const images = expandedStackImages(stack);
      restored.push(...images.map(image => image.id));
      draft.objects.splice(index, 1, ...images);
      // 收起后新连到整组的连线，在拆开时落到封面图；原单图连线保持原来的身份。
      for (const connection of draft.connections) for (const anchor of [connection.from, connection.to]) if (anchor.kind === 'object' && anchor.objectId === id) { anchor.objectId = images[0].id; delete anchor.pointId; }
    });
    return restored;
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
      if (selected.length < 2 || selected.some(object => object.locked)) return;
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
      if (draft.objects.some(object => selectedIds.has(object.id) && object.locked)) return;
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
      if (selected.length < 2 || selected.some(object => object.locked)) return;
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
      if (typeof target !== 'string') draft.objects.push({ id: textId, kind: 'text', x: target.x, y: target.y, width: 220, height: 72, groupId: null, text: canvasTextFromPlainText(marker.note), fontSize: 16, color: '#172033', align: 'left' });
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
  moveNoteSelection(sourceId: string, targetId: string, remaining: RichTextDocument, selected: RichTextDocument): void {
    if (sourceId === targetId) return;
    this.execute(draft => {
      const source = draft.notes.find(note => note.id === sourceId), target = draft.notes.find(note => note.id === targetId);
      if (!source || !target) throw Error('笔记不存在');
      const moved = structuredClone(selected), annotations = noteAnnotationIds(moved);
      const ids = new Map([...annotations].map(id => [id, crypto.randomUUID()]));
      const rewrite = (nodes: RichTextDocument['content']) => nodes.forEach(node => { node.marks?.forEach(mark => { if (mark.type === 'noteAnnotation' && typeof mark.attrs?.id === 'string') mark.attrs.id = ids.get(mark.attrs.id) ?? mark.attrs.id; }); if (node.content) rewrite(node.content); });
      rewrite(moved.content);
      target.annotations.push(...source.annotations.filter(annotation => annotations.has(annotation.id)).map(annotation => ({ ...annotation, id: ids.get(annotation.id)!, orphaned: false })));
      target.document.content.push(...moved.content); source.document = structuredClone(remaining);
      refreshAnnotationReferences(source); refreshAnnotationReferences(target);
    });
  }
  updateNote(id: string, change: (note: Note) => void): void {
    this.execute(draft => { const note = draft.notes.find(item => item.id === id); if (note) { change(note); refreshAnnotationReferences(note); } });
  }
  addNoteObject(noteId: string, position: { x: number; y: number }): string {
    const objectId = crypto.randomUUID();
    this.execute(draft => {
      if (!draft.notes.some(note => note.id === noteId)) throw Error('笔记不存在');
      draft.objects.push(this.initializeObject({ id: objectId, kind: 'note', noteId, x: position.x, y: position.y, width: 180, height: 120, groupId: null }));
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

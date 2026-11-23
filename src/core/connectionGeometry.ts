// 用法：connectionAnchorAt 命中端点；connectionPoints 共用绘制/框选几何；translatedSelection 生成一次移动的预览。
import { DEFAULT_CONNECTION_PORTS, mediaWidth, objectMemberIds, resolveAnchor, type Anchor, type ProjectDocument } from './document';
type Point = { x: number; y: number };
type Connection = ProjectDocument['connections'][number];

export function connectionAnchorAt(document: ProjectDocument, point: Point, attached?: Anchor): Anchor {
  // 吸入半径 10 屏幕像素，脱离半径 16 像素：轻微手抖不会在吸附边界反复跳动。
  if (attached?.kind === 'object' && (attached.port || attached.pointId)) {
    const fixed = resolveAnchor(document, attached);
    if (fixed && Math.hypot(fixed.x - point.x, fixed.y - point.y) * document.camera.scale <= 16) return attached;
  }
  let nearest: Anchor | undefined, distance = 10 / document.camera.scale;
  let inside: Anchor | undefined;
  for (let i = document.objects.length - 1; i >= 0; i--) {
    const object = document.objects[i], width = object.kind === 'media' ? mediaWidth(object) : object.width;
    const angle = (object.rotation ?? 0) * Math.PI / 180, dx = point.x - object.x - width / 2, dy = point.y - object.y - object.height / 2;
    const x = dx * Math.cos(angle) + dy * Math.sin(angle) + width / 2, y = -dx * Math.sin(angle) + dy * Math.cos(angle) + object.height / 2;
    const consider = (port: Point, anchor: Anchor) => {
      const nextDistance = Math.hypot(x - port.x * width, y - port.y * object.height);
      if (nextDistance > distance || (nearest && nextDistance === distance)) return;
      distance = nextDistance;
      nearest = anchor;
    };
    for (const port of object.connectionPoints ?? []) consider(port, { kind: 'object', objectId: object.id, pointId: port.id });
    for (const port of DEFAULT_CONNECTION_PORTS) consider(port, { kind: 'object', objectId: object.id, port: port.id });
    if (!inside && x >= 0 && x <= width && y >= 0 && y <= object.height) inside = { kind: 'object', objectId: object.id };
  }
  return nearest ?? inside ?? { kind: 'free', point };
}

export function connectionPoints(document: ProjectDocument, connection: Connection): number[] {
  const start = resolveAnchor(document, connection.from), end = resolveAnchor(document, connection.to);
  const from = resolveAnchor(document, connection.from, end ?? undefined), to = resolveAnchor(document, connection.to, start ?? undefined);
  if (!from || !to) return [];
  return connection.routing === 'elbow' ? [from.x, from.y, to.x, from.y, to.x, to.y]
    : connection.routing === 'curve' ? [from.x, from.y, from.x + (to.x - from.x) * .45, from.y, to.x - (to.x - from.x) * .45, to.y, to.x, to.y]
    : [from.x, from.y, to.x, to.y];
}

export function connectionIntersectsRect(document: ProjectDocument, connection: Connection, rect: { left: number; top: number; right: number; bottom: number }): boolean {
  const points = connectionPoints(document, connection);
  if (!points.length) return false;
  const polyline: Point[] = [];
  if (connection.routing === 'curve') {
    // 三次贝塞尔在世界空间采样；使用相同控制点，避免按外接框误选不相交的曲线。
    for (let i = 0; i <= 48; i++) {
      const t = i / 48, u = 1 - t;
      polyline.push({ x: u ** 3 * points[0] + 3 * u * u * t * points[2] + 3 * u * t * t * points[4] + t ** 3 * points[6], y: u ** 3 * points[1] + 3 * u * u * t * points[3] + 3 * u * t * t * points[5] + t ** 3 * points[7] });
    }
  } else for (let i = 0; i < points.length; i += 2) polyline.push({ x: points[i], y: points[i + 1] });
  return polyline.slice(1).some((b, i) => {
    const a = polyline[i], dx = b.x - a.x, dy = b.y - a.y;
    let lo = 0, hi = 1;
    for (const [p, q] of [[-dx, a.x - rect.left], [dx, rect.right - a.x], [-dy, a.y - rect.top], [dy, rect.bottom - a.y]]) {
      if (p === 0) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
      if (lo > hi) return false;
    }
    return true;
  });
}

export function translatedSelection(document: ProjectDocument, ids: string[], connectionIds: string[], delta: Point): ProjectDocument {
  const selected = new Set(ids), selectedConnections = new Set(connectionIds);
  const moving = new Set(document.objects.filter(object => selected.has(object.id) && !object.locked).flatMap(objectMemberIds));
  const follows = (anchor: Anchor) => anchor.kind === 'object' ? moving.has(anchor.objectId) : anchor.kind === 'time' && document.markers.some(marker => marker.id === anchor.markerId && moving.has(marker.mediaId));
  return { ...document,
    objects: document.objects.map(object => moving.has(object.id) ? { ...object, x: object.x + delta.x, y: object.y + delta.y, ...(object.kind === 'stroke' ? { points: object.points.map(p => ({ x: p.x + delta.x, y: p.y + delta.y })) } : {}) } : object),
    connections: document.connections.map(connection => {
      if (!selectedConnections.has(connection.id)) return connection;
      const points = connectionPoints(document, connection);
      if (!points.length) return connection;
      const shift = (anchor: Anchor, x: number, y: number): Anchor => follows(anchor) ? anchor : { kind: 'free', point: { x: x + delta.x, y: y + delta.y } };
      return { ...connection, from: shift(connection.from, points[0], points[1]), to: shift(connection.to, points.at(-2)!, points.at(-1)!) };
    })
  };
}

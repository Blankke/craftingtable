// 用法：connectionAnchorAt(document, point) 在端点拖动结束时选择连接对象或自由坐标。
import { mediaWidth, type Anchor, type ProjectDocument } from './document';

export function connectionAnchorAt(document: ProjectDocument, point: { x: number; y: number }): Anchor {
  // 从顶层开始命中，旋转对象先转换到局部坐标；显式连接点优先于边界自动吸附。
  for (let i = document.objects.length - 1; i >= 0; i--) {
    const object = document.objects[i], width = object.kind === 'media' ? mediaWidth(object) : object.width;
    const angle = (object.rotation ?? 0) * Math.PI / 180, dx = point.x - object.x - width / 2, dy = point.y - object.y - object.height / 2;
    const x = dx * Math.cos(angle) + dy * Math.sin(angle) + width / 2, y = -dx * Math.sin(angle) + dy * Math.cos(angle) + object.height / 2;
    const port = object.connectionPoints?.find(port => Math.hypot(x - port.x * width, y - port.y * object.height) <= 10 / document.camera.scale);
    if (port) return { kind: 'object', objectId: object.id, pointId: port.id };
    if (x >= 0 && x <= width && y >= 0 && y <= object.height) return { kind: 'object', objectId: object.id };
  }
  return { kind: 'free', point };
}

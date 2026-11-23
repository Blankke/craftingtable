// 用法：styleOf(object) 读取渲染样式；resizeObject 用于画布和对象栏统一缩放。
import type { CanvasObject } from './document';
import { hasShapeGeometry, standardShapeRatio } from './shapeGeometry';

export function isShapeObject(object: CanvasObject): object is Extract<CanvasObject, { fill: string }> { return hasShapeGeometry(object.kind); }

/** 开启标准比例锁时保持中心与高度，恢复圆、正方形或规则多边形；解锁不改变现有尺寸。 */
export function lockStandardShape(object: CanvasObject, locked: boolean): void {
  if (!isShapeObject(object)) return;
  object.aspectLocked = locked;
  if (!locked) return;
  const centerX = object.x + object.width / 2;
  resizeObject(object, object.width, object.height, 'height');
  object.x = centerX - object.width / 2;
}

export const shapeLabels = { rectangle: '矩形', roundedRectangle: '圆角矩形', ellipse: '椭圆', diamond: '菱形', triangle: '三角形', hexagon: '六边形', parallelogram: '平行四边形', trapezoid: '梯形', cylinder: '圆柱', document: '文档', cloud: '云朵', star: '星形', callout: '对话框', cross: '十字', arrowShape: '块箭头', actor: '角色', folder: '文件夹', heart: '心形', lightning: '闪电', moon: '月牙', ring: '圆环', speech: '气泡', cube: '立方体', leftArrow: '左箭头', rightArrow: '右箭头', upArrow: '上箭头', downArrow: '下箭头', leftRightArrow: '双向箭头', upDownArrow: '上下箭头', quadArrow: '四向箭头', process: '处理', terminator: '开始/结束', data: '数据', predefinedProcess: '预定义处理', manualInput: '手工输入', manualOperation: '手工操作', delay: '延迟', display: '显示', multidocument: '多文档', preparation: '准备', offPage: '离页连接符', internalStorage: '内部存储', merge: '合并' };
export function styleOf(object: CanvasObject): NonNullable<CanvasObject['style']> {
  return object.style ?? { fillEnabled: object.kind !== 'text' && object.kind !== 'stroke', fill: 'fill' in object ? object.fill : '#f3f5ff', gradient: false, gradientColor: '#a7b4ff', gradientDirection: 'vertical', strokeEnabled: object.kind !== 'text', stroke: 'stroke' in object ? object.stroke : object.kind === 'stroke' ? object.color : '#5268e8', strokeWidth: object.kind === 'stroke' ? object.strokeWidth : 1, dash: 'solid', perimeter: 0, opacity: 1, fontFamily: 'Microsoft YaHei', bold: false, italic: false, underline: false, verticalAlign: object.kind === 'text' ? 'top' : 'middle' };
}
export function resizeObject(object: CanvasObject, width: number, height: number, axis: 'width' | 'height' = 'width'): void {
  const ratio = isShapeObject(object) ? standardShapeRatio(object.kind) : object.width / object.height;
  width = Math.max(12, width); height = Math.max(12, height);
  if (object.kind === 'imageStack' || (object.kind === 'image' && object.aspectLocked !== false) || (isShapeObject(object) && object.aspectLocked)) {
    if (axis === 'width') { width = Math.max(width, 12 * ratio); height = width / ratio; }
    else { height = Math.max(height, 12 / ratio); width = height * ratio; }
  }
  if (object.kind === 'stroke') object.points = object.points.map(point => ({ x: object.x + (point.x - object.x) * width / object.width, y: object.y + (point.y - object.y) * height / object.height }));
  object.width = width; object.height = height;
}

/** 图片「还原比例」的目标宽高比：存在裁剪时按可见裁剪区域，否则按素材自然尺寸。 */
export function restoredImageRatio(crop: { width: number; height: number } | undefined, naturalWidth: number, naturalHeight: number): number {
  if (crop) return (crop.width * naturalWidth) / (crop.height * naturalHeight);
  return naturalWidth / naturalHeight;
}

/** 从四角缩放，固定对角的世界位置；旋转、比例锁和画笔点均沿用统一尺寸逻辑。 */
export function resizeFromCorner(source: CanvasObject, corner: 'nw' | 'ne' | 'sw' | 'se', dx: number, dy: number): CanvasObject {
  const copy = structuredClone(source), angle = (source.rotation ?? 0) * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const localX = dx * cos + dy * sin, localY = -dx * sin + dy * cos;
  const sx = corner.includes('w') ? -1 : 1, sy = corner.includes('n') ? -1 : 1;
  resizeObject(copy, source.width + sx * localX, source.height + sy * localY, Math.abs(localX / source.width) >= Math.abs(localY / source.height) ? 'width' : 'height');
  const cx = sx * (copy.width - source.width) / 2, cy = sy * (copy.height - source.height) / 2;
  copy.x += cx * cos - cy * sin - (copy.width - source.width) / 2;
  copy.y += cx * sin + cy * cos - (copy.height - source.height) / 2;
  if (copy.kind === 'stroke') copy.points = copy.points.map(point => ({ x: point.x + copy.x - source.x, y: point.y + copy.y - source.y }));
  return copy;
}

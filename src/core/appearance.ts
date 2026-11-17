// 用法：styleOf(object) 读取渲染样式；resizeObject 用于画布和对象栏统一缩放。
import type { CanvasObject } from './document';

export const shapeLabels = { rectangle: '矩形', roundedRectangle: '圆角矩形', ellipse: '椭圆', diamond: '菱形', triangle: '三角形', hexagon: '六边形', parallelogram: '平行四边形', trapezoid: '梯形', cylinder: '圆柱', document: '文档', cloud: '云朵', star: '星形', callout: '对话框', cross: '十字', arrowShape: '块箭头', actor: '角色', folder: '文件夹', heart: '心形', lightning: '闪电', moon: '月牙', ring: '圆环', speech: '气泡', cube: '立方体', leftArrow: '左箭头', rightArrow: '右箭头', upArrow: '上箭头', downArrow: '下箭头', leftRightArrow: '双向箭头', upDownArrow: '上下箭头', quadArrow: '四向箭头', process: '处理', terminator: '开始/结束', data: '数据', predefinedProcess: '预定义处理', manualInput: '手工输入', manualOperation: '手工操作', delay: '延迟', display: '显示', multidocument: '多文档', preparation: '准备', offPage: '离页连接符', internalStorage: '内部存储', merge: '合并' };
export function styleOf(object: CanvasObject): NonNullable<CanvasObject['style']> {
  return object.style ?? { fillEnabled: object.kind !== 'text' && object.kind !== 'stroke', fill: 'fill' in object ? object.fill : '#f3f5ff', gradient: false, gradientColor: '#a7b4ff', gradientDirection: 'vertical', strokeEnabled: object.kind !== 'text', stroke: 'stroke' in object ? object.stroke : object.kind === 'stroke' ? object.color : '#5268e8', strokeWidth: object.kind === 'stroke' ? object.strokeWidth : 1, dash: 'solid', perimeter: 0, opacity: 1, fontFamily: 'Microsoft YaHei', bold: false, italic: false, underline: false, verticalAlign: 'middle' };
}
export function resizeObject(object: CanvasObject, width: number, height: number, axis: 'width' | 'height' = 'width'): void {
  const ratio = object.width / object.height;
  width = Math.max(12, width); height = Math.max(12, height);
  if (object.kind === 'image' && object.aspectLocked !== false) {
    if (axis === 'width') height = width / ratio; else width = height * ratio;
  }
  if (object.kind === 'stroke') object.points = object.points.map(point => ({ x: object.x + (point.x - object.x) * width / object.width, y: object.y + (point.y - object.y) * height / object.height }));
  object.width = width; object.height = height;
}

/** 图片「还原比例」的目标宽高比：存在裁剪时按可见裁剪区域，否则按素材自然尺寸。 */
export function restoredImageRatio(crop: { width: number; height: number } | undefined, naturalWidth: number, naturalHeight: number): number {
  if (crop) return (crop.width * naturalWidth) / (crop.height * naturalHeight);
  return naturalWidth / naturalHeight;
}

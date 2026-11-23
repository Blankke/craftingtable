// 用法：shapePath(kind) 为画布、工具预览和首页缩略图取得同一份 100×100 图形路径。
// 图形定义固定对应 draw.io 24.7 的 General、Basic、Arrows 与 Flowchart 基础图库；
// 所有使用方均从这里读取分组，避免工具栏、拖动虚影和项目格式出现不同的可用图形。
export const shapeGroups = {
  General: ['rectangle', 'roundedRectangle', 'ellipse', 'triangle', 'star', 'cloud', 'callout', 'speech'],
  Basic: ['hexagon', 'parallelogram', 'trapezoid', 'cross', 'actor', 'folder', 'heart', 'lightning', 'moon', 'ring', 'cube'],
  Arrows: ['arrowShape', 'leftArrow', 'rightArrow', 'upArrow', 'downArrow', 'leftRightArrow', 'upDownArrow', 'quadArrow'],
  Flowchart: ['process', 'diamond', 'terminator', 'data', 'predefinedProcess', 'manualInput', 'manualOperation', 'delay', 'display', 'document', 'multidocument', 'cylinder', 'preparation', 'offPage', 'internalStorage', 'merge']
} as const;

// 矩形、圆角矩形和椭圆由各渲染器以原生几何绘制，其余图形使用同一份 100×100 SVG 路径。
export const nativeShapeKinds = new Set(['rectangle', 'roundedRectangle', 'ellipse']);

// 标准多边形的外接框并非全部为正方形；三角形、六边形与五角星使用真实几何比例。
export function standardShapeRatio(kind: string): number {
  if (kind === 'triangle' || kind === 'hexagon' || kind === 'merge') return 2 / Math.sqrt(3);
  if (kind === 'star') return 2 * Math.cos(Math.PI / 10) / (1 + Math.cos(Math.PI / 5));
  return 1;
}

// 规则五角星统一归一化至 100×100；结合标准外接框比例可恢复等角、等长的星形。
const starPoints = Array.from({ length: 10 }, (_, index) => {
  const angle = -Math.PI / 2 + index * Math.PI / 5;
  const radius = index % 2 ? Math.sin(Math.PI / 10) / Math.sin(3 * Math.PI / 10) : 1;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
});
const starMinX = Math.min(...starPoints.map(point => point.x)), starMaxX = Math.max(...starPoints.map(point => point.x));
const starMinY = Math.min(...starPoints.map(point => point.y)), starMaxY = Math.max(...starPoints.map(point => point.y));
const starPath = starPoints.map((point, index) => `${index ? 'L' : 'M'}${((point.x - starMinX) / (starMaxX - starMinX) * 100).toFixed(6)} ${((point.y - starMinY) / (starMaxY - starMinY) * 100).toFixed(6)}`).join(' ') + ' Z';
const shapePaths: Readonly<Record<string, string>> = {
  triangle: 'M50 0 L100 100 L0 100 Z', diamond: 'M50 0 L100 50 L50 100 L0 50 Z',
  hexagon: 'M25 0 L75 0 L100 50 L75 100 L25 100 L0 50 Z', parallelogram: 'M25 0 L100 0 L75 100 L0 100 Z',
  trapezoid: 'M25 0 L75 0 L100 100 L0 100 Z', cylinder: 'M0 15 C0 -5 100 -5 100 15 L100 85 C100 105 0 105 0 85 Z M0 15 C0 35 100 35 100 15',
  document: 'M0 0 L100 0 L100 85 C65 60 35 110 0 85 Z', cloud: 'M20 80 C-10 80 -5 40 15 40 C0 10 40 0 50 20 C65 -5 100 10 90 35 C115 40 105 80 85 80 C80 105 45 100 40 85 C25 100 10 95 20 80 Z',
  star: starPath,
  cross: 'M33 0 L67 0 L67 33 L100 33 L100 67 L67 67 L67 100 L33 100 L33 67 L0 67 L0 33 L33 33 Z',
  actor: 'M50 0 A15 15 0 1 1 50 30 A15 15 0 1 1 50 0 M50 30 L50 65 M15 45 L85 45 M50 65 L20 100 M50 65 L80 100',
  folder: 'M0 0 L40 0 L50 18 L100 18 L100 100 L0 100 Z',
  heart: 'M50 92 C30 72 0 56 0 27 C0 2 30 -8 50 14 C70 -8 100 2 100 27 C100 56 70 72 50 92 Z',
  lightning: 'M58 0 L8 58 L42 58 L32 100 L92 35 L58 35 Z',
  moon: 'M70 0 C20 8 8 65 40 90 C62 107 91 91 100 68 C78 82 50 73 41 50 C32 28 46 8 70 0 Z',
  ring: 'M50 0 A50 50 0 1 1 50 100 A50 50 0 1 1 50 0 M50 24 A26 26 0 1 0 50 76 A26 26 0 1 0 50 24 Z',
  cube: 'M0 25 L50 0 L100 25 L100 75 L50 100 L0 75 Z M0 25 L50 52 L100 25 M50 52 L50 100',
  leftRightArrow: 'M0 50 L35 0 L35 28 L65 28 L65 0 L100 50 L65 100 L65 72 L35 72 L35 100 Z',
  upDownArrow: 'M50 0 L90 35 L68 35 L68 65 L90 65 L50 100 L10 65 L32 65 L32 35 L10 35 Z',
  quadArrow: 'M42 0 L58 0 L58 28 L82 28 L82 8 L100 32 L82 56 L82 40 L58 40 L58 62 L78 62 L50 100 L22 62 L42 62 L42 40 L18 40 L18 56 L0 32 L18 8 L18 28 L42 28 Z',
  terminator: 'M18 0 L82 0 Q100 0 100 50 Q100 100 82 100 L18 100 Q0 100 0 50 Q0 0 18 0 Z',
  data: 'M18 0 L100 0 L82 100 L0 100 Z', predefinedProcess: 'M0 0 L100 0 L100 100 L0 100 Z M16 0 L16 100 M84 0 L84 100',
  manualInput: 'M0 20 L100 0 L100 100 L0 100 Z', manualOperation: 'M0 0 L100 0 L84 100 L16 100 Z',
  delay: 'M0 0 L60 0 Q100 0 100 50 Q100 100 60 100 L0 100 Z', display: 'M0 0 L72 0 Q100 50 72 100 L0 100 L16 50 Z',
  multidocument: 'M0 0 L92 0 L92 75 C68 56 42 100 0 78 Z M8 12 L100 12 L100 88 C76 68 50 112 8 90 Z',
  preparation: 'M22 0 L78 0 L100 50 L78 100 L22 100 L0 50 Z', offPage: 'M0 0 L100 0 L100 68 L50 100 L0 68 Z',
  internalStorage: 'M0 0 L100 0 L100 100 L0 100 Z M18 0 L18 100 M0 18 L100 18', merge: 'M0 0 L100 0 L50 100 Z',
  process: 'M0 0 L100 0 L100 100 L0 100 Z'
};

export type ShapeAdjustments = { radius?: number; tailX?: number; tailY?: number; inset?: number; shaft?: number; head?: number };
type AdjustableShape = { kind: string; width: number; height: number; adjustments?: ShapeAdjustments };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const arrowKinds = ['arrowShape', 'rightArrow', 'leftArrow', 'upArrow', 'downArrow'];
export function shapeRadius(object: AdjustableShape): number { return object.kind === 'roundedRectangle' ? Math.min(object.width, object.height) * (object.adjustments?.radius ?? .15) : 0; }

/** 与 PPT 类似的黄色几何调节点；位置和参数定义供画布、属性栏共用。 */
export function shapeAdjustmentHandles(object: AdjustableShape) {
  const a = object.adjustments ?? {}, w = object.width, h = object.height;
  if (object.kind === 'roundedRectangle') return [{ id: 'radius', label: '圆角', x: shapeRadius(object), y: 0 }];
  if (object.kind === 'callout' || object.kind === 'speech') return [{ id: 'tail', label: '引出角', x: (a.tailX ?? (object.kind === 'callout' ? .2 : .12)) * w, y: (a.tailY ?? 1) * h }];
  if (['parallelogram', 'trapezoid', 'data', 'preparation', 'hexagon'].includes(object.kind)) return [{ id: 'inset', label: '斜边', x: (a.inset ?? (object.kind === 'data' ? .18 : object.kind === 'preparation' ? .22 : .25)) * w, y: 0 }];
  if (arrowKinds.includes(object.kind)) {
    const local = [{ id: 'shaft', label: '箭身宽度', x: 0, y: (1 - (a.shaft ?? .5)) / 2 }, { id: 'head', label: '箭头长度', x: 1 - (a.head ?? .4), y: 0 }];
    return local.map(p => { const q = orientArrow(object.kind, p.x, p.y); return { ...p, x: q.x * w, y: q.y * h }; });
  }
  return [];
}
function orientArrow(kind: string, x: number, y: number) {
  return kind === 'leftArrow' ? { x: 1 - x, y } : kind === 'upArrow' ? { x: y, y: 1 - x } : kind === 'downArrow' ? { x: y, y: x } : { x, y };
}
/** 指针已转到对象局部坐标；连续预览和一次提交由画布统一处理。 */
export function adjustedShape(object: AdjustableShape, id: string, point: { x: number; y: number }): ShapeAdjustments {
  const a = { ...object.adjustments }, x = point.x / object.width, y = point.y / object.height;
  if (id === 'radius') a.radius = clamp(point.x / Math.min(object.width, object.height), 0, .5);
  if (id === 'tail') { a.tailX = clamp(x, -1, 2); a.tailY = clamp(y, -1, 2); }
  if (id === 'inset') a.inset = clamp(x, 0, .45);
  const along = object.kind === 'leftArrow' ? 1 - x : object.kind === 'upArrow' ? 1 - y : object.kind === 'downArrow' ? y : x;
  const across = object.kind === 'upArrow' || object.kind === 'downArrow' ? x : y;
  if (id === 'shaft') a.shaft = clamp(1 - across * 2, .1, .9);
  if (id === 'head') a.head = clamp(1 - along, .1, .9);
  return a;
}

export function shapePath(kind: string, a: ShapeAdjustments = {}): string | undefined {
  if (kind === 'callout' || kind === 'speech') {
    const x = (a.tailX ?? (kind === 'callout' ? .2 : .12)) * 100, y = (a.tailY ?? 1) * 100, bottom = kind === 'callout' ? 75 : 72;
    // 引出角可指向任意边；尖端进入气泡正文时收起三角，不产生自交路径。
    if (x >= 0 && x <= 100 && y >= 0 && y <= bottom) return `M0 0 H100 V${bottom} H0 Z`;
    const horizontal = Math.abs((x - 50) / 50) > Math.abs((y - bottom / 2) / (bottom / 2));
    const px = clamp(x, 12, 88), py = clamp(y, 12, bottom - 12);
    if (horizontal && x > 50) return `M0 0 H100 V${py - 10} L${x} ${y} L100 ${py + 10} V${bottom} H0 Z`;
    if (horizontal) return `M0 0 H100 V${bottom} H0 V${py + 10} L${x} ${y} L0 ${py - 10} Z`;
    if (y < 0) return `M0 0 H${px - 10} L${x} ${y} L${px + 10} 0 H100 V${bottom} H0 Z`;
    return `M0 0 H100 V${bottom} H${px + 10} L${x} ${y} L${px - 10} ${bottom} H0 Z`;
  }
  if (a.inset !== undefined) {
    const i = a.inset * 100;
    if (kind === 'parallelogram' || kind === 'data') return `M${i} 0 H100 L${100 - i} 100 H0 Z`;
    if (kind === 'trapezoid') return `M${i} 0 H${100 - i} L100 100 H0 Z`;
    if (kind === 'preparation' || kind === 'hexagon') return `M${i} 0 H${100 - i} L100 50 L${100 - i} 100 H${i} L0 50 Z`;
  }
  if (arrowKinds.includes(kind)) {
    const neck = 1 - (a.head ?? .4), top = (1 - (a.shaft ?? .5)) / 2;
    const points = [[0, top], [neck, top], [neck, 0], [1, .5], [neck, 1], [neck, 1 - top], [0, 1 - top]];
    return points.map(([x, y], i) => { const p = orientArrow(kind, x, y); return `${i ? 'L' : 'M'}${p.x * 100} ${p.y * 100}`; }).join(' ') + ' Z';
  }
  return shapePaths[kind];
}

/** 判断图形是否有可用于工具预览、拖动虚影和画布的权威几何。 */
export function hasShapeGeometry(kind: string): boolean {
  return nativeShapeKinds.has(kind) || Boolean(shapePath(kind));
}

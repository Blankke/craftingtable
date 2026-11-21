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
export const shapePaths: Readonly<Record<string, string>> = {
  triangle: 'M50 0 L100 100 L0 100 Z', diamond: 'M50 0 L100 50 L50 100 L0 50 Z',
  hexagon: 'M25 0 L75 0 L100 50 L75 100 L25 100 L0 50 Z', parallelogram: 'M25 0 L100 0 L75 100 L0 100 Z',
  trapezoid: 'M25 0 L75 0 L100 100 L0 100 Z', cylinder: 'M0 15 C0 -5 100 -5 100 15 L100 85 C100 105 0 105 0 85 Z M0 15 C0 35 100 35 100 15',
  document: 'M0 0 L100 0 L100 85 C65 60 35 110 0 85 Z', cloud: 'M20 80 C-10 80 -5 40 15 40 C0 10 40 0 50 20 C65 -5 100 10 90 35 C115 40 105 80 85 80 C80 105 45 100 40 85 C25 100 10 95 20 80 Z',
  star: 'M50 0 L61 35 L98 35 L68 57 L79 94 L50 72 L21 94 L32 57 L2 35 L39 35 Z',
  callout: 'M0 0 L100 0 L100 75 L45 75 L20 100 L20 75 L0 75 Z',
  cross: 'M33 0 L67 0 L67 33 L100 33 L100 67 L67 67 L67 100 L33 100 L33 67 L0 67 L0 33 L33 33 Z',
  arrowShape: 'M0 25 L60 25 L60 0 L100 50 L60 100 L60 75 L0 75 Z',
  actor: 'M50 0 A15 15 0 1 1 50 30 A15 15 0 1 1 50 0 M50 30 L50 65 M15 45 L85 45 M50 65 L20 100 M50 65 L80 100',
  folder: 'M0 0 L40 0 L50 18 L100 18 L100 100 L0 100 Z',
  heart: 'M50 92 C30 72 0 56 0 27 C0 2 30 -8 50 14 C70 -8 100 2 100 27 C100 56 70 72 50 92 Z',
  lightning: 'M58 0 L8 58 L42 58 L32 100 L92 35 L58 35 Z',
  moon: 'M70 0 C20 8 8 65 40 90 C62 107 91 91 100 68 C78 82 50 73 41 50 C32 28 46 8 70 0 Z',
  ring: 'M50 0 A50 50 0 1 1 50 100 A50 50 0 1 1 50 0 M50 24 A26 26 0 1 0 50 76 A26 26 0 1 0 50 24 Z',
  speech: 'M0 0 L100 0 L100 72 L35 72 L12 100 L18 72 L0 72 Z',
  cube: 'M0 25 L50 0 L100 25 L100 75 L50 100 L0 75 Z M0 25 L50 52 L100 25 M50 52 L50 100',
  leftArrow: 'M100 25 L40 25 L40 0 L0 50 L40 100 L40 75 L100 75 Z', rightArrow: 'M0 25 L60 25 L60 0 L100 50 L60 100 L60 75 L0 75 Z',
  upArrow: 'M25 100 L25 40 L0 40 L50 0 L100 40 L75 40 L75 100 Z', downArrow: 'M25 0 L25 60 L0 60 L50 100 L100 60 L75 60 L75 0 Z',
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

export function shapePath(kind: string): string | undefined {
  return shapePaths[kind];
}

/** 判断图形是否有可用于工具预览、拖动虚影和画布的权威几何。 */
export function hasShapeGeometry(kind: string): boolean {
  return nativeShapeKinds.has(kind) || Boolean(shapePath(kind));
}

// 用法：<ShapeIcon kind="rectangle"/>。工具区的 draw.io 式形状预览图，复用 ObjectAppearance 的路径。
// 统一为无填充、主题色描边、圆角连接的轮廓预览，避免预览退化为实心色块。
import { shapePath } from '../../core/shapeGeometry';

const outline = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, vectorEffect: 'non-scaling-stroke' as const, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function ShapeIcon({ kind }: { kind: string }) {
  const path = shapePath(kind);
  // 路径的边常落在 0/100 边界；留出完整描边空间，避免一半笔画被 SVG 视口裁掉。
  return <svg className="shape-icon" viewBox="-8 -8 116 116" aria-hidden="true">
    {path ? <path d={path} {...outline} /> : kind === 'ellipse' ? <ellipse cx="50" cy="50" rx="43" ry="38" {...outline} /> : <rect x="9" y="9" width="82" height="82" rx={kind === 'roundedRectangle' ? 18 : 5} {...outline} />}
  </svg>;
}

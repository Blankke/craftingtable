// 用法：<ShapeIcon kind="rectangle"/>。工具区的 draw.io 式形状预览图，复用 ObjectAppearance 的路径。
// 统一为无填充、主题色描边、圆角连接的轮廓预览，避免预览退化为实心色块。
import { shapePaths } from '../core/shapeGeometry';

const outline = { fill: 'none', stroke: 'currentColor', strokeWidth: 6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function ShapeIcon({ kind }: { kind: string }) {
  const path = shapePaths[kind];
  return <svg className="shape-icon" viewBox="0 0 100 100" aria-hidden="true">
    {path ? <path d={path} {...outline} /> : kind === 'ellipse' ? <ellipse cx="50" cy="50" rx="43" ry="38" {...outline} /> : <rect x="9" y="9" width="82" height="82" rx={kind === 'roundedRectangle' ? 18 : 5} {...outline} />}
  </svg>;
}

// 用法：<ShapeIcon kind="rectangle"/>。工具区的 draw.io 式形状预览图，复用 ObjectAppearance 的路径。
import { shapePaths } from '../core/shapeGeometry';

export function ShapeIcon({ kind }: { kind: string }) {
  const path = shapePaths[kind];
  return <svg className="shape-icon" viewBox="0 0 100 100" aria-hidden="true">
    {path ? <path d={path} fill="currentColor" /> : kind === 'ellipse' ? <ellipse cx="50" cy="50" rx="43" ry="38" fill="currentColor" /> : <rect x="6" y="6" width="88" height="88" rx={kind === 'roundedRectangle' ? 18 : 0} fill="currentColor" />}
  </svg>;
}

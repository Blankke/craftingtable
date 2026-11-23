// 用法：在对象 Group 内渲染 <ObjectAppearance object={object}/>，坐标以对象左上角为原点。
import { Ellipse, Line, Path, Rect } from 'react-konva';
import type { CanvasObject } from '../../core/document';
import { styleOf } from '../../core/appearance';
import { shapePath, shapeRadius } from '../../core/shapeGeometry';
import { CanvasTextView } from './CanvasTextView';
import { isTextObject } from './canvasTextLayout';
export function ObjectAppearance({ object, hideText = false, scale = 1 }: { object: CanvasObject; hideText?: boolean; scale?: number }) {
  const style = styleOf(object), w = object.width, h = object.height;
  const path = shapePath(object.kind, 'adjustments' in object ? object.adjustments : undefined);
  // 关闭填充时使用透明命中区域，且不提供渐变色标，避免 Konva 回退到渐变填充。
  const common = { fill: style.fillEnabled ? style.fill : 'rgba(0,0,0,0)', stroke: style.strokeEnabled ? style.stroke : undefined, strokeWidth: style.strokeWidth, strokeScaleEnabled: false, dash: style.dash === 'dashed' ? [8, 5] : style.dash === 'dotted' ? [2, 4] : [], fillPriority: (style.gradient && style.fillEnabled ? 'linear-gradient' : 'color') as 'linear-gradient' | 'color', fillLinearGradientStartPoint: { x: 0, y: 0 }, fillLinearGradientEndPoint: style.gradientDirection === 'horizontal' ? { x: w, y: 0 } : { x: 0, y: h }, fillLinearGradientColorStops: style.gradient && style.fillEnabled ? [0, style.fill, 1, style.gradientColor] : undefined };
  return <>
    {object.kind === 'stroke' ? <Line points={object.points.flatMap(point => [point.x - object.x, point.y - object.y])} stroke={object.style ? style.stroke : object.color} strokeWidth={object.style ? style.strokeWidth : object.strokeWidth} dash={common.dash} lineCap="round" lineJoin="round" /> : object.kind === 'ellipse' ? <Ellipse {...common} x={w / 2} y={h / 2} radiusX={w / 2} radiusY={h / 2} /> : path ? <Path {...common} data={path} scaleX={w / 100} scaleY={h / 100} fillLinearGradientEndPoint={style.gradientDirection === 'horizontal' ? { x: 100, y: 0 } : { x: 0, y: 100 }} /> : <Rect {...common} width={w} height={h} cornerRadius={shapeRadius(object)} />}
    {!hideText && isTextObject(object) && <CanvasTextView object={object} scale={scale} />}
  </>;
}

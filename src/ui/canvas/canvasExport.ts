// 用法：copyCanvasGraphic(stage, objects, format)。导出当前选中内容，去掉选择框，形状保留 SVG 矢量几何。
import Konva from 'konva';
import type { CanvasObject } from '../../core/document';
import { styleOf } from '../../core/appearance';
import { shapePaths } from '../../core/shapeGeometry';
import { escapeTextHtml } from '../../core/canvasText';
import { canvasTextImageSource, canvasTextLayout, isTextObject } from './canvasTextLayout';

export async function copyCanvasGraphic(stage: Konva.Stage, objects: CanvasObject[], format: 'png' | 'svg'): Promise<void> {
  const copies = objects.flatMap(object => {
    const node = stage.findOne((node: Konva.Node) => node.name() === `object:${object.id}`);
    if (!node) return [];
    const clone = node.clone() as Konva.Group;
    clone.find((node: Konva.Node) => node.hasName('editor-decoration') || /^(resize-handle|crop-.*|trim-.*|scale-time-handle|media-drag-handle|playhead-handle|note:.*)$/.test(node.name())).forEach(item => item.destroy());
    return [{ object, node: clone }];
  });
  if (!copies.length) return;
  const bounds = copies.map(({ node }) => node.getClientRect());
  const left = Math.floor(Math.min(...bounds.map(box => box.x)) - 2), top = Math.floor(Math.min(...bounds.map(box => box.y)) - 2);
  const width = Math.ceil(Math.max(...bounds.map(box => box.x + box.width)) - left + 2), height = Math.ceil(Math.max(...bounds.map(box => box.y + box.height)) - top + 2);
  if (width * height > 32_000_000) throw Error('选中区域过大，请分批复制为图像');
  const container = document.createElement('div'), output = new Konva.Stage({ container, width, height });
  const layer = new Konva.Layer({ x: -left, y: -top }); output.add(layer);
  try {
    copies.forEach(({ node }) => layer.add(node)); layer.draw();
    const png = output.toDataURL({ pixelRatio: Math.min(2, Math.sqrt(32_000_000 / (width * height))) });
    let svg: string | undefined;
    if (format === 'svg') {
      const elements = copies.map(({ object, node }) => {
        const style = styleOf(object), w = object.width, h = object.height;
        if (!isTextObject(object) && object.kind !== 'stroke') {
          const box = node.getClientRect({ relativeTo: layer });
          return `<image x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" href="${node.toDataURL({ pixelRatio: 2 })}"/>`;
        }
        const id = `fill-${object.id}`, gradient = style.gradient && style.fillEnabled;
        const fill = gradient ? `url(#${id})` : style.fillEnabled ? style.fill : 'none';
        const stroke = style.strokeEnabled ? style.stroke : 'none', dash = style.dash === 'dashed' ? '8 5' : style.dash === 'dotted' ? '2 4' : '';
        const attrs = `fill="${escapeTextHtml(fill)}" stroke="${escapeTextHtml(stroke)}" stroke-width="${style.strokeWidth}" stroke-dasharray="${dash}" vector-effect="non-scaling-stroke"`;
        const shape = object.kind === 'stroke' ? `<polyline points="${object.points.map(point => `${point.x - object.x},${point.y - object.y}`).join(' ')}" fill="none" stroke="${escapeTextHtml(object.style ? style.stroke : object.color)}" stroke-width="${object.style ? style.strokeWidth : object.strokeWidth}" stroke-linecap="round"/>` : object.kind === 'ellipse' ? `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" ${attrs}/>` : shapePaths[object.kind] ? `<path d="${shapePaths[object.kind]}" transform="scale(${w / 100} ${h / 100})" ${attrs}/>` : `<rect width="${w}" height="${h}" rx="${object.kind === 'roundedRectangle' ? Math.min(w, h) * .15 : 0}" ${attrs}/>`;
        const text = isTextObject(object) ? (() => { const layout = canvasTextLayout(object); return `<image y="${layout.y}" width="${w}" height="${layout.height}" href="${escapeTextHtml(canvasTextImageSource(object, 1))}"/>`; })() : '';
        const defs = gradient ? `<defs><linearGradient id="${id}" x2="${style.gradientDirection === 'horizontal' ? '100%' : '0'}" y2="${style.gradientDirection === 'horizontal' ? '0' : '100%'}"><stop stop-color="${escapeTextHtml(style.fill)}"/><stop offset="1" stop-color="${escapeTextHtml(style.gradientColor)}"/></linearGradient></defs>` : '';
        return `${defs}<g transform="translate(${object.x} ${object.y}) rotate(${object.rotation ?? 0} ${w / 2} ${h / 2})" opacity="${style.opacity}">${shape}${text}</g>`;
      });
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}">${elements.join('')}</svg>`;
    }
    await window.workbench!.copyGraphic({ png, svg });
  } finally { output.destroy(); }
}

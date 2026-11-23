// 首页项目预览只读取项目快照；SVG 由项目对象生成，媒体缩略图由后台传入。
import type { ProjectDocument } from './document';
import { noteText } from './note';
import { canvasTextPlainText } from './canvasText';
import { shapePath, shapeRadius } from './shapeGeometry';

export interface ProjectPreview {
  canvas?: string;
  media?: string;
  note?: string;
}

function xml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}

function svg(content: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="150" viewBox="0 0 240 150"><rect width="240" height="150" fill="#f7f8fc"/>${content}</svg>`)}`;
}

export function buildProjectPreview(document: ProjectDocument, mediaByAsset: ReadonlyMap<string, string>): ProjectPreview {
  const preview: ProjectPreview = {};
  if (document.objects.length) {
    // 缩略图复现最后浏览的相机视口；不再为了“看全对象”而改写用户当时的构图。
    const scale = document.camera.scale;
    const xOffset = document.camera.x, yOffset = document.camera.y;
    const shapes = document.objects.slice(0, 80).map(object => {
      const x = object.x * scale + xOffset, y = object.y * scale + yOffset;
      const width = Math.max(2, object.width * scale), height = Math.max(2, object.height * scale);
      const rotation = object.rotation ? `rotate(${object.rotation} ${x + width / 2} ${y + height / 2})` : '';
      const rotated = (content: string) => rotation ? `<g transform="${rotation}">${content}</g>` : content;
      if (object.kind === 'imageStack') {
        const cover = mediaByAsset.get(object.images[0].assetId);
        return rotated(`<rect x="${x + 8}" y="${y - 8}" width="${width}" height="${height}" rx="4" fill="#dde3ee" stroke="#8895bd"/><rect x="${x + 4}" y="${y - 4}" width="${width}" height="${height}" rx="4" fill="#eef1f7" stroke="#8895bd"/>${cover ? `<image href="${xml(cover)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>` : `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#e4e9f2"/>`}<text x="${x + 6}" y="${y + height - 6}" font-size="12" fill="#172033">${object.images.length} 张</text>`);
      }
      if ((object.kind === 'image' || object.kind === 'media') && mediaByAsset.has(object.assetId)) {
        return rotated(`<image href="${xml(mediaByAsset.get(object.assetId)!)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>`);
      }
      if (object.kind === 'text') {
        const font = Math.max(7, Math.min(15, object.fontSize * scale)), text = canvasTextPlainText(object.text).slice(0, 40);
        if (object.writingMode === 'vertical-rl') {
          const count = Math.max(1, Math.floor((height - 8) / font)), characters = Array.from(text);
          const columns = Array.from({ length: Math.ceil(characters.length / count) }, (_, index) => `<text x="${x + width - font / 2 - index * font * 1.4}" y="${y + 4}" writing-mode="vertical-rl" font-size="${font}" fill="${xml(object.color)}">${xml(characters.slice(index * count, (index + 1) * count).join(''))}</text>`).join('');
          return rotated(columns);
        }
        return rotated(`<text x="${x}" y="${y + Math.min(16, height)}" font-size="${font}" fill="${xml(object.color)}">${xml(text)}</text>`);
      }
      if (object.kind === 'ellipse') return rotated(`<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${xml(object.fill)}" stroke="${xml(object.stroke)}"/>`);
      const path = shapePath(object.kind, 'adjustments' in object ? object.adjustments : undefined);
      if (path && 'fill' in object && 'stroke' in object) return rotated(`<path d="${path}" transform="translate(${x} ${y}) scale(${width / 100} ${height / 100})" fill="${xml(object.fill)}" stroke="${xml(object.stroke)}"/>`);
      const fill = object.kind === 'note' ? '#fffdf1' : object.kind === 'media' ? '#dce4ff' : object.kind === 'image' ? '#e4e9f2' : object.kind === 'stroke' ? 'none' : object.fill;
      const stroke = object.kind === 'note' || object.kind === 'media' || object.kind === 'image' ? '#8895bd' : object.kind === 'stroke' ? object.color : object.stroke;
      if (object.kind === 'stroke') return `<path d="${object.points.map((point, index) => `${index ? 'L' : 'M'}${point.x * scale + xOffset} ${point.y * scale + yOffset}`).join(' ')}" fill="none" stroke="${xml(stroke)}" stroke-width="${Math.max(1, object.strokeWidth * scale)}"/>`;
      return rotated(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${object.kind === 'roundedRectangle' ? shapeRadius(object) * scale : object.kind === 'note' ? 6 : 1}" fill="${xml(fill)}" stroke="${xml(stroke)}"/>`);
    }).join('');
    preview.canvas = svg(shapes);
  }
  const media = document.assets.find(asset => mediaByAsset.has(asset.id));
  if (media) preview.media = mediaByAsset.get(media.id);
  const note = document.notes.find(item => noteText(item));
  if (note) {
    const text = noteText(note).slice(0, 120);
    const lines = text.match(/.{1,24}/gu)?.slice(0, 5) ?? [];
    preview.note = svg(`<rect x="17" y="10" width="206" height="130" rx="5" fill="#fffdf5" stroke="#e4dfcf"/>${lines.map((line, index) => `<text x="29" y="${36 + index * 21}" font-family="sans-serif" font-size="12" fill="#5c6170">${xml(line)}</text><path d="M28 ${42 + index * 21}H212" stroke="#dce5e9"/>`).join('')}`);
  }
  return preview;
}

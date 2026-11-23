import { BoundedCache } from '../../core/boundedCache';
// 用法：canvasTextLayout(object) 返回实际排版高度；fitCanvasText 作为编辑器的几何归一化入口。
// 文字以浏览器原生排版测量并绘入 Konva，编辑态复用相同 HTML/CSS，保留画布对象的叠放顺序。
import type { CSSProperties } from 'react';
import type { CanvasObject } from '../../core/document';
import { styleOf } from '../../core/appearance';
import { canvasTextHtml, escapeTextHtml } from '../../core/canvasText';
import css from '../styles/canvasText.css?inline';
import '../styles/canvasText.css';

export type TextObject = Extract<CanvasObject, { kind: 'text' | typeof import('../../core/document').shapeKinds[number] }>;
export const isTextObject = (object: CanvasObject): object is TextObject => object.kind === 'text' || 'fill' in object;
export function canvasTextStyle(object: TextObject): CSSProperties {
  const style = styleOf(object);
  return { fontFamily: style.fontFamily, fontSize: object.fontSize ?? 18, fontWeight: style.bold ? 'bold' : 'normal', fontStyle: style.italic ? 'italic' : 'normal', textDecoration: style.underline ? 'underline' : 'none', textAlign: object.align ?? 'center', color: object.color ?? '#172033' };
}
const heightCache = new BoundedCache<string, number>(300, 2 * 1024 * 1024);
// 同一不可变正文在移动、播放和选区更新中复用 HTML；WeakMap 随文档释放。
const textCache = new WeakMap<object, { html: string; heights: BoundedCache<string, number> }>();
const emptyTextKey = {};
function textEntry(object: TextObject) {
  const key = object.text ?? emptyTextKey;
  let entry = textCache.get(key);
  if (!entry) { entry = { html: canvasTextHtml(object.text), heights: new BoundedCache(8) }; textCache.set(key, entry); }
  return entry;
}
export function canvasTextLayout(object: TextObject) {
  const style = canvasTextStyle(object), entry = textEntry(object), html = entry.html;
  const styleText = `font-family:${style.fontFamily};font-size:${style.fontSize}px;font-weight:${style.fontWeight};font-style:${style.fontStyle};text-decoration:${style.textDecoration};text-align:${style.textAlign};color:${style.color}`;
  const metricKey = JSON.stringify([object.width, styleText]);
  let height = entry.heights.get(metricKey);
  const key = height === undefined ? JSON.stringify([object.width, styleText, html]) : '';
  if (height === undefined) height = heightCache.get(key);
  if (height === undefined) {
    const host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:${object.width}px`;
    host.innerHTML = `<div class="canvas-rich-text" style="${escapeTextHtml(styleText)}">${html}</div>`;
    document.body.append(host);
    height = Math.ceil(host.firstElementChild!.getBoundingClientRect().height);
    host.remove();
    heightCache.set(key, height, key.length * 2);
  }
  entry.heights.set(metricKey, height);
  const alignment = styleOf(object).verticalAlign;
  const y = alignment === 'top' ? 0 : alignment === 'bottom' ? object.height - height : (object.height - height) / 2;
  return { height, y, html, styleText };
}
export function fitCanvasText(object: CanvasObject): void {
  if (object.kind === 'text') object.height = Math.max(object.height, canvasTextLayout(object).height);
}
export function canvasTextImageSource(object: TextObject, ratio: number): string {
  const { height, html, styleText } = canvasTextLayout(object);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(object.width * ratio)}" height="${Math.ceil(height * ratio)}" viewBox="0 0 ${object.width} ${height}"><style>${css}</style><foreignObject width="${object.width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" class="canvas-rich-text" style="${escapeTextHtml(styleText)}">${html}</div></foreignObject></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

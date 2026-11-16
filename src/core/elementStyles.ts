// 元素样式预设与箭头样式库（数据化）。样式 = 结构外观（填充/描边/线型/透明度/间距），颜色另由颜色编辑器控制。
import type { CanvasObject } from './document';

export type StylePatch = Partial<NonNullable<CanvasObject['style']>>;

export interface StylePreset {
  id: string;
  label: string;
  style: StylePatch;
}

export const shapeStylePresets: StylePreset[] = [
  { id: 'minimal', label: '极简', style: { fillEnabled: false, strokeEnabled: true, strokeWidth: 1, dash: 'solid', gradient: false, opacity: 1 } },
  { id: 'filled', label: '实色', style: { fillEnabled: true, strokeEnabled: true, strokeWidth: 1, dash: 'solid', gradient: false, opacity: 1 } },
  { id: 'outline', label: '描边', style: { fillEnabled: false, strokeEnabled: true, strokeWidth: 3, dash: 'solid', gradient: false, opacity: 1 } },
  { id: 'soft', label: '柔和', style: { fillEnabled: true, strokeEnabled: true, strokeWidth: 1, dash: 'solid', gradient: false, opacity: 0.82 } },
  { id: 'paper', label: '纸张', style: { fillEnabled: true, strokeEnabled: true, strokeWidth: 1, dash: 'solid', gradient: false, opacity: 1, perimeter: 6 } },
  { id: 'glass', label: '玻璃', style: { fillEnabled: true, strokeEnabled: true, strokeWidth: 1, dash: 'solid', gradient: false, opacity: 0.55 } }
];

export const textStylePresets: StylePreset[] = [
  { id: 'minimal', label: '极简', style: { fillEnabled: false, strokeEnabled: false } },
  { id: 'filled', label: '实色', style: { fillEnabled: true, strokeEnabled: false } },
  { id: 'soft', label: '柔和', style: { fillEnabled: true, strokeEnabled: false, opacity: 0.85 } },
  { id: 'paper', label: '纸张', style: { fillEnabled: true, strokeEnabled: false, opacity: 1 } },
  { id: 'glass', label: '玻璃', style: { fillEnabled: true, strokeEnabled: false, opacity: 0.5 } }
];

export const mediaTrackStylePresets: StylePreset[] = [
  { id: 'default', label: '默认', style: { strokeEnabled: true, strokeWidth: 1, dash: 'solid' } },
  { id: 'minimal', label: '无边框', style: { strokeEnabled: false } },
  { id: 'card', label: '卡片', style: { strokeEnabled: true, strokeWidth: 2, dash: 'solid' } },
  { id: 'dashed', label: '虚线框', style: { strokeEnabled: true, strokeWidth: 1, dash: 'dashed' } }
];

export function stylePresetsFor(kind: CanvasObject['kind']): StylePreset[] {
  if (kind === 'text') return textStylePresets;
  if (kind === 'media') return mediaTrackStylePresets;
  return shapeStylePresets;
}

// ---- 箭头样式库（对齐 draw.io 的线型与头部选择）----
export interface ArrowLineStyle { id: string; label: string; dash: number[]; double?: boolean }
export interface ArrowHeadStyle { id: string; label: string }

export const arrowLineStyles: ArrowLineStyle[] = [
  { id: 'solid', label: '实线', dash: [] },
  { id: 'dashed', label: '虚线', dash: [8, 5] },
  { id: 'dotted', label: '点线', dash: [2, 4] },
  { id: 'dash-dot', label: '点划线', dash: [10, 4, 2, 4] }
];

export const arrowHeadStyles: ArrowHeadStyle[] = [
  { id: 'none', label: '无' },
  { id: 'arrow', label: '实心箭头' },
  { id: 'open', label: '开口箭头' },
  { id: 'diamond', label: '菱形' },
  { id: 'circle', label: '圆形' },
  { id: 'square', label: '方块' },
  { id: 'block', label: '粗箭头' }
];

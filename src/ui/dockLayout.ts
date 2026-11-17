// 用法：WorkspaceDock 的分栏布局纯函数。侧栏宽度与三块面板高度归一化、最小高度与本地持久化逻辑集中于此，便于单元测试。
export const DOCK_STORAGE_KEY = 'workbench-dock-layout';
export const DOCK_MIN_HEIGHT = 120;
export const DOCK_DIVIDER_HEIGHT = 6;
export const DOCK_MIN_WIDTH = 280;
export const DOCK_PANELS = [
  { id: 'tools', label: '工具', icon: '◇' },
  { id: 'library', label: '素材库', icon: '▤' },
  { id: 'properties', label: '编辑', icon: '⚙' }
] as const;
export type PanelId = typeof DOCK_PANELS[number]['id'];

export interface DockLayout { width: number; heights: Record<PanelId, number> }

/** 侧栏宽度限幅到 [DOCK_MIN_WIDTH, maxWidth]。 */
export function clampWidth(width: number, maxWidth: number): number {
  return Math.min(maxWidth, Math.max(DOCK_MIN_WIDTH, width));
}

/** 面板高度下限。 */
export function clampHeight(height: number): number {
  return Math.max(DOCK_MIN_HEIGHT, height);
}

/** 把面板总高度按当前比例重新分配到可见面板；每块不低于 DOCK_MIN_HEIGHT，末块吸收误差。 */
export function normalizeHeights(heights: Record<PanelId, number>, ids: PanelId[], total: number): Record<PanelId, number> {
  const next = { ...heights };
  if (!ids.length) return next;
  const sum = ids.reduce((acc, id) => acc + heights[id], 0) || ids.length * 200;
  const scale = total / sum;
  const scaled = ids.map(id => Math.max(DOCK_MIN_HEIGHT, heights[id] * scale));
  const headSum = scaled.slice(0, -1).reduce((acc, value) => acc + value, 0);
  const last = Math.max(DOCK_MIN_HEIGHT, total - headSum);
  ids.forEach((id, index) => { next[id] = index === ids.length - 1 ? last : scaled[index]; });
  return next;
}

interface StorageLike { getItem(key: string): string | null }

/** 读取并限幅本地布局；存储不可用或内容损坏时返回默认值。 */
export function loadDockLayout(storage: StorageLike): DockLayout {
  const defaults: DockLayout = { width: 360, heights: { tools: 230, library: 260, properties: 460 } };
  try {
    const raw = storage.getItem(DOCK_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<DockLayout>;
    const heights = parsed.heights ?? ({} as Partial<Record<PanelId, number>>);
    return {
      width: clampWidth(Number(parsed.width) || 360, 4000),
      heights: {
        tools: clampHeight(Number(heights.tools) || 230),
        library: clampHeight(Number(heights.library) || 260),
        properties: clampHeight(Number(heights.properties) || 460)
      }
    };
  } catch { return defaults; }
}

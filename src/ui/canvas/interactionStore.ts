import { create } from 'zustand';
import type { Tool } from './CanvasStage';

type InteractionState = {
  tool: Tool;
  toolPersistent: boolean;
  arrowRouting: 'straight' | 'elbow';
  selected: string[];
  selectedConnections: string[];
  selectedMarker: string | null;
  setSelectedMarker(id: string | null): void;
  trimMode: boolean;
  setTool(tool: Tool, persistent?: boolean): void;
  finishTool(): void;
  setArrowRouting(routing: 'straight' | 'elbow'): void;
  setSelected(ids: string[]): void;
  setSelectedConnections(ids: string[]): void;
  setTrimMode(value: boolean): void;
  reset(): void;
};

const defaults = { tool: 'select' as Tool, toolPersistent: false, arrowRouting: 'straight' as const, selected: [] as string[], selectedConnections: [] as string[], selectedMarker: null, trimMode: false };

// 工具、选择和裁剪模式仅影响当前工作区；项目切换时一次性清空。
export const useInteractionStore = create<InteractionState>(set => ({
  ...defaults,
  setTool: (tool, persistent = false) => set({ tool, toolPersistent: persistent && ['arrow', 'brush', 'text'].includes(tool) }),
  // 仅创建完成后使用此入口；取消和切换工具走 setTool，单击画笔保留原有连续绘制行为。
  finishTool: () => set(state => state.toolPersistent || state.tool === 'brush' ? state : { tool: 'select', toolPersistent: false }),
  setArrowRouting: arrowRouting => set({ arrowRouting }),
  setSelected: selected => set(state => ({ selected, selectedConnections: [], selectedMarker: selected.length === 1 && selected[0] === state.selected[0] ? state.selectedMarker : null })),
  setSelectedConnections: selectedConnections => set({ selectedConnections, selected: [], selectedMarker: null }),
  setSelectedMarker: selectedMarker => set({ selectedMarker }),
  setTrimMode: trimMode => set({ trimMode }),
  reset: () => set({ ...defaults, selected: [] })
}));

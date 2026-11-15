import { create } from 'zustand';
import type { Tool } from './CanvasStage';

type InteractionState = {
  tool: Tool;
  arrowRouting: 'straight' | 'elbow';
  selected: string[];
  trimMode: boolean;
  setTool(tool: Tool): void;
  setArrowRouting(routing: 'straight' | 'elbow'): void;
  setSelected(ids: string[]): void;
  setTrimMode(value: boolean): void;
  reset(): void;
};

const defaults = { tool: 'select' as Tool, arrowRouting: 'straight' as const, selected: [] as string[], trimMode: false };

// 工具、选择和裁剪模式仅影响当前工作区；项目切换时一次性清空。
export const useInteractionStore = create<InteractionState>(set => ({
  ...defaults,
  setTool: tool => set({ tool }),
  setArrowRouting: arrowRouting => set({ arrowRouting }),
  setSelected: selected => set({ selected }),
  setTrimMode: trimMode => set({ trimMode }),
  reset: () => set({ ...defaults, selected: [] })
}));

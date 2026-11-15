import { create } from 'zustand';
import type { MediaAnalysis } from './CanvasStage';

type AnalysisMap = Record<string, MediaAnalysis>;
type TaskState = {
  analysis: AnalysisMap;
  retryVersion: number;
  updateAnalysis(update: (previous: AnalysisMap) => AnalysisMap): void;
  resetAnalysis(): void;
  retry(): void;
};

// 任务进度是可重建的界面状态；与项目事实、选择和播放状态分别管理。
export const useTaskStore = create<TaskState>(set => ({
  analysis: {},
  retryVersion: 0,
  updateAnalysis: update => set(state => ({ analysis: update(state.analysis) })),
  resetAnalysis: () => set({ analysis: {} }),
  retry: () => set(state => ({ retryVersion: state.retryVersion + 1 }))
}));

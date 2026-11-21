// 用法：useMediaAnalysis(editor, folder)。订阅编辑器提交，预览手势不触发后台分析。
import { useEffect } from 'react';
import type { Editor } from '../../core/editor';
import { MediaAnalysisController } from '../../core/mediaAnalysis';
import { useTaskStore } from './taskStore';

export function useMediaAnalysis(editor: Editor, folder: string | null): void {
  useEffect(() => {
    useTaskStore.getState().resetAnalysis();
    if (!folder) return;
    const api = window.workbench!;
    const controller = new MediaAnalysisController(api, analysis => useTaskStore.getState().updateAnalysis(() => analysis));
    const reconcile = (retry = false) => controller.reconcile(editor.committedDocument, retry);
    const unsubscribe = editor.subscribe(() => reconcile());
    const stopProgress = api.onTaskProgress(({ taskId, percent }) => controller.progress(taskId, percent));
    const stopRetry = useTaskStore.subscribe((state, previous) => { if (state.retryVersion !== previous.retryVersion) reconcile(true); });
    reconcile();
    return () => { unsubscribe(); stopProgress(); stopRetry(); controller.dispose(); };
  }, [editor, folder]);
}

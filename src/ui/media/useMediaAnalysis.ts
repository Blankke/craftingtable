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
    let previous: typeof editor.document | undefined;
    const reconcile = (retry = false) => {
      const current = editor.committedDocument;
      // 预览/相机变化共享对象与素材数组，不必重新扫描轨道；显式重试始终执行。
      if (!retry && previous?.objects === current.objects && previous.assets === current.assets) return;
      previous = current; controller.reconcile(current, retry);
    };
    const unsubscribe = editor.subscribe(() => reconcile());
    const stopProgress = api.onTaskProgress(({ taskId, percent }) => controller.progress(taskId, percent));
    const stopRetry = useTaskStore.subscribe((state, previous) => { if (state.retryVersion !== previous.retryVersion) reconcile(true); });
    reconcile();
    return () => { unsubscribe(); stopProgress(); stopRetry(); controller.dispose(); };
  }, [editor, folder]);
}

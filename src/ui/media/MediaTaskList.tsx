import type { ProjectDocument } from '../../core/document';
import type { MediaAnalysis } from '../canvas/CanvasStage';
import { useLanguage } from '../shared/language';

export function MediaTaskList({ document, analysis, onCancel, onRetry }: {
  document: ProjectDocument; analysis: Record<string, MediaAnalysis>;
  onCancel(taskId: string): void; onRetry(): void;
}) {
  const { t } = useLanguage();
  const entries = Object.entries(analysis).filter(([, state]) => state.processing || state.error);
  if (!entries.length) return null;
  return <div className="task-list" aria-label={t('媒体处理任务', 'Media tasks')}>{entries.map(([objectId, state]) => {
    const object = document.objects.find(item => item.id === objectId);
    const asset = object && 'assetId' in object ? document.assets.find(item => item.id === object.assetId) : undefined;
    return <div className="task-row" key={objectId}>
      <b title={asset?.name}>{asset?.name || t('媒体任务', 'Media task')}</b>
      {state.processing ? <><progress max="100" value={state.progress || 0} /><span>{state.progress || 0}%</span>{state.taskId && <button onClick={() => onCancel(state.taskId!)}>{t('取消', 'Cancel')}</button>}</> : <><small title={state.error}>{state.errorCode || t('错误', 'Error')}：{state.error}</small>{state.retryable && <button onClick={onRetry}>{t('重试', 'Retry')}</button>}</>}
    </div>;
  })}</div>;
}

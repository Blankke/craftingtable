import { useEffect, useState } from 'react';
import type { ProjectDocument } from '../core/document';
import { mediaSource } from '../platform/browserBackend';
import { useLanguage } from './language';

function AssetPreview({ asset }: { asset: ProjectDocument['assets'][number] }) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  useEffect(() => {
    setThumbnail(null);
    if (!['video', 'audio'].includes(asset.kind) || asset.status === 'missing' || !window.workbench) return;
    let cancelled = false;
    const taskId = crypto.randomUUID();
    // 视频提取首帧，音频生成波形；两者共用后台有界任务队列和可重建缓存。
    void window.workbench.analyzeAsset({ assetId: asset.id, assetPath: asset.path, kind: asset.kind as 'video' | 'audio', inUs: 0, outUs: asset.kind === 'video' ? Math.min(asset.durationUs || 1_000_000, 1_000_000) : asset.durationUs || 1_000_000, pixelsPerSecond: 120, taskId })
      .then(result => { if (!cancelled && result.ok) setThumbnail(asset.kind === 'video' ? result.result.frames?.[0]?.path ?? null : result.result.waveform ?? null); })
      .catch(() => undefined);
    return () => { cancelled = true; void window.workbench?.cancelTask(taskId).catch(() => undefined); };
  }, [asset.id, asset.path, asset.durationUs, asset.kind, asset.status]);
  if (asset.status === 'missing') return <span className="asset-preview asset-preview-empty">?</span>;
  const source = mediaSource(asset.path);
  if (asset.kind === 'image') return <img className="asset-preview" src={source} loading="lazy" alt="" />;
  if (asset.kind === 'video' || asset.kind === 'audio') return thumbnail ? <img className="asset-preview" src={mediaSource(thumbnail, 'cache')} alt="" /> : <span className="asset-preview asset-preview-empty">{asset.kind === 'video' ? '▶' : '♪'}</span>;
  if (asset.kind === 'text') return <span className="asset-preview asset-preview-text">{asset.content?.slice(0, 24) || '文'}</span>;
  return null;
}

export function AssetLibrary({ assets, referencedIds, processingAssetIds, failedAssetIds, onAdd, onRelink, onRemove }: {
  assets: ProjectDocument['assets'];
  referencedIds: Set<string>;
  processingAssetIds: Set<string>;
  failedAssetIds: Set<string>;
  onAdd(kind: 'text' | 'media' | 'image', id: string): void;
  onRelink(id: string): void;
  onRemove(id: string): void;
}) {
  const { t } = useLanguage();
  return <div className="asset-list">{assets.map(asset => <div className="asset-row" key={asset.id}>
    <button className="asset" draggable={asset.status !== 'missing'} onDragStart={event => event.dataTransfer.setData('application/x-workbench-item', JSON.stringify({ kind: asset.kind === 'image' ? 'image' : asset.kind === 'text' ? 'text' : 'media', assetId: asset.id }))} disabled={asset.status === 'missing'} onClick={() => onAdd(asset.kind === 'image' ? 'image' : asset.kind === 'text' ? 'text' : 'media', asset.id)}>
      <AssetPreview asset={asset} />
      <span className="asset-details"><b title={asset.name}>{asset.name}</b><small>{({ video: t('视频', 'Video'), audio: t('音频', 'Audio'), image: t('图片', 'Image'), text: t('文字', 'Text') })[asset.kind]} · {asset.durationUs ? `${(asset.durationUs / 1_000_000).toFixed(1)}s · ` : ''}{asset.status === 'missing' ? t('文件缺失', 'Missing file') : asset.status === 'unsupported' ? t('不支持播放', 'Unsupported') : processingAssetIds.has(asset.id) ? t('处理中', 'Processing') : failedAssetIds.has(asset.id) ? t('处理失败', 'Failed') : t('就绪', 'Ready')}</small></span>
    </button>
    {asset.status === 'missing' && <button aria-label={`${t('重新关联', 'Relink')} ${asset.name}`} onClick={() => onRelink(asset.id)}>{t('重新关联', 'Relink')}</button>}
    <button aria-label={`${t('移除', 'Remove')} ${asset.name}`} title={referencedIds.has(asset.id) ? t('素材仍被画布实例引用', 'Asset is still used on canvas') : t('从素材库移除，可撤销', 'Remove from library; undo available')} disabled={referencedIds.has(asset.id)} onClick={() => onRemove(asset.id)}>{t('移除', 'Remove')}</button>
  </div>)}</div>;
}

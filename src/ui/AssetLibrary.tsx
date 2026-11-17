import { useEffect, useState } from 'react';
import type { ProjectDocument } from '../core/document';
import { mediaSource } from './mediaSource';
import { useLanguage } from './language';

function AssetPreview({ asset }: { asset: ProjectDocument['assets'][number] }) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  useEffect(() => {
    setThumbnail(null);
    // 视频提取首帧作为缩略图；音频缩略图改为固定音符占位，不再生成 PNG 波形。
    if (asset.kind !== 'video' || asset.status === 'missing') return;
    let cancelled = false;
    const taskId = crypto.randomUUID();
    void window.workbench!.analyzeAsset({ assetId: asset.id, assetPath: asset.path, kind: 'video', inUs: 0, outUs: Math.min(asset.durationUs || 1_000_000, 1_000_000), pixelsPerSecond: 120, taskId })
      .then(result => { if (!cancelled && result.ok) setThumbnail(result.result.frames?.[0]?.path ?? null); })
      .catch(() => undefined);
    return () => { cancelled = true; void window.workbench!.cancelTask(taskId).catch(() => undefined); };
  }, [asset.id, asset.path, asset.durationUs, asset.kind, asset.status]);
  if (asset.status === 'missing') return <span className="asset-preview asset-preview-empty">?</span>;
  const source = mediaSource(asset.path);
  if (asset.kind === 'image') return <img className="asset-preview" src={source} loading="lazy" alt="" />;
  if (asset.kind === 'video') return thumbnail ? <img className="asset-preview" src={mediaSource(thumbnail, 'cache')} alt="" /> : <span className="asset-preview asset-preview-empty">▶</span>;
  if (asset.kind === 'audio') return <span className="asset-preview asset-preview-empty">♪</span>;
  if (asset.kind === 'text') return <span className="asset-preview asset-preview-text">{asset.content?.slice(0, 24) || '文'}</span>;
  return null;
}

export function AssetLibrary({ assets, notes, referencedIds, processingAssetIds, failedAssetIds, onAdd, onRelink, onRemove, onPlace, onOpenNote, onAddNote, onPlaceNote, onDuplicateNote, onRemoveNote }: {
  assets: ProjectDocument['assets'];
  notes: ProjectDocument['notes'];
  referencedIds: Set<string>;
  processingAssetIds: Set<string>;
  failedAssetIds: Set<string>;
  onPlace(event: React.PointerEvent, kind: 'text' | 'media' | 'image', assetId: string): void;
  onAdd(kind: 'text' | 'media' | 'image', id: string): void;
  onRelink(id: string): void;
  onRemove(id: string): void;
  onOpenNote(id: string): void;
  onAddNote(id: string): void;
  onPlaceNote(event: React.PointerEvent, id: string): void;
  onDuplicateNote(id: string): void;
  onRemoveNote(id: string): void;
}) {
  const { t } = useLanguage();
  return <div className="asset-list">
    {notes.length > 0 && <div className="note-library"><h4>{t('笔记', 'Notes')}</h4>{notes.map(note => <div className="asset-row" key={note.id}>
      <button className="asset" onClick={() => onOpenNote(note.id)}><span className="asset-preview asset-preview-text">📝</span><span className="asset-details"><b title={note.name}>{note.name}</b><small>{t('结构化正文', 'Structured document')}</small></span></button>
      <button aria-label={`${t('放到画布', 'Place on canvas')} ${note.name}`} onPointerDown={event => onPlaceNote(event, note.id)} onClick={() => onAddNote(note.id)}>{t('放到画布', 'Place')}</button>
      <button aria-label={`${t('复制笔记', 'Duplicate note')} ${note.name}`} onClick={() => onDuplicateNote(note.id)}>{t('复制', 'Copy')}</button>
      <button aria-label={`${t('删除笔记', 'Delete note')} ${note.name}`} onClick={() => onRemoveNote(note.id)}>{t('删除', 'Delete')}</button>
    </div>)}</div>}
    {assets.map(asset => <div className="asset-row" key={asset.id}>
    <button className="asset" onPointerDown={event => onPlace(event, asset.kind === 'image' ? 'image' : asset.kind === 'text' ? 'text' : 'media', asset.id)} disabled={asset.status === 'missing'} onClick={() => onAdd(asset.kind === 'image' ? 'image' : asset.kind === 'text' ? 'text' : 'media', asset.id)}>
      <AssetPreview asset={asset} />
      <span className="asset-details"><b title={asset.name}>{asset.name}</b><small>{({ video: t('视频', 'Video'), audio: t('音频', 'Audio'), image: t('图片', 'Image'), text: t('文字', 'Text') })[asset.kind]} · {asset.durationUs ? `${(asset.durationUs / 1_000_000).toFixed(1)}s · ` : ''}{asset.status === 'missing' ? t('文件缺失', 'Missing file') : asset.status === 'unsupported' ? t('不支持播放', 'Unsupported') : processingAssetIds.has(asset.id) ? t('处理中', 'Processing') : failedAssetIds.has(asset.id) ? t('处理失败', 'Failed') : t('就绪', 'Ready')}</small></span>
    </button>
    {asset.status === 'missing' && <button aria-label={`${t('重新关联', 'Relink')} ${asset.name}`} onClick={() => onRelink(asset.id)}>{t('重新关联', 'Relink')}</button>}
    <button aria-label={`${t('移除', 'Remove')} ${asset.name}`} title={referencedIds.has(asset.id) ? t('素材仍被项目引用', 'Asset is still used in this project') : t('从素材库移除，可撤销', 'Remove from library; undo available')} disabled={referencedIds.has(asset.id)} onClick={() => onRemove(asset.id)}>{t('移除', 'Remove')}</button>
  </div>)}</div>;
}

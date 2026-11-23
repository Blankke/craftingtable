import { ContextMenu } from '../shared/ContextMenu';
import { useEffect, useRef, useState } from 'react';
import type { ProjectDocument } from '../../core/document';
import { mediaSource } from './mediaSource';
import { useLanguage } from '../shared/language';
import { FolderOpen, Search, X, Copy, Trash2, Plus, Link2, FileText, Music2, Film, FileQuestion } from 'lucide-react';
import { IconButton } from '../shared/EditorControls';

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
  if (asset.status === 'missing') return <span className="asset-preview asset-preview-empty"><FileQuestion size={20} /></span>;
  const source = mediaSource(asset.path);
  if (asset.kind === 'image') return <img className="asset-preview" src={source} loading="lazy" alt="" />;
  if (asset.kind === 'video') return thumbnail ? <img className="asset-preview" src={mediaSource(thumbnail, 'cache')} alt="" /> : <span className="asset-preview asset-preview-empty"><Film size={20} /></span>;
  if (asset.kind === 'audio') return <span className="asset-preview asset-preview-empty"><Music2 size={20} /></span>;
  if (asset.kind === 'text') return <span className="asset-preview asset-preview-text">{asset.content?.slice(0, 24) || '文'}</span>;
  return null;
}

export function AssetLibrary({ assets, notes, referencedIds, processingAssetIds, failedAssetIds, onAdd, onRelink, onRemove, onReveal, onPlace, onOpenNote, onAddNote, onPlaceNote, onDuplicateNote, onRemoveNote }: {
  assets: ProjectDocument['assets'];
  notes: ProjectDocument['notes'];
  referencedIds: Set<string>;
  processingAssetIds: Set<string>;
  failedAssetIds: Set<string>;
  onPlace(event: React.PointerEvent, kind: 'text' | 'media' | 'image', assetId: string): void;
  onAdd(kind: 'text' | 'media' | 'image', id: string): void;
  onRelink(id: string): void;
  onReveal(path: string): void;
  onRemove(id: string): void | Promise<void>;
  onOpenNote(id: string): void;
  onAddNote(id: string): void;
  onPlaceNote(event: React.PointerEvent, id: string): void;
  onDuplicateNote(id: string): void;
  onRemoveNote(id: string): void;
}) {
  const { t } = useLanguage();
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const menuFocus = useRef<HTMLButtonElement | null>(null);
  const menuAsset = assets.find(asset => asset.id === menu?.id);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const needle = query.trim().toLocaleLowerCase();
  const visibleNotes = notes.filter(note => (kind === 'all' || kind === 'notes') && note.name.toLocaleLowerCase().includes(needle));
  const visibleAssets = assets.filter(asset => (kind === 'all' || kind === asset.kind) && asset.name.toLocaleLowerCase().includes(needle));
  return <div className="asset-list">
    <div className="asset-filter"><label className="editor-search"><Search size={14} /><input aria-label={t('搜索素材', 'Search assets')} placeholder={t('搜索素材', 'Search assets')} value={query} onChange={event => setQuery(event.target.value)} />{query && <IconButton icon={X} label={t('清空素材搜索', 'Clear asset search')} onClick={() => setQuery('')} />}</label><select aria-label={t('素材类型', 'Asset type')} value={kind} onChange={event => setKind(event.target.value)}>{[['all', t('全部', 'All')], ['image', t('图片', 'Images')], ['video', t('视频', 'Video')], ['audio', t('音频', 'Audio')], ['text', t('文字', 'Text')], ['notes', t('笔记', 'Notes')]].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
    {visibleNotes.length > 0 && <div className="note-library"><h4>{t('笔记', 'Notes')}</h4>{visibleNotes.map(note => <div className="asset-row" key={note.id}>
      <button className="asset" onPointerDown={event => onPlaceNote(event, note.id)} onClick={() => onOpenNote(note.id)}><span className="asset-preview asset-preview-text" aria-hidden="true"><FileText size={18} /></span><span className="asset-details"><b title={note.name}>{note.name}</b><small>{t('笔记', 'Note')}</small></span></button>
      <IconButton icon={Plus} label={`${t('放到画布', 'Place on canvas')} ${note.name}`} onPointerDown={event => onPlaceNote(event, note.id)} onClick={() => onAddNote(note.id)} />
      <IconButton icon={Copy} label={`${t('复制笔记', 'Duplicate note')} ${note.name}`} onClick={() => onDuplicateNote(note.id)} />
      <IconButton icon={Trash2} label={`${t('删除笔记', 'Delete note')} ${note.name}`} onClick={() => { if (confirm(t(`删除“${note.name}”？`, `Delete “${note.name}”?`))) onRemoveNote(note.id); }} />
    </div>)}</div>}
    {visibleAssets.map(asset => <div className="asset-row" key={asset.id} onContextMenu={event => { event.preventDefault(); menuFocus.current = event.currentTarget.querySelector('button:not(:disabled)'); setMenu({ x: event.clientX, y: event.clientY, id: asset.id }); }}
      onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); menuFocus.current = event.currentTarget.querySelector('button:not(:disabled)'); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.left, y: rect.bottom, id: asset.id }); } }}>
    <button className="asset" onPointerDown={event => onPlace(event, asset.kind === 'image' ? 'image' : asset.kind === 'text' ? 'text' : 'media', asset.id)} disabled={asset.status === 'missing'} onClick={() => onAdd(asset.kind === 'image' ? 'image' : asset.kind === 'text' ? 'text' : 'media', asset.id)}>
      <AssetPreview asset={asset} />
      <span className="asset-details"><b title={asset.name}>{asset.name}</b><small>{({ video: t('视频', 'Video'), audio: t('音频', 'Audio'), image: t('图片', 'Image'), text: t('文字', 'Text') })[asset.kind]} · {asset.durationUs ? `${(asset.durationUs / 1_000_000).toFixed(1)}s · ` : ''}{asset.status === 'missing' ? t('文件缺失', 'Missing file') : asset.status === 'unsupported' ? t('不支持播放', 'Unsupported') : processingAssetIds.has(asset.id) ? t('处理中', 'Processing') : failedAssetIds.has(asset.id) ? t('处理失败', 'Failed') : t('就绪', 'Ready')}</small></span>
    </button>
    {asset.status === 'missing' && <IconButton icon={Link2} label={`${t('重新关联', 'Relink')} ${asset.name}`} onClick={() => onRelink(asset.id)} />}
    <IconButton icon={Trash2} label={`${t('移除', 'Remove')} ${asset.name}`} title={referencedIds.has(asset.id) ? t('素材仍被项目引用', 'Asset is still used in this project') : t('从素材库移除，同时删除项目文件', 'Remove from library and delete the project file')} disabled={referencedIds.has(asset.id)} onClick={() => { void onRemove(asset.id); }} />
  </div>)}{!visibleAssets.length && !visibleNotes.length && <p className="editor-empty">{query || kind !== 'all' ? t('没有匹配的素材', 'No matching assets') : t('暂无素材', 'No assets')}</p>}{menu && menuAsset && <ContextMenu x={menu.x} y={menu.y} label={t('素材右键菜单', 'Asset context menu')} onClose={() => setMenu(null)} onRestoreFocus={() => menuFocus.current?.focus({ preventScroll: true })} items={[{ id: 'reveal-asset', label: t('在资源管理器中显示', 'Show in file manager'), icon: <FolderOpen/>, disabled: menuAsset.status === 'missing', run: () => onReveal(menuAsset.path) }]}/>}</div>;
}

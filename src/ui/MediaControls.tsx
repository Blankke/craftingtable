import { useEffect, useRef, useState } from 'react';
import type { Editor } from '../core/editor';
import type { ProjectDocument } from '../core/document';
import { usePlaybackStore } from './playbackStore';
import { mediaSource } from '../platform/browserBackend';
import { useLanguage } from './language';

type Marker = ProjectDocument['markers'][number];

function MarkerRow({ marker, editor, durationUs, onPlay }: { marker: Marker; editor: Editor; durationUs: number; onPlay(): void }) {
  const { t } = useLanguage();
  const [seconds, setSeconds] = useState((marker.timeUs / 1_000_000).toFixed(2));
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState(marker.note);
  useEffect(() => setSeconds((marker.timeUs / 1_000_000).toFixed(2)), [marker.timeUs]);
  const commitTime = () => {
    const parsed = Number(seconds);
    if (Number.isFinite(parsed)) editor.moveMarker(marker.id, Math.min(durationUs, Math.max(0, Math.round(parsed * 1_000_000))));
    else setSeconds((marker.timeUs / 1_000_000).toFixed(2));
  };
  return <div className="marker-row">
    <input aria-label={t('标记源时间（秒）', 'Marker source time (seconds)')} type="number" min="0" max={durationUs / 1_000_000} step="0.01" value={seconds} onChange={event => setSeconds(event.target.value)} onBlur={commitTime} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    {editingNote ? <input aria-label={t('标记说明', 'Marker note')} autoFocus value={note} onChange={event => setNote(event.target.value)} onBlur={() => { editor.execute(draft => { const target = draft.markers.find(item => item.id === marker.id); if (target) target.note = note; }); setEditingNote(false); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setNote(marker.note); setEditingNote(false); } }} /> : <button className="marker-note" title={marker.note || t('编辑标记说明', 'Edit marker note')} onClick={() => { setNote(marker.note); setEditingNote(true); }}>{marker.note || t('说明', 'Note')}</button>}
    <button aria-label={t('播放标记', 'Play marker')} onClick={onPlay}>▶</button>
    <button aria-label={t('删除标记', 'Delete marker')} onClick={() => editor.deleteMarker(marker.id)}>×</button>
  </div>;
}

function TrimInputs({ media, durationUs, editor }: { media: Extract<ProjectDocument['objects'][number], { kind: 'media' }>; durationUs?: number; editor: Editor }) {
  const { t } = useLanguage();
  const [start, setStart] = useState((media.inUs / 1_000_000).toFixed(2));
  const [end, setEnd] = useState((media.outUs / 1_000_000).toFixed(2));
  useEffect(() => { setStart((media.inUs / 1_000_000).toFixed(2)); setEnd((media.outUs / 1_000_000).toFixed(2)); }, [media.id, media.inUs, media.outUs]);
  const commit = (side: 'in' | 'out', raw: string) => {
    const seconds = Number(raw);
    if (!raw.trim() || !Number.isFinite(seconds) || seconds < 0) { setStart((media.inUs / 1_000_000).toFixed(2)); setEnd((media.outUs / 1_000_000).toFixed(2)); return; }
    editor.execute(draft => {
      const target = draft.objects.find(item => item.id === media.id);
      if (target?.kind !== 'media') return;
      const value = Math.round(seconds * 1_000_000);
      if (side === 'in') target.inUs = Math.max(0, Math.min(target.outUs - 100_000, value));
      else target.outUs = Math.max(target.inUs + 100_000, Math.min(Math.max(target.inUs + 100_000, durationUs || target.outUs), value));
    });
    const updated = editor.document.objects.find(item => item.id === media.id);
    if (updated?.kind === 'media') { setStart((updated.inUs / 1_000_000).toFixed(2)); setEnd((updated.outUs / 1_000_000).toFixed(2)); }
  };
  return <><label>{t('起点', 'In')} <input aria-label={t('裁剪起点', 'Trim in')} type="number" min="0" step="0.1" value={start} onChange={event => setStart(event.target.value)} onBlur={() => commit('in', start)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label><label>{t('终点', 'Out')} <input aria-label={t('裁剪终点', 'Trim out')} type="number" min={media.inUs / 1e6 + 0.1} max={durationUs ? durationUs / 1e6 : undefined} step="0.1" value={end} onChange={event => setEnd(event.target.value)} onBlur={() => commit('out', end)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label></>;
}
export function MediaControls({ document, editor, trimMode, onTrimMode }: { document: ProjectDocument; editor: Editor; trimMode: boolean; onTrimMode(value: boolean): void }) {
  const { t } = useLanguage();
  const playback = usePlaybackStore(state => state.playback);
  const onPlayback = usePlaybackStore(state => state.setPlayback);
  const updateFromMedia = usePlaybackStore(state => state.updateFromMedia);
  const seekVersion = usePlaybackStore(state => state.seekVersion);
  const player = useRef<HTMLMediaElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const media = document.objects.find(item => item.id === playback?.mediaId);
  const asset = media?.kind === 'media' ? document.assets.find(item => item.id === media.assetId) : undefined;
  const source = asset ? mediaSource(asset.path) : undefined;
  useEffect(() => { setPosition(null); }, [playback?.mediaId]);
  useEffect(() => { setPlaybackError(null); }, [source]);
  useEffect(() => {
    const element = player.current;
    if (!element || !playback || media?.kind !== 'media') return;
    const seconds = playback.timeUs / 1_000_000;
    if (Math.abs(element.currentTime - seconds) > 0.02) element.currentTime = seconds;
  }, [seekVersion, playback?.mediaId, media?.kind, source]);
  useEffect(() => {
    const element = player.current;
    if (!element || !playback || media?.kind !== 'media') return;
    if (playback.play) element.play().catch(error => {
      setPlaybackError(`${t('播放失败', 'Playback failed')}：${error instanceof Error ? error.message : String(error)}`);
      const current = usePlaybackStore.getState().playback;
      if (current?.mediaId === playback.mediaId) onPlayback({ ...current, play: false });
    });
    else element.pause();
  }, [playback?.mediaId, playback?.play, media?.kind, source]);
  useEffect(() => {
    if (!playback?.play || media?.kind !== 'media') return;
    const timer = setInterval(() => {
      const element = player.current;
      if (!element || element.currentTime < media.outUs / 1_000_000) return;
      element.pause();
      if (Math.abs(element.currentTime - media.outUs / 1_000_000) > 0.001) element.currentTime = media.outUs / 1_000_000;
      const current = usePlaybackStore.getState().playback;
      if (current?.mediaId === media.id) onPlayback({ ...current, timeUs: media.outUs, play: false });
    }, 30);
    return () => clearInterval(timer);
  }, [playback?.mediaId, playback?.play, media?.kind, media?.kind === 'media' ? media.outUs : undefined, onPlayback]);
  if (!playback || media?.kind !== 'media' || !asset) return null;
  const playbackFailed = (message: string) => {
    setPlaybackError(message);
    // 解码失败的素材仍留在项目中，状态写入文档以便重开后清楚提示和重新关联。
    editor.execute(draft => { const target = draft.assets.find(item => item.id === asset.id); if (target && target.status !== 'missing') target.status = 'unsupported'; });
    const current = usePlaybackStore.getState().playback;
    if (current?.mediaId === media.id) onPlayback({ ...current, play: false });
  };
  const markers = document.markers.filter(item => item.mediaId === media.id);
  const loadedMetadata = (element: HTMLMediaElement) => {
    const current = usePlaybackStore.getState().playback;
    if (current?.mediaId !== media.id) return;
    const targetUs = Math.max(media.inUs, Math.min(media.outUs, current.timeUs));
    element.currentTime = targetUs / 1_000_000;
  };
  const timeUpdate = (element: HTMLMediaElement) => {
    const timeUs = Math.round(element.currentTime * 1_000_000);
    if (!updateFromMedia(media.id, timeUs, media.outUs)) return;
    if (timeUs >= media.outUs) { element.pause(); if (Math.abs(element.currentTime - media.outUs / 1_000_000) > 0.001) element.currentTime = media.outUs / 1_000_000; }
  };
  return <div ref={panel} className="media-controls" style={asset.kind === 'video' && position ? { left: position.left, top: position.top, bottom: 'auto' } : undefined}>
    <div className="media-title" style={asset.kind === 'video' ? { cursor: 'move' } : undefined}
      onPointerDown={event => {
        if (asset.kind !== 'video' || event.target instanceof HTMLButtonElement || !panel.current?.parentElement) return;
        const bounds = panel.current.getBoundingClientRect();
        const parent = panel.current.parentElement.getBoundingClientRect();
        drag.current = { x: event.clientX, y: event.clientY, left: bounds.left - parent.left, top: bounds.top - parent.top };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (!drag.current || !panel.current?.parentElement) return;
        const parent = panel.current.parentElement.getBoundingClientRect();
        const left = Math.max(0, Math.min(Math.max(0, parent.width - panel.current.offsetWidth), drag.current.left + event.clientX - drag.current.x));
        const top = Math.max(0, Math.min(Math.max(0, parent.height - panel.current.offsetHeight), drag.current.top + event.clientY - drag.current.y));
        panel.current.style.left = `${left}px`;
        panel.current.style.top = `${top}px`;
        panel.current.style.bottom = 'auto';
      }}
      onPointerUp={() => {
        if (!drag.current || !panel.current) return;
        const left = Number.parseFloat(panel.current.style.left), top = Number.parseFloat(panel.current.style.top);
        setPosition({ left: Number.isFinite(left) ? left : drag.current.left, top: Number.isFinite(top) ? top : drag.current.top });
        drag.current = null;
      }}
      onPointerCancel={() => { drag.current = null; }}>
      <b>{asset.name}</b><button onClick={() => onPlayback(null)}>×</button>
    </div>
    {asset.kind === 'video' ? <video ref={player as React.RefObject<HTMLVideoElement>} src={source} onLoadedMetadata={event => loadedMetadata(event.currentTarget)} onTimeUpdate={event => timeUpdate(event.currentTarget)} onError={() => playbackFailed(t('此视频无法播放，请检查文件或编码格式。', 'This video cannot play. Check the file and codec.'))} /> : <audio ref={player as React.RefObject<HTMLAudioElement>} src={source} onLoadedMetadata={event => loadedMetadata(event.currentTarget)} onTimeUpdate={event => timeUpdate(event.currentTarget)} onError={() => playbackFailed(t('此音频无法播放，请检查文件或编码格式。', 'This audio cannot play. Check the file and codec.'))} />}
    {playbackError && <p className="media-playback-error" role="alert">{playbackError}</p>}
    <div className="media-row"><button onClick={() => onPlayback({ ...playback, play: !playback.play })}>{playback.play ? t('暂停', 'Pause') : t('播放', 'Play')}</button><span>{(playback.timeUs / 1e6).toFixed(1)}s / {(media.outUs / 1e6).toFixed(1)}s</span><button onClick={() => editor.annotate(media.id, playback.timeUs, { x: media.x + 60, y: media.y + 130 })}>{t('标记并注释', 'Add marker and note')}</button></div>
    <div className="media-row"><label>{t('显示长度', 'Display length')}</label><input aria-label={t('显示长度', 'Display length')} type="range" min="10" max="120" value={media.pixelsPerSecond} onChange={event => editor.preview(draft => { const target = draft.objects.find(item => item.id === media.id); if (target?.kind === 'media') target.pixelsPerSecond = Number(event.target.value); })} onPointerUp={() => editor.commitPreview()} onPointerCancel={() => editor.cancelPreview()} onKeyUp={() => editor.commitPreview()} onBlur={() => editor.commitPreview()} /></div>
    <div className="media-row"><button aria-pressed={trimMode} onClick={() => onTrimMode(!trimMode)}>{trimMode ? t('完成裁剪', 'Finish trim') : t('裁剪', 'Trim')}</button>{trimMode && <TrimInputs media={media} durationUs={asset.durationUs} editor={editor} />}</div>
    <div className="marker-list">{markers.map(marker => <MarkerRow key={marker.id} marker={marker} editor={editor} durationUs={asset.durationUs || media.outUs} onPlay={() => onPlayback({ mediaId: media.id, timeUs: marker.timeUs, play: true })} />)}</div>
  </div>;
}

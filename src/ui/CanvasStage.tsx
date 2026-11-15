import { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Rect, Text, Ellipse, Line, Group, Image as KonvaImage, Circle, Arrow } from 'react-konva';
import type Konva from 'konva';
import { Editor } from '../core/editor';
import { mediaWidth, resolveAnchor, type Anchor, type CanvasObject, type ProjectDocument } from '../core/document';
import { usePlaybackStore } from './playbackStore';
import { trackTicks } from '../core/ticks';
import { mediaSource } from '../platform/browserBackend';
import { useLanguage } from './language';

export type Tool = 'select' | 'text' | 'rectangle' | 'ellipse' | 'diamond' | 'arrow' | 'brush';
export type MediaAnalysis = { waveform?: string; frames?: { path: string; timeUs: number }[]; processing?: boolean; progress?: number; taskId?: string; error?: string; errorCode?: string; retryable?: boolean };
type Point = { x: number; y: number };
type Gesture =
  | { kind: 'pan'; start: Point; camera: Point }
  | { kind: 'marquee'; start: Point }
  | { kind: 'brush'; points: Point[] }
  | { kind: 'scrub'; mediaId: string; lastPreviewAt: number; node: Konva.Node | null }
  | { kind: 'scale-time'; mediaId: string; x: number; inUs: number; outUs: number; node: Konva.Node | null }
  | { kind: 'trim'; mediaId: string; side: 'in' | 'out'; x: number; inUs: number; outUs: number; pixelsPerSecond: number; durationUs: number; node: Konva.Node | null }
  | { kind: 'arrow'; start: Point; sourceId: string | null; timeUs: number | null; autoAnnotate: boolean };
const accent = '#5268e8';

function ImageContent({ path, width, height, x = 0, y = 0, host = 'asset', crop }: { path: string; width: number; height: number; x?: number; y?: number; host?: 'asset' | 'cache'; crop?: { x: number; y: number; width: number; height: number } }) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const element = new Image();
    element.onload = () => setImage(element);
    element.src = mediaSource(path, host);
    return () => { element.onload = null; };
  }, [path, host]);
  return image ? <KonvaImage image={image} x={x} y={y} width={width} height={height} crop={crop} /> : <Rect x={x} y={y} width={width} height={height} fill="#f1f5f9" />;
}

function ObjectView({ object, assetPath, assetName, assetKind, assetDurationUs, analysis, markers, playheadUs, selected, trimMode, tool, onSelect, onMove, onMarkerMove, onSeek }: {
  object: CanvasObject; assetPath?: string; assetName?: string; assetKind?: string; assetDurationUs?: number; analysis?: MediaAnalysis; markers: ProjectDocument['markers']; playheadUs?: number; selected: boolean; tool: Tool;
  trimMode: boolean;
  onSelect(additive: boolean): void; onMove(x: number, y: number): void; onMarkerMove(id: string, timeUs: number): void; onSeek(timeUs: number, play: boolean): void;
}) {
  const { t } = useLanguage();
  const width = object.kind === 'media' ? mediaWidth(object) : object.width;
  const ticks = object.kind === 'media' ? trackTicks(object.inUs, object.outUs, object.pixelsPerSecond) : [];
  const [hoverX, setHoverX] = useState<number | null>(null);
  const seek = (play: boolean, localX: number) => {
    if (object.kind === 'media') onSeek(Math.round(Math.max(object.inUs, Math.min(object.outUs, object.inUs + localX / object.pixelsPerSecond * 1_000_000))), play);
  };
  return <Group name={`object:${object.id}`} x={object.x} y={object.y} draggable={tool === 'select' && object.kind !== 'media'}
    onMouseMove={event => { if (object.kind === 'media' && tool === 'select') { const point = event.currentTarget.getRelativePointerPosition(); setHoverX(point && point.y >= 25 ? Math.max(0, Math.min(width, point.x)) : null); } }}
    onMouseLeave={() => setHoverX(null)}
    onClick={event => { if (tool !== 'select' || (event.target.name().endsWith('-handle') && event.target.name() !== 'media-drag-handle')) return; onSelect(event.evt.ctrlKey || event.evt.shiftKey); seek(false, event.currentTarget.getRelativePointerPosition()?.x ?? 0); }}
    onDblClick={event => { if (tool === 'select') seek(true, event.currentTarget.getRelativePointerPosition()?.x ?? 0); }}
    onTap={() => { if (tool === 'select') onSelect(false); }}
    onDragEnd={event => { if (event.target === event.currentTarget) onMove(event.target.x(), event.target.y()); }}>
    {object.kind === 'text' ? <Text text={object.text || t('双击编辑文字', 'Double click to edit')} width={width} height={object.height} fontSize={object.fontSize} fill={object.color} align={object.align} /> : null}
    {object.kind === 'rectangle' ? <Rect width={width} height={object.height} fill={object.fill} stroke={selected ? accent : object.stroke} strokeWidth={selected ? 2 : 1} cornerRadius={6} /> : null}
    {object.kind === 'ellipse' ? <Ellipse x={width / 2} y={object.height / 2} radiusX={width / 2} radiusY={object.height / 2} fill={object.fill} stroke={selected ? accent : object.stroke} /> : null}
    {object.kind === 'diamond' ? <Line points={[width / 2, 0, width, object.height / 2, width / 2, object.height, 0, object.height / 2]} closed fill={object.fill} stroke={selected ? accent : object.stroke} /> : null}
    {object.kind === 'stroke' ? <Line points={object.points.flatMap(point => [point.x - object.x, point.y - object.y])} stroke={object.color} strokeWidth={object.strokeWidth} lineCap="round" lineJoin="round" /> : null}
    {object.kind === 'media' ? <>
      <Rect width={width} height={object.height} fill={selected ? '#dce6ff' : '#edf1f8'} stroke={selected ? accent : '#b8c4d8'} cornerRadius={8}/>
      {assetKind === 'audio' && analysis?.waveform && <ImageContent host="cache" path={analysis.waveform} x={8} y={27} width={Math.max(1, width - 16)} height={42} crop={{ x: 1600 * object.inUs / (assetDurationUs || object.outUs), y: 0, width: 1600 * (object.outUs - object.inUs) / (assetDurationUs || object.outUs), height: 60 }} />}
      {assetKind === 'video' && <Group clipX={0} clipY={24} clipWidth={width} clipHeight={50}>{analysis?.frames?.map(frame => <ImageContent key={frame.path} host="cache" path={frame.path} x={(frame.timeUs - object.inUs) / 1_000_000 * object.pixelsPerSecond} y={24} width={Math.min(120, width / Math.max(1, analysis.frames!.length))} height={50} />)}</Group>}
      <Text x={12} y={8} width={Math.max(80, width - 20)} ellipsis text={analysis?.error ? t('处理失败，见右侧任务', 'Processing failed; see tasks') : `${assetKind === 'audio' ? '♪' : '▶'} ${assetName ?? t('缺失素材', 'Missing asset')}${analysis?.processing ? ` · ${t('处理中', 'Processing')} ${analysis.progress ?? 0}%` : ''}`} fontSize={13} fill="#172033" />
      {markers.filter(marker => marker.timeUs >= object.inUs && marker.timeUs <= object.outUs).map(marker => { const x = (marker.timeUs - object.inUs) / 1_000_000 * object.pixelsPerSecond; return <Group key={marker.id} name="marker-handle" x={x} draggable={tool === 'select'}
        onDragMove={event => { event.target.x(Math.max(0, Math.min(width, event.target.x()))); event.target.y(0); }}
        onDragEnd={event => { if (object.kind === 'media') onMarkerMove(marker.id, Math.round(object.inUs + event.target.x() / object.pixelsPerSecond * 1_000_000)); }}
        onDblClick={event => { event.cancelBubble = true; onSeek(marker.timeUs, true); }}>
        <Line points={[0, 24, 0, object.height - 20]} stroke="#e08a27" strokeWidth={2}/><Circle y={24} radius={7} fill="#e08a27" stroke="#fff" strokeWidth={2}/>
      </Group>; })}
      {playheadUs !== undefined && playheadUs >= object.inUs && playheadUs <= object.outUs && <>
        <Line points={[(playheadUs - object.inUs) / 1_000_000 * object.pixelsPerSecond, 0, (playheadUs - object.inUs) / 1_000_000 * object.pixelsPerSecond, object.height]} stroke="#e44352" strokeWidth={2} listening={false} />
        <Circle name="playhead-handle" x={(playheadUs - object.inUs) / 1_000_000 * object.pixelsPerSecond} y={35} radius={9} fill="#e44352" stroke="#fff" strokeWidth={2} />
      </>}
      {hoverX !== null && tool === 'select' && <><Line points={[hoverX, 35, hoverX, object.height - 20]} stroke={accent} dash={[3, 3]} listening={false} /><Circle name="time-handle" x={hoverX} y={35} radius={7} fill={accent} stroke="#fff" strokeWidth={2} /><Text x={Math.min(hoverX + 9, width - 48)} y={38} text={`${(object.inUs / 1e6 + hoverX / object.pixelsPerSecond).toFixed(1)}s`} fontSize={10} fill="#3549c7" listening={false} /></>}
      <Line points={[12, object.height - 20, width - 12, object.height - 20]} stroke="#91a0bd"/>
      {ticks.length ? ticks.map(tick => <Group key={tick.timeUs} x={tick.x} listening={false}>
        <Line points={[0, object.height - 20, 0, object.height - 13]} stroke="#7f8ca5" strokeWidth={1} />
        <Text x={Math.max(2 - tick.x, Math.min(2, width - tick.x - 44))} y={object.height - 12} text={tick.label} fontSize={10} fill="#64748b" />
      </Group>) : <Text x={12} y={object.height - 17} text={`${(object.inUs / 1e6).toFixed(1)}s — ${(object.outUs / 1e6).toFixed(1)}s`} fontSize={11} fill="#64748b" listening={false} />}
      {markers.some(marker => marker.timeUs < object.inUs || marker.timeUs > object.outUs) && <Text x={Math.max(10, width - 105)} y={8} text={`${t('区间外', 'Outside range')} ${markers.filter(marker => marker.timeUs < object.inUs || marker.timeUs > object.outUs).length} ${t('个标记', 'markers')}`} fontSize={11} fill="#a65c15" />}
      {tool === 'arrow' && <Circle x={width / 2} y={0} radius={6} fill={accent} />}
      {selected && tool === 'select' && (trimMode ? <>
        <Rect name="trim-in-handle" x={-6} y={23} width={12} height={50} fill="#e08a27" cornerRadius={4} />
        <Rect name="trim-out-handle" x={width - 6} y={23} width={12} height={50} fill="#e08a27" cornerRadius={4} />
      </> : <>
        <Text x={Math.max(0, width - 105)} y={object.height + 9} text={t('显示长度', 'Display length')} fontSize={11} fill="#5268e8" listening={false} />
        <Rect name="scale-time-handle" x={width - 40} y={object.height + 5} width={40} height={22} fill={accent} opacity={0.58} cornerRadius={5} />
      </>)}
      {tool === 'select' && <Rect name="media-drag-handle" x={0} y={0} width={width} height={23} fill="#fff" opacity={0.001} draggable
        onDragEnd={event => { onMove(object.x + event.target.x(), object.y + event.target.y()); event.target.position({ x: 0, y: 0 }); }} />}
    </> : null}
    {object.kind === 'image' ? <>{assetPath ? <ImageContent path={assetPath} width={width} height={object.height} /> : <Rect width={width} height={object.height} fill="#f1f5f9" />}<Rect width={width} height={object.height} stroke={selected ? accent : '#b8c4d8'}/></> : null}
  </Group>;
}

function objectIdFromNode(node: Konva.Node): string | null {
  let current: Konva.Node | null = node;
  while (current) {
    const name = current.name();
    if (name.startsWith('object:')) return name.slice(7);
    current = current.getParent();
  }
  return null;
}

function worldPoint(stage: Konva.Stage): Point | null {
  const point = stage.getPointerPosition();
  return point ? { x: (point.x - stage.x()) / stage.scaleX(), y: (point.y - stage.y()) / stage.scaleY() } : null;
}

export function CanvasStage({ editor, document, viewport, tool, arrowRouting, selected, trimMode, analysis, onSelect, onTool, onSpacePan }: {
  editor: Editor; document: ProjectDocument; viewport: { width: number; height: number }; tool: Tool; selected: string[];
  arrowRouting: 'straight' | 'elbow';
  trimMode: boolean;
  analysis: Record<string, MediaAnalysis>;
  onSelect(ids: string[]): void; onTool(tool: Tool): void; onSpacePan(): void;
}) {
  const { t } = useLanguage();
  const playback = usePlaybackStore(state => state.playback);
  const setPlayback = usePlaybackStore(state => state.setPlayback);
  const onPlayback = (mediaId: string, timeUs: number, play: boolean) => setPlayback({ mediaId, timeUs, play });
  const gesture = useRef<Gesture | null>(null);
  const previewLine = useRef<Konva.Line | null>(null);
  const previewRect = useRef<Konva.Rect | null>(null);
  const space = useRef(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { textarea.current?.focus(); }, [editing?.id]);
  const commitText = (value?: string) => {
    if (!editing) return;
    const text = value ?? textarea.current?.value ?? editing.text;
    const original = document.objects.find(item => item.id === editing.id);
    if (original?.kind === 'text' && original.text !== text) editor.execute(draft => { const target = draft.objects.find(item => item.id === editing.id); if (target?.kind === 'text') target.text = text; });
    setEditing(null);
  };
  useEffect(() => {
    const down = (event: KeyboardEvent) => { if (event.code === 'Space' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) space.current = true; };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') space.current = false; };
    addEventListener('keydown', down); addEventListener('keyup', up);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); };
  }, []);
  const finish = (stage: Konva.Stage, target: Konva.Node) => {
    const active = gesture.current; gesture.current = null;
    previewLine.current?.hide(); previewRect.current?.hide();
    if (!active) return;
    if ('node' in active) active.node?.draggable(true);
    const end = worldPoint(stage);
    if (!end) return;
    if (active.kind === 'scale-time' || active.kind === 'trim') { editor.commitPreview(); return; }
    if (active.kind === 'scrub') {
      const media = document.objects.find(item => item.id === active.mediaId);
      if (media?.kind === 'media') onPlayback(media.id, Math.round(Math.max(media.inUs, Math.min(media.outUs, media.inUs + (end.x - media.x) / media.pixelsPerSecond * 1_000_000))), false);
      return;
    }
    if (active.kind === 'pan') {
      editor.execute(draft => { draft.camera.x = stage.x(); draft.camera.y = stage.y(); });
      return;
    }
    if (active.kind === 'marquee') {
      const left = Math.min(active.start.x, end.x), right = Math.max(active.start.x, end.x);
      const top = Math.min(active.start.y, end.y), bottom = Math.max(active.start.y, end.y);
      onSelect(document.objects.filter(item => item.x < right && item.x + (item.kind === 'media' ? mediaWidth(item) : item.width) > left && item.y < bottom && item.y + item.height > top).map(item => item.id));
      return;
    }
    if (active.kind === 'brush') {
      if (active.points.length < 2) return;
      const xs = active.points.map(point => point.x), ys = active.points.map(point => point.y);
      editor.addObject({ id: crypto.randomUUID(), kind: 'stroke', x: Math.min(...xs), y: Math.min(...ys), width: Math.max(1, Math.max(...xs) - Math.min(...xs)), height: Math.max(1, Math.max(...ys) - Math.min(...ys)), groupId: null, points: active.points, color: '#172033', strokeWidth: 3 });
      return;
    }
    const targetId = objectIdFromNode(target);
    if (active.autoAnnotate && active.sourceId && active.timeUs !== null) {
      if (Math.hypot(end.x - active.start.x, end.y - active.start.y) < 8) return;
      const textId = editor.annotate(active.sourceId, active.timeUs, targetId && targetId !== active.sourceId ? targetId : end);
      if (textId) { onSelect([textId]); setEditing({ id: textId, text: '' }); }
      onTool('select');
      return;
    }
    if (Math.hypot(end.x - active.start.x, end.y - active.start.y) < 8) return;
    const targetObject = document.objects.find(item => item.id === targetId);
    const targetLocalY = targetObject ? end.y - targetObject.y : -1;
    const targetTimeUs = targetObject?.kind === 'media' && targetLocalY >= 24 && targetLocalY <= targetObject.height - 20
      ? Math.round(Math.max(targetObject.inUs, Math.min(targetObject.outUs, targetObject.inUs + (end.x - targetObject.x) / targetObject.pixelsPerSecond * 1_000_000))) : null;
    editor.execute(draft => {
      // 时间锚点与连线同一命令提交，删除或撤销时不会留下孤立关系。
      const fromMarkerId = active.sourceId && active.timeUs !== null ? crypto.randomUUID() : null;
      const toMarkerId = targetId && targetTimeUs !== null ? crypto.randomUUID() : null;
      if (fromMarkerId) draft.markers.push({ id: fromMarkerId, mediaId: active.sourceId!, timeUs: active.timeUs!, note: '' });
      if (toMarkerId) draft.markers.push({ id: toMarkerId, mediaId: targetId!, timeUs: targetTimeUs!, note: '' });
      const from: Anchor = fromMarkerId ? { kind: 'time', markerId: fromMarkerId } : active.sourceId ? { kind: 'object', objectId: active.sourceId } : { kind: 'free', point: active.start };
      const to: Anchor = toMarkerId ? { kind: 'time', markerId: toMarkerId } : targetId && targetId !== active.sourceId ? { kind: 'object', objectId: targetId } : { kind: 'free', point: end };
      draft.connections.push({ id: crypto.randomUUID(), from, to, routing: arrowRouting });
    });
    onTool('select');
  };
  const editingObject = document.objects.find(item => item.id === editing?.id);
  // 可见区四周预绘一屏，保证短距离平移时对象已在 Konva 图层中。
  const marginX = viewport.width / document.camera.scale;
  const marginY = viewport.height / document.camera.scale;
  const visible = {
    left: -document.camera.x / document.camera.scale - marginX,
    top: -document.camera.y / document.camera.scale - marginY,
    right: (viewport.width - document.camera.x) / document.camera.scale + marginX,
    bottom: (viewport.height - document.camera.y) / document.camera.scale + marginY
  };
  const visibleObjects = document.objects.filter(object => object.x < visible.right && object.x + (object.kind === 'media' ? mediaWidth(object) : object.width) > visible.left && object.y < visible.bottom && object.y + object.height > visible.top);
  return <><Stage width={viewport.width} height={viewport.height} x={document.camera.x} y={document.camera.y} scaleX={document.camera.scale} scaleY={document.camera.scale}
    onMouseDown={event => {
      const stage = event.target.getStage(); if (!stage) return;
      if (event.evt.button === 1 || space.current) { gesture.current = { kind: 'pan', start: { x: event.evt.clientX, y: event.evt.clientY }, camera: { x: stage.x(), y: stage.y() } }; if (space.current) onSpacePan(); event.evt.preventDefault(); return; }
      const point = worldPoint(stage); if (!point) return;
      const handleName = event.target.name();
      const selectedMedia = selected.length === 1 ? document.objects.find(item => item.id === selected[0]) : undefined;
      if (tool === 'select' && selectedMedia?.kind === 'media') {
        const localX = point.x - selectedMedia.x, localY = point.y - selectedMedia.y;
        const width = mediaWidth(selectedMedia);
        // 手柄按语义区域命中，避免 Konva 的缓存命中图在快速重绘后短暂落后于画面。
        if (!trimMode && localX >= width - 40 && localX <= width && localY >= selectedMedia.height + 5 && localY <= selectedMedia.height + 27) {
          gesture.current = { kind: 'scale-time', mediaId: selectedMedia.id, x: selectedMedia.x, inUs: selectedMedia.inUs, outUs: selectedMedia.outUs, node: null };
          event.evt.preventDefault(); return;
        }
        if (trimMode && playback?.mediaId === selectedMedia.id && localY >= 23 && localY <= 73) {
          const side = Math.abs(localX) <= 10 ? 'in' : Math.abs(localX - width) <= 10 ? 'out' : null;
          if (side) {
            gesture.current = { kind: 'trim', mediaId: selectedMedia.id, side, x: selectedMedia.x, inUs: selectedMedia.inUs, outUs: selectedMedia.outUs, pixelsPerSecond: selectedMedia.pixelsPerSecond, durationUs: document.assets.find(item => item.id === selectedMedia.assetId)?.durationUs ?? selectedMedia.outUs, node: null };
            event.evt.preventDefault(); return;
          }
        }
      }
      if (tool === 'select' && event.target.name() === 'playhead-handle') {
        const mediaId = objectIdFromNode(event.target);
        if (mediaId) { const node = event.target.getParent(); node?.draggable(false); gesture.current = { kind: 'scrub', mediaId, lastPreviewAt: 0, node }; event.evt.preventDefault(); return; }
      }
      if (tool === 'brush') { gesture.current = { kind: 'brush', points: [point] }; return; }
      if (tool === 'arrow' || event.target.name() === 'time-handle') {
        const sourceId = objectIdFromNode(event.target);
        const source = document.objects.find(item => item.id === sourceId);
        const timeArea = source?.kind === 'media' && point.y - source.y >= 24 && point.y - source.y <= source.height - 20;
        const isConnector = event.target.name() === 'time-handle';
        // 选择工具从连接柄拉出自动注释；箭头工具在轨道内容区建立普通时间锚点。
        const timeUs = source?.kind === 'media' && (isConnector || tool === 'arrow' && timeArea) ? Math.round(Math.max(source.inUs, Math.min(source.outUs, source.inUs + (point.x - source.x) / source.pixelsPerSecond * 1_000_000))) : null;
        gesture.current = { kind: 'arrow', start: point, sourceId, timeUs, autoAnnotate: isConnector && tool === 'select' }; return;
      }
      if (tool === 'select' && event.target === stage) { gesture.current = { kind: 'marquee', start: point }; onSelect([]); }
    }}
    onMouseMove={event => {
      const active = gesture.current, stage = event.target.getStage(); if (!active || !stage) return;
      if (active.kind === 'pan') {
        stage.position({ x: active.camera.x + event.evt.clientX - active.start.x, y: active.camera.y + event.evt.clientY - active.start.y });
        const canvas = stage.container().closest<HTMLElement>('.canvas');
        if (canvas) canvas.style.backgroundPosition = `${stage.x()}px ${stage.y()}px`;
        stage.batchDraw();
        return;
      }
      const point = worldPoint(stage); if (!point) return;
      if (active.kind === 'scrub') {
        // 拖动时暂停播放，并限制视频解码定位频率；松开后再提交精确位置。
        if (performance.now() - active.lastPreviewAt < 80) return;
        const media = document.objects.find(item => item.id === active.mediaId);
        if (media?.kind === 'media') {
          active.lastPreviewAt = performance.now();
          onPlayback(media.id, Math.round(Math.max(media.inUs, Math.min(media.outUs, media.inUs + (point.x - media.x) / media.pixelsPerSecond * 1_000_000))), false);
        }
        return;
      }
      if (active.kind === 'scale-time') {
        const seconds = (active.outUs - active.inUs) / 1_000_000;
        if (seconds > 0) editor.preview(draft => {
          const media = draft.objects.find(item => item.id === active.mediaId);
          if (media?.kind === 'media') media.pixelsPerSecond = Math.min(120, Math.max(10, Math.round((point.x - active.x) / seconds)));
        });
        return;
      }
      if (active.kind === 'trim') {
        const sourceUs = Math.round(active.inUs + (point.x - active.x) / active.pixelsPerSecond * 1_000_000);
        editor.preview(draft => {
          const media = draft.objects.find(item => item.id === active.mediaId);
          if (media?.kind !== 'media') return;
          if (active.side === 'in') media.inUs = Math.max(0, Math.min(active.outUs - 100_000, sourceUs));
          else media.outUs = Math.max(active.inUs + 100_000, Math.min(active.durationUs, sourceUs));
        });
        return;
      }
      if (active.kind === 'brush') { active.points.push(point); previewLine.current?.points(active.points.flatMap(item => [item.x, item.y])); previewLine.current?.show(); previewLine.current?.getLayer()?.batchDraw(); return; }
      if (active.kind === 'arrow') { previewLine.current?.points([active.start.x, active.start.y, point.x, point.y]); previewLine.current?.show(); previewLine.current?.getLayer()?.batchDraw(); return; }
      previewRect.current?.setAttrs({ x: Math.min(active.start.x, point.x), y: Math.min(active.start.y, point.y), width: Math.abs(point.x - active.start.x), height: Math.abs(point.y - active.start.y), visible: true });
      previewRect.current?.getLayer()?.batchDraw();
    }}
    onMouseUp={event => { const stage = event.target.getStage(); if (stage) finish(stage, event.target); }}
    onWheel={event => {
      event.evt.preventDefault();
      const stage = event.target.getStage();
      const objectId = objectIdFromNode(event.target);
      const object = document.objects.find(item => item.id === objectId);
      if (event.evt.ctrlKey && object?.kind === 'media') {
        // 轨道上 Ctrl + 滚轮只改变时间显示比例，不改变裁剪区间和画布相机。
        editor.execute(draft => {
          const target = draft.objects.find(item => item.id === object.id);
          if (target?.kind === 'media') target.pixelsPerSecond = Math.min(120, Math.max(10, Math.round(target.pixelsPerSecond * (event.evt.deltaY > 0 ? 0.9 : 1.1))));
        });
        return;
      }
      const pointer = stage?.getPointerPosition();
      editor.execute(draft => {
        if (event.evt.ctrlKey && pointer) {
          // 保持指针下的世界坐标不动，避免缩放时画布跳移。
          const worldX = (pointer.x - draft.camera.x) / draft.camera.scale;
          const worldY = (pointer.y - draft.camera.y) / draft.camera.scale;
          const scale = Math.min(4, Math.max(0.2, draft.camera.scale * (event.evt.deltaY > 0 ? 0.9 : 1.1)));
          draft.camera.scale = scale;
          draft.camera.x = pointer.x - worldX * scale;
          draft.camera.y = pointer.y - worldY * scale;
        } else { draft.camera.x -= event.evt.deltaX; draft.camera.y -= event.evt.deltaY; }
      });
    }}
    onDblClick={event => { const id = objectIdFromNode(event.target); const object = document.objects.find(item => item.id === id); if (object?.kind === 'text') setEditing({ id: object.id, text: object.text }); }}>
    <Layer>
      {document.connections.map(connection => { const from = resolveAnchor(document, connection.from), to = resolveAnchor(document, connection.to); if (!from || !to || Math.max(from.x, to.x) < visible.left || Math.min(from.x, to.x) > visible.right || Math.max(from.y, to.y) < visible.top || Math.min(from.y, to.y) > visible.bottom) return null; return <Arrow key={connection.id} points={connection.routing === 'elbow' ? [from.x, from.y, to.x, from.y, to.x, to.y] : [from.x, from.y, to.x, to.y]} stroke={accent} fill={accent} strokeWidth={2} pointerLength={9} pointerWidth={8} />; })}
      {visibleObjects.map(object => { const asset = 'assetId' in object ? document.assets.find(item => item.id === object.assetId) : undefined; return <ObjectView key={object.id} object={object} tool={tool} selected={selected.includes(object.id)} trimMode={trimMode && playback?.mediaId === object.id} assetPath={asset?.path} assetName={asset?.name} assetKind={asset?.kind} assetDurationUs={asset?.durationUs} analysis={analysis[object.id]} markers={document.markers.filter(marker => marker.mediaId === object.id)} playheadUs={playback?.mediaId === object.id ? playback.timeUs : undefined} onSelect={additive => onSelect(additive ? (selected.includes(object.id) ? selected.filter(id => id !== object.id) : [...selected, object.id]) : [object.id])} onSeek={(timeUs, play) => onPlayback(object.id, timeUs, play)} onMarkerMove={(id, timeUs) => editor.moveMarker(id, timeUs)} onMove={(x, y) => { if (selected.includes(object.id) && selected.length > 1) editor.moveObjects(selected, x - object.x, y - object.y); else editor.moveObject(object.id, x, y); }} />; })}
      <Line ref={previewLine} points={[]} stroke={accent} strokeWidth={2} listening={false} visible={false} />
      <Rect ref={previewRect} stroke={accent} dash={[5, 4]} fill="#5268e821" listening={false} visible={false} />
    </Layer>
  </Stage>{editing && editingObject?.kind === 'text' && <><textarea ref={textarea} className="canvas-text-editor" aria-label={t('编辑画布文字', 'Edit canvas text')} value={editing.text} onChange={event => setEditing({ ...editing, text: event.target.value })} onBlur={event => commitText(event.currentTarget.value)} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') setEditing(null); if (event.key === 'Enter' && event.ctrlKey) commitText(event.currentTarget.value); }} style={{ left: editingObject.x * document.camera.scale + document.camera.x, top: editingObject.y * document.camera.scale + document.camera.y, width: editingObject.width * document.camera.scale, minHeight: editingObject.height * document.camera.scale, fontSize: editingObject.fontSize * document.camera.scale, color: editingObject.color, textAlign: editingObject.align }} /><button className="canvas-text-done" aria-label={t('完成文字编辑', 'Finish text editing')} onMouseDown={event => event.preventDefault()} onClick={() => commitText(textarea.current?.value)} style={{ left: (editingObject.x + editingObject.width) * document.camera.scale + document.camera.x + 8, top: editingObject.y * document.camera.scale + document.camera.y }}>{t('完成', 'Done')}</button></>}</>;
}

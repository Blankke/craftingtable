import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Rect, Text, Line, Group, Image as KonvaImage, Circle, Path, RegularPolygon, Shape } from 'react-konva';
import type Konva from 'konva';
import { ObjectAppearance } from './ObjectAppearance';
import { CanvasTextEditor } from './CanvasTextEditor';
import { CanvasObjectMenu, type CanvasMenuTarget } from './CanvasObjectMenu';
import { copyCanvasGraphic } from './canvasExport';
import { ImageStackViewer } from './ImageStackViewer';
import { canvasTextLayout, isTextObject } from './canvasTextLayout';
import type { RichTextDocument } from '../../core/richText';
import { resizeObject, styleOf } from '../../core/appearance';
import { CANVAS_TEXT_WIDTH, emptyCanvasText } from '../../core/canvasText';
import { useInteractionStore } from './interactionStore';
import { Editor } from '../../core/editor';
import { mediaWidth, resolveAnchor, type Anchor, type CanvasObject, type ConnectionStyle, type ProjectDocument } from '../../core/document';
import { noteText, type Note } from '../../core/note';
import { usePlaybackStore } from '../media/playbackStore';
import { trackTicks } from '../../core/ticks';
import { mediaSource } from '../media/mediaSource';
import { useLanguage } from '../shared/language';
import { useTheme } from '../theme/themeStore';
import { colorToHex, colorToRgba } from '../../core/theme';
import { canvasDisplayObject, canvasInk } from '../../core/canvasColors';
import { decodeWaveform, resampleColumns, type WaveformPeaks } from '../../core/waveform';
import type { MediaAnalysis } from '../../core/mediaAnalysis';

export type Tool = 'select' | 'text' | typeof import('../../core/document').shapeKinds[number] | 'arrow' | 'brush';
type Point = { x: number; y: number };
type Gesture =
  | { kind: 'pan'; start: Point; camera: Point }
  | { kind: 'marquee'; start: Point }
  | { kind: 'text'; start: Point }
  | { kind: 'brush'; points: Point[] }
  | { kind: 'scrub'; mediaId: string; lastPreviewAt: number; node: Konva.Node | null }
  | { kind: 'scale-time'; mediaId: string; x: number; inUs: number; outUs: number; node: Konva.Node | null }
  | { kind: 'trim'; mediaId: string; side: 'in' | 'out'; x: number; inUs: number; outUs: number; pixelsPerSecond: number; durationUs: number; node: Konva.Node | null }
  | { kind: 'move'; start: Point; ids: string[] }
  | { kind: 'resize'; start: Point; object: CanvasObject }
  | { kind: 'crop'; start: Point; object: Extract<CanvasObject, { kind: 'image' }>; crop: { x: number; y: number; width: number; height: number }; corner?: 'nw' | 'ne' | 'sw' | 'se' }
  | { kind: 'arrow'; start: Point; sourceId: string | null; markerId: string | null; pointId?: string };

function ImageContent({ path, width, height, x = 0, y = 0, host = 'asset', crop, normalizedCrop = false, tint }: { path: string; width: number; height: number; x?: number; y?: number; host?: 'asset' | 'cache'; normalizedCrop?: boolean; tint?: string; crop?: { x: number; y: number; width: number; height: number } }) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const element = new Image(), controller = new AbortController();
    let objectUrl: string | undefined;
    // 将受限素材协议响应转换为当前页面的 Blob，画布导出时保持同源、避免被标记为污染。
    void fetch(mediaSource(path, host), { signal: controller.signal }).then(response => {
      if (!response.ok) throw Error('素材无法读取');
      return response.blob();
    }).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      element.onload = () => { setImage(element); URL.revokeObjectURL(objectUrl!); objectUrl = undefined; };
      element.src = objectUrl;
    }).catch(() => { if (!controller.signal.aborted) setImage(null); });
    return () => { controller.abort(); element.onload = null; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path, host]);
  const rendered = useMemo(() => {
    if (!image || !tint) return image;
    // 源 PNG 只有波形区域有 alpha，source-in 用当前轨道颜色重绘该区域。
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) return image;
    context.drawImage(image, 0, 0);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = tint;
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  }, [image, tint]);
  return rendered ? <KonvaImage image={rendered} x={x} y={y} width={width} height={height} crop={crop && normalizedCrop ? { x: crop.x * image!.naturalWidth, y: crop.y * image!.naturalHeight, width: crop.width * image!.naturalWidth, height: crop.height * image!.naturalHeight } : crop} /> : <Rect x={x} y={y} width={width} height={height} fill="#f1f5f9" />;
}

// 峰值文件按路径缓存一次解码结果；裁剪、缩放与改色只在内存重采样，不重复请求或分析音频。
const waveformCache = new Map<string, Promise<WaveformPeaks | null>>();
function loadPeaks(path: string): Promise<WaveformPeaks | null> {
  let cached = waveformCache.get(path);
  if (!cached) {
    cached = fetch(mediaSource(path, 'cache'))
      .then(response => response.ok ? response.arrayBuffer() : null)
      .then(buffer => buffer ? decodeWaveform(buffer) : null)
      .catch(() => null);
    waveformCache.set(path, cached);
  }
  return cached;
}

function WaveformView({ path, color, x, y, width, height, inUs, outUs, scale }: {
  path: string; color: string; x: number; y: number; width: number; height: number; inUs: number; outUs: number; scale: number;
}) {
  // 峰值重采样到屏幕像素列，单条 Shape 绘制 1px 垂直峰值线；改裁剪、缩放与颜色都不拉伸图片。
  const [columns, setColumns] = useState<{ min: number; max: number }[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setColumns(null);
    const pixelWidth = Math.max(1, Math.floor(width * scale * window.devicePixelRatio));
    void loadPeaks(path).then(peaks => {
      if (cancelled) return;
      setColumns(peaks ? resampleColumns(peaks, inUs, outUs, pixelWidth) : []);
    });
    return () => { cancelled = true; };
  }, [path, inUs, outUs, width, scale]);
  if (!columns || !columns.length) return null;
  return <Shape x={x} y={y} width={width} height={height} fill="transparent" stroke="transparent" listening={false} sceneFunc={context => {
    const ctx = context._context;
    ctx.strokeStyle = color;
    ctx.lineWidth = width / columns.length;
    ctx.beginPath();
    const center = height / 2;
    const half = height / 2;
    for (let index = 0; index < columns.length; index++) {
      const column = columns[index];
      const top = center - (column.max / 32768) * half;
      const bottom = center - (column.min / 32768) * half;
      ctx.moveTo((index + 0.5) * width / columns.length, top);
      ctx.lineTo((index + 0.5) * width / columns.length, bottom);
    }
    ctx.stroke();
  }} />;
}

function ObjectView({ object: sourceObject, hideText = false, scale, assetPath, assetName, assetKind, assets, analysis, markers, playheadUs, selected, trimMode, tool, note, onSelect, onSeek, onOpenStack }: {
  object: CanvasObject; hideText?: boolean; scale: number; assetPath?: string; assetName?: string; assetKind?: string; analysis?: MediaAnalysis; markers: ProjectDocument['markers']; playheadUs?: number; selected: boolean; tool: Tool;
  trimMode: boolean; note?: Note;
  assets?: ProjectDocument['assets']; onOpenStack?(id: string): void;
  onSelect(additive: boolean): void; onSeek(timeUs: number, play: boolean): void;
}) {
  const { t } = useLanguage();
  const { tokens } = useTheme();
  const object = useMemo(() => canvasDisplayObject(sourceObject, tokens), [sourceObject, tokens]);
  const accent = colorToHex(tokens.primary);
  const fg = colorToHex(tokens.foreground);
  const selectionFill = colorToHex(tokens.selection);
  const borderColor = colorToHex(tokens.border);
  const mutedFg = colorToHex(tokens.mutedForeground);
  const trackColor = object.kind === 'media' && object.color ? colorToHex(object.color) : accent;
  const selectedMarker = useInteractionStore(state => state.selectedMarker);
  const setSelectedMarker = useInteractionStore(state => state.setSelectedMarker);
  const width = object.kind === 'media' ? mediaWidth(object) : object.width;
  const ticks = object.kind === 'media' ? trackTicks(object.inUs, object.outUs, object.pixelsPerSecond) : [];
  const [hoverX, setHoverX] = useState<number | null>(null);
  const seek = (play: boolean, localX: number) => {
    if (object.kind === 'media') onSeek(Math.round(Math.max(object.inUs, Math.min(object.outUs, object.inUs + localX / object.pixelsPerSecond * 1_000_000))), play);
  };
  return <Group name={`object:${object.id}`} x={object.x + width / 2} y={object.y + object.height / 2} offsetX={width / 2} offsetY={object.height / 2} rotation={object.rotation ?? 0} opacity={styleOf(object).opacity}
    onMouseMove={event => { if (object.kind === 'media' && tool === 'select') { const point = event.currentTarget.getRelativePointerPosition(); setHoverX(point && point.y >= 25 ? Math.max(0, Math.min(width, point.x)) : null); } }}
    onMouseLeave={() => setHoverX(null)}
    onClick={event => { if (event.evt.button !== 0 || tool !== 'select' || (event.target.name().endsWith('-handle') && event.target.name() !== 'media-drag-handle')) return; onSelect(event.evt.ctrlKey || event.evt.shiftKey); seek(false, event.currentTarget.getRelativePointerPosition()?.x ?? 0); }}
    onDblClick={event => { if (tool === 'select') seek(true, event.currentTarget.getRelativePointerPosition()?.x ?? 0); }}
    onTap={() => { if (tool === 'select') onSelect(false); }}>
    {object.kind !== 'media' && object.kind !== 'image' && object.kind !== 'imageStack' && object.kind !== 'note' && <ObjectAppearance object={object} hideText={hideText} scale={scale} />}
    {object.kind === 'imageStack' && <>
      {/* 后两张使用真实图片，轻微错位表达收起状态；封面与计数共用整组命中区域。 */}
      {object.images.slice(0, 3).map((image, index) => ({ image, index })).reverse().map(({ image, index }) => {
        const asset = assets?.find(item => item.id === image.assetId);
        return <Group key={image.id} x={index * 7} y={-index * 7} rotation={index * 2}>
          <Rect width={width} height={object.height} fill={colorToHex(tokens.card)} stroke={borderColor} cornerRadius={5} shadowColor="#0003" shadowBlur={index ? 5 : 9} />
          {asset && <ImageContent path={asset.path} width={width} height={object.height} crop={image.crop} normalizedCrop />}
          <Rect width={width} height={object.height} stroke={styleOf(object).strokeEnabled ? sourceObject.style ? styleOf(object).stroke : borderColor : undefined} strokeWidth={styleOf(object).strokeWidth} cornerRadius={5} />
        </Group>;
      })}
      <Group name="image-stack-open" x={Math.max(4, width - 100)} y={Math.max(4, object.height - 32)} onClick={event => { event.cancelBubble = true; if (event.evt.button === 0) { onSelect(false); onOpenStack?.(object.id); } }}>
        <Rect name="image-stack-open" width={94} height={26} cornerRadius={13} fill={colorToHex(tokens.card)} opacity={.94} stroke={borderColor}/>
        <Text name="image-stack-open" width={94} height={26} align="center" verticalAlign="middle" text={`${object.images.length} ${t('张 · 查看', 'images · Open')}`} fill={fg} fontSize={12}/>
      </Group>
    </>}
    {object.kind === 'note' && note ? <>
      <Rect width={width} height={object.height} fill={colorToHex(tokens.card)} stroke={accent} strokeWidth={1} cornerRadius={6} shadowColor="#00000026" shadowBlur={6} shadowOffsetY={2} />
      <Text x={12} y={10} width={Math.max(20, width - 24)} ellipsis text={note.name || t('未命名笔记', 'Untitled note')} fontSize={14} fontStyle="bold" fill={fg} />
      <Text x={12} y={32} width={Math.max(20, width - 24)} height={Math.max(8, object.height - 52)} text={note ? noteText(note).slice(0, 80) : ''} fontSize={12} fill={mutedFg} />
      <Text x={12} y={object.height - 20} text={t('双击打开笔记', 'Double-click to open')} fontSize={10} fill={accent} listening={false} />
    </> : null}
    {object.kind === 'media' ? <>
      <Rect width={width} height={object.height} fill={selected ? selectionFill : colorToRgba(trackColor, 0.14)} stroke={styleOf(object).strokeEnabled ? trackColor : undefined} strokeWidth={styleOf(object).strokeWidth} dash={styleOf(object).dash === 'solid' ? [] : [6, 4]} cornerRadius={8}/>
      {assetKind === 'audio' && analysis?.waveform && <WaveformView scale={scale} path={analysis.waveform.path} color={trackColor} x={8} y={27} width={Math.max(1, width - 16)} height={42} inUs={object.inUs} outUs={object.outUs} />}
      {assetKind === 'video' && <Group clipX={0} clipY={24} clipWidth={width} clipHeight={50}>{analysis?.frames?.map(frame => <ImageContent key={frame.path} host="cache" path={frame.path} x={(frame.timeUs - object.inUs) / 1_000_000 * object.pixelsPerSecond} y={24} width={Math.min(120, width / Math.max(1, analysis.frames!.length))} height={50} />)}</Group>}
      <Text x={12} y={8} width={Math.max(80, width - 20)} ellipsis text={analysis?.error ? t('处理失败，见右侧任务', 'Processing failed; see tasks') : `${assetKind === 'audio' ? '♪' : '▶'} ${assetName ?? t('缺失素材', 'Missing asset')}${analysis?.processing ? ` · ${t('处理中', 'Processing')} ${analysis.progress ?? 0}%` : ''}`} fontSize={13} fill={fg} />
      {markers.filter(marker => marker.timeUs >= object.inUs && marker.timeUs <= object.outUs).map(marker => { const x = (marker.timeUs - object.inUs) / 1_000_000 * object.pixelsPerSecond; return <Group key={marker.id} name={`marker:${marker.id}`} x={x}
        onClick={event => { event.cancelBubble = true; if (selected && event.evt.button === 0) { setSelectedMarker(marker.id); onSeek(marker.timeUs, false); } }}
        onDblClick={event => { event.cancelBubble = true; if (selected) onSeek(marker.timeUs, true); }}>
        <Line points={[0, 24, 0, object.height - 20]} stroke="#e08a27" strokeWidth={selectedMarker === marker.id && selected ? 4 : 2}/><Circle y={24} radius={selectedMarker === marker.id && selected ? 9 : 7} fill={selectedMarker === marker.id && selected ? accent : '#e08a27'} stroke="#fff" strokeWidth={selectedMarker === marker.id && selected ? 3 : 2}/>
        {selected && selectedMarker === marker.id && <><Circle name={`note:${marker.id}`} y={-16} radius={8} fill={accent}/><Text x={12} y={-22} text="拖出笔记" fontSize={11} fill={accent} listening={false}/></>}
      </Group>; })}
      {!(selected && selectedMarker) && playheadUs !== undefined && playheadUs >= object.inUs && playheadUs <= object.outUs && <>
        <Line points={[(playheadUs - object.inUs) / 1_000_000 * object.pixelsPerSecond, 0, (playheadUs - object.inUs) / 1_000_000 * object.pixelsPerSecond, object.height]} stroke="#e44352" strokeWidth={2} listening={false} />
        <Circle name="playhead-handle" x={(playheadUs - object.inUs) / 1_000_000 * object.pixelsPerSecond} y={35} radius={9} fill="#e44352" stroke="#fff" strokeWidth={2} />
      </>}
      {hoverX !== null && selected && tool === 'select' && <><Line points={[hoverX, 35, hoverX, object.height - 20]} stroke={accent} dash={[3, 3]} listening={false} /><Circle listening={false} x={hoverX} y={35} radius={7} fill={accent} stroke="#fff" strokeWidth={2} /><Text x={Math.min(hoverX + 9, width - 48)} y={38} text={`${(object.inUs / 1e6 + hoverX / object.pixelsPerSecond).toFixed(1)}s`} fontSize={10} fill={accent} listening={false} /></>}
      <Line points={[12, object.height - 20, width - 12, object.height - 20]} stroke={borderColor}/>
      {ticks.length ? ticks.map(tick => <Group key={tick.timeUs} x={tick.x} listening={false}>
        <Line points={[0, object.height - 20, 0, object.height - 13]} stroke={mutedFg} strokeWidth={1} />
        <Text x={Math.max(2 - tick.x, Math.min(2, width - tick.x - 44))} y={object.height - 12} text={tick.label} fontSize={10} fill={mutedFg} />
      </Group>) : <Text x={12} y={object.height - 17} text={`${(object.inUs / 1e6).toFixed(1)}s — ${(object.outUs / 1e6).toFixed(1)}s`} fontSize={11} fill={mutedFg} listening={false} />}
      {markers.some(marker => marker.timeUs < object.inUs || marker.timeUs > object.outUs) && <Text x={Math.max(10, width - 105)} y={8} text={`${t('区间外', 'Outside range')} ${markers.filter(marker => marker.timeUs < object.inUs || marker.timeUs > object.outUs).length} ${t('个标记', 'markers')}`} fontSize={11} fill="#a65c15" />}
      {tool === 'arrow' && <Circle x={width / 2} y={0} radius={6} fill={accent} />}
      {selected && tool === 'select' && (trimMode ? <>
        <Rect name="trim-in-handle" x={-6} y={23} width={12} height={50} fill="#e08a27" cornerRadius={4} />
        <Rect name="trim-out-handle" x={width - 6} y={23} width={12} height={50} fill="#e08a27" cornerRadius={4} />
      </> : <>
        <Text name="editor-decoration" x={Math.max(0, width - 105)} y={object.height + 9} text={t('显示长度', 'Display length')} fontSize={11} fill={accent} listening={false} />
        <Rect name="scale-time-handle" x={width - 40} y={object.height + 5} width={40} height={22} fill={accent} opacity={0.58} cornerRadius={5} />
      </>)}
      {tool === 'select' && <Rect name="media-drag-handle" x={0} y={0} width={width} height={23} fill="#fff" opacity={0.001} />}
    </> : null}
    {object.kind === 'image' ? <>{assetPath ? <ImageContent path={assetPath} width={width} height={object.height} crop={object.crop} normalizedCrop /> : <Rect width={width} height={object.height} fill="#f1f5f9" />}<Rect width={width} height={object.height} stroke={styleOf(object).strokeEnabled ? styleOf(object).stroke : undefined} strokeWidth={styleOf(object).strokeWidth} dash={styleOf(object).dash === 'solid' ? [] : [6, 4]}/>{selected && !object.locked && tool === 'select' && object.crop && (() => { const crop = object.crop; const left = crop.x * width, top = crop.y * object.height, right = left + crop.width * width, bottom = top + crop.height * object.height; return <><Rect name="crop-move-handle" x={left} y={top} width={crop.width * width} height={crop.height * object.height} stroke="#e08a27" dash={[5, 3]} strokeWidth={2} fill="rgba(224,138,39,.08)" /><Text name="editor-decoration" x={4} y={4} text={t('拖动裁剪框或边角调整', 'Drag crop or corners')} fontSize={10} fill="#a65c15" listening={false} />{([['nw', left, top], ['ne', right, top], ['sw', left, bottom], ['se', right, bottom]] as const).map(([corner, x, y]) => <Rect key={corner} name={`crop-resize-${corner}`} x={x - 6} y={y - 6} width={12} height={12} fill="#e08a27" cornerRadius={2} hitStrokeWidth={14} />)}</>; })()}</> : null}
    {(selected || tool === 'arrow') && object.connectionPoints?.map(point => <Circle key={point.id} name={`connection-point:${point.id} editor-decoration`} x={point.x * width} y={point.y * object.height} radius={4 / scale} fill={accent} stroke={colorToHex(tokens.card)} strokeWidth={1 / scale} hitStrokeWidth={10 / scale}/>) }
  </Group>;
}

/** 选区独立于素材透明度及叠放顺序，轮廓和手柄始终保持固定屏幕尺寸。 */
function SelectionOutline({ object, scale, accent, surface, resizable }: { object: CanvasObject; scale: number; accent: string; surface: string; resizable: boolean }) {
  const width = object.kind === 'media' ? mediaWidth(object) : object.width, height = object.height;
  const handle = Math.min(12 / scale, width / 2, height / 2);
  return <Group name={`object:${object.id} editor-decoration`} x={object.x + width / 2} y={object.y + height / 2} offsetX={width / 2} offsetY={height / 2} rotation={object.rotation ?? 0}>
    <Rect width={width} height={height} stroke={surface} strokeWidth={4 / scale} listening={false} />
    <Rect width={width} height={height} stroke={accent} strokeWidth={2 / scale} listening={false} />
    {([[0, 0], [width, 0], [0, height]] as const).map(([x, y], index) => <Rect key={index} x={x - 2.5 / scale} y={y - 2.5 / scale} width={5 / scale} height={5 / scale} fill={surface} stroke={accent} strokeWidth={1.5 / scale} listening={false} />)}
    {resizable && !object.locked && object.kind !== 'media' && <Line name="resize-handle editor-decoration" points={[width - handle, height, width, height, width, height - handle]} stroke={accent} strokeWidth={3 / scale} hitStrokeWidth={16 / scale} lineCap="round" lineJoin="round" />}
  </Group>;
}

function objectIdFromNode(node: Konva.Node): string | null {
  let current: Konva.Node | null = node;
  while (current) {
    const name = current.name();
    if (name.startsWith('object:')) return name.split(' ')[0].slice(7);
    current = current.getParent();
  }
  return null;
}

function connectionIdFromNode(node: Konva.Node): string | null {
  let current: Konva.Node | null = node;
  while (current) {
    const name = current.name();
    if (name.startsWith('connection:')) return name.slice(11);
    current = current.getParent();
  }
  return null;
}

function worldPoint(stage: Konva.Stage): Point | null {
  const point = stage.getPointerPosition();
  return point ? { x: (point.x - stage.x()) / stage.scaleX(), y: (point.y - stage.y()) / stage.scaleY() } : null;
}

const dashPattern = (dash: ConnectionStyle['dash']): number[] => dash === 'dashed' ? [8, 5] : dash === 'dotted' ? [2, 4] : dash === 'dash-dot' ? [10, 4, 2, 4] : [];

function ConnectionHead({ x, y, angleDeg, head, color, strokeWidth, headSize }: { x: number; y: number; angleDeg: number; head: ConnectionStyle['endHead']; color: string; strokeWidth: number; headSize?: number }) {
  if (head === 'none' || !head) return null;
  const size = headSize ?? Math.max(9, strokeWidth * 2.4 + 6);
  const rad = (angleDeg * Math.PI) / 180;
  const dir = { x: Math.cos(rad), y: Math.sin(rad) };
  const perp = { x: -dir.y, y: dir.x };
  const base = { x: x - dir.x * size, y: y - dir.y * size };
  const half = size * 0.55;
  const l = { x: base.x + perp.x * half, y: base.y + perp.y * half };
  const r = { x: base.x - perp.x * half, y: base.y - perp.y * half };
  if (head === 'arrow' || head === 'block') {
    const w = head === 'block' ? half * 1.6 : half;
    const lp = { x: base.x + perp.x * w, y: base.y + perp.y * w };
    const rp = { x: base.x - perp.x * w, y: base.y - perp.y * w };
    return <Line points={[x, y, lp.x, lp.y, rp.x, rp.y]} closed fill={color} stroke={color} strokeWidth={1} strokeLinejoin="round" />;
  }
  if (head === 'open') return <Path data={`M ${l.x} ${l.y} L ${x} ${y} L ${r.x} ${r.y}`} stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />;
  if (head === 'diamond') return <RegularPolygon x={base.x} y={base.y} sides={4} radius={size * 0.62} rotation={angleDeg + 45} fill={color} stroke={color} strokeWidth={1} />;
  if (head === 'circle') return <Circle x={base.x} y={base.y} radius={size * 0.45} fill={color} />;
  if (head === 'square') return <Rect x={base.x - size * 0.45} y={base.y - size * 0.45} width={size * 0.9} height={size * 0.9} rotation={angleDeg} fill={color} />;
  return null;
}

function ConnectionView({ connection, document, accent, selected }: {
  connection: ProjectDocument['connections'][number]; document: ProjectDocument; accent: string; selected: boolean;
}) {
  const { tokens } = useTheme();
  const start = resolveAnchor(document, connection.from), end = resolveAnchor(document, connection.to);
  const from = resolveAnchor(document, connection.from, end ?? undefined), to = resolveAnchor(document, connection.to, start ?? undefined);
  if (!from || !to) return null;
  const points = connection.routing === 'elbow' ? [from.x, from.y, to.x, from.y, to.x, to.y]
    : connection.routing === 'curve' ? [from.x, from.y, from.x + (to.x - from.x) * .45, from.y, to.x - (to.x - from.x) * .45, to.y, to.x, to.y]
    : [from.x, from.y, to.x, to.y];
  const style = connection.style ?? {};
  const color = canvasInk(style.color ?? accent, [colorToHex(tokens.background)]);
  const strokeWidth = style.strokeWidth ?? 2;
  const dash = style.dash === 'custom' ? style.customDash ?? [8, 5] : dashPattern(style.dash ?? 'dashed');
  const lastX = points[points.length - 2], lastY = points[points.length - 1];
  const prevX = points[points.length - 4] ?? points[0], prevY = points[points.length - 3] ?? points[1];
  const endAngle = (Math.atan2(lastY - prevY, lastX - prevX) * 180) / Math.PI;
  const startAngle = (Math.atan2(points[1] - points[3], points[0] - points[2]) * 180) / Math.PI;
  const pathProps = { bezier: connection.routing === 'curve', tension: connection.routing === 'elbow' && style.rounded ? 0.14 : 0 };
  return <Group name={`connection:${connection.id}`} opacity={style.opacity ?? 1}>
    {selected && <>
      <Line points={points} stroke={colorToHex(tokens.card)} strokeWidth={strokeWidth + 6 / document.camera.scale} listening={false} {...pathProps} />
      <Line points={points} stroke={accent} strokeWidth={strokeWidth + 4 / document.camera.scale} listening={false} {...pathProps} />
    </>}
    <Line points={points} stroke={color} strokeWidth={strokeWidth} dash={dash} hitStrokeWidth={14} {...pathProps} />
    <ConnectionHead x={lastX} y={lastY} angleDeg={endAngle} head={style.endHead ?? 'arrow'} color={color} strokeWidth={strokeWidth} headSize={style.headSize} />
    <ConnectionHead x={points[0]} y={points[1]} angleDeg={startAngle} head={style.startHead ?? 'none'} color={color} strokeWidth={strokeWidth} headSize={style.headSize} />
    {style.label && <Text x={(from.x + to.x) / 2 - 60} y={(from.y + to.y) / 2 - 10} width={120} align="center" text={style.label} fontSize={14} fill={color} />}
  </Group>;
}

export function CanvasStage({ editor, document, viewport, tool, arrowRouting, selected, trimMode, analysis, placementGhost, onSelect, onTool, onSpacePan, onOpenNote, onOpenInspector }: {
  editor: Editor; document: ProjectDocument; viewport: { width: number; height: number }; tool: Tool; selected: string[];
  arrowRouting: 'straight' | 'elbow';
  trimMode: boolean;
  analysis: Record<string, MediaAnalysis>;
  placementGhost?: CanvasObject | null;
  onSelect(ids: string[]): void; onTool(tool: Tool): void; onSpacePan(): void; onOpenNote(noteId: string): void; onOpenInspector(tab?: string): void;
}) {
  const { t } = useLanguage();
  const { tokens } = useTheme();
  const accent = colorToHex(tokens.primary);
  const fg = colorToHex(tokens.foreground);
  const playback = usePlaybackStore(state => state.playback);
  const setPlayback = usePlaybackStore(state => state.setPlayback);
  const selectedConnections = useInteractionStore(state => state.selectedConnections);
  const setSelectedConnections = useInteractionStore(state => state.setSelectedConnections);
  const finishTool = useInteractionStore(state => state.finishTool);
  const onPlayback = (mediaId: string, timeUs: number, play: boolean) => setPlayback({ mediaId, timeUs, play });
  const gesture = useRef<Gesture | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const ghostRef = useRef<CanvasObject[]>([]);
  const [ghosts, setGhosts] = useState<CanvasObject[]>([]);
  const setGhost = (objects: CanvasObject[]) => { ghostRef.current = objects; setGhosts(objects); };
  // 从媒体标记拖出文本批注时的虚影：随指针显示 220×72 文本框，悬停文本对象时给出目标命中反馈。
  const [markerGhost, setMarkerGhost] = useState<{ x: number; y: number; targetId: string | null } | null>(null);
  const cancel = () => {
    gesture.current = null; setGhost([]); setMarkerGhost(null); editor.cancelPreview();
    previewLine.current?.hide(); previewRect.current?.hide();
    stageRef.current?.position(editor.document.camera);
    const canvas = stageRef.current?.container().closest<HTMLElement>('.canvas');
    if (canvas) canvas.style.backgroundPosition = `${editor.document.camera.x}px ${editor.document.camera.y}px`;
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    const mouse = (event: MouseEvent) => { if (event.button === 2 && gesture.current) { event.preventDefault(); cancel(); } };
    const outside = (event: MouseEvent) => { if (gesture.current && !stageRef.current?.container().contains(event.target as Node)) cancel(); };
    addEventListener('keydown', key); addEventListener('mousedown', mouse); addEventListener('mouseup', outside); addEventListener('blur', cancel);
    return () => { removeEventListener('keydown', key); removeEventListener('mousedown', mouse); removeEventListener('mouseup', outside); removeEventListener('blur', cancel); };
  }, [editor]);
  const previewLine = useRef<Konva.Line | null>(null);
  const previewRect = useRef<Konva.Rect | null>(null);
  const space = useRef(false);
  const [editing, setEditing] = useState<{ id: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<CanvasMenuTarget | null>(null);
  const [viewingStack, setViewingStack] = useState<string | null>(null);
  useEffect(() => {
    const element = stageRef.current?.container(); if (!element) return;
    element.tabIndex = 0;
    const menuKey = (event: KeyboardEvent) => {
      if (tool !== 'select' || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
      event.preventDefault(); event.stopPropagation();
      const box = element.getBoundingClientRect(), object = editor.document.objects.find(object => selected.includes(object.id)), camera = editor.document.camera;
      setContextMenu({ x: box.left + (object ? camera.x + object.x * camera.scale : 30), y: box.top + (object ? camera.y + (object.y + object.height) * camera.scale : 30), ids: selected, connections: selectedConnections });
    };
    element.addEventListener('keydown', menuKey); return () => element.removeEventListener('keydown', menuKey);
  }, [editor, selected, selectedConnections, tool]);
  const commitText = (text: RichTextDocument, height: number) => {
    if (!editing) return;
    editor.execute(draft => {
      const target = draft.objects.find(item => item.id === editing.id);
      if (target && isTextObject(target)) { target.text = text; if (target.kind === 'text') target.height = height; }
    });
    setEditing(null);
  };
  useEffect(() => {
    const down = (event: KeyboardEvent) => { if (event.code === 'Space' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable))) space.current = true; };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') space.current = false; };
    addEventListener('keydown', down); addEventListener('keyup', up);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); };
  }, []);
  const finish = (stage: Konva.Stage, target: Konva.Node) => {
    const active = gesture.current; gesture.current = null;
    previewLine.current?.hide(); previewRect.current?.hide();
    if (!active) return;
    setMarkerGhost(null);
    const end = worldPoint(stage);
    if (!end) return;
    if (active.kind === 'move' || active.kind === 'resize') {
      const preview = ghostRef.current; setGhost([]);
      if (preview.length) editor.execute(draft => { for (const ghost of preview) { const index = draft.objects.findIndex(item => item.id === ghost.id); if (index >= 0) draft.objects[index] = { ...ghost, x: Math.round(ghost.x), y: Math.round(ghost.y) } as typeof draft.objects[number]; } });
      return;
    }
    if (active.kind === 'scale-time' || active.kind === 'trim' || active.kind === 'crop') { editor.commitPreview(); return; }
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
    if (active.kind === 'text') {
      const dragged = Math.hypot(end.x - active.start.x, end.y - active.start.y) * document.camera.scale > 6;
      const object: CanvasObject = { id: crypto.randomUUID(), kind: 'text', x: dragged ? Math.min(active.start.x, end.x) : end.x, y: dragged ? Math.min(active.start.y, end.y) : end.y,
        width: dragged ? Math.max(80, Math.abs(end.x - active.start.x)) : CANVAS_TEXT_WIDTH, height: dragged ? Math.max(42, Math.abs(end.y - active.start.y)) : 42,
        groupId: null, text: emptyCanvasText(), fontSize: 18, color: fg, align: 'left' };
      editor.addObject(object); onSelect([object.id]); finishTool(); setEditing({ id: object.id });
      return;
    }
    if (active.kind === 'brush') {
      if (active.points.length < 2) return;
      const xs = active.points.map(point => point.x), ys = active.points.map(point => point.y);
      editor.addObject({ id: crypto.randomUUID(), kind: 'stroke', x: Math.min(...xs), y: Math.min(...ys), width: Math.max(1, Math.max(...xs) - Math.min(...xs)), height: Math.max(1, Math.max(...ys) - Math.min(...ys)), groupId: null, points: active.points, color: fg, strokeWidth: 3 });
      finishTool();
      return;
    }
    const targetId = objectIdFromNode(target);
    if (Math.hypot(end.x - active.start.x, end.y - active.start.y) < 8) return;
    if (active.markerId) {
      const targetObject = document.objects.find(item => item.id === targetId);
      const textId = editor.annotateMarker(active.markerId, targetObject?.kind === 'text' ? targetObject.id : end);
      if (textId) { onSelect([textId]); setEditing({ id: textId }); }
    } else editor.execute(draft => {
      const from: Anchor = active.sourceId ? { kind: 'object', objectId: active.sourceId, ...(active.pointId ? { pointId: active.pointId } : {}) } : { kind: 'free', point: active.start };
      const targetPoint = target.name().split(' ')[0].startsWith('connection-point:') ? target.name().split(' ')[0].slice(17) : undefined;
      const to: Anchor = targetId && targetId !== active.sourceId ? { kind: 'object', objectId: targetId, ...(targetPoint ? { pointId: targetPoint } : {}) } : { kind: 'free', point: end };
      draft.connections.push({ id: crypto.randomUUID(), from, to, routing: arrowRouting });
    });
    finishTool();
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
  const visibleObjects = document.objects.filter(object => {
    if (selected.includes(object.id)) return true;
    const layout = isTextObject(object) ? canvasTextLayout(object) : null;
    const top = object.y + Math.min(0, layout?.y ?? 0), bottom = object.y + Math.max(object.height, (layout?.y ?? 0) + (layout?.height ?? 0));
    return object.x < visible.right && object.x + (object.kind === 'media' ? mediaWidth(object) : object.width) > visible.left && top < visible.bottom && bottom > visible.top;
  });
  const stack = document.objects.find(object => object.id === viewingStack);
  const focusCanvas = () => { const element = stageRef.current?.container(); if (element) { element.tabIndex = -1; element.focus({ preventScroll: true }); } };
  return <><Stage ref={stageRef} onContextMenu={event => {
    event.evt.preventDefault();
    const id = objectIdFromNode(event.target);
    const connection = connectionIdFromNode(event.target);
    const ids = id ? [...editor.expandObjectIds(selected.includes(id) ? selected : [id])] : [];
    const connections = connection ? selectedConnections.includes(connection) ? selectedConnections : [connection] : [];
    cancel();
    if (tool === 'select') { if (connections.length) setSelectedConnections(connections); else onSelect(ids); focusCanvas(); setContextMenu({ x: event.evt.clientX, y: event.evt.clientY, ids, connections }); }
  }} width={viewport.width} height={viewport.height} x={document.camera.x} y={document.camera.y} scaleX={document.camera.scale} scaleY={document.camera.scale}
    onMouseDown={event => {
      const stage = event.target.getStage(); if (!stage) return;
      if (event.evt.button === 0) focusCanvas();
      const hit = document.objects.find(object => object.id === objectIdFromNode(event.target));
      if (hit?.locked && event.evt.button === 0 && !space.current) { onSelect([...editor.expandObjectIds([hit.id])]); return; }
      if (event.evt.button === 2) { event.evt.preventDefault(); cancel(); return; }
      if (event.evt.button === 1 || space.current) { gesture.current = { kind: 'pan', start: { x: event.evt.clientX, y: event.evt.clientY }, camera: { x: stage.x(), y: stage.y() } }; if (space.current) onSpacePan(); event.evt.preventDefault(); return; }
      const point = worldPoint(stage); if (!point) return;
      if (tool === 'text') { gesture.current = { kind: 'text', start: point }; return; }
      if (tool === 'select' && event.evt.button === 0) {
        const connectionId = connectionIdFromNode(event.target);
        if (connectionId) {
          event.evt.preventDefault();
          const additive = event.evt.ctrlKey || event.evt.shiftKey;
          setSelectedConnections(additive ? selectedConnections.includes(connectionId) ? selectedConnections.filter(id => id !== connectionId) : [...selectedConnections, connectionId] : [connectionId]);
          return;
        }
      }
      const handleName = event.target.name().split(' ')[0];
      if (handleName === 'image-stack-open') return;
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
      const sourceId = objectIdFromNode(event.target);
      const source = document.objects.find(item => item.id === sourceId);
      if (source && handleName.startsWith('connection-point:')) { gesture.current = { kind: 'arrow', start: point, sourceId, markerId: null, pointId: handleName.slice(17) }; return; }
      const noteId = handleName.startsWith('note:') ? handleName.slice(5) : null;
      if (noteId && selected.includes(sourceId!) && useInteractionStore.getState().selectedMarker === noteId) {
        gesture.current = { kind: 'arrow', start: point, sourceId, markerId: noteId }; return;
      }
      if (tool === 'arrow') {
        if (source?.kind === 'media' && !selected.includes(source.id)) return;
        gesture.current = { kind: 'arrow', start: point, sourceId, markerId: null }; return;
      }
      if (tool === 'select' && source) {
        if (document.objects.some(object => editor.expandObjectIds(selected.includes(source.id) ? selected : [source.id]).has(object.id) && object.locked)) return;
        if (handleName.startsWith('marker:') || event.target.getParent()?.name().startsWith('marker:')) return;
        if ((handleName === 'crop-move-handle' || handleName.startsWith('crop-resize-')) && source.kind === 'image') { const corner = handleName.replace('crop-resize-', ''); gesture.current = { kind: 'crop', start: point, object: source, crop: source.crop ?? { x: 0, y: 0, width: 1, height: 1 }, ...(corner === handleName ? {} : { corner: corner as 'nw' | 'ne' | 'sw' | 'se' }) }; return; }
        if (handleName === 'resize-handle') { gesture.current = { kind: 'resize', start: point, object: source }; return; }
        if (source.kind === 'media' && handleName !== 'media-drag-handle') return;
        const ids = [...editor.expandObjectIds(selected.includes(source.id) ? selected : [source.id])];
        gesture.current = { kind: 'move', start: point, ids }; return;
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
      if (active.kind === 'move') {
        const dx = point.x - active.start.x, dy = point.y - active.start.y;
        if (Math.hypot(dx, dy) < 3 && !ghostRef.current.length) return;
        setGhost(document.objects.filter(item => active.ids.includes(item.id)).map(item => ({ ...item, x: item.x + dx, y: item.y + dy, ...(item.kind === 'stroke' ? { points: item.points.map(p => ({ x: p.x + dx, y: p.y + dy })) } : {}) })));
        return;
      }
      if (active.kind === 'resize') {
        const copy = structuredClone(active.object);
        resizeObject(copy, active.object.width + point.x - active.start.x, active.object.height + point.y - active.start.y);
        setGhost([copy]); return;
      }
      if (active.kind === 'crop') {
        const dx = (point.x - active.start.x) / active.object.width, dy = (point.y - active.start.y) / active.object.height;
        editor.preview(draft => {
          const image = draft.objects.find(item => item.id === active.object.id);
          if (image?.kind !== 'image') return;
          if (!active.corner) {
            image.crop = { ...active.crop, x: Math.max(0, Math.min(1 - active.crop.width, active.crop.x + dx)), y: Math.max(0, Math.min(1 - active.crop.height, active.crop.y + dy)) };
            return;
          }
          // 裁剪框四角直接修改同一组归一化数据，右侧数值字段会随预览同步刷新。
          const min = .03;
          let left = active.crop.x, top = active.crop.y, right = left + active.crop.width, bottom = top + active.crop.height;
          if (active.corner.includes('w')) left = Math.max(0, Math.min(right - min, left + dx));
          if (active.corner.includes('e')) right = Math.min(1, Math.max(left + min, right + dx));
          if (active.corner.includes('n')) top = Math.max(0, Math.min(bottom - min, top + dy));
          if (active.corner.includes('s')) bottom = Math.min(1, Math.max(top + min, bottom + dy));
          image.crop = { x: left, y: top, width: right - left, height: bottom - top };
        });
        return;
      }
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
      if (active.kind === 'arrow') {
        previewLine.current?.points([active.start.x, active.start.y, point.x, point.y]);
        previewLine.current?.show();
        previewLine.current?.getLayer()?.batchDraw();
        // 从标记拖出批注时，跟随指针显示 220×72 文本框虚影；悬停已有文本对象给出命中反馈。
        if (active.markerId) {
          const hit = document.objects.find(item => item.kind === 'text' && point.x >= item.x && point.x <= item.x + item.width && point.y >= item.y && point.y <= item.y + item.height);
          setMarkerGhost({ x: point.x, y: point.y, targetId: hit?.id ?? null });
        }
        return;
      }
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
    onDblClick={event => {
      if (tool !== 'select' || event.evt.button !== 0 || space.current) return;
      const id = objectIdFromNode(event.target);
      const object = document.objects.find(item => item.id === id);
      if (!object) return;
      if (object.kind === 'note') { onOpenNote(object.noteId); return; }
      if (object.kind === 'imageStack') { onSelect([object.id]); setViewingStack(object.id); return; }
      if (object.locked) return;
      onSelect([object.id]);
      onOpenInspector();
      // 展开属性面板时同时恢复原位文字输入；未设置 text 的空形状也应可编辑。
      if (isTextObject(object)) setEditing({ id: object.id });
    }}>
    <Layer>
      {visibleObjects.map(object => { const asset = 'assetId' in object ? document.assets.find(item => item.id === object.assetId) : undefined; const note = object.kind === 'note' ? document.notes.find(item => item.id === object.noteId) : undefined; return <ObjectView assets={document.assets} onOpenStack={setViewingStack} scale={document.camera.scale} key={object.id} object={object} tool={tool} selected={selected.includes(object.id) && editing?.id !== object.id} hideText={editing?.id === object.id} trimMode={trimMode && playback?.mediaId === object.id} assetPath={asset?.path} assetName={asset?.name} assetKind={asset?.kind} analysis={analysis[object.id]} markers={document.markers.filter(marker => marker.mediaId === object.id)} playheadUs={playback?.mediaId === object.id ? playback.timeUs : undefined} note={note} onSelect={additive => onSelect(additive ? (selected.includes(object.id) ? selected.filter(id => id !== object.id) : [...selected, object.id]) : [object.id])} onSeek={(timeUs, play) => onPlayback(object.id, timeUs, play)} />; })}
    </Layer>
    <Layer listening={false}>
      {placementGhost && (() => {
        const asset = 'assetId' in placementGhost ? document.assets.find(item => item.id === placementGhost.assetId) : undefined;
        const note = placementGhost.kind === 'note' ? document.notes.find(item => item.id === placementGhost.noteId) : undefined;
        // 新对象的虚影使用实际画布渲染器、相机缩放和落点，松手后几何保持一致。
        return <ObjectView assets={document.assets} onOpenStack={setViewingStack} scale={document.camera.scale} object={{ ...placementGhost, style: { ...styleOf(placementGhost), opacity: .45 } }} tool="select" selected={false} trimMode={false} assetPath={asset?.path} assetName={asset?.name} assetKind={asset?.kind} markers={[]} note={note} onSelect={() => undefined} onSeek={() => undefined} />;
      })()}
      {/* 虚影独立于原对象绘制，拖动期间不会改变项目文档。 */}
      {ghosts.map(ghost => { const asset = 'assetId' in ghost ? document.assets.find(item => item.id === ghost.assetId) : undefined; const note = ghost.kind === 'note' ? document.notes.find(item => item.id === ghost.noteId) : undefined; return <ObjectView assets={document.assets} onOpenStack={setViewingStack} scale={document.camera.scale} key={`ghost-${ghost.id}`} object={{ ...ghost, style: { ...styleOf(ghost), opacity: 0.4 } }} tool={tool} selected={false} trimMode={false} assetPath={asset?.path} assetName={asset?.name} assetKind={asset?.kind} analysis={analysis[ghost.id]} markers={[]} note={note} onSelect={() => undefined} onSeek={() => undefined} />; })}
      {markerGhost && !markerGhost.targetId && <Group x={markerGhost.x} y={markerGhost.y} opacity={0.5} listening={false}>
        <Rect width={220} height={72} fill={colorToHex(tokens.card)} stroke={accent} strokeWidth={1} dash={[5, 3]} cornerRadius={6} />
        <Text x={12} y={27} width={196} text={t('拖出笔记', 'Drag to annotate')} fontSize={16} fill={accent} listening={false} />
      </Group>}
      {markerGhost?.targetId && (() => { const target = document.objects.find(item => item.id === markerGhost.targetId); if (!target || target.kind !== 'text') return null; return <Rect x={target.x} y={target.y} width={target.width} height={target.height} stroke={accent} strokeWidth={2} dash={[4, 4]} fill={colorToRgba(tokens.primary, 0.12)} listening={false} />; })()}
    </Layer>
    <Layer>
      {document.connections.map(connection => {
        const start = resolveAnchor(document, connection.from), end = resolveAnchor(document, connection.to);
        const from = resolveAnchor(document, connection.from, end ?? undefined), to = resolveAnchor(document, connection.to, start ?? undefined);
        if (!from || !to || Math.max(from.x, to.x) < visible.left || Math.min(from.x, to.x) > visible.right || Math.max(from.y, to.y) < visible.top || Math.min(from.y, to.y) > visible.bottom) return null;
        return <ConnectionView key={connection.id} connection={connection} document={document} accent={accent} selected={selectedConnections.includes(connection.id)} />;
      })}
      <Line ref={previewLine} points={[]} stroke={accent} strokeWidth={2} listening={false} visible={false} />
      <Rect ref={previewRect} stroke={accent} dash={[5, 4]} fill={colorToRgba(tokens.primary, 0.13)} listening={false} visible={false} />
    </Layer>
    <Layer>
      {visibleObjects.filter(object => selected.includes(object.id) && editing?.id !== object.id).map(object => <SelectionOutline key={object.id} object={object} scale={document.camera.scale} accent={accent} surface={colorToHex(tokens.card)} resizable={tool === 'select'} />)}
    </Layer>
  </Stage>{editing && editingObject && isTextObject(editingObject) && <CanvasTextEditor key={editing.id} object={canvasDisplayObject(editingObject, tokens)} camera={document.camera} onCommit={commitText} onCancel={() => setEditing(null)} />}
    <CanvasObjectMenu target={contextMenu} editor={editor} close={() => setContextMenu(null)} select={onSelect} focus={focusCanvas} editText={id => setEditing({ id })} inspect={onOpenInspector} openStack={setViewingStack} openNote={onOpenNote} connect={() => onTool('arrow')} exportGraphic={(objects, format) => copyCanvasGraphic(stageRef.current!, objects.map(object => canvasDisplayObject(object, tokens)), format)}/>
    {stack?.kind === 'imageStack' && <ImageStackViewer key={stack.id} stack={stack} assets={document.assets} editor={editor} onClose={() => setViewingStack(null)} />}
  </>;
}

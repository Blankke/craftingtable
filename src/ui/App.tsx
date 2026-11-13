import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Stage, Layer, Rect, Text, Ellipse, Line, Group } from 'react-konva';
import { Editor } from '../core/editor';
import { mediaWidth, newDocument, resolveAnchor, type CanvasObject, type ProjectDocument } from '../core/document';

type Tool = 'select' | 'text' | 'rectangle' | 'ellipse' | 'diamond' | 'stroke';
const colors = { ink: '#172033', accent: '#5268e8' };
const api = window.workbench;

function useEditor(editor: Editor): ProjectDocument { return useSyncExternalStore(editor.subscribe, () => editor.document); }
function ObjectView({ object, selected, onSelect, onMove }: { object: CanvasObject; selected: boolean; onSelect(): void; onMove(x: number, y: number): void }) {
  const width = object.kind === 'media' ? mediaWidth(object) : object.width;
  return <Group x={object.x} y={object.y} draggable onClick={onSelect} onTap={onSelect} onDragEnd={event => onMove(event.target.x(), event.target.y())}>
    {object.kind === 'text' ? <Text text={object.text || '双击编辑文字'} width={width} height={object.height} fontSize={object.fontSize} fill={object.color} align={object.align} /> : null}
    {object.kind === 'rectangle' ? <Rect width={width} height={object.height} fill={object.fill} stroke={selected ? colors.accent : object.stroke} strokeWidth={selected ? 2 : 1} cornerRadius={6} /> : null}
    {object.kind === 'ellipse' ? <Ellipse x={width / 2} y={object.height / 2} radiusX={width / 2} radiusY={object.height / 2} fill={object.fill} stroke={selected ? colors.accent : object.stroke} /> : null}
    {object.kind === 'diamond' ? <Line points={[width / 2, 0, width, object.height / 2, width / 2, object.height, 0, object.height / 2]} closed fill={object.fill} stroke={selected ? colors.accent : object.stroke} /> : null}
    {object.kind === 'stroke' ? <Line points={object.points.flatMap(point => [point.x - object.x, point.y - object.y])} stroke={object.color} strokeWidth={object.strokeWidth} lineCap="round" lineJoin="round" /> : null}
    {object.kind === 'media' ? <><Rect width={width} height={object.height} fill={selected ? '#dce6ff' : '#edf1f8'} stroke={selected ? colors.accent : '#b8c4d8'} cornerRadius={8}/><Text x={12} y={12} text="▶ 媒体轨道" fontSize={15} fill={colors.ink}/><Line points={[12, object.height - 22, width - 12, object.height - 22]} stroke="#91a0bd"/><Text x={12} y={object.height - 18} text={`${(object.inUs / 1e6).toFixed(1)}s — ${(object.outUs / 1e6).toFixed(1)}s`} fontSize={11} fill="#64748b"/></> : null}
    {object.kind === 'image' ? <><Rect width={width} height={object.height} fill="#f1f5f9" stroke={selected ? colors.accent : '#b8c4d8'}/><Text text="图片素材" x={12} y={12} fontSize={15} fill={colors.ink}/></> : null}
  </Group>;
}

export function App() {
  const [projects, setProjects] = useState<{ name: string; folder: string }[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [editor, setEditor] = useState(() => new Editor(newDocument('未命名项目')));
  const document = useEditor(editor);
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string[]>([]);
  const [saveState, setSaveState] = useState('已保存');
  const [viewport, setViewport] = useState({ width: innerWidth - 300, height: innerHeight - 60 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSave = useRef(0);
  useEffect(() => { api?.listProjects().then(setProjects).catch(console.error); }, []);
  useEffect(() => {
    const update = () => setViewport({ width: innerWidth - 300, height: innerHeight - 60 });
    addEventListener('resize', update); return () => removeEventListener('resize', update);
  }, []);
  useEffect(() => {
    if (!folder || !api || document.revision === 0) return;
    setSaveState('未保存');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const snapshot = editor.document;
      api.saveProject(snapshot).then(() => { lastSave.current = Date.now(); if (editor.document.revision === snapshot.revision) setSaveState('已保存'); }).catch(() => setSaveState('保存失败，按 Ctrl+S 重试'));
    }, Math.min(600, Math.max(0, 2000 - (Date.now() - lastSave.current))));
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [document, editor, folder]);
  async function createProject() {
    const name = prompt('项目名称'); if (!name?.trim()) return;
    const created = api ? await api.createProject(name.trim()) : name.trim();
    const next = new Editor(newDocument(name.trim()));
    setFolder(created); setEditor(next);
    if (api) { await api.saveProject(next.document); setProjects(await api.listProjects()); }
  }
  async function openProject(path: string) { if (!api) return; setEditor(new Editor(await api.openProject(path))); setFolder(path); setSelected([]); }
  async function importAssets() {
    if (!api) return;
    const assets = await api.importAssets();
    if (assets.length) editor.execute(draft => { draft.assets.push(...assets); });
  }
  function addObject(kind: Tool | 'media' | 'image', assetId?: string) {
    const common = { id: crypto.randomUUID(), x: 100 - document.camera.x, y: 100 - document.camera.y, width: 220, height: 90, groupId: null };
    const object: CanvasObject = kind === 'text' ? { ...common, kind, text: '双击编辑文字', fontSize: 18, color: colors.ink, align: 'left' } : kind === 'media' ? { ...common, kind, assetId: assetId!, inUs: 0, outUs: document.assets.find(a => a.id === assetId)?.durationUs || 60_000_000, pixelsPerSecond: 30 } : kind === 'image' ? { ...common, kind, assetId: assetId! } : { ...common, kind: kind === 'ellipse' ? 'ellipse' : kind === 'diamond' ? 'diamond' : 'rectangle', fill: '#f3f5ff', stroke: colors.accent };
    editor.addObject(object); setSelected([object.id]); setTool('select');
  }
  function keyDown(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { if (selected.length) editor.deleteObjects(selected); setSelected([]); }
    if (event.ctrlKey && event.key.toLowerCase() === 'z') { event.preventDefault(); editor.undo(); }
    if (event.ctrlKey && event.key.toLowerCase() === 'y') { event.preventDefault(); editor.redo(); }
    if (event.ctrlKey && event.key.toLowerCase() === 's') { event.preventDefault(); if (api) api.saveProject(editor.document).then(() => setSaveState('已保存')).catch(() => setSaveState('保存失败')); }
  }
  useEffect(() => { addEventListener('keydown', keyDown); return () => removeEventListener('keydown', keyDown); });
  if (!folder) return <main className="home"><div className="project-grid">{projects.map(project => <button className="project-card" key={project.folder} onClick={() => openProject(project.folder)}>{project.name.split('-').slice(0, -1).join('-') || project.name}</button>)}<button className="project-card plus" onClick={createProject}>+</button></div></main>;
  return <div className="app"><header><button onClick={() => setFolder(null)}>‹ 项目</button><strong>{document.name}</strong><span>{saveState}</span><button onClick={() => editor.undo()}>撤销</button><button onClick={() => editor.redo()}>重做</button></header><div className="workspace"><section className="canvas">
    <Stage width={viewport.width} height={viewport.height} x={document.camera.x} y={document.camera.y} scaleX={document.camera.scale} scaleY={document.camera.scale} onWheel={event => { event.evt.preventDefault(); const delta = event.evt.deltaY; editor.execute(draft => { if (event.evt.ctrlKey) draft.camera.scale = Math.min(4, Math.max(0.2, draft.camera.scale * (delta > 0 ? 0.9 : 1.1))); else { draft.camera.x -= event.evt.deltaX; draft.camera.y -= delta; } }); }} onDblClick={event => { const point = event.target.getStage()?.getPointerPosition(); if (!point) return; const object = document.objects.find(item => selected.includes(item.id)); if (object?.kind === 'text') { const text = prompt('编辑文字', object.text); if (text !== null) editor.execute(draft => { const target = draft.objects.find(item => item.id === object.id); if (target?.kind === 'text') target.text = text; }); } }}>
      <Layer>{document.connections.map(connection => { const from = resolveAnchor(document, connection.from), to = resolveAnchor(document, connection.to); return from && to ? <Line key={connection.id} points={[from.x, from.y, to.x, to.y]} stroke={colors.accent} strokeWidth={2} /> : null; })}{document.objects.map(object => <ObjectView key={object.id} object={object} selected={selected.includes(object.id)} onSelect={() => setSelected([object.id])} onMove={(x,y) => editor.execute(draft => { const target = draft.objects.find(item => item.id === object.id); if (target) { target.x = x; target.y = y; } })}/>)}</Layer>
    </Stage></section><aside><div className="panel"><h3>工具</h3><div className="tool-grid">{(['text','rectangle','ellipse','diamond'] as const).map(item => <button key={item} onClick={() => addObject(item)}>{({ text:'文字', rectangle:'矩形', ellipse:'圆形', diamond:'菱形' })[item]}</button>)}</div>{selected.length > 1 && <button onClick={() => editor.group(selected)}>分组</button>}{selected.length === 1 && document.objects.find(item => item.id === selected[0])?.groupId && <button onClick={() => editor.ungroup(document.objects.find(item => item.id === selected[0])!.groupId!)}>解组</button>}</div><div className="panel library"><h3>项目素材库</h3><button onClick={importAssets}>+ 导入素材</button>{document.assets.map(asset => <button className="asset" key={asset.id} onClick={() => addObject(asset.kind === 'image' ? 'image' : asset.kind === 'text' ? 'text' : 'media', asset.id)}><b>{asset.name}</b><small>{asset.kind} · {asset.status}</small></button>)}</div></aside></div></div>;
}

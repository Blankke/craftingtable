import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Editor } from '../core/editor';
import { newDocument, type CanvasObject, type ProjectDocument } from '../core/document';
import { MediaControls } from './MediaControls';
import { Autosave } from '../core/autosave';
import { CanvasStage, type Tool } from './CanvasStage';
import { TextToolbar } from './TextToolbar';
import { AssetLibrary } from './AssetLibrary';
import { MediaTaskList } from './MediaTaskList';
import { TextAssetCreator } from './TextAssetCreator';
import { usePlaybackStore } from './playbackStore';
import { useTaskStore } from './taskStore';
import { useInteractionStore } from './interactionStore';
import { browserBackend } from '../platform/browserBackend';
import { SettingsPanel } from './SettingsPanel';
import { useLanguage } from './language';

const colors = { ink: '#172033', accent: '#5268e8' };
const api = window.workbench ?? browserBackend;
function useEditor(editor: Editor): ProjectDocument { return useSyncExternalStore(editor.subscribe, () => editor.document); }

export function App() {
  const { t } = useLanguage();
  const [projects, setProjects] = useState<{ name: string; folder: string }[]>([]);
  const [homeMenu, setHomeMenu] = useState(false);
  const [creating, setCreating] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [homeError, setHomeError] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [recoveredProject, setRecoveredProject] = useState(false);
  const [editor, setEditor] = useState(() => new Editor(newDocument('未命名项目')));
  const document = useEditor(editor);
  const tool = useInteractionStore(state => state.tool);
  const setTool = useInteractionStore(state => state.setTool);
  const arrowRouting = useInteractionStore(state => state.arrowRouting);
  const setArrowRouting = useInteractionStore(state => state.setArrowRouting);
  const selected = useInteractionStore(state => state.selected);
  const setSelected = useInteractionStore(state => state.setSelected);
  const resetInteraction = useInteractionStore(state => state.reset);
  const [saveState, setSaveState] = useState('已保存');
  const playbackMediaId = usePlaybackStore(state => state.playback?.mediaId);
  const setPlayback = usePlaybackStore(state => state.setPlayback);
  const trimMode = useInteractionStore(state => state.trimMode);
  const setTrimMode = useInteractionStore(state => state.setTrimMode);
  const analysis = useTaskStore(state => state.analysis);
  const analysisRetry = useTaskStore(state => state.retryVersion);
  const setAnalysis = useTaskStore(state => state.updateAnalysis);
  const resetAnalysis = useTaskStore(state => state.resetAnalysis);
  const retryAnalysis = useTaskStore(state => state.retry);
  const [viewport, setViewport] = useState({ width: innerWidth - 300, height: innerHeight - 60 });
  const autosave = useRef<Autosave | null>(null);
  const copiedIds = useRef<string[]>([]);
  const spacePanUsed = useRef(false);
  const spacePressed = useRef(false);
  const taskOwners = useRef(new Map<string, string>());
  useEffect(() => { api.listProjects().then(setProjects).catch(error => setHomeError(`${t('读取项目失败', 'Could not load projects')}：${String(error)}`)); }, []);
  useEffect(() => {
    const update = () => setViewport({ width: innerWidth - 300, height: innerHeight - 60 });
    addEventListener('resize', update); return () => removeEventListener('resize', update);
  }, []);
  useEffect(() => {
    if (!folder) return;
    const scheduler = new Autosave(snapshot => api.saveProject(snapshot), setSaveState, editor.document.revision - (recoveredProject ? 1 : 0));
    autosave.current = scheduler;
    // 恢复快照本身也需要落回主文件，不能依赖用户再次编辑才触发保存。
    if (recoveredProject) scheduler.schedule(editor.document);
    const unsubscribe = editor.subscribe(() => scheduler.schedule(editor.document));
    const removeFlushListener = api.onFlushRequest?.(async () => {
      try { await scheduler.flush(); return true; } catch { return false; }
    });
    const removeRestartListener = api.onBackendRestart(() => { void scheduler.flush().catch(() => undefined); });
    return () => { unsubscribe(); removeFlushListener?.(); removeRestartListener(); scheduler.dispose(); if (autosave.current === scheduler) autosave.current = null; };
  }, [editor, folder, recoveredProject]);
  const mediaSignature = document.objects.filter(item => item.kind === 'media').map(item => {
    const asset = document.assets.find(candidate => candidate.id === item.assetId);
    return `${item.id}:${item.assetId}:${asset?.path}:${asset?.status}:${item.inUs}:${item.outUs}:${item.pixelsPerSecond}`;
  }).join('|');
  const analysisKey = editor.isPreviewing ? 'preview' : mediaSignature;
  const selectedText = selected.length === 1 ? document.objects.find(item => item.id === selected[0]) : undefined;
  const referencedIds = new Set(document.objects.flatMap(object => 'assetId' in object && object.assetId ? [object.assetId] : []));
  const processingAssetIds = new Set(document.objects.flatMap(object => object.kind === 'media' && analysis[object.id]?.processing ? [object.assetId] : []));
  const failedAssetIds = new Set(document.objects.flatMap(object => object.kind === 'media' && analysis[object.id]?.error ? [object.assetId] : []));
  useEffect(() => { resetAnalysis(); }, [editor, resetAnalysis]);
  useEffect(() => { setTrimMode(false); }, [playbackMediaId]);
  useEffect(() => api?.onTaskProgress(progress => {
    const objectId = taskOwners.current.get(progress.taskId);
    if (objectId) setAnalysis(previous => ({ ...previous, [objectId]: { ...previous[objectId], progress: progress.percent, processing: progress.percent < 100 } }));
  }), []);
  useEffect(() => {
    if (!folder || !window.workbench) return;
    if (editor.isPreviewing) return;
    let cancelled = false;
    const started: string[] = [];
    const snapshot = editor.document;
    setAnalysis(() => ({}));
    for (const object of snapshot.objects) {
      if (object.kind !== 'media') continue;
      const asset = snapshot.assets.find(item => item.id === object.assetId);
      if (!asset || asset.status === 'missing' || (asset.kind !== 'audio' && asset.kind !== 'video')) continue;
      const taskId = crypto.randomUUID();
      started.push(taskId);
      taskOwners.current.set(taskId, object.id);
      setAnalysis(previous => ({ ...previous, [object.id]: { processing: true, progress: 0, taskId } }));
      void api.analyzeAsset({ assetId: asset.id, assetPath: asset.path, kind: asset.kind, inUs: object.inUs, outUs: object.outUs, pixelsPerSecond: object.pixelsPerSecond, taskId })
        .then(response => { if (!cancelled) setAnalysis(previous => ({ ...previous, [object.id]: response.ok ? response.result : { error: response.error.message, errorCode: response.error.code, retryable: response.error.retryable } })); })
        .catch(error => { if (!cancelled) setAnalysis(previous => ({ ...previous, [object.id]: { error: String(error), errorCode: 'BACKEND', retryable: true } })); })
        .finally(() => taskOwners.current.delete(taskId));
    }
    return () => { cancelled = true; started.forEach(taskId => { void api.cancelTask(taskId).catch(() => undefined); taskOwners.current.delete(taskId); }); };
  }, [folder, editor, analysisKey, analysisRetry]);
  async function createProject() {
    const name = projectName.trim();
    if (!name) { setHomeError(t('请输入项目名称', 'Enter a project name')); return; }
    try {
      const created = await api.createProject(name);
      const next = new Editor(newDocument(name));
      await api.saveProject(next.document);
      const list = await api.listProjects();
      resetInteraction(); setPlayback(null); setRecoveredProject(false); setFolder(created); setEditor(next);
      setProjects(list); setCreating(false); setHomeMenu(false); setHomeError(''); setProjectName('');
    } catch (error) { setHomeError(`${t('新建项目失败', 'Could not create project')}：${String(error)}`); }
  }
  async function openProject(path: string) {
    try {
      const loaded = await api.openProject(path);
      resetInteraction(); setPlayback(null); setRecoveredProject(!!loaded.recovered); setEditor(new Editor(loaded)); setFolder(path);
      setSaveState(loaded.recovered ? '已载入恢复快照，请保存' : '已保存');
    } catch (error) { alert(`${t('打开项目失败', 'Could not open project')}：${String(error)}`); }
  }
  async function pickProjectFolder() {
    setHomeMenu(false);
    try {
      const selected = await api.pickProjectFolder();
      if (!selected) return;
      resetInteraction(); setPlayback(null); setRecoveredProject(!!selected.document.recovered); setEditor(new Editor(selected.document)); setFolder(selected.folder);
      setSaveState(selected.document.recovered ? '已载入恢复快照，请保存' : '已保存');
    } catch (error) { alert(`${t('打开项目文件夹失败', 'Could not open project folder')}：${String(error)}`); }
  }
  async function importAssets() {
    try {
      const result = await api.importAssets();
      if (result.assets.length) editor.execute(draft => { draft.assets.push(...result.assets); });
      if (result.errors.length) alert(`${t('部分素材导入失败', 'Some assets could not be imported')}：\n${result.errors.map(item => `${item.name}：${item.message}`).join('\n')}`);
    } catch (error) { alert(`${t('导入素材失败', 'Could not import assets')}：${String(error)}`); }
  }
  async function createTextAsset(name: string, content: string): Promise<void> {
    if (!api) return;
    const asset = await api.createTextAsset({ name, content });
    editor.execute(draft => { draft.assets.push(asset); });
  }
  async function relinkAsset(id: string): Promise<void> {
    if (!api) return;
    const asset = editor.document.assets.find(item => item.id === id);
    if (!asset) return;
    try {
      const replacement = await api.relinkAsset(asset.kind);
      if (!replacement) return;
      editor.execute(draft => {
        const target = draft.assets.find(item => item.id === id);
        if (target) { target.path = replacement.path; target.name = replacement.name; target.durationUs = replacement.durationUs; target.content = replacement.content; target.status = 'ready'; }
      });
    } catch (error) { alert(`${t('重新关联失败', 'Could not relink asset')}：${String(error)}`); }
  }
  function addObject(kind: Tool | 'media' | 'image', assetId?: string, position?: { x: number; y: number }) {
    const common = { id: crypto.randomUUID(), x: position?.x ?? (100 - document.camera.x) / document.camera.scale, y: position?.y ?? (100 - document.camera.y) / document.camera.scale, width: 220, height: 90, groupId: null };
    const object: CanvasObject = kind === 'text' ? { ...common, kind, text: assetId ? document.assets.find(a => a.id === assetId)?.content || '' : t('双击编辑文字', 'Double click to edit'), fontSize: 18, color: colors.ink, align: 'left', ...(assetId ? { assetId } : {}) } : kind === 'media' ? { ...common, kind, assetId: assetId!, inUs: 0, outUs: document.assets.find(a => a.id === assetId)?.durationUs || 60_000_000, pixelsPerSecond: 30 } : kind === 'image' ? { ...common, kind, assetId: assetId! } : { ...common, kind: kind === 'ellipse' ? 'ellipse' : kind === 'diamond' ? 'diamond' : 'rectangle', fill: '#f3f5ff', stroke: colors.accent };
    editor.addObject(object); setSelected([object.id]); setTool('select');
  }
  function dropItem(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault();
    const raw = event.dataTransfer.getData('application/x-workbench-item');
    if (!raw) return;
    let item: { kind?: string; assetId?: string };
    try { item = JSON.parse(raw); } catch { return; }
    if (!item.kind || !['text', 'rectangle', 'ellipse', 'diamond', 'media', 'image'].includes(item.kind)) return;
    if (item.assetId && !document.assets.some(asset => asset.id === item.assetId && asset.status !== 'missing')) return;
    if (['media', 'image'].includes(item.kind) && !item.assetId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    addObject(item.kind as Tool | 'media' | 'image', item.assetId, {
      x: (event.clientX - bounds.left - document.camera.x) / document.camera.scale,
      y: (event.clientY - bounds.top - document.camera.y) / document.camera.scale
    });
  }
  function keyDown(event: KeyboardEvent) {
    const playback = usePlaybackStore.getState().playback;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { if (selected.length) editor.deleteObjects(selected); setSelected([]); }
    if (event.ctrlKey && event.key.toLowerCase() === 'z') { event.preventDefault(); editor.undo(); }
    if (event.ctrlKey && event.key.toLowerCase() === 'y') { event.preventDefault(); editor.redo(); }
    if (event.ctrlKey && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(document.objects.map(item => item.id)); }
    if (event.ctrlKey && event.key.toLowerCase() === 'c') { event.preventDefault(); copiedIds.current = selected; }
    if (event.ctrlKey && event.key.toLowerCase() === 'v') { event.preventDefault(); if (copiedIds.current.length) setSelected(editor.duplicateObjects(copiedIds.current)); }
    if (event.ctrlKey && event.key.toLowerCase() === 'd') { event.preventDefault(); if (selected.length) setSelected(editor.duplicateObjects(selected)); }
    if (event.ctrlKey && event.key.toLowerCase() === 's') { event.preventDefault(); void autosave.current?.flush().catch(() => undefined); }
    if (event.key.toLowerCase() === 'm' && playback) { event.preventDefault(); editor.execute(draft => { draft.markers.push({ id: crypto.randomUUID(), mediaId: playback.mediaId, timeUs: playback.timeUs, note: '' }); }); }
    if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) spacePanUsed.current = false; spacePressed.current = true; }
  }
  function keyUp(event: KeyboardEvent) {
    if (event.code !== 'Space' || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    spacePressed.current = false;
    const playback = usePlaybackStore.getState().playback;
    if (playback && !spacePanUsed.current) setPlayback({ ...playback, play: !playback.play });
    spacePanUsed.current = false;
  }
  useEffect(() => {
    const mouseDown = (event: MouseEvent) => { if (spacePressed.current && event.target instanceof Element && event.target.closest('.canvas')) spacePanUsed.current = true; };
    addEventListener('keydown', keyDown); addEventListener('keyup', keyUp); addEventListener('mousedown', mouseDown);
    return () => { removeEventListener('keydown', keyDown); removeEventListener('keyup', keyUp); removeEventListener('mousedown', mouseDown); };
  });
  const settings = <SettingsPanel onRootChange={async () => setProjects(await api.listProjects())} />;
  if (!folder) return <main className="home">
    <header className="home-header"><strong>{t('音视频创作策划工作台', 'Media Planning Workbench')}</strong>{settings}</header>
    <div className="project-grid">
      {projects.map(project => <button className="project-card" key={project.folder} onClick={() => openProject(project.folder)}>{window.workbench ? project.name.split('-').slice(0, -1).join('-') || project.name : project.name}</button>)}
      <div className="home-create"><button className="project-card plus" aria-label={t('添加项目', 'Add project')} onClick={() => setHomeMenu(value => !value)}>+</button>
        {homeMenu && <div className="home-menu"><button onClick={() => { setHomeMenu(false); setCreating(true); setHomeError(''); }}>{t('新建项目', 'New project')}</button>{window.workbench && <button onClick={pickProjectFolder}>{t('打开项目文件夹', 'Open project folder')}</button>}</div>}
      </div>
    </div>
    {homeError && !creating && <p className="home-error" role="alert">{homeError}</p>}
    {creating && <div className="dialog-backdrop"><form className="project-dialog" onSubmit={event => { event.preventDefault(); void createProject(); }}>
      <h2>{t('新建项目', 'New project')}</h2><label htmlFor="project-name">{t('项目名称', 'Project name')}</label>
      <input id="project-name" autoFocus value={projectName} onChange={event => setProjectName(event.target.value)} maxLength={100} />
      {homeError && <p className="home-error" role="alert">{homeError}</p>}
      <div><button type="button" onClick={() => { setCreating(false); setHomeError(''); }}>{t('取消', 'Cancel')}</button><button type="submit">{t('创建项目', 'Create project')}</button></div>
    </form></div>}
  </main>;
  return <div className="app"><header>
    <button onClick={async () => { try { await autosave.current?.flush(); await api.leaveProject(); resetInteraction(); setFolder(null); setPlayback(null); } catch { setSaveState('保存失败'); } }}>{t('‹ 项目', '‹ Projects')}</button>
    <strong>{document.name}</strong><span>{saveState === '已保存' ? t('已保存', 'Saved') : saveState === '未保存' ? t('未保存', 'Unsaved') : saveState === '保存失败' ? t('保存失败', 'Save failed') : t('已载入恢复快照，请保存', 'Recovery loaded; please save')}</span>
    {saveState === '保存失败' && <button onClick={() => { void autosave.current?.flush().catch(() => undefined); }}>{t('重试保存', 'Retry save')}</button>}
    <button onClick={() => editor.undo()}>{t('撤销', 'Undo')}</button><button onClick={() => editor.redo()}>{t('重做', 'Redo')}</button>{settings}
  </header><div className="workspace"><section className="canvas" data-selected={selected.join(',')} style={{ backgroundSize: `${24 * document.camera.scale}px ${24 * document.camera.scale}px`, backgroundPosition: `${document.camera.x}px ${document.camera.y}px` }} onDragOver={event => { if (event.dataTransfer.types.includes('application/x-workbench-item')) event.preventDefault(); }} onDrop={dropItem}>
    <CanvasStage editor={editor} document={document} viewport={viewport} tool={tool} arrowRouting={arrowRouting} selected={selected} trimMode={trimMode} analysis={analysis} onSelect={setSelected} onTool={setTool} onSpacePan={() => { spacePanUsed.current = true; }}/>
    <MediaControls document={document} editor={editor} trimMode={trimMode} onTrimMode={setTrimMode}/>
  </section><aside><div className="panel"><h3>{t('工具', 'Tools')}</h3><div className="tool-grid">
    {(['text','rectangle','ellipse','diamond'] as const).map(item => <button key={item} draggable onDragStart={event => event.dataTransfer.setData('application/x-workbench-item', JSON.stringify({ kind: item }))} onClick={() => addObject(item)}>{({ text:t('文字', 'Text'), rectangle:t('矩形', 'Rectangle'), ellipse:t('圆形', 'Ellipse'), diamond:t('菱形', 'Diamond') })[item]}</button>)}
    <button aria-pressed={tool === 'arrow'} onClick={() => setTool('arrow')}>{t('箭头', 'Arrow')}</button><button aria-pressed={tool === 'brush'} onClick={() => setTool('brush')}>{t('画笔', 'Brush')}</button><button aria-pressed={tool === 'select'} onClick={() => setTool('select')}>{t('选择', 'Select')}</button>
  </div>{tool === 'arrow' && <label className="arrow-routing">{t('路径', 'Path')} <select aria-label={t('箭头路径', 'Arrow path')} value={arrowRouting} onChange={event => setArrowRouting(event.target.value as 'straight' | 'elbow')}><option value="straight">{t('直线', 'Straight')}</option><option value="elbow">{t('折线', 'Elbow')}</option></select></label>}
    {selectedText?.kind === 'text' && <TextToolbar editor={editor} object={selectedText}/>}
    {selected.length > 1 && <button onClick={() => editor.group(selected)}>{t('分组', 'Group')}</button>}
    {selected.length === 1 && document.objects.find(item => item.id === selected[0])?.groupId && <button onClick={() => editor.ungroup(document.objects.find(item => item.id === selected[0])!.groupId!)}>{t('解组', 'Ungroup')}</button>}
  </div><div className="panel library"><h3>{t('项目素材库', 'Project assets')}</h3><button onClick={importAssets}>{t('+ 导入素材', '+ Import assets')}</button>
    <TextAssetCreator onCreate={createTextAsset}/><MediaTaskList document={document} analysis={analysis} onCancel={taskId => { void api.cancelTask(taskId); }} onRetry={retryAnalysis}/>
    <AssetLibrary assets={document.assets} referencedIds={referencedIds} processingAssetIds={processingAssetIds} failedAssetIds={failedAssetIds} onAdd={addObject} onRelink={relinkAsset} onRemove={id => editor.removeAsset(id)}/>
  </div></aside></div></div>;
}

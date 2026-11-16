import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Editor } from '../core/editor';
import { newDocument, type CanvasObject, type ProjectDocument } from '../core/document';
import { noteAssetIds } from '../core/note';
import { MediaControls } from './MediaControls';
import { Autosave } from '../core/autosave';
import { CanvasStage, type Tool } from './CanvasStage';
import { ObjectInspector } from './ObjectInspector';
import { ConnectionInspector } from './ConnectionInspector';
import { ShapeIcon } from './ShapeIcon';
import { GlassFolderCard, type FolderArt } from './GlassFolderCard';
const NoteEditor = lazy(() => import('./NoteEditor').then(module => ({ default: module.NoteEditor })));
import { WorkspaceDock } from './WorkspaceDock';
import { shapeKinds } from '../core/document';
import { shapeLabels } from '../core/appearance';
import { mediaSource } from './mediaSource';
import { AssetLibrary } from './AssetLibrary';
import { MediaTaskList } from './MediaTaskList';
import { TextAssetCreator } from './TextAssetCreator';
import { usePlaybackStore } from './playbackStore';
import { useTaskStore } from './taskStore';
import { useInteractionStore } from './interactionStore';
import { SettingsPanel } from './SettingsPanel';
import { useLanguage } from './language';
import { useTheme } from './themeStore';
import { autoTrackColor, colorToHex } from '../core/theme';
import { ThemePicker } from './ThemePicker';
import { shapeGroups } from '../core/shapeGeometry';
// main.tsx 在挂载前确认 preload 已就绪；渲染端只使用桌面 IPC。
const api = window.workbench!;
function useEditor(editor: Editor): ProjectDocument { return useSyncExternalStore(editor.subscribe, () => editor.document); }

export function App() {
  const { t } = useLanguage();
  const { tokens, trackPalette } = useTheme();
  const ink = colorToHex(tokens.foreground);
  const accent = colorToHex(tokens.primary);
  const defaultFill = colorToHex(tokens.muted);
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof api.listProjects>>>([]);
  const [homeMenu, setHomeMenu] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creatingPending, setCreatingPending] = useState(false);
  const creatingLock = useRef(false);
  const [projectName, setProjectName] = useState('');
  const [homeError, setHomeError] = useState('');
  const [retryProjectPath, setRetryProjectPath] = useState<string | null>(null);
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
  const setSelectedConnections = useInteractionStore(state => state.setSelectedConnections);
  const resetInteraction = useInteractionStore(state => state.reset);
  const [saveState, setSaveState] = useState('已保存');
  const [themeOpen, setThemeOpen] = useState(false);
  const [shapeSearch, setShapeSearch] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [readingNoteId, setReadingNoteId] = useState<string | null>(null);
  const [openNoteIds, setOpenNoteIds] = useState<string[]>([]);
  const playbackMediaId = usePlaybackStore(state => state.playback?.mediaId);
  const setPlayback = usePlaybackStore(state => state.setPlayback);
  const trimMode = useInteractionStore(state => state.trimMode);
  const setTrimMode = useInteractionStore(state => state.setTrimMode);
  const analysis = useTaskStore(state => state.analysis);
  const analysisRetry = useTaskStore(state => state.retryVersion);
  const setAnalysis = useTaskStore(state => state.updateAnalysis);
  const resetAnalysis = useTaskStore(state => state.resetAnalysis);
  const retryAnalysis = useTaskStore(state => state.retry);
  const canvasRef = useRef<HTMLElement | null>(null);
  const activeEditor = useRef(editor); activeEditor.current = editor;
  const [dropPreview, setDropPreview] = useState<{ x: number; y: number; label: string; image?: string } | null>(null);
  const placement = useRef<{ kind: Tool | 'media' | 'image' | 'note'; assetId?: string; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const cancelledDrop = useRef(false);
  const externalDrag = useRef(false);
  const [importing, setImporting] = useState(false);
  const [viewport, setViewport] = useState({ width: innerWidth - 300, height: innerHeight - 60 });
  const autosave = useRef<Autosave | null>(null);
  const copiedIds = useRef<string[]>([]);
  const spacePanUsed = useRef(false);
  const spacePressed = useRef(false);
  const taskOwners = useRef(new Map<string, string>());
  useEffect(() => { api.listProjects().then(setProjects).catch(error => setHomeError(`${t('读取项目失败', 'Could not load projects')}：${String(error)}`)); }, []);
  useEffect(() => {
    if (!folder || !canvasRef.current) return;
    const observer = new ResizeObserver(entries => { const box = entries[0].contentRect; setViewport({ width: box.width, height: box.height }); });
    observer.observe(canvasRef.current); return () => observer.disconnect();
  }, [folder]);
  useEffect(() => {
    // 媒体工作区跟随当前选择，防止误操作其他轨道。
    const media = selected.length === 1 ? editor.document.objects.find(item => item.id === selected[0]) : undefined;
    const current = usePlaybackStore.getState().playback;
    if (media?.kind === 'media') { if (current?.mediaId !== media.id) setPlayback({ mediaId: media.id, timeUs: media.inUs, play: false }); }
    else if (current) setPlayback(null);
  }, [selected, editor, document.objects]);
  useEffect(() => {
    if (!folder) return;
    const scheduler = new Autosave(snapshot => api.saveProject(snapshot), setSaveState, editor.document.revision - (recoveredProject ? 1 : 0));
    autosave.current = scheduler;
    // 恢复快照本身也需要落回主文件，不能依赖用户再次编辑才触发保存。
    if (recoveredProject) scheduler.schedule(editor.document);
    const unsubscribe = editor.subscribe(() => scheduler.schedule(editor.document));
    const removeFlushListener = api.onFlushRequest(async () => {
      try { await scheduler.flush(); return true; } catch { return false; }
    });
    const removeRestartListener = api.onBackendRestart(() => { void scheduler.flush().catch(() => undefined); });
    return () => { unsubscribe(); removeFlushListener(); removeRestartListener(); scheduler.dispose(); if (autosave.current === scheduler) autosave.current = null; };
  }, [editor, folder, recoveredProject]);
  const mediaSignature = document.objects.filter(item => item.kind === 'media').map(item => {
    const asset = document.assets.find(candidate => candidate.id === item.assetId);
    return `${item.id}:${item.assetId}:${asset?.path}:${asset?.status}:${item.inUs}:${item.outUs}:${item.pixelsPerSecond}`;
  }).join('|');
  const analysisKey = editor.isPreviewing ? 'preview' : mediaSignature;
  const selectedObjects = document.objects.filter(item => selected.includes(item.id));
  const selectedConnections = useInteractionStore(state => state.selectedConnections);
  const selectedConnectionObjects = document.connections.filter(item => selectedConnections.includes(item.id));
  const referencedIds = new Set([
    ...document.objects.flatMap(object => 'assetId' in object && object.assetId ? [object.assetId] : []),
    ...document.notes.flatMap(note => noteAssetIds(note))
  ]);
  const processingAssetIds = new Set(document.objects.flatMap(object => object.kind === 'media' && analysis[object.id]?.processing ? [object.assetId] : []));
  const failedAssetIds = new Set(document.objects.flatMap(object => object.kind === 'media' && analysis[object.id]?.error ? [object.assetId] : []));
  useEffect(() => { resetAnalysis(); }, [editor, resetAnalysis]);
  useEffect(() => { setTrimMode(false); }, [playbackMediaId]);
  useEffect(() => api.onTaskProgress(progress => {
    const objectId = taskOwners.current.get(progress.taskId);
    if (objectId) setAnalysis(previous => ({ ...previous, [objectId]: { ...previous[objectId], progress: progress.percent, processing: progress.percent < 100 } }));
  }), []);
  useEffect(() => {
    if (!folder) return;
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
    if (creatingLock.current) return;
    const name = projectName.trim();
    if (!name) { setHomeError(t('请输入项目名称', 'Enter a project name')); return; }
    creatingLock.current = true; setCreatingPending(true); setHomeError('');
    try {
      const created = await api.createProject(name);
      const next = new Editor(newDocument(name));
      await api.saveProject(next.document);
      const list = await api.listProjects();
      resetInteraction(); setPlayback(null); setRecoveredProject(false); setFolder(created); setEditor(next);
      setProjects(list); setCreating(false); setHomeMenu(false); setHomeError(''); setProjectName('');
    } catch (error) { setHomeError(`${t('新建项目失败', 'Could not create project')}：${String(error)}`); }
    finally { creatingLock.current = false; setCreatingPending(false); }
  }
  async function openProject(path: string) {
    try {
      setHomeError(''); setRetryProjectPath(null);
      const loaded = await api.openProject(path);
      resetInteraction(); setPlayback(null); setRecoveredProject(!!loaded.recovered); setEditor(new Editor(loaded)); setFolder(path);
      setSaveState(loaded.recovered ? '已载入恢复快照，请保存' : '已保存');
    } catch (error) { setHomeError(`${t('打开项目失败', 'Could not open project')}：${String(error)}`); setRetryProjectPath(path); }
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
  async function importNoteImages(files: File[]): Promise<ProjectDocument['assets']> {
    try {
      const result = await api.importDroppedFiles(files);
      if (result.assets.length) editor.execute(draft => { draft.assets.push(...result.assets); });
      if (result.errors.length) alert(`${t('部分素材导入失败', 'Some assets could not be imported')}：\n${result.errors.map(item => `${item.name}：${item.message}`).join('\n')}`);
      return result.assets.filter(asset => asset.kind === 'image');
    } catch (error) {
      alert(`${t('导入素材失败', 'Could not import assets')}：${String(error)}`);
      return [];
    }
  }
  async function createTextAsset(name: string, content: string): Promise<void> {
    const asset = await api.createTextAsset({ name, content });
    editor.execute(draft => { draft.assets.push(asset); });
  }
  async function relinkAsset(id: string): Promise<void> {
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
  async function makeObject(kind: Tool | 'media' | 'image', asset: ProjectDocument['assets'][number] | undefined, position?: { x: number; y: number }): Promise<CanvasObject> {
    const camera = editor.document.camera;
    const common = { id: crypto.randomUUID(), x: position?.x ?? (100 - camera.x) / camera.scale, y: position?.y ?? (100 - camera.y) / camera.scale, width: 220, height: 90, groupId: null };
    if (kind === 'image' && asset) {
      const image = new Image(); image.src = mediaSource(asset.path); await image.decode();
      const width = Math.min(400, image.naturalWidth);
      return { ...common, kind, assetId: asset.id, width, height: width * image.naturalHeight / image.naturalWidth, aspectLocked: true };
    }
    if (kind === 'media' && asset) {
      const mediaCount = editor.document.objects.filter(item => item.kind === 'media').length;
      return { ...common, kind, assetId: asset.id, inUs: 0, outUs: asset.durationUs || 60_000_000, pixelsPerSecond: 30, color: autoTrackColor(trackPalette, mediaCount), autoColor: true };
    }
    if (kind === 'text') return { ...common, kind, text: asset?.content ?? t('双击编辑文字', 'Double click to edit'), fontSize: 18, color: ink, align: 'left', ...(asset ? { assetId: asset.id } : {}) };
    return { ...common, kind: shapeKinds.includes(kind as typeof shapeKinds[number]) ? kind as typeof shapeKinds[number] : 'rectangle', fill: defaultFill, stroke: accent, text: '', fontSize: 18, color: ink, align: 'center' };
  }
  async function addObject(kind: Tool | 'media' | 'image' | 'note', assetId?: string, position?: { x: number; y: number }) {
    if (suppressClick.current && !position) return;
    try {
      if (kind === 'note') {
        if (!assetId) throw Error('笔记不存在');
        const target = position ?? { x: (viewport.width / 2 - editor.document.camera.x) / editor.document.camera.scale, y: (viewport.height / 2 - editor.document.camera.y) / editor.document.camera.scale };
        const id = editor.addNoteObject(assetId, target);
        setSelected([id]); setTool('select'); return;
      }
      const object = await makeObject(kind, editor.document.assets.find(item => item.id === assetId), position);
      if (activeEditor.current !== editor) return;
      editor.addObject(object); setSelected([object.id]); setTool('select');
    } catch (error) { alert('无法放入素材：' + String(error)); }
  }
  const canvasPoint = (x: number, y: number) => {
    const rect = canvasRef.current!.getBoundingClientRect(), camera = editor.document.camera;
    return { x: (x - rect.left - camera.x) / camera.scale, y: (y - rect.top - camera.y) / camera.scale };
  };
  function beginPlacement(event: React.PointerEvent, kind: Tool | 'media' | 'image' | 'note', assetId?: string) {
    if (event.button !== 0) return;
    suppressClick.current = false; cancelledDrop.current = false;
    placement.current = { kind, assetId, x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const item = placement.current; if (!item) return;
      if (Math.hypot(event.clientX - item.x, event.clientY - item.y) > 4) item.moved = true;
      if (!item.moved) return;
      const asset = editor.document.assets.find(a => a.id === item.assetId);
      const note = item.kind === 'note' ? editor.document.notes.find(value => value.id === item.assetId) : null;
      setDropPreview({ x: event.clientX, y: event.clientY, label: note?.name ?? asset?.name ?? (item.kind in shapeLabels ? shapeLabels[item.kind as keyof typeof shapeLabels] : '文字'), image: asset?.kind === 'image' ? mediaSource(asset.path) : undefined });
    };
    const cancel = () => { if (placement.current) suppressClick.current = true; placement.current = null; cancelledDrop.current = true; setDropPreview(null); };
    const down = (event: MouseEvent) => { if (event.button === 2) cancel(); };
    const up = (event: PointerEvent) => {
      const item = placement.current; placement.current = null; setDropPreview(null);
      if (!item?.moved || event.button !== 0) return;
      suppressClick.current = true;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) void addObject(item.kind, item.assetId, canvasPoint(event.clientX, event.clientY));
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('mousedown', down); addEventListener('keydown', key); addEventListener('blur', cancel);
    return () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('mousedown', down); removeEventListener('keydown', key); removeEventListener('blur', cancel); };
  }, [editor]);
  async function dropItem(event: React.DragEvent<HTMLElement>) {
    event.preventDefault(); setDropPreview(null); externalDrag.current = false;
    if (cancelledDrop.current || importing) return;
    const files = Array.from(event.dataTransfer.files);
    const text = event.dataTransfer.getData('text/plain');
    const position = canvasPoint(event.clientX, event.clientY);
    setImporting(true);
    try {
      const result = files.length ? await api.importDroppedFiles(files) : text ? { assets: [await api.createTextAsset({ name: '拖入文字', content: text })], errors: [] } : { assets: [], errors: [] };
      const objects: CanvasObject[] = [];
      for (const [index, asset] of result.assets.entries()) {
        try { objects.push(await makeObject(asset.kind === 'image' ? 'image' : asset.kind === 'text' ? 'text' : 'media', asset, { x: position.x + index * 28, y: position.y + index * 110 })); }
        catch (error) { result.errors.push({ name: asset.name, message: String(error) }); }
      }
      if (activeEditor.current !== editor) return;
      if (result.assets.length) editor.execute(draft => { draft.assets.push(...result.assets); draft.objects.push(...objects); });
      setSelected(objects.map(item => item.id)); setTool('select');
      if (result.errors.length) alert(result.errors.map(item => item.name + '：' + item.message).join('\n'));
    } catch (error) { alert('导入失败：' + String(error)); } finally { setImporting(false); }
  }
  function keyDown(event: KeyboardEvent) {
    if (!folder || noteId || creating || themeOpen || event.isComposing || event.key === 'Process') return;
    const playback = usePlaybackStore.getState().playback;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { if (selectedConnections.length) { editor.deleteConnections(selectedConnections); setSelectedConnections([]); } else if (selected.length) { editor.deleteObjects(selected); setSelected([]); } }
    if (event.ctrlKey && event.key.toLowerCase() === 'z') { event.preventDefault(); editor.undo(); }
    if (event.ctrlKey && event.key.toLowerCase() === 'y') { event.preventDefault(); editor.redo(); }
    if (event.ctrlKey && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(document.objects.map(item => item.id)); }
    if (event.ctrlKey && event.key.toLowerCase() === 'c') { event.preventDefault(); copiedIds.current = selected; }
    if (event.ctrlKey && event.key.toLowerCase() === 'v') { event.preventDefault(); if (copiedIds.current.length) setSelected(editor.duplicateObjects(copiedIds.current)); }
    if (event.ctrlKey && event.key.toLowerCase() === 'd') { event.preventDefault(); if (selected.length) setSelected(editor.duplicateObjects(selected)); }
    if (event.ctrlKey && event.key.toLowerCase() === 's') { event.preventDefault(); void autosave.current?.flush().catch(() => undefined); }
    if (event.key.toLowerCase() === 'm' && !event.ctrlKey && !event.metaKey && !event.repeat && playback && selected.length === 1 && selected[0] === playback.mediaId) { event.preventDefault(); editor.addMarker(playback.mediaId, playback.timeUs); useInteractionStore.getState().setSelectedMarker(null); }
    if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) spacePanUsed.current = false; spacePressed.current = true; }
  }
  function keyUp(event: KeyboardEvent) {
    if (!folder || noteId || creating || themeOpen || event.isComposing) return;
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
  const themeButton = <button onClick={() => setThemeOpen(true)}>{t('主题', 'Themes')}</button>;
  const themeModal = themeOpen ? <ThemePicker onClose={() => setThemeOpen(false)} /> : null;
  const selectedMedia = selectedObjects.length === 1 && selectedObjects[0].kind === 'media' ? selectedObjects[0] : null;
  const mergedInspector = selectedConnectionObjects.length
    ? <ConnectionInspector key={selectedConnections.join(',')} editor={editor} connections={selectedConnectionObjects}/>
    : <>{selectedMedia && <MediaControls document={document} editor={editor} trimMode={trimMode} onTrimMode={setTrimMode}/>}<ObjectInspector key={selected.join(',')} editor={editor} objects={selectedObjects}/></>;
  const currentNote = noteId ? document.notes.find(item => item.id === noteId) : null;
  function openNote(id: string, reading = false) { setOpenNoteIds(ids => ids.includes(id) ? ids : [...ids, id]); setReadingNoteId(reading ? id : null); setNoteId(id); }
  function closeNote(id: string) {
    const remaining = openNoteIds.filter(item => item !== id);
    setOpenNoteIds(remaining);
    if (noteId === id) setNoteId(remaining.at(-1) ?? null);
  }
  const createNote = () => { const id = editor.createNote(t('未命名笔记', 'Untitled note')); openNote(id); };
  const openNotes = () => { if (document.notes.length) openNote(document.notes[0].id); else createNote(); };
  if (!folder) return <main className="home">
    <header className="home-header"><strong>{t('音视频创作策划工作台', 'Media Planning Workbench')}</strong>{themeButton}{settings}</header>
    <div className="project-grid">
      {projects.map(project => {
        const name = project.name;
        const files: { name: string; meta: string; art: FolderArt; image?: string }[] = [];
        if (project.summary.objects) files.push({ name: t('画布', 'Canvas'), meta: `${project.summary.objects} ${t('个对象', 'objects')}`, art: 'none', image: project.preview.canvas });
        if (project.summary.assets) files.push({ name: t('素材', 'Assets'), meta: `${project.summary.assets} ${t('项素材', 'assets')}`, art: 'none', image: project.preview.media });
        if (project.summary.notes) files.push({ name: t('笔记', 'Notes'), meta: `${project.summary.notes} ${t('篇笔记', 'notes')}`, art: 'none', image: project.preview.note });
        const meta = project.status === 'invalid' ? t('项目文件无效', 'Invalid project') : files.length ? `${files.length} ${t('类内容', 'sections')}` : t('空项目', 'Empty project');
        return <GlassFolderCard key={`${project.folder}:${project.revision ?? 'invalid'}`} label={name} meta={meta} files={files} onOpen={() => openProject(project.folder)} />;
      })}
      <div className="home-create"><button className="project-card plus" aria-label={t('添加项目', 'Add project')} onClick={() => setHomeMenu(value => !value)}>+</button>
        {homeMenu && <div className="home-menu"><button onClick={() => { setHomeMenu(false); setCreating(true); setHomeError(''); }}>{t('新建项目', 'New project')}</button><button onClick={pickProjectFolder}>{t('打开项目文件夹', 'Open project folder')}</button></div>}
      </div>
    </div>
    {homeError && !creating && <div className="home-error" role="alert"><p>{homeError}</p>{retryProjectPath && <button onClick={() => void openProject(retryProjectPath)}>{t('重试打开', 'Retry open')}</button>}</div>}
    {creating && <div className="dialog-backdrop"><form className="project-dialog" onSubmit={event => { event.preventDefault(); void createProject(); }}>
      <h2>{t('新建项目', 'New project')}</h2><label htmlFor="project-name">{t('项目名称', 'Project name')}</label>
      <input id="project-name" autoFocus value={projectName} onChange={event => setProjectName(event.target.value)} maxLength={100} disabled={creatingPending} />
      {homeError && <p className="home-error" role="alert">{homeError}</p>}
      <div><button type="button" disabled={creatingPending} onClick={() => { setCreating(false); setHomeError(''); }}>{t('取消', 'Cancel')}</button><button type="submit" disabled={creatingPending}>{t('创建项目', 'Create project')}</button></div>
    </form></div>}
    {themeModal}
  </main>;
  return <div className="app" onContextMenu={event => event.preventDefault()} onDragOver={event => event.preventDefault()} onDrop={event => event.preventDefault()}><header>
    <button onClick={async () => { try { await autosave.current?.flush(); await api.leaveProject(); resetInteraction(); setFolder(null); setPlayback(null); setProjects(await api.listProjects()); } catch { setSaveState('保存失败'); } }}>{t('‹ 项目', '‹ Projects')}</button>
    <strong>{document.name}</strong><span>{saveState === '已保存' ? t('已保存', 'Saved') : saveState === '未保存' ? t('未保存', 'Unsaved') : saveState === '保存失败' ? t('保存失败', 'Save failed') : t('已载入恢复快照，请保存', 'Recovery loaded; please save')}</span>
    {saveState === '保存失败' && <button onClick={() => { void autosave.current?.flush().catch(() => undefined); }}>{t('重试保存', 'Retry save')}</button>}
    <button onClick={() => editor.undo()}>{t('撤销', 'Undo')}</button><button onClick={() => editor.redo()}>{t('重做', 'Redo')}</button><button onClick={openNotes}>{t('笔记', 'Notes')}</button>{themeButton}{settings}
  </header>{noteId && currentNote ? <div className="note-view"><div className="note-tabs">
    {openNoteIds.map(id => document.notes.find(note => note.id === id)).filter((note): note is ProjectDocument['notes'][number] => !!note).map(n => <div key={n.id} className={`note-tab${n.id === noteId ? ' active' : ''}`}><button onClick={() => setNoteId(n.id)}>{n.name || t('未命名', 'Untitled')}</button><button aria-label={t('关闭标签', 'Close tab')} onClick={() => closeNote(n.id)}>×</button></div>)}
    <button onClick={createNote}>＋ {t('笔记', 'Note')}</button>
  </div><Suspense fallback={<div className="note-paper">{t('正在打开笔记…', 'Opening note…')}</div>}><NoteEditor key={currentNote.id} note={currentNote} assets={document.assets} initialReadMode={readingNoteId === currentNote.id} onBack={() => setNoteId(null)} onChange={change => editor.updateNote(noteId!, change)} onImportImages={importNoteImages} /></Suspense></div> : <div className="workspace"><section ref={canvasRef} className="canvas" data-selected={selected.join(',')} style={{ backgroundSize: `${24 * document.camera.scale}px ${24 * document.camera.scale}px`, backgroundPosition: `${document.camera.x}px ${document.camera.y}px` }} onDragEnter={() => { if (!externalDrag.current) cancelledDrop.current = false; externalDrag.current = true; }} onDragOver={event => { event.preventDefault(); if (event.buttons & 2) { cancelledDrop.current = true; setDropPreview(null); } event.dataTransfer.dropEffect = cancelledDrop.current ? 'none' : 'copy'; if (!cancelledDrop.current) setDropPreview({ x: event.clientX, y: event.clientY, label: '松开放入素材' }); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { setDropPreview(null); externalDrag.current = false; } }} onDrop={dropItem}>
    <CanvasStage editor={editor} document={document} viewport={viewport} tool={tool} arrowRouting={arrowRouting} selected={selected} trimMode={trimMode} analysis={analysis} onSelect={setSelected} onTool={setTool} onSpacePan={() => { spacePanUsed.current = true; }} onOpenNote={id => openNote(id, true)}/>
    {importing && <div className="import-status" role="status">正在导入素材…</div>}
  </section><WorkspaceDock tools={<><input className="shape-search" aria-label={t('搜索图形', 'Search shapes')} placeholder={t('搜索图形', 'Search shapes')} value={shapeSearch} onChange={event => setShapeSearch(event.target.value)} />
    {Object.entries(shapeGroups).map(([group, kinds]) => {
      const matches = kinds.filter(kind => !shapeSearch || shapeLabels[kind].toLocaleLowerCase().includes(shapeSearch.toLocaleLowerCase()) || kind.toLocaleLowerCase().includes(shapeSearch.toLocaleLowerCase()));
      return matches.length ? <details className="shape-group" key={group} open={!!shapeSearch || !collapsedGroups.includes(group)}>
        <summary onClick={event => { event.preventDefault(); setCollapsedGroups(groups => groups.includes(group) ? groups.filter(item => item !== group) : [...groups, group]); }}>{group}</summary><div className="tool-grid">{matches.map(kind => <button key={kind} className="tool-tile" title={shapeLabels[kind]} aria-label={shapeLabels[kind]} onPointerDown={event => beginPlacement(event, kind as typeof shapeKinds[number])} onClick={() => void addObject(kind as typeof shapeKinds[number])}><ShapeIcon kind={kind}/><span>{shapeLabels[kind]}</span></button>)}</div>
      </details> : null;
    })}<div className="tool-grid">
    <button onPointerDown={event => beginPlacement(event, 'text')} onClick={() => void addObject('text')}>文字</button>
    <button aria-pressed={tool === 'arrow'} onClick={() => setTool('arrow')}>箭头</button><button aria-pressed={tool === 'brush'} onClick={() => setTool('brush')}>画笔</button><button aria-pressed={tool === 'select'} onClick={() => setTool('select')}>选择</button>
  </div>{tool === 'arrow' && <label className="arrow-routing">路径<select aria-label="箭头路径" value={arrowRouting} onChange={event => setArrowRouting(event.target.value as 'straight' | 'elbow')}><option value="straight">直线</option><option value="elbow">折线</option></select></label>}</>}
  library={<><button onClick={importAssets}>+ 导入素材</button><TextAssetCreator onCreate={createTextAsset}/><MediaTaskList document={document} analysis={analysis} onCancel={taskId => { void api.cancelTask(taskId); }} onRetry={retryAnalysis}/><AssetLibrary assets={document.assets} notes={document.notes} referencedIds={referencedIds} processingAssetIds={processingAssetIds} failedAssetIds={failedAssetIds} onPlace={beginPlacement} onAdd={addObject} onRelink={relinkAsset} onRemove={id => editor.removeAsset(id)} onOpenNote={openNote} onAddNote={id => { void addObject('note', id); }} onPlaceNote={(event, id) => beginPlacement(event, 'note', id)} onDuplicateNote={id => openNote(editor.duplicateNote(id))} onRemoveNote={id => { editor.deleteNote(id); closeNote(id); }}/></>}
  inspector={mergedInspector} autoOpenProperties={!!selectedMedia}/>
  </div>}{dropPreview && <div className="drop-ghost" style={{ left: dropPreview.x + 12, top: dropPreview.y + 12 }}>{dropPreview.image && <img src={dropPreview.image} alt=""/>}<span>{dropPreview.label}</span></div>}{themeModal}</div>;
}

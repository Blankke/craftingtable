import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pin } from 'lucide-react';
import { Editor } from '../core/editor';
import { CANVAS_TEXT_WIDTH, canvasTextFromMarkdown, canvasTextPlainText, emptyCanvasText } from '../core/canvasText';
import { fitCanvasText } from './canvas/canvasTextLayout';
import { canvasShortcut, withDefaultStyle } from './canvas/canvasCommands';
import { CANVAS_CLIPBOARD_MIME, copyCanvasSelection, pasteCanvasSelection } from '../core/canvasClipboard';
import { PROJECT_SCHEMA_VERSION, newDocument, objectAssetIds, type CanvasObject, type ProjectDocument } from '../core/document';
import { noteAssetIds } from '../core/note';
import { MediaControls } from './media/MediaControls';
import { Autosave } from '../core/autosave';
import { CanvasStage, type Tool } from './canvas/CanvasStage';
import { ObjectInspector } from './canvas/ObjectInspector';
import { ConnectionInspector } from './canvas/ConnectionInspector';
import { ShapeIcon } from './canvas/ShapeIcon';
import { GlassFolderCard, type FolderArt } from './home/GlassFolderCard';
const NoteEditor = lazy(() => import('./notes/NoteEditor').then(module => ({ default: module.NoteEditor })));
import { WorkspaceDock } from './workspace/WorkspaceDock';
import { WorkspaceModeSwitch, type WorkspaceMode } from './workspace/WorkspaceModeSwitch';
import { shapeKinds } from '../core/document';
import { shapeLabels } from '../core/appearance';
import { mediaSource } from './media/mediaSource';
import { AssetLibrary } from './media/AssetLibrary';
import { MediaTaskList } from './media/MediaTaskList';
import { TextAssetCreator } from './media/TextAssetCreator';
import { usePlaybackStore } from './media/playbackStore';
import { useTaskStore } from './media/taskStore';
import { useMediaAnalysis } from './media/useMediaAnalysis';
import { useInteractionStore } from './canvas/interactionStore';
import { SettingsPanel } from './shared/SettingsPanel';
import { useLanguage } from './shared/language';
import { useTheme } from './theme/themeStore';
import { autoTrackColor, colorToHex } from '../core/theme';
import { ThemePicker } from './theme/ThemePicker';
import { ThemeToggle } from './theme/ThemeToggle';
import { WorkbenchIcon } from './shared/WorkbenchIcon';
import { NotesWorkspace } from './notes/NotesWorkspace';
import { shapeGroups } from '../core/shapeGeometry';
import { useSplashStore } from './home/splashStore';
// main.tsx 在挂载前确认 preload 已就绪；渲染端只使用桌面 IPC。
const api = window.workbench!;
const createCanvasEditor = (document: ProjectDocument) => new Editor(document, fitCanvasText, withDefaultStyle);
function useEditor(editor: Editor): ProjectDocument { return useSyncExternalStore(editor.subscribe, () => editor.document); }

export function App() {
  const { t } = useLanguage();
  const { tokens, trackPalette } = useTheme();
  const ink = colorToHex(tokens.foreground);
  const accent = colorToHex(tokens.primary);
  const [projects, setProjects] = useState<Awaited<ReturnType<typeof api.listProjects>>>([]);
  const projectsRequest = useRef(0);
  const deletingProjects = useRef(new Set<string>());
  async function refreshProjects() {
    const request = ++projectsRequest.current;
    const items = await api.listProjects();
    if (request === projectsRequest.current) setProjects(items);
  }
  async function deleteProject(project: { folder: string; name: string }) {
    if (deletingProjects.current.has(project.folder)) return;
    if (!confirm(`确定删除项目“${project.name}”吗？此操作会删除项目目录及其中的素材，且无法恢复。`)) return;
    deletingProjects.current.add(project.folder); ++projectsRequest.current; setHomeError('');
    try {
      await api.deleteProject(project.folder);
      // 删除成功先移除卡片；刷新失败也不能让已删除项目重新出现在首页。
      setProjects(items => items.filter(item => item.folder !== project.folder));
      setRetryProjectPath(current => current === project.folder ? null : current);
    } catch (error) { setHomeError(String(error)); }
    finally {
      await refreshProjects().catch(error => setHomeError(String(error)));
      deletingProjects.current.delete(project.folder);
    }
  }
  const [homeMenu, setHomeMenu] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [creatingPending, setCreatingPending] = useState(false);
  const creatingLock = useRef(false);
  const [projectName, setProjectName] = useState('');
  const [homeError, setHomeError] = useState('');
  const [retryProjectPath, setRetryProjectPath] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [recoveredProject, setRecoveredProject] = useState(false);
  const [editor, setEditor] = useState(() => createCanvasEditor(newDocument('未命名项目')));
  const document = useEditor(editor);
  // 在首帧记住磁盘修订号，避免首次操作早于 passive effect 时被误判为已经保存。
  const loadedEditor = useRef({ editor, revision: editor.document.revision });
  if (loadedEditor.current.editor !== editor) loadedEditor.current = { editor, revision: editor.document.revision };
  const tool = useInteractionStore(state => state.tool);
  const setTool = useInteractionStore(state => state.setTool);
  const toolPersistent = useInteractionStore(state => state.toolPersistent);
  const chooseTool = (next: Tool, persistent = false) => { setTool(next, persistent); };
  const arrowRouting = useInteractionStore(state => state.arrowRouting);
  const setArrowRouting = useInteractionStore(state => state.setArrowRouting);
  const selected = useInteractionStore(state => state.selected);
  const setSelection = useInteractionStore(state => state.setSelection);
  const setSelected = useInteractionStore(state => state.setSelected);
  const resetInteraction = useInteractionStore(state => state.reset);
  const dismissSplash = useSplashStore(state => state.dismiss);
  const [saveState, setSaveState] = useState('已保存');
  const [themeOpen, setThemeOpen] = useState(false);
  const [inspectorRequested, setInspectorRequested] = useState(0);
  const [inspectorTab, setInspectorTab] = useState('样式');
  const [shapeSearch, setShapeSearch] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [readingNoteId, setReadingNoteId] = useState<string | null>(null);
  const [openNoteIds, setOpenNoteIds] = useState<string[]>([]);
  // 工作台模式由 App 显式持有，不再用 noteId !== null 隐式判断；模式不写入项目数据。
  const [libraryRequested, setLibraryRequested] = useState(0);
  const [mode, setMode] = useState<WorkspaceMode>('canvas');
  const playbackMediaId = usePlaybackStore(state => state.playback?.mediaId);
  const setPlayback = usePlaybackStore(state => state.setPlayback);
  const trimMode = useInteractionStore(state => state.trimMode);
  const setTrimMode = useInteractionStore(state => state.setTrimMode);
  const analysis = useTaskStore(state => state.analysis);
  const retryAnalysis = useTaskStore(state => state.retry);
  useMediaAnalysis(editor, folder);
  const canvasRef = useRef<HTMLElement | null>(null);
  const activeEditor = useRef(editor); activeEditor.current = editor;
  const [dropPreview, setDropPreview] = useState<{ x: number; y: number; label: string; image?: string; shape?: typeof shapeKinds[number]; note?: boolean } | null>(null);
  const [placementGhost, setPlacementGhost] = useState<CanvasObject | null>(null);
  const placement = useRef<{ kind: Tool | 'media' | 'image' | 'note'; assetId?: string; x: number; y: number; moved: boolean; object?: CanvasObject; ready: Promise<CanvasObject> } | null>(null);
  const suppressClick = useRef(false);
  const cancelledDrop = useRef(false);
  const externalDrag = useRef(false);
  const [importing, setImporting] = useState(false);
  const [viewport, setViewport] = useState({ width: innerWidth - 300, height: innerHeight - 60 });
  const autosave = useRef<Autosave | null>(null);
  // 首页和打开失败时也要响应关闭请求；没有活动编辑器就没有待保存修改。
  useEffect(() => api.onFlushRequest(async () => {
    const focused = globalThis.document.activeElement;
    if (focused instanceof HTMLElement) focused.blur();
    await Promise.resolve();
    try { await autosave.current?.flush(); return true; } catch { return false; }
  }), []);
  const lastCanvasPointer = useRef<{ x: number; y: number } | null>(null);
  const spacePanUsed = useRef(false);
  const spacePressed = useRef(false);
  useEffect(() => { void refreshProjects().catch(error => setHomeError(`${t('读取项目失败', 'Could not load projects')}：${String(error)}`)); }, []);
  useEffect(() => {
    if (!folder || !canvasRef.current) return;
    const observer = new ResizeObserver(entries => { const box = entries[0].contentRect; setViewport({ width: box.width, height: box.height }); });
    observer.observe(canvasRef.current); return () => observer.disconnect();
  }, [folder, mode]);
  useEffect(() => {
    // 媒体工作区跟随当前选择，防止误操作其他轨道。
    const media = selected.length === 1 ? editor.document.objects.find(item => item.id === selected[0]) : undefined;
    const current = usePlaybackStore.getState().playback;
    if (media?.kind === 'media') { if (current?.mediaId !== media.id) setPlayback({ mediaId: media.id, timeUs: media.inUs, play: false }); }
    else if (current) setPlayback(null);
  }, [selected, editor, document.objects]);
  useEffect(() => {
    if (!folder) return;
    const scheduler = new Autosave(snapshot => api.saveProject(snapshot), setSaveState, loadedEditor.current.revision - (recoveredProject ? 1 : 0));
    autosave.current = scheduler;
    const unsubscribe = editor.subscribe(() => scheduler.schedule(editor.document));
    // 覆盖订阅建立前的修改；恢复快照本身也需要落回主文件。
    scheduler.schedule(editor.document);
    const removeRestartListener = api.onBackendRestart(() => { void scheduler.flush().catch(() => undefined); });
    return () => { unsubscribe(); removeRestartListener(); scheduler.dispose(); if (autosave.current === scheduler) autosave.current = null; };
  }, [editor, folder, recoveredProject]);
  const selectedObjects = document.objects.filter(item => selected.includes(item.id));
  const selectedConnections = useInteractionStore(state => state.selectedConnections);
  const selectedConnectionObjects = document.connections.filter(item => selectedConnections.includes(item.id));
  const referencedIds = new Set([
    ...document.objects.flatMap(objectAssetIds),
    ...document.notes.flatMap(note => noteAssetIds(note))
  ]);
  const processingAssetIds = new Set(document.objects.flatMap(object => object.kind === 'media' && analysis[object.id]?.processing ? [object.assetId] : []));
  const failedAssetIds = new Set(document.objects.flatMap(object => object.kind === 'media' && analysis[object.id]?.error ? [object.assetId] : []));
  useEffect(() => { setTrimMode(false); }, [playbackMediaId]);
  async function checkDesktopVersion() {
    const settings = await api.getSettings();
    if (settings.documentSchemaVersion !== PROJECT_SCHEMA_VERSION) throw Error(t('桌面程序已更新，请关闭当前窗口并重新运行 npm.cmd run dev，再打开项目。', 'The desktop runtime changed. Close this window and restart npm run dev before opening the project.'));
  }
  async function createProject() {
    if (creatingLock.current) return;
    const name = projectName.trim();
    if (!name) { setHomeError(t('请输入项目名称', 'Enter a project name')); return; }
    creatingLock.current = true; setCreatingPending(true); setHomeError('');
    try {
      if (renamingFolder) {
        await api.renameProject(renamingFolder, name);
        await refreshProjects(); setRenamingFolder(null); setProjectName('');
        return;
      }
      await checkDesktopVersion();
      const created = await api.createProject(name);
      const next = createCanvasEditor(newDocument(name));
      await api.saveProject(next.document);
      await refreshProjects();
      resetInteraction(); setPlayback(null); setRecoveredProject(false); setFolder(created); setEditor(next); dismissSplash();
      setCreating(false); setHomeMenu(false); setHomeError(''); setProjectName('');
    } catch (error) { await api.leaveProject().catch(() => undefined); setHomeError(`${t('新建项目失败', 'Could not create project')}：${String(error)}`); }
    finally { creatingLock.current = false; setCreatingPending(false); }
  }
  async function openProject(path: string, section?: 'canvas' | 'assets' | 'notes') {
    try {
      setHomeError(''); setRetryProjectPath(null);
      await checkDesktopVersion();
      const loaded = await api.openProject(path);
      resetInteraction(); setPlayback(null); setRecoveredProject(!!loaded.recovered); setEditor(createCanvasEditor(loaded)); setFolder(path); dismissSplash();
      if (section === 'notes' && loaded.notes.length) {
        const id = loaded.notes[0].id;
        setOpenNoteIds([id]); setNoteId(id); setReadingNoteId(null); setMode('notes');
      } else if (section) setMode('canvas');
      setLibraryRequested(value => section === 'assets' ? value + 1 : 0);
      setSaveState(loaded.recovered ? '已载入恢复快照，请保存' : '已保存');
    } catch (error) { await api.leaveProject().catch(() => undefined); setHomeError(`${t('打开项目失败', 'Could not open project')}：${String(error)}`); setRetryProjectPath(path); }
  }
  async function pickProjectFolder() {
    setHomeMenu(false);
    try {
      await checkDesktopVersion();
      const selected = await api.pickProjectFolder();
      if (!selected) return;
      resetInteraction(); setPlayback(null); setRecoveredProject(!!selected.document.recovered); setEditor(createCanvasEditor(selected.document)); setFolder(selected.folder); dismissSplash();
      setSaveState(selected.document.recovered ? '已载入恢复快照，请保存' : '已保存');
    } catch (error) { await api.leaveProject().catch(() => undefined); alert(`${t('打开项目文件夹失败', 'Could not open project folder')}：${String(error)}`); }
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
    return withDefaultStyle(await makeBaseObject(kind, asset, position));
  }
  async function makeBaseObject(kind: Tool | 'media' | 'image', asset: ProjectDocument['assets'][number] | undefined, position?: { x: number; y: number }): Promise<CanvasObject> {
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
    if (kind === 'text') return { ...common, kind, width: CANVAS_TEXT_WIDTH, height: 42, text: asset ? canvasTextFromMarkdown(asset.content ?? '') : emptyCanvasText(), fontSize: 18, color: ink, align: 'left', ...(asset ? { assetId: asset.id } : {}) };
    return { ...common, kind: shapeKinds.includes(kind as typeof shapeKinds[number]) ? kind as typeof shapeKinds[number] : 'rectangle', fill: 'transparent', stroke: accent, text: emptyCanvasText(), fontSize: 18, color: ink, align: 'center', style: { fillEnabled: false, fill: 'transparent', gradient: false, gradientColor: accent, gradientDirection: 'vertical', strokeEnabled: true, stroke: accent, strokeWidth: 1.5, dash: 'solid', perimeter: 0, opacity: 1, fontFamily: 'Microsoft YaHei', bold: false, italic: false, underline: false, verticalAlign: 'middle' } };
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
    const ready: Promise<CanvasObject> = kind === 'note'
      ? Promise.resolve(withDefaultStyle({ id: crypto.randomUUID(), kind: 'note', noteId: assetId!, x: 0, y: 0, width: 180, height: 120, groupId: null }))
      : makeObject(kind, editor.document.assets.find(asset => asset.id === assetId));
    const item = { kind, assetId, x: event.clientX, y: event.clientY, moved: false, ready, object: undefined as CanvasObject | undefined };
    placement.current = item;
    void ready.then(object => { item.object = object; }).catch(() => { if (placement.current === item) placement.current = null; });
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  useEffect(() => {
    // 拖放只吞掉本次手势尾随的 click；新的按下或键盘激活不继承抑制状态。
    const resetClick = () => { suppressClick.current = false; };
    const consumeClick = (event: MouseEvent) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      if (event.detail > 0) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const move = (event: PointerEvent) => {
      const item = placement.current; if (!item) return;
      if (Math.hypot(event.clientX - item.x, event.clientY - item.y) > 4) item.moved = true;
      if (!item.moved) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect && item.object && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
        setPlacementGhost({ ...item.object, ...canvasPoint(event.clientX, event.clientY) });
        setDropPreview(null);
        return;
      }
      setPlacementGhost(null);
      const asset = editor.document.assets.find(a => a.id === item.assetId);
      const note = item.kind === 'note' ? editor.document.notes.find(value => value.id === item.assetId) : null;
      setDropPreview({ x: event.clientX, y: event.clientY, label: note?.name ?? asset?.name ?? (item.kind in shapeLabels ? shapeLabels[item.kind as keyof typeof shapeLabels] : '文字'), image: asset?.kind === 'image' ? mediaSource(asset.path) : undefined, shape: shapeKinds.includes(item.kind as typeof shapeKinds[number]) ? item.kind as typeof shapeKinds[number] : undefined, note: item.kind === 'note' });
    };
    const cancel = () => { if (placement.current) suppressClick.current = true; placement.current = null; cancelledDrop.current = true; setDropPreview(null); setPlacementGhost(null); };
    const down = (event: MouseEvent) => { if (event.button === 2) cancel(); };
    const up = (event: PointerEvent) => {
      const item = placement.current; placement.current = null; setDropPreview(null); setPlacementGhost(null);
      if (!item?.moved || event.button !== 0) return;
      suppressClick.current = true;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
        const point = canvasPoint(event.clientX, event.clientY);
        void item.ready.then(object => {
          if (activeEditor.current !== editor) return;
          editor.addObject({ ...object, ...point });
          setSelected([object.id]); setTool('select');
        }).catch(error => alert('无法放入素材：' + String(error)));
      }
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    addEventListener('pointerdown', resetClick, true); addEventListener('click', consumeClick, true);
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', cancel); addEventListener('mousedown', down); addEventListener('keydown', key); addEventListener('blur', cancel);
    return () => { removeEventListener('pointerdown', resetClick, true); removeEventListener('click', consumeClick, true); removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', cancel); removeEventListener('mousedown', down); removeEventListener('keydown', key); removeEventListener('blur', cancel); };
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
    if (!folder || mode !== 'canvas' || creating || themeOpen || event.isComposing || event.key === 'Process') return;
    const playback = usePlaybackStore.getState().playback;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
    if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[data-edit-menu],dialog'))) return;
    if (event.key === 'Escape') { chooseTool('select'); return; }
    if (canvasShortcut(event, editor, selected)) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { editor.deleteObjects(selected, selectedConnections); setSelection([], []); }
    if (event.ctrlKey && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) editor.redo(); else editor.undo(); }
    if (event.ctrlKey && event.key.toLowerCase() === 'y') { event.preventDefault(); editor.redo(); }
    if (event.ctrlKey && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelection(document.objects.map(item => item.id), document.connections.map(item => item.id)); }
    if (event.ctrlKey && event.key.toLowerCase() === 'd') { event.preventDefault(); const pasted = pasteCanvasSelection(editor, copyCanvasSelection(editor, selected, selectedConnections)); setSelection(pasted.objects, pasted.connections); }
    if (event.ctrlKey && event.key.toLowerCase() === 's') { event.preventDefault(); void autosave.current?.flush().catch(() => undefined); }
    if (event.key.toLowerCase() === 'm' && !event.ctrlKey && !event.metaKey && !event.repeat && playback && selected.length === 1 && selected[0] === playback.mediaId) { event.preventDefault(); editor.addMarker(playback.mediaId, playback.timeUs); useInteractionStore.getState().setSelectedMarker(null); }
    if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) spacePanUsed.current = false; spacePressed.current = true; }
  }
  function keyUp(event: KeyboardEvent) {
    if (!folder || mode !== 'canvas' || creating || themeOpen || event.isComposing) return;
    if (event.code !== 'Space' || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return;
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
  useEffect(() => {
    const inField = (target: EventTarget | null) => target instanceof HTMLElement && (!!target.closest('input,textarea,select,[contenteditable="true"]'));
    const trackPointer = (event: PointerEvent) => { lastCanvasPointer.current = { x: event.clientX, y: event.clientY }; };
    const copy = (event: ClipboardEvent) => {
      if (!folder || mode !== 'canvas' || inField(event.target) || (!selected.length && !selectedConnections.length) || !event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData(CANVAS_CLIPBOARD_MIME, JSON.stringify(copyCanvasSelection(editor, selected, selectedConnections)));
      event.clipboardData.setData('text/plain', editor.document.objects.filter(item => selected.includes(item.id)).map(item => 'text' in item ? canvasTextPlainText(item.text) : '').filter(Boolean).join('\n'));
      if (event.type === 'cut') { editor.deleteObjects(selected, selectedConnections); setSelection([], []); }
    };
    const pastePosition = () => {
      const rect = canvasRef.current!.getBoundingClientRect(), pointer = lastCanvasPointer.current;
      const camera = editor.document.camera;
      const inside = pointer && pointer.x >= rect.left && pointer.x <= rect.right && pointer.y >= rect.top && pointer.y <= rect.bottom;
      return {
        x: inside ? (pointer.x - rect.left - camera.x) / camera.scale : (rect.width / 2 - camera.x) / camera.scale - CANVAS_TEXT_WIDTH / 2,
        y: inside ? (pointer.y - rect.top - camera.y) / camera.scale : (rect.height / 2 - camera.y) / camera.scale
      };
    };
    const pasteImages = async (files: File[], position: { x: number; y: number }) => {
      setImporting(true);
      try {
        const result = await api.importDroppedFiles(files);
        if (activeEditor.current !== editor) return;
        const objects: CanvasObject[] = [];
        for (const [index, asset] of result.assets.entries()) {
          if (asset.kind !== 'image') continue;
          try { objects.push(await makeObject('image', asset, { x: position.x + index * 24, y: position.y + index * 24 })); }
          catch (error) { result.errors.push({ name: asset.name, message: String(error) }); }
        }
        if (activeEditor.current !== editor) return;
        // 素材与画布对象一次写入，粘贴对应一次撤销；原始图片文件保留在项目 assets 内。
        if (result.assets.length) editor.execute(draft => { draft.assets.push(...result.assets); draft.objects.push(...objects); });
        if (objects.length) { setSelected(objects.map(object => object.id)); setTool('select'); }
        if (result.errors.length) alert(result.errors.map(item => item.name + '：' + item.message).join('\n'));
      } catch (error) { alert(t('粘贴图片失败', 'Could not paste image') + '：' + String(error)); }
      finally { setImporting(false); }
    };
    const paste = (event: ClipboardEvent) => {
      if (!folder || mode !== 'canvas' || creating || themeOpen || event.defaultPrevented || inField(event.target) || !event.clipboardData) return;
      const internal = event.clipboardData.getData(CANVAS_CLIPBOARD_MIME);
      if (internal) {
        try {
          const copied = JSON.parse(internal) as ProjectDocument;
          if (copied.id === editor.document.id) {
            event.preventDefault(); const pasted = pasteCanvasSelection(editor, copied); setSelection(pasted.objects, pasted.connections); return;
          }
        } catch { /* 外部剪贴板自定义数据无效时继续读取普通文字。 */ }
      }
      const images = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
      if (images.length) { event.preventDefault(); void pasteImages(images, pastePosition()); return; }
      const source = event.clipboardData.getData('text/plain');
      if (!source.trim()) return;
      event.preventDefault();
      const object: CanvasObject = { id: crypto.randomUUID(), kind: 'text', ...pastePosition(), width: CANVAS_TEXT_WIDTH, height: 42, groupId: null, text: canvasTextFromMarkdown(source), fontSize: 18, color: ink, align: 'left' };
      editor.addObject(object); setSelected([object.id]); setTool('select');
    };
    addEventListener('pointermove', trackPointer); addEventListener('copy', copy); addEventListener('cut', copy); addEventListener('paste', paste);
    return () => { removeEventListener('pointermove', trackPointer); removeEventListener('copy', copy); removeEventListener('cut', copy); removeEventListener('paste', paste); };
  }, [editor, folder, mode, selected, selectedConnections, creating, themeOpen, ink]);
  const settings = <SettingsPanel onRootChange={refreshProjects} />;
  const themeButton = <button type="button" className="nav-icon-button" aria-label={t('主题', 'Themes')} title={t('主题', 'Themes')} onClick={() => setThemeOpen(true)}><WorkbenchIcon name="palette" size={16} /><span>{t('主题', 'Themes')}</span></button>;
  const themeToggle = <ThemeToggle />;
  const themeModal = themeOpen ? <ThemePicker onClose={() => setThemeOpen(false)} /> : null;
  const selectedMedia = selectedObjects.length === 1 && selectedObjects[0].kind === 'media' ? selectedObjects[0] : null;
  const mergedInspector = selectedConnectionObjects.length
    ? <ConnectionInspector key={selectedConnections.join(',')} editor={editor} connections={selectedConnectionObjects}/>
    : <>{selectedMedia && <MediaControls document={document} editor={editor} trimMode={trimMode} onTrimMode={setTrimMode}/>}<ObjectInspector key={selected.join(',')} editor={editor} objects={selectedObjects} assets={document.assets} requestedTab={inspectorTab} request={inspectorRequested}/></>;
  const currentNote = noteId ? document.notes.find(item => item.id === noteId) : null;
  function openNote(id: string, reading = false) { setOpenNoteIds(ids => ids.includes(id) ? ids : [...ids, id]); setReadingNoteId(reading ? id : null); setNoteId(id); setMode('notes'); }
  function closeNote(id: string) {
    const remaining = openNoteIds.filter(item => item !== id);
    setOpenNoteIds(remaining);
    if (noteId === id) {
      const next = remaining.at(-1) ?? null;
      setNoteId(next);
      // 关闭最后一个标签回到画布；其余情况保留当前笔记与标签。
      if (!next) setMode('canvas');
    }
  }
  const createNote = () => { const id = editor.createNote(t('未命名笔记', 'Untitled note')); openNote(id); };
  const openNotes = () => { if (document.notes.length) openNote(document.notes[0].id); else createNote(); };
  // 切换器统一控制模式；切到笔记但当前笔记无效（未打开或已被删除）时，先恢复或自动创建一篇。
  const changeMode = (next: WorkspaceMode) => {
    if (next === 'notes' && !currentNote) openNotes();
    setMode(next);
  };
  if (!folder) return <main className="home">
    <header className="home-header"><strong>{t('工作台', 'Media Planning Workbench')}</strong><div className="header-actions">{themeToggle}{themeButton}{settings}</div></header>
    <div className="project-grid">
      {projects.map(project => {
        const name = project.name;
        const files: { section: 'canvas' | 'assets' | 'notes'; name: string; meta: string; art: FolderArt; image?: string }[] = [];
        if (project.summary.objects) files.push({ section: 'canvas', name: t('画布', 'Canvas'), meta: `${project.summary.objects} ${t('个对象', 'objects')}`, art: 'none', image: project.preview.canvas });
        if (project.summary.assets) files.push({ section: 'assets', name: t('素材', 'Assets'), meta: `${project.summary.assets} ${t('项素材', 'assets')}`, art: 'none', image: project.preview.media });
        if (project.summary.notes) files.push({ section: 'notes', name: t('笔记', 'Notes'), meta: `${project.summary.notes} ${t('篇笔记', 'notes')}`, art: 'none', image: project.preview.note });
        const meta = project.status === 'invalid' ? t('项目文件无效', 'Invalid project') : files.length ? `${files.length} ${t('类内容', 'sections')}` : t('空项目', 'Empty project');
        return <GlassFolderCard key={project.folder} label={name} meta={meta} files={files} onOpen={() => openProject(project.folder)} onOpenSection={index => void openProject(project.folder, files[index].section)} onReveal={() => { void api.revealProject(project.folder).catch(error => setHomeError(String(error))); }} onDelete={() => { void deleteProject(project); }} onRename={() => { setRenamingFolder(project.folder); setProjectName(name); setHomeError(''); }} />;
      })}
      <div className="home-create"><button className="project-card plus" aria-label={t('添加项目', 'Add project')} onClick={() => setHomeMenu(value => !value)}>+</button>
        {homeMenu && <div className="home-menu"><button onClick={() => { setHomeMenu(false); setCreating(true); setHomeError(''); }}>{t('新建项目', 'New project')}</button><button onClick={pickProjectFolder}>{t('打开项目文件夹', 'Open project folder')}</button></div>}
      </div>
    </div>
    {homeError && !creating && <div className="home-error" role="alert"><p>{homeError}</p>{retryProjectPath && <button onClick={() => void openProject(retryProjectPath)}>{t('重试打开', 'Retry open')}</button>}</div>}
    {(creating || renamingFolder) && <div className="dialog-backdrop"><form className="project-dialog" onSubmit={event => { event.preventDefault(); void createProject(); }}>
      <h2>{renamingFolder ? t('重命名项目', 'Rename project') : t('新建项目', 'New project')}</h2><label htmlFor="project-name">{t('项目名称', 'Project name')}</label>
      <input id="project-name" autoFocus value={projectName} onChange={event => setProjectName(event.target.value)} maxLength={100} disabled={creatingPending} />
      {homeError && <p className="home-error" role="alert">{homeError}</p>}
      <div><button type="button" disabled={creatingPending} onClick={() => { setCreating(false); setRenamingFolder(null); setProjectName(''); setHomeError(''); }}>{t('取消', 'Cancel')}</button><button type="submit" disabled={creatingPending}>{renamingFolder ? t('保存名称', 'Save name') : t('创建项目', 'Create project')}</button></div>
    </form></div>}
    {themeModal}
  </main>;
  return <div className="app" onContextMenu={event => event.preventDefault()} onDragOver={event => event.preventDefault()} onDrop={event => event.preventDefault()}><header className="workspace-header">
    <nav className="workspace-nav-left" aria-label={t('工作台导航', 'Workbench navigation')}><button type="button" onClick={async () => {  try { await autosave.current?.flush(); await api.leaveProject(); resetInteraction(); setFolder(null); setPlayback(null); await refreshProjects(); } catch { setSaveState('保存失败'); } }}>{t('‹ 项目', '‹ Projects')}</button><WorkspaceModeSwitch mode={mode} onModeChange={changeMode} /></nav>
    <div className="workspace-header-center"><strong>{document.name}</strong><span>{saveState === '已保存' ? t('已保存', 'Saved') : saveState === '未保存' ? t('未保存', 'Unsaved') : saveState === '保存失败' ? t('保存失败', 'Save failed') : t('已载入恢复快照，请保存', 'Recovery loaded; please save')}</span></div>
    <nav className="workspace-nav-actions" aria-label={t('编辑操作', 'Editing actions')}>
      {saveState === '保存失败' && <button type="button" onClick={() => { void autosave.current?.flush().catch(() => undefined); }}>{t('重试保存', 'Retry save')}</button>}
      <button type="button" className="nav-icon-button" aria-label={t('撤销', 'Undo')} title={t('撤销', 'Undo')} onClick={() => editor.undo()}><WorkbenchIcon name="undo" size={16} /><span>{t('撤销', 'Undo')}</span></button>
      <button type="button" className="nav-icon-button" aria-label={t('重做', 'Redo')} title={t('重做', 'Redo')} onClick={() => editor.redo()}><WorkbenchIcon name="redo" size={16} /><span>{t('重做', 'Redo')}</span></button>
      {themeToggle}{themeButton}{settings}
    </nav>
  </header>{mode === 'notes' && currentNote ? <NotesWorkspace notes={document.notes} activeId={currentNote.id} openIds={openNoteIds} onOpen={id => openNote(id)} onClose={closeNote} onCreate={createNote} onDuplicate={id => openNote(editor.duplicateNote(id))} onDelete={id => { editor.deleteNote(id); closeNote(id); }}>
    <Suspense fallback={<div className="note-paper">{t('正在打开笔记…', 'Opening note…')}</div>}><NoteEditor key={currentNote.id} note={currentNote} assets={document.assets} notes={document.notes} onOpenNote={openNote} initialReadMode={readingNoteId === currentNote.id} onChange={change => editor.updateNote(currentNote.id, change)} onImportImages={importNoteImages} onMoveSelection={(targetId, remaining, selected) => editor.moveNoteSelection(currentNote.id, targetId, remaining, selected)} /></Suspense>
  </NotesWorkspace> : <div className="workspace"><section ref={canvasRef} className="canvas" data-placement-preview={placementGhost?.kind} data-selected={selected.join(',')} style={{ backgroundSize: `${24 * document.camera.scale}px ${24 * document.camera.scale}px`, backgroundPosition: `${document.camera.x}px ${document.camera.y}px` }} onDragEnter={() => { if (!externalDrag.current) cancelledDrop.current = false; externalDrag.current = true; }} onDragOver={event => { event.preventDefault(); if (event.buttons & 2) { cancelledDrop.current = true; setDropPreview(null); } event.dataTransfer.dropEffect = cancelledDrop.current ? 'none' : 'copy'; if (!cancelledDrop.current) setDropPreview({ x: event.clientX, y: event.clientY, label: '松开放入素材' }); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { setDropPreview(null); externalDrag.current = false; } }} onDrop={dropItem}>
    <CanvasStage editor={editor} document={document} viewport={viewport} tool={tool} arrowRouting={arrowRouting} selected={selected} trimMode={trimMode} analysis={analysis} onSelect={setSelected} onTool={setTool} onSpacePan={() => { spacePanUsed.current = true; }} onOpenNote={id => openNote(id, true)} placementGhost={placementGhost} onOpenInspector={(tab = '样式') => { setInspectorTab(tab); setInspectorRequested(value => value + 1); }}/>
    {importing && <div className="import-status" role="status">正在导入素材…</div>}
  </section><WorkspaceDock tools={<><div className="canvas-basic-tools">
    <button title={t('选择', 'Select')} aria-label={t('选择', 'Select')} aria-pressed={tool === 'select'} onClick={() => chooseTool('select')}><WorkbenchIcon name="select" /></button>
    {(['text', 'arrow', 'brush'] as const).map(kind => {
      const label = kind === 'text' ? t('文字', 'Text') : kind === 'arrow' ? t('箭头', 'Arrow') : t('画笔', 'Brush');
      const persistent = tool === kind && toolPersistent;
      return <button key={kind} title={`${label} · ${t('双击持续使用，Esc 退出', 'Double-click to keep using; Esc to exit')}`} aria-label={label} aria-pressed={tool === kind} aria-describedby={persistent ? 'persistent-tool-hint' : undefined} data-persistent={persistent || undefined}
        onPointerDown={kind === 'text' ? event => beginPlacement(event, 'text') : undefined}
        onClick={() => { if (!suppressClick.current) chooseTool(kind); }}
        onDoubleClick={() => { if (kind === 'text') void addObject('text').then(() => chooseTool(kind, true)); else chooseTool(kind, true); }}
        onKeyDown={event => { if (event.shiftKey && event.key === 'Enter') { event.preventDefault(); chooseTool(kind, true); } }}>
        <WorkbenchIcon name={kind} />{persistent && <Pin className="tool-persistent-mark" size={11} aria-hidden="true" />}
      </button>;
    })}
  </div>{toolPersistent && <p id="persistent-tool-hint" className="tool-persistent-hint" role="status">{t('持续使用 · Esc 退出', 'Keep using · Esc to exit')}</p>}{tool === 'arrow' && <label className="arrow-routing">{t('路径', 'Path')}<select aria-label={t('箭头路径', 'Arrow path')} value={arrowRouting} onChange={event => setArrowRouting(event.target.value as 'straight' | 'elbow')}><option value="straight">{t('直线', 'Straight')}</option><option value="elbow">{t('折线', 'Elbow')}</option></select></label>}<input className="shape-search" aria-label={t('搜索图形', 'Search shapes')} placeholder={t('搜索图形', 'Search shapes')} value={shapeSearch} onChange={event => setShapeSearch(event.target.value)} />
    {Object.entries(shapeGroups).map(([group, kinds]) => {
      const matches = kinds.filter(kind => !shapeSearch || shapeLabels[kind].toLocaleLowerCase().includes(shapeSearch.toLocaleLowerCase()) || kind.toLocaleLowerCase().includes(shapeSearch.toLocaleLowerCase()));
      return matches.length ? <details className="shape-group" key={group} open={!!shapeSearch || !collapsedGroups.includes(group)}>
        <summary onClick={event => { event.preventDefault(); setCollapsedGroups(groups => groups.includes(group) ? groups.filter(item => item !== group) : [...groups, group]); }}>{group}</summary><div className="tool-grid">{matches.map(kind => <button key={kind} className="tool-tile" title={shapeLabels[kind]} aria-label={shapeLabels[kind]} onPointerDown={event => beginPlacement(event, kind as typeof shapeKinds[number])} aria-pressed={tool === kind} onClick={() => { if (!suppressClick.current) chooseTool(kind); }} onDoubleClick={() => void addObject(kind)}><ShapeIcon kind={kind}/><span>{shapeLabels[kind]}</span></button>)}</div>
      </details> : null;
    })}</>}
  library={<><button onClick={importAssets}>+ 导入素材</button><TextAssetCreator onCreate={createTextAsset}/><MediaTaskList document={document} analysis={analysis} onCancel={taskId => { void api.cancelTask(taskId); }} onRetry={retryAnalysis}/><AssetLibrary assets={document.assets} notes={document.notes} referencedIds={referencedIds} processingAssetIds={processingAssetIds} failedAssetIds={failedAssetIds} onPlace={beginPlacement} onAdd={addObject} onRelink={relinkAsset} onReveal={path => { void api.revealAsset(path).catch(error => setSaveState(`${t('无法显示素材文件', 'Could not reveal asset')}: ${String(error)}`)); }} onRemove={async id => { const asset = editor.document.assets.find(item => item.id === id); if (!asset) return; try { await api.removeAsset(asset.path); editor.removeAsset(id); } catch (error) { setSaveState(`${t('移除素材失败', 'Could not remove asset')}: ${String(error)}`); } }} onOpenNote={id => { if (!suppressClick.current) openNote(id); }} onAddNote={id => { void addObject('note', id); }} onPlaceNote={(event, id) => beginPlacement(event, 'note', id)} onDuplicateNote={id => openNote(editor.duplicateNote(id))} onRemoveNote={id => { editor.deleteNote(id); closeNote(id); }}/></>}
  inspector={mergedInspector} autoOpenProperties={!!selectedMedia} propertiesRequest={inspectorRequested} libraryRequest={libraryRequested}/>
  </div>}{dropPreview && <div className={`drop-ghost${dropPreview.shape ? ' drop-ghost-shape' : ''}${dropPreview.note ? ' drop-ghost-note' : ''}`} style={{ left: dropPreview.x + 12, top: dropPreview.y + 12 }}>{dropPreview.image && <img src={dropPreview.image} alt=""/>}{dropPreview.shape ? <ShapeIcon kind={dropPreview.shape}/> : dropPreview.note ? <><strong>{dropPreview.label}</strong><span>笔记</span></> : <span>{dropPreview.label}</span>}</div>}{themeModal}</div>;
}

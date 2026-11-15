// 使用示例：npm run dev，在浏览器新建项目并导入本地素材。数据保存在当前浏览器的 IndexedDB 中。
import { documentSchema, type ProjectDocument } from '../core/document';

type Asset = ProjectDocument['assets'][number];
const databaseName = 'media-planning-workbench';
const sources = new Map<string, string>();
let activeFolder: string | null = null;

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('projects', { keyPath: 'folder' });
      db.createObjectStore('files', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact<T>(storeName: 'projects' | 'files', mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    transaction.oncomplete = () => { db.close(); resolve(request.result); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}

function chooseFiles(multiple: boolean): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = '.mp4,.mov,.mkv,.mp3,.wav,.jpg,.jpeg,.png,.txt';
    input.style.display = 'none';
    document.body.append(input);
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(files);
    };
    // 浏览器取消文件选择时不会触发 change；窗口重新获得焦点后结束本次选择。
    const onFocus = () => setTimeout(() => { if (!input.files?.length) finish([]); }, 300);
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])), { once: true });
    window.addEventListener('focus', onFocus, { once: true });
    input.click();
  });
}

function mediaKind(file: File): Asset['kind'] | null {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (['.mp4', '.mov', '.mkv'].includes(extension)) return 'video';
  if (['.mp3', '.wav'].includes(extension)) return 'audio';
  if (['.jpg', '.jpeg', '.png'].includes(extension)) return 'image';
  if (extension === '.txt') return 'text';
  return null;
}

function clearSources(): void {
  for (const url of sources.values()) URL.revokeObjectURL(url);
  sources.clear();
}

async function storeFile(file: File, folder: string): Promise<Asset> {
  const kind = mediaKind(file);
  if (!kind) throw Error('不支持的素材类型');
  const id = crypto.randomUUID();
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  const assetPath = `assets/${id}${extension}`;
  await transact('files', 'readwrite', store => store.put({ key: `${folder}/${assetPath}`, blob: file }));
  sources.set(assetPath, URL.createObjectURL(file));
  const content = kind === 'text' ? await file.text() : undefined;
  return { id, name: file.name, path: assetPath, kind, status: 'ready', content };
}

async function hydrate(folder: string, project: ProjectDocument): Promise<void> {
  clearSources();
  for (const asset of project.assets) {
    const record = await transact('files', 'readonly', store => store.get(`${folder}/${asset.path}`)) as { blob: Blob } | undefined;
    if (record) sources.set(asset.path, URL.createObjectURL(record.blob));
    else asset.status = 'missing';
  }
}

export function mediaSource(assetPath: string, host: 'asset' | 'cache' = 'asset'): string {
  if (!window.workbench) return sources.get(assetPath) ?? '';
  return `project-media://${host}/${assetPath.split('/').map(encodeURIComponent).join('/')}`;
}

export const browserBackend: NonNullable<Window['workbench']> = {
  async getSettings() { return { projectsRoot: '' }; },
  async chooseProjectsRoot() { return { projectsRoot: '' }; },
  async listProjects() {
    const records = await transact('projects', 'readonly', store => store.getAll()) as { folder: string; document?: ProjectDocument; name: string }[];
    return records.filter(item => item.document).map(item => ({ name: item.name, folder: item.folder }));
  },
  async createProject(name) {
    const folder = `browser:${crypto.randomUUID()}`;
    activeFolder = folder;
    await transact('projects', 'readwrite', store => store.put({ folder, name }));
    return folder;
  },
  async openProject(folder) {
    const record = await transact('projects', 'readonly', store => store.get(folder)) as { document?: ProjectDocument } | undefined;
    if (!record?.document) throw Error('项目不存在');
    const project = documentSchema.parse(record.document);
    await hydrate(folder, project);
    activeFolder = folder;
    return project;
  },
  async pickProjectFolder() { return null; },
  async saveProject(project) {
    if (!activeFolder) throw Error('未打开项目');
    await transact('projects', 'readwrite', store => store.put({ folder: activeFolder, name: project.name, document: documentSchema.parse(project) }));
    return { revision: project.revision };
  },
  async leaveProject() { activeFolder = null; clearSources(); },
  async importAssets() {
    if (!activeFolder) throw Error('未打开项目');
    const files = await chooseFiles(true);
    const assets: Asset[] = [], errors: { name: string; message: string }[] = [];
    for (const file of files) {
      try { assets.push(await storeFile(file, activeFolder)); }
      catch (error) { errors.push({ name: file.name, message: String(error) }); }
    }
    return { assets, errors };
  },
  async relinkAsset(kind) {
    if (!activeFolder) throw Error('未打开项目');
    const file = (await chooseFiles(false))[0];
    if (!file) return null;
    if (mediaKind(file) !== kind) throw Error('重新关联文件的类型不匹配');
    return storeFile(file, activeFolder);
  },
  async createTextAsset({ name, content }) {
    if (!activeFolder) throw Error('未打开项目');
    const file = new File([content], name.endsWith('.txt') ? name : `${name}.txt`, { type: 'text/plain' });
    return storeFile(file, activeFolder);
  },
  async analyzeAsset() { return { ok: true as const, result: {} }; },
  async cancelTask() { return { cancelled: false }; },
  onTaskProgress() { return () => undefined; },
  onBackendRestart() { return () => undefined; },
  onFlushRequest() { return () => undefined; }
};

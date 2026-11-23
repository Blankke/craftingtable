import { contextBridge, ipcRenderer, webUtils } from 'electron';

// 渲染器仅可调用列出的项目与素材操作，不能传入任意文件操作指令。
contextBridge.exposeInMainWorld('workbench', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  clipboardCommand: (command: string) => ipcRenderer.invoke('editing:clipboard', command),
  readClipboardText: () => ipcRenderer.invoke('editing:clipboard-text'),
  copyGraphic: (input: { png: string; svg?: string }) => ipcRenderer.invoke('editing:copy-graphic', input),
  openLink: (href: string) => ipcRenderer.invoke('editing:open-link', href),
  chooseProjectsRoot: () => ipcRenderer.invoke('settings:choose-projects-root'),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (name: string) => ipcRenderer.invoke('projects:create', name),
  openProject: (folder: string) => ipcRenderer.invoke('projects:open', folder),
  pickProjectFolder: () => ipcRenderer.invoke('projects:pick-folder'),
  revealProject: (folder: string) => ipcRenderer.invoke('projects:reveal', folder),
  deleteProject: (folder: string) => ipcRenderer.invoke('projects:delete', folder),
  renameProject: (folder: string, name: string) => ipcRenderer.invoke('projects:rename', folder, name),
  exportNote: (input: { name: string; markdown: string }) => ipcRenderer.invoke('notes:export', input),
  saveProject: (document: unknown) => ipcRenderer.invoke('projects:save', document),
  leaveProject: () => ipcRenderer.invoke('projects:leave'),
  importAssets: () => ipcRenderer.invoke('assets:import'),
  removeAsset: (assetPath: string) => ipcRenderer.invoke('assets:remove', assetPath),
  // 只在 preload 中解析真实拖入文件；磁盘绝对路径不回传给页面。
  importDroppedFiles: async (files: File[]) => {
    const paths = files.map(file => webUtils.getPathForFile(file));
    // 剪贴板中的图片没有磁盘路径，按字节导入；拖入的真实文件仍走已有路径校验。
    const result = paths.some(Boolean) ? await ipcRenderer.invoke('assets:drop', paths.filter(Boolean)) : { assets: [], errors: [] };
    for (const [index, file] of files.entries()) {
      if (paths[index]) continue;
      try {
        if (!file.type.startsWith('image/') || file.size > 50 * 1024 * 1024) throw Error('请选择 50 MB 以内的图片');
        const asset = await ipcRenderer.invoke('assets:paste-image', { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
        result.assets.push(asset);
      } catch (error) { result.errors.push({ name: file.name, message: String(error) }); }
    }
    return result;
  },
  relinkAsset: (kind: string) => ipcRenderer.invoke('assets:relink', kind),
  createTextAsset: (input: { name: string; content: string }) => ipcRenderer.invoke('assets:create-text', input),
  analyzeAsset: (input: unknown) => ipcRenderer.invoke('assets:analyze', input),
  cancelTask: (taskId: string) => ipcRenderer.invoke('tasks:cancel', taskId),
  onTaskProgress: (handler: (progress: { taskId: string; assetId: string; percent: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { taskId: string; assetId: string; percent: number }) => handler(progress);
    ipcRenderer.on('tasks:progress', listener);
    return () => ipcRenderer.removeListener('tasks:progress', listener);
  },
  onBackendRestart: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on('backend:restarted', listener);
    return () => ipcRenderer.removeListener('backend:restarted', listener);
  },
  onFlushRequest: (handler: () => Promise<boolean>) => {
    const listener = async (_event: Electron.IpcRendererEvent, id: string) => {
      let saved = false;
      try { saved = await handler(); } catch { /* 保存错误由界面显示 */ }
      ipcRenderer.send('save:flushed', id, saved);
    };
    ipcRenderer.on('save:flush-request', listener);
    return () => ipcRenderer.removeListener('save:flush-request', listener);
  }
});

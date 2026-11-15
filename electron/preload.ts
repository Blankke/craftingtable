import { contextBridge, ipcRenderer } from 'electron';

// 渲染器仅可调用列出的项目与素材操作，不能传入任意文件操作指令。
contextBridge.exposeInMainWorld('workbench', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  chooseProjectsRoot: () => ipcRenderer.invoke('settings:choose-projects-root'),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (name: string) => ipcRenderer.invoke('projects:create', name),
  openProject: (folder: string) => ipcRenderer.invoke('projects:open', folder),
  pickProjectFolder: () => ipcRenderer.invoke('projects:pick-folder'),
  saveProject: (document: unknown) => ipcRenderer.invoke('projects:save', document),
  leaveProject: () => ipcRenderer.invoke('projects:leave'),
  importAssets: () => ipcRenderer.invoke('assets:import'),
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

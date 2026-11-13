import { contextBridge, ipcRenderer } from 'electron';

// 渲染器仅可调用列出的项目与素材操作，不能传入任意文件操作指令。
contextBridge.exposeInMainWorld('workbench', {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (name: string) => ipcRenderer.invoke('projects:create', name),
  openProject: (folder: string) => ipcRenderer.invoke('projects:open', folder),
  saveProject: (document: unknown) => ipcRenderer.invoke('projects:save', document),
  importAssets: () => ipcRenderer.invoke('assets:import')
});

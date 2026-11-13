import { app, BrowserWindow, dialog, ipcMain, protocol, net, utilityProcess } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { z } from 'zod';

protocol.registerSchemesAsPrivileged([{ scheme: 'project-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
let worker: Electron.UtilityProcess;
let projectFolder: string | null = null;
let window: BrowserWindow;
let quitting = false;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
function startWorker(): void {
  worker = utilityProcess.fork(path.join(__dirname, 'worker.cjs'));
  worker.on('message', (message: { id: string; result?: unknown; error?: string }) => {
    const task = pending.get(message.id); if (!task) return;
    pending.delete(message.id);
    message.error ? task.reject(Error(message.error)) : task.resolve(message.result);
  });
  worker.on('exit', () => { for (const task of pending.values()) task.reject(Error('后台服务已退出')); pending.clear(); if (!quitting) startWorker(); });
}
function call(request: unknown): Promise<unknown> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, request }); });
}
app.whenReady().then(() => {
  app.on('before-quit', () => { quitting = true; });
  startWorker();
  const root = path.join(app.getPath('documents'), '音视频创作策划工作台');
  protocol.handle('project-media', request => {
    const url = new URL(request.url);
    if (!projectFolder || url.hostname !== 'asset') return new Response('Forbidden', { status: 403 });
    const relative = decodeURIComponent(url.pathname.slice(1));
    const full = path.resolve(projectFolder, relative);
    if (!full.startsWith(path.resolve(projectFolder, 'assets') + path.sep) || !existsSync(full)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(full).toString());
  });
  ipcMain.handle('projects:list', () => call({ method: 'list', root }));
  ipcMain.handle('projects:create', async (_event, name: unknown) => {
    const folder = await call({ method: 'create', root, name: z.string().min(1).parse(name) }); projectFolder = String(folder); return folder;
  });
  ipcMain.handle('projects:open', async (_event, folder: unknown) => {
    const selected = z.string().parse(folder);
    if (path.dirname(selected) !== root) throw Error('项目位置无效');
    const document = await call({ method: 'open', folder: selected }); projectFolder = selected; return document;
  });
  ipcMain.handle('projects:save', (_event, document: unknown) => {
    if (!projectFolder) throw Error('未打开项目');
    return call({ method: 'save', folder: projectFolder, document });
  });
  ipcMain.handle('assets:import', async () => {
    if (!projectFolder) throw Error('未打开项目');
    const selected = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'] });
    if (selected.canceled) return [];
    return Promise.all(selected.filePaths.map(source => call({ method: 'import', folder: projectFolder, source })));
  });
  window = new BrowserWindow({ width: 1440, height: 900, backgroundColor: '#ffffff', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  if (process.env.VITE_DEV_SERVER_URL) window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else window.loadFile(path.join(__dirname, '../dist/index.html'));
});

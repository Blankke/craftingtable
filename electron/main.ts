import { app, BrowserWindow, dialog, ipcMain, protocol, net, shell, utilityProcess, Menu } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync, realpathSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { readProjectsRoot, saveProjectsRoot } from './projectSettings';
import { developmentDirectories } from './devDirectories';
import { mediaToolPath } from './mediaTools';

// 媒体峰值通过 fetch 读取；显式启用标准 CORS 协议能力，以适配当前 Chromium。
protocol.registerSchemesAsPrivileged([{ scheme: 'project-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);
let worker: Electron.UtilityProcess;
let projectFolder: string | null = null;
let window: BrowserWindow;
let quitting = false;
let allowClose = false;
function exitApplication(code: number): void {
  // app.exit 不触发 before-quit；必须先关闭自动重启，避免退出时留下新后台进程或占用安装文件。
  quitting = true;
  app.exit(code);
}
function runtimeLog(message: string): void {
  // 即使启动终端已关闭，也保留子进程退出原因供下次排查。
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try { appendFileSync(path.join(app.getPath('userData'), 'runtime.log'), line, 'utf8'); } catch { /* 日志不可写不能阻断应用 */ }
  console.error(line.trim());
}
process.on('uncaughtException', error => runtimeLog(`主进程未捕获异常：${error.stack ?? error.message}`));
process.on('unhandledRejection', reason => runtimeLog(`主进程未处理拒绝：${String(reason)}`));
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
function startWorker(): void {
  worker = utilityProcess.fork(path.join(__dirname, 'worker.cjs'));
  worker.on('message', (message: { id?: string; type?: string; taskId?: string; percent?: number; assetId?: string; result?: unknown; error?: { code: string; message: string; retryable: boolean } }) => {
    if (message.type === 'progress') { window?.webContents.send('tasks:progress', { taskId: message.taskId, percent: message.percent, assetId: message.assetId }); return; }
    if (!message.id) return;
    const task = pending.get(message.id); if (!task) return;
    pending.delete(message.id);
    message.error ? task.reject(Object.assign(Error(message.error.message), { code: message.error.code, retryable: message.error.retryable })) : task.resolve(message.result);
  });
  worker.on('exit', code => {
    runtimeLog(`后台进程退出：${code}`);
    for (const task of pending.values()) task.reject(Error('后台服务已退出'));
    pending.clear();
    if (!quitting) {
      startWorker();
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('backend:restarted');
    }
  });
}
function call(request: unknown): Promise<unknown> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, request }); });
}
const smokeMode = process.argv.includes('--smoke') || process.env.WORKBENCH_SMOKE === '1';
const e2eRoot = process.env.WORKBENCH_E2E_ROOT ? path.resolve(process.env.WORKBENCH_E2E_ROOT) : null;
const devRoot = process.env.WORKBENCH_DEV_ROOT ? path.resolve(process.env.WORKBENCH_DEV_ROOT) : null;
const devDirectories = devRoot ? developmentDirectories(app.getPath('appData'), devRoot) : null;
if (smokeMode || e2eRoot || devRoot) {
  // 开发和自动化实例使用独立数据目录；开发缓存必须位于 Windows 用户目录，供 Chromium 沙箱访问。
  if (smokeMode || e2eRoot) { app.disableHardwareAcceleration(); app.commandLine.appendSwitch('disable-gpu'); }
  const testUserData = e2eRoot ? path.join(e2eRoot, 'userdata') : devDirectories ? devDirectories.userData : path.join(app.getPath('temp'), 'media-workbench-smoke-userdata');
  mkdirSync(testUserData, { recursive: true });
  app.setPath('userData', testUserData);
}
if (!app.requestSingleInstanceLock()) {
  if (devRoot) console.error(`[dev] 无法取得桌面实例锁：可能已有窗口在运行，或当前用户无法写入 ${app.getPath('userData')}。请检查任务栏和该目录权限。`);
  exitApplication(smokeMode || e2eRoot || devRoot ? 1 : 0);
}
else app.whenReady().then(() => {
  // 使用应用内统一导航栏，移除 Electron 默认的 File/Edit 原生菜单，避免语言切换出现双套入口。
  Menu.setApplicationMenu(null);
  runtimeLog('应用就绪');
  app.on('before-quit', () => { quitting = true; });
  app.on('child-process-gone', (_event, details) => runtimeLog(`子进程退出：${details.type} ${details.reason} ${details.exitCode}`));
  app.on('will-quit', () => { quitting = true; });
  app.on('second-instance', () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  startWorker();
  const smoke = smokeMode;
  const settingsFile = path.join(app.getPath('userData'), 'settings.json');
  const defaultRoot = e2eRoot ? path.join(e2eRoot, 'projects') : smoke ? path.join(app.getPath('temp'), 'media-workbench-smoke') : devDirectories ? devDirectories.projects : path.join(app.getPath('documents'), '工作台');
  let root = e2eRoot || smoke ? defaultRoot : readProjectsRoot(settingsFile, defaultRoot);
  ipcMain.handle('settings:get', () => ({ projectsRoot: root }));
  ipcMain.handle('settings:choose-projects-root', async () => {
    const selection = await dialog.showOpenDialog(window, { defaultPath: root, properties: ['openDirectory', 'createDirectory'] });
    if (selection.canceled || !selection.filePaths[0]) return { projectsRoot: root };
    const selected = realpathSync(selection.filePaths[0]);
    if (!statSync(selected).isDirectory()) throw Error('项目位置必须是文件夹');
    if (!e2eRoot && !smoke) saveProjectsRoot(settingsFile, selected);
    root = selected;
    return { projectsRoot: root };
  });
  protocol.handle('project-media', request => {
    const url = new URL(request.url);
    if (!projectFolder || !['asset', 'cache'].includes(url.hostname)) return new Response('Forbidden', { status: 403 });
    const relative = decodeURIComponent(url.pathname.slice(1));
    const full = path.resolve(projectFolder, relative);
    const allowedRoot = path.resolve(projectFolder, url.hostname === 'asset' ? 'assets' : 'cache');
    if (!full.startsWith(allowedRoot + path.sep) || !existsSync(full)) return new Response('Not found', { status: 404 });
    try {
      // 路径字符串合法仍可能经过符号链接跳出项目，读取前再核对真实路径。
      const realProject = realpathSync(projectFolder), realRoot = realpathSync(allowedRoot), realFile = realpathSync(full);
      const rootInside = path.relative(realProject, realRoot);
      const inside = path.relative(realRoot, realFile);
      if (!rootInside || rootInside.startsWith(`..${path.sep}`) || rootInside === '..' || path.isAbsolute(rootInside) || !inside || inside.startsWith(`..${path.sep}`) || inside === '..' || path.isAbsolute(inside) || !statSync(realFile).isFile()) return new Response('Forbidden', { status: 403 });
      // Chromium 定位媒体时请求字节段。file: 的 net.fetch 不保证实现 Range，直接返回 206 与流。
      const range = request.headers.get('range');
      if (range) {
        const size = statSync(realFile).size;
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        const suffix = !match[1];
        const start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1]);
        const end = suffix ? size - 1 : match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        const extension = path.extname(realFile).toLowerCase();
        const contentType = ({ '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.webm': 'video/webm' } as Record<string, string>)[extension] || 'application/octet-stream';
        const body = Readable.toWeb(createReadStream(realFile, { start, end })) as ReadableStream<Uint8Array>;
        return new Response(body, { status: 206, headers: { 'Content-Type': contentType, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' } });
      }
      return net.fetch(pathToFileURL(realFile).toString());
    } catch { return new Response('Not found', { status: 404 }); }
  });
  ipcMain.handle('projects:list', () => call({ method: 'list', root }));
  ipcMain.handle('notes:export', async (event, input: unknown) => {
    if (event.sender !== window.webContents || !projectFolder) throw Error('请先打开项目');
    const { name, markdown } = z.object({ name: z.string().max(255), markdown: z.string().max(10_000_000) }).parse(input);
    // 只允许写入用户通过系统对话框选择的位置，渲染器不能传入任意路径。
    const target = await dialog.showSaveDialog(window, { title: '导出 Markdown', defaultPath: `${name.replace(/[\\/:*?"<>|]/g, '_') || 'note'}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (target.canceled || !target.filePath) return false;
    await writeFile(target.filePath, markdown, 'utf8');
    return true;
  });
  ipcMain.handle('projects:create', async (_event, name: unknown) => {
    const folder = await call({ method: 'create', root, name: z.string().min(1).parse(name) }); projectFolder = String(folder); return folder;
  });
  ipcMain.handle('projects:open', async (_event, folder: unknown) => {
    const selected = z.string().parse(folder);
    if (path.dirname(selected) !== root) throw Error('项目位置无效');
    const document = await call({ method: 'open', folder: selected }); projectFolder = selected; return document;
  });
  // 首页只允许操作当前项目根目录直属的项目，避免渲染端传入任意路径。
  const managedProjectFolder = (folder: unknown, allowMissing = false) => {
    const selected = path.resolve(z.string().parse(folder));
    const managedRoot = realpathSync(root);
    // 即使目录已被移除，也先核对父目录，避免把任意外部路径当作可删除项目。
    if (realpathSync(path.dirname(selected)) !== managedRoot) throw Error('项目位置无效');
    if (!existsSync(selected)) {
      if (allowMissing) return selected;
      throw Error('项目不存在或已被移除');
    }
    const managedFolder = realpathSync(selected);
    if (path.dirname(managedFolder) !== managedRoot || !statSync(managedFolder).isDirectory()) throw Error('项目位置无效');
    return managedFolder;
  };
  ipcMain.handle('projects:reveal', async (_event, folder: unknown) => {
    const selected = managedProjectFolder(folder);
    const error = await shell.openPath(selected);
    if (error) throw Error(error);
  });
  ipcMain.handle('projects:rename', (_event, folder: unknown, name: unknown) => {
    const selected = managedProjectFolder(folder);
    if (projectFolder && path.resolve(projectFolder) === selected) throw Error('请返回项目页后重命名');
    return call({ method: 'rename', folder: selected, name: z.string().trim().min(1).max(100).parse(name) });
  });
  ipcMain.handle('projects:delete', (_event, folder: unknown) => {
    const selected = managedProjectFolder(folder, true);
    // 删除动作由页面二次确认后才会抵达这里；若删除当前项目，关闭其写入上下文。
    if (projectFolder && path.resolve(projectFolder) === selected) projectFolder = null;
    rmSync(selected, { recursive: true, force: true, maxRetries: 2, retryDelay: 120 });
    return true;
  });
  ipcMain.handle('projects:pick-folder', async () => {
    const selected = await dialog.showOpenDialog(window, { properties: ['openDirectory'] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const folder = path.resolve(selected.filePaths[0]);
    const document = await call({ method: 'open', folder });
    projectFolder = folder;
    return { folder, document };
  });
  ipcMain.handle('projects:save', (_event, document: unknown) => {
    if (!projectFolder) throw Error('未打开项目');
    return call({ method: 'save', folder: projectFolder, document });
  });
  ipcMain.handle('projects:leave', () => { projectFolder = null; });
  const importPaths = async (sources: string[]) => {
    if (!projectFolder) throw Error('未打开项目');
    const folder = projectFolder;
    const results = await Promise.allSettled(sources.map(source => call({ method: 'import', folder, source })));
    return {
      assets: results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []),
      errors: results.flatMap((result, index) => result.status === 'rejected' ? [{ name: path.basename(sources[index]), message: String(result.reason instanceof Error ? result.reason.message : result.reason) }] : [])
    };
  };
  ipcMain.handle('assets:drop', (event, sources: unknown) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw Error('无效的导入来源');
    return importPaths(z.array(z.string().min(1).refine(value => path.isAbsolute(value))).min(1).max(100).parse(sources));
  });
  ipcMain.handle('assets:paste-image', (event, input: unknown) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !projectFolder) throw Error('无效的导入来源');
    const data = z.object({ name: z.string().max(255), bytes: z.instanceof(Uint8Array).refine(bytes => bytes.length > 0 && bytes.length <= 50 * 1024 * 1024) }).parse(input);
    return call({ method: 'importImage', folder: projectFolder, ...data });
  });
  ipcMain.handle('assets:import', async () => {
    const selected = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'] });
    return selected.canceled ? { assets: [], errors: [] } : importPaths(selected.filePaths);
  });
  ipcMain.handle('assets:remove', (_event, assetPath: unknown) => {
    if (!projectFolder) throw Error('未打开项目');
    return call({ method: 'removeAsset', folder: projectFolder, assetPath: z.string().min(1).parse(assetPath) });
  });
  ipcMain.handle('assets:relink', async (_event, kind: unknown) => {
    if (!projectFolder) throw Error('未打开项目');
    const expectedKind = z.enum(['video', 'audio', 'image', 'text']).parse(kind);
    const selected = await dialog.showOpenDialog(window, { properties: ['openFile'] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    return call({ method: 'relink', folder: projectFolder, source: selected.filePaths[0], expectedKind });
  });
  ipcMain.handle('assets:create-text', (_event, input: unknown) => {
    if (!projectFolder) throw Error('未打开项目');
    const data = z.object({ name: z.string().trim().min(1).max(100), content: z.string().max(2_000_000) }).parse(input);
    return call({ method: 'createText', folder: projectFolder, ...data });
  });
  ipcMain.handle('assets:analyze', async (_event, input: unknown) => {
    if (!projectFolder) throw Error('未打开项目');
    const parameters = z.object({ assetId: z.string().uuid(), assetPath: z.string(), kind: z.enum(['audio', 'video']), inUs: z.number().int().nonnegative(), outUs: z.number().int().positive(), pixelsPerSecond: z.number().positive(), taskId: z.string().uuid() }).parse(input);
    try { return { ok: true, result: await call({ method: 'analyze', folder: projectFolder, ...parameters }) }; }
    catch (error) { return { ok: false, error: { code: (error as { code?: string }).code ?? 'INTERNAL', message: String((error as Error).message), retryable: (error as { retryable?: boolean }).retryable ?? true } }; }
  });
  ipcMain.handle('tasks:cancel', (_event, taskId: unknown) => call({ method: 'cancel', taskId: z.string().uuid().parse(taskId) }));
  const appIcon = path.join(__dirname, '../build/icon.png');
  window = new BrowserWindow({ width: 1440, height: 900, show: !smoke, backgroundColor: '#ffffff', icon: existsSync(appIcon) ? appIcon : undefined, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !smoke } });
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) runtimeLog(`界面控制台：${message}`); });
  window.webContents.on('render-process-gone', (_event, details) => runtimeLog(`界面进程退出：${details.reason} ${details.exitCode}`));
  if (devRoot) {
    console.log(`[dev] Electron 窗口已创建；运行时数据：${app.getPath('userData')}`);
    window.webContents.on('did-finish-load', () => {
      void window.webContents.executeJavaScript('Boolean(document.querySelector(".home,.app"))')
        .then(ready => console.log(`[dev] 页面加载完成；工作台可用：${ready}；窗口可见：${window.isVisible()}`))
        .catch(error => console.error('[dev] 页面脚本执行失败：', error));
    });
    window.webContents.on('did-fail-load', (_event, code, description, url) => console.error(`[dev] 界面加载失败 (${code})：${description}；地址：${url}`));
    window.webContents.on('render-process-gone', (_event, details) => console.error(`[dev] 界面进程异常退出：${details.reason}，代码 ${details.exitCode}`));
  }
  window.on('close', event => {
    if (allowClose || !projectFolder) return;
    event.preventDefault();
    const id = crypto.randomUUID();
    const response = new Promise<boolean>(resolve => {
      const timeout = setTimeout(() => { ipcMain.removeListener('save:flushed', listener); resolve(false); }, 10_000);
      const listener = (_event: Electron.IpcMainEvent, receivedId: string, saved: boolean) => {
        if (receivedId !== id) return;
        clearTimeout(timeout); ipcMain.removeListener('save:flushed', listener); resolve(saved);
      };
      ipcMain.on('save:flushed', listener);
    });
    window.webContents.send('save:flush-request', id);
    void response.then(async saved => {
      if (!saved) { await dialog.showMessageBox(window, { type: 'warning', message: '项目尚未保存，请重试后关闭窗口。', buttons: ['确定'] }); return; }
      allowClose = true; window.close();
    });
  });
  if (process.env.VITE_DEV_SERVER_URL) window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else window.loadFile(path.join(__dirname, '../dist/index.html'));
  if (smoke) window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        const ready = !!document.querySelector('.home');
        const name = 'smoke-' + Date.now();
        const until = async predicate => { for (let attempt = 0; attempt < 100; attempt++) {
          const value = await predicate(); if (value) return value;
          await new Promise(resolve => setTimeout(resolve, 50));
        } throw Error('界面等待超时：' + String(predicate).slice(0, 180)); };
        document.querySelector('.plus').click();
        (await until(() => document.querySelector('.home-menu button'))).click();
        const projectName = await until(() => document.querySelector('#project-name'));
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(projectName, name);
        projectName.dispatchEvent(new Event('input', { bubbles: true }));
        projectName.closest('form').querySelector('button[type=submit]').click();
        await until(() => document.querySelector('.tool-grid'));
        document.querySelector('.shape-group .tool-tile').click();
        const folder = (await window.workbench.listProjects()).find(item => item.name.startsWith(name))?.folder;
        if (!folder) throw Error('界面创建项目失败');
        const reopened = await until(async () => { const snapshot = await window.workbench.openProject(folder);
          return snapshot.objects.length === 1 ? snapshot : null; });
        return { ready, persisted: reopened.objects[0].kind === 'rectangle', folder, name };
      })()`);
      if (!result.ready || !result.persisted) throw Error('首页或项目读写失败');
      await window.webContents.executeJavaScript(`document.querySelector('button[aria-label=箭头]').click()`);
        await new Promise(resolve => setTimeout(resolve, 80));
        await window.webContents.capturePage();
      window.webContents.sendInputEvent({ type: 'mouseDown', x: 120, y: 170, button: 'left', clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseMove', x: 440, y: 360 });
      window.webContents.sendInputEvent({ type: 'mouseUp', x: 440, y: 360, button: 'left', clickCount: 1 });
      const connected = await new Promise<boolean>(resolve => {
        let attempts = 0;
        const inspect = async () => {
          const snapshot = await call({ method: 'open', folder: result.folder }) as { connections: unknown[] };
          if (snapshot.connections.length === 1) resolve(true);
          else if (++attempts >= 50) resolve(false);
          else setTimeout(inspect, 100);
        };
        void inspect();
      });
      if (!connected) throw Error('画布箭头操作未保存');
      {
        const ffmpeg = mediaToolPath('ffmpeg');
        const ffprobe = mediaToolPath('ffprobe');
        if (!existsSync(ffmpeg) || !existsSync(ffprobe)) throw Error('安装包缺少媒体工具');
        const samples: { name: string; kind: string; args?: string[] }[] = [
          { name: 'smoke.wav', kind: 'audio', args: ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'pcm_s16le'] },
          { name: 'smoke.mp3', kind: 'audio', args: ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libmp3lame'] },
          { name: 'smoke.mp4', kind: 'video', args: ['-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=1:r=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'] },
          { name: 'smoke.jpg', kind: 'image', args: ['-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=1', '-frames:v', '1'] },
          { name: 'smoke.png', kind: 'image', args: ['-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=1', '-frames:v', '1'] },
          { name: 'smoke.txt', kind: 'text' }
        ];
        const importedAssets: { id: string; path: string; kind: string; durationUs?: number; content?: string }[] = [];
        for (const sample of samples) {
          const source = path.join(result.folder, sample.name);
          if (sample.args) execFileSync(ffmpeg, ['-v', 'error', ...sample.args, '-y', source], { timeout: 20_000 });
          else writeFileSync(source, '中文创作说明', 'utf8');
          const imported = await call({ method: 'import', folder: result.folder, source }) as { id: string; path: string; kind: string; durationUs?: number; content?: string };
          if (imported.kind !== sample.kind) throw Error(`${sample.name} 类型识别错误`);
          if ((sample.kind === 'audio' || sample.kind === 'video') && (!imported.durationUs || imported.durationUs < 800_000)) throw Error(`${sample.name} 时长探测失败`);
          if (sample.kind === 'text' && imported.content !== '中文创作说明') throw Error('UTF-8 文本读取失败');
          importedAssets.push(imported);
        }
        const persisted = await call({ method: 'open', folder: result.folder }) as Record<string, unknown>;
        await call({ method: 'save', folder: result.folder, document: { ...persisted, revision: Number(persisted.revision) + 1, assets: importedAssets } });
        const reopened = await call({ method: 'open', folder: result.folder }) as { assets: unknown[] };
        if (reopened.assets.length !== samples.length) throw Error('素材保存重开失败');
        const waveformAsset = importedAssets.find(item => item.path.endsWith('.wav'))!;
        const videoAssetForCache = importedAssets.find(item => item.kind === 'video')!;
        const waveform = await call({ method: 'analyze', folder: result.folder, assetId: waveformAsset.id, assetPath: waveformAsset.path, kind: 'audio', inUs: 0, outUs: waveformAsset.durationUs, pixelsPerSecond: 30 }) as { waveform: { path: string; samplesPerSecond: number; durationUs: number } };
        const videoFrames = await call({ method: 'analyze', folder: result.folder, assetId: videoAssetForCache.id, assetPath: videoAssetForCache.path, kind: 'video', inUs: 0, outUs: videoAssetForCache.durationUs, pixelsPerSecond: 60 }) as { frames: { path: string }[] };
        if (!waveform.waveform?.path || !videoFrames.frames.length) throw Error('波形或视频帧未生成');
        const cancellableAsset = importedAssets.find(item => item.path.endsWith('.mp3'))!;
        const cancelId = crypto.randomUUID();
        const pendingAnalysis = call({ method: 'analyze', folder: result.folder, assetId: cancellableAsset.id, assetPath: cancellableAsset.path, kind: 'audio', inUs: 0, outUs: cancellableAsset.durationUs, pixelsPerSecond: 30, taskId: cancelId });
        const cancellation = await call({ method: 'cancel', taskId: cancelId }) as { cancelled: boolean };
        const cancelledCode = await pendingAnalysis.then(() => 'FINISHED', error => (error as { code?: string }).code ?? 'UNKNOWN');
        if (!cancellation.cancelled || cancelledCode !== 'CANCELLED' || readdirSync(path.join(result.folder, 'cache')).some(file => file.startsWith(`${cancellableAsset.id}-`) && file.endsWith('-wave-v1.bin'))) throw Error(`媒体任务取消失败：${cancelledCode}`);
        const decoded = await window.webContents.executeJavaScript(`(async () => {
          const assets = ${JSON.stringify(importedAssets)};
          const load = asset => new Promise((resolve, reject) => {
            const url = 'project-media://' + (asset.host || 'asset') + '/' + asset.path.split('/').map(encodeURIComponent).join('/');
            const element = asset.kind === 'image' ? new Image() : document.createElement(asset.kind === 'video' ? 'video' : 'audio');
            const timer = setTimeout(() => reject(Error(asset.path + ' 超时')), 8000);
            element.onload = element.onloadedmetadata = () => { clearTimeout(timer); resolve(element); };
            element.onerror = () => { clearTimeout(timer); reject(Error(asset.path + ' 无法解码')); };
            element.src = url;
          });
          for (const asset of assets.filter(item => item.kind !== 'text')) await load(asset);
          const waveBuffer = await fetch('project-media://cache/' + ${JSON.stringify(waveform.waveform.path)}.split('/').map(encodeURIComponent).join('/')).then(response => response.ok ? response.arrayBuffer() : null);
          if (!waveBuffer || waveBuffer.byteLength < 28) throw Error('波形峰值缓存无法读取');
          await load({ kind: 'image', host: 'cache', path: ${JSON.stringify(videoFrames.frames[0].path)} });
          const videoAsset = assets.find(item => item.kind === 'video');
          const video = await load(videoAsset);
          video.muted = true;
          await video.play();
          await new Promise(resolve => setTimeout(resolve, 350));
          const advanced = video.currentTime > 0;
          video.pause();
          return advanced;
        })()`);
        if (!decoded) throw Error('H.264/AAC 视频未能播放');
        const withAssets = await call({ method: 'open', folder: result.folder }) as Record<string, unknown>;
        const mediaId = crypto.randomUUID();
        const mediaObject = { id: mediaId, kind: 'media', assetId: waveformAsset.id, x: 100, y: 240, width: 220, height: 90, groupId: null, inUs: 0, outUs: waveformAsset.durationUs, pixelsPerSecond: 100 };
        await call({ method: 'save', folder: result.folder, document: { ...withAssets, revision: Number(withAssets.revision) + 1, objects: [...(withAssets.objects as unknown[]), mediaObject] } });
        await new Promise<void>(resolve => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload(); });
        const opened = await window.webContents.executeJavaScript(`(async () => {
          for (let attempt = 0; attempt < 100; attempt++) {
            const card = [...document.querySelectorAll('.gf-hit')].find(item => item.getAttribute('aria-label') === ${JSON.stringify(result.name)});
            if (card) { card.click(); break; }
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          for (let attempt = 0; attempt < 100; attempt++) {
            if (document.querySelector('.canvas')) return true;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          return false;
        })()`);
        if (!opened) throw Error('媒体项目无法从首页打开');
        // 首页重载后启动遮罩仍可能覆盖真实指针输入，等它移除再点画布。
        await window.webContents.executeJavaScript(`(async () => { for (let i = 0; i < 80 && document.querySelector('.splash'); i++) await new Promise(resolve => setTimeout(resolve, 50)); return true; })()`);
        // 先单击媒体并按 M，再选择已有标记，从上方连接柄创建笔记。
        window.webContents.sendInputEvent({ type: 'mouseDown', x: 130, y: 345, button: 'left', clickCount: 1 });
        window.webContents.sendInputEvent({ type: 'mouseUp', x: 130, y: 345, button: 'left', clickCount: 1 });
        await new Promise(resolve => setTimeout(resolve, 150));
        // 冒烟窗口隐藏运行，没有系统键盘焦点；键盘实机路径由 Playwright 桌面用例覆盖。
        await window.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }))`);
        await new Promise(resolve => setTimeout(resolve, 150));
        const markerButton = await window.webContents.executeJavaScript(`(() => { const button = document.querySelector('[aria-label="选择标记"]'); if (!button) return { found: false, selected: document.querySelector('.canvas')?.dataset.selected }; button.click(); return { found: true }; })()`) as { found: boolean; selected?: string };
        if (!markerButton.found) throw Error(`选择标记按钮缺失：${markerButton.selected ?? '未选中媒体'}`);
        await new Promise(resolve => setTimeout(resolve, 150));
        window.webContents.sendInputEvent({ type: 'mouseMove', x: 130, y: 284 });
        await new Promise(resolve => setTimeout(resolve, 150));
        // 隐藏窗口先强制绘制一帧，确保新增连接柄的命中图已刷新。
        await window.webContents.capturePage();
        window.webContents.sendInputEvent({ type: 'mouseDown', x: 130, y: 284, button: 'left', clickCount: 1 });
        await new Promise(resolve => setTimeout(resolve, 80));
        window.webContents.sendInputEvent({ type: 'mouseMove', x: 500, y: 450, modifiers: ['leftButtonDown'] });
        await new Promise(resolve => setTimeout(resolve, 80));
        window.webContents.sendInputEvent({ type: 'mouseUp', x: 500, y: 450, button: 'left', clickCount: 1 });
        const annotation = await new Promise<boolean>(resolve => {
          let attempts = 0;
          const inspect = async () => {
            const snapshot = await call({ method: 'open', folder: result.folder }) as { markers: unknown[]; connections: unknown[]; objects: unknown[] };
            const hasEditor = await window.webContents.executeJavaScript('!!document.querySelector("[aria-label=编辑画布文字]")');
            if (snapshot.markers.length === 1 && snapshot.connections.length === 2 && snapshot.objects.length === 3 && hasEditor) resolve(true);
            else if (++attempts >= 50) resolve(false);
            else setTimeout(inspect, 100);
          };
          void inspect();
        });
        if (!annotation) {
          writeFileSync(path.join(root, 'annotation-debug.png'), (await window.webContents.capturePage()).toPNG());
          const state = await window.webContents.executeJavaScript(`({ selected: document.querySelector('.canvas')?.dataset.selected, markerSelected: document.querySelector('[aria-label="选择标记"]')?.getAttribute('aria-pressed') })`);
          throw Error(`时间连接柄未创建完整注释：${JSON.stringify(state)}`);
        }
        await window.webContents.executeJavaScript(`document.querySelector('[aria-label=编辑画布文字]').focus()`);
        await window.webContents.insertText('中文注释');
        await new Promise(resolve => setTimeout(resolve, 100));
        const textInput = await window.webContents.executeJavaScript(`(() => { const element = document.querySelector('[aria-label=编辑画布文字]'); const value = element.value; const focused = document.activeElement === element; document.querySelector('[aria-label=完成文字编辑]').click(); return { value, focused }; })()`);
        const savedText = await new Promise<boolean>(resolve => {
          let attempts = 0;
          const inspect = async () => {
            const snapshot = await call({ method: 'open', folder: result.folder }) as { objects: { kind: string; text?: string }[] };
            if (snapshot.objects.some(item => item.kind === 'text' && item.text === '中文注释')) resolve(true);
            else if (++attempts >= 50) resolve(false);
            else setTimeout(inspect, 100);
          };
          void inspect();
        });
        if (!savedText) throw Error(`中文注释未保存 ${JSON.stringify(textInput)}`);
        window.webContents.sendInputEvent({ type: 'mouseDown', x: 120, y: 310, button: 'left', clickCount: 1 });
        window.webContents.sendInputEvent({ type: 'mouseUp', x: 120, y: 310, button: 'left', clickCount: 1 });
        await new Promise(resolve => setTimeout(resolve, 150));
        await window.webContents.executeJavaScript(`document.querySelector('button[aria-label=箭头]').click()`);
        await new Promise(resolve => setTimeout(resolve, 80));
        await window.webContents.capturePage();
        window.webContents.sendInputEvent({ type: 'mouseDown', x: 120, y: 310, button: 'left', clickCount: 1 });
        window.webContents.sendInputEvent({ type: 'mouseMove', x: 520, y: 510, modifiers: ['leftButtonDown'] });
        window.webContents.sendInputEvent({ type: 'mouseUp', x: 520, y: 510, button: 'left', clickCount: 1 });
        const mediaArrow = await new Promise<boolean>(resolve => {
          let attempts = 0;
          const inspect = async () => {
            const snapshot = await call({ method: 'open', folder: result.folder }) as { markers: unknown[]; connections: { from: { kind: string; objectId?: string } }[] };
            if (snapshot.markers.length === 1 && snapshot.connections.length === 3 && snapshot.connections[2]?.from.kind === 'object' && snapshot.connections[2]?.from.objectId === mediaId) resolve(true);
            else if (++attempts >= 40) resolve(false);
            else setTimeout(inspect, 100);
          };
          void inspect();
        });
        if (!mediaArrow) throw Error('箭头从轨道对象出发时错误创建时间标记');
        await window.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`);
        for (let attempt = 0; attempt < 40; attempt++) {
          const snapshot = await call({ method: 'open', folder: result.folder }) as { connections: unknown[] };
          if (snapshot.connections.length === 2) break;
          if (attempt === 39) throw Error('箭头撤销后关系未恢复');
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        await window.webContents.executeJavaScript(`document.querySelector('button[aria-label=箭头]').click()`);
        await new Promise(resolve => setTimeout(resolve, 80));
        await window.webContents.capturePage();
        window.webContents.sendInputEvent({ type: 'mouseDown', x: 520, y: 510, button: 'left', clickCount: 1 });
        window.webContents.sendInputEvent({ type: 'mouseMove', x: 180, y: 345, modifiers: ['leftButtonDown'] });
        window.webContents.sendInputEvent({ type: 'mouseUp', x: 180, y: 345, button: 'left', clickCount: 1 });
        const timeArrow = await new Promise<boolean>(resolve => {
          let attempts = 0;
          const inspect = async () => {
            const snapshot = await call({ method: 'open', folder: result.folder }) as { markers: { mediaId: string }[]; connections: { to: { kind: string; markerId?: string } }[] };
            const target = snapshot.connections[2]?.to;
            if (snapshot.markers.length === 1 && snapshot.connections.length === 3 && target?.kind === 'object' && snapshot.markers.some(marker => marker.mediaId === mediaId)) resolve(true);
            else if (++attempts >= 40) resolve(false);
            else setTimeout(inspect, 100);
          };
          void inspect();
        });
        if (!timeArrow) throw Error('普通箭头应绑定对象，不能隐式新增时间标记');
        await window.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))`);
        for (let attempt = 0; attempt < 40; attempt++) {
          const snapshot = await call({ method: 'open', folder: result.folder }) as { markers: unknown[]; connections: unknown[] };
          if (snapshot.markers.length === 1 && snapshot.connections.length === 2) break;
          if (attempt === 39) throw Error('时间箭头撤销后关系未恢复');
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        window.webContents.sendInputEvent({ type: 'mouseDown', x: 120, y: 310, button: 'left', clickCount: 1 });
        window.webContents.sendInputEvent({ type: 'mouseUp', x: 120, y: 310, button: 'left', clickCount: 1 });
        await new Promise(resolve => setTimeout(resolve, 120));
        const selectedMedia = await window.webContents.executeJavaScript(`document.querySelector('.canvas').dataset.selected`);
        if (selectedMedia !== mediaId) throw Error(`轨道点击后选中状态异常：${selectedMedia}`);
        // 等待 Konva 将选中手柄绘制并更新命中图，随后再发送拖动事件。
        window.webContents.sendInputEvent({ type: 'mouseMove', x: 180, y: 405 });
        await new Promise(resolve => setTimeout(resolve, 150));
        await window.webContents.capturePage();
        window.webContents.sendInputEvent({ type: 'mouseDown', x: 180, y: 405, button: 'left', clickCount: 1 });
        await new Promise(resolve => setTimeout(resolve, 80));
        window.webContents.sendInputEvent({ type: 'mouseMove', x: 170, y: 405, modifiers: ['leftButtonDown'] });
        window.webContents.sendInputEvent({ type: 'mouseMove', x: 160, y: 405, modifiers: ['leftButtonDown'] });
        await new Promise(resolve => setTimeout(resolve, 80));
        window.webContents.sendInputEvent({ type: 'mouseUp', x: 160, y: 405, button: 'left', clickCount: 1 });
        const scaled = await new Promise<boolean>(resolve => {
          let attempts = 0;
          const inspect = async () => {
            const snapshot = await call({ method: 'open', folder: result.folder }) as { objects: { id: string; pixelsPerSecond?: number; outUs?: number }[] };
            const media = snapshot.objects.find(item => item.id === mediaId);
            if (media?.pixelsPerSecond === 60 && media.outUs === waveformAsset.durationUs) resolve(true);
            else if (++attempts >= 40) resolve(false);
            else setTimeout(inspect, 100);
          };
          void inspect();
        });
        if (!scaled) {
          writeFileSync(path.join(root, 'scale-debug.png'), (await window.webContents.capturePage()).toPNG());
          const state = await window.webContents.executeJavaScript(`({ selected: document.querySelector('.canvas').dataset.selected, controls: !!document.querySelector('.media-controls') })`);
          throw Error(`显示长度拖动未单独改变时间比例：${JSON.stringify(state)}`);
        }
        const selectedAfterScale = await window.webContents.executeJavaScript(`document.querySelector('.canvas').dataset.selected`);
        if (selectedAfterScale !== mediaId) {
          window.webContents.sendInputEvent({ type: 'mouseDown', x: 120, y: 310, button: 'left', clickCount: 1 });
          window.webContents.sendInputEvent({ type: 'mouseUp', x: 120, y: 310, button: 'left', clickCount: 1 });
        }
        await window.webContents.executeJavaScript(`[...document.querySelectorAll('.media-row button')].find(item => item.textContent === '裁剪').click()`);
        const trimReady = await window.webContents.executeJavaScript(`(async () => { for (let i = 0; i < 50; i++) { if (document.querySelector('.canvas').dataset.selected === ${JSON.stringify(mediaId)} && document.querySelector('.media-row button[aria-pressed="true"]')?.textContent === '完成裁剪') return true; await new Promise(resolve => setTimeout(resolve, 50)); } return false; })()`);
        if (!trimReady) throw Error('裁剪模式未显示轨道手柄');
        window.webContents.sendInputEvent({ type: 'mouseMove', x: 160, y: 345 });
        await new Promise(resolve => setTimeout(resolve, 150));
        await window.webContents.capturePage();
        window.webContents.sendInputEvent({ type: 'mouseDown', x: 160, y: 345, button: 'left', clickCount: 1 });
        await new Promise(resolve => setTimeout(resolve, 80));
        window.webContents.sendInputEvent({ type: 'mouseMove', x: 153, y: 345, modifiers: ['leftButtonDown'] });
        window.webContents.sendInputEvent({ type: 'mouseMove', x: 145, y: 345, modifiers: ['leftButtonDown'] });
        await new Promise(resolve => setTimeout(resolve, 80));
        window.webContents.sendInputEvent({ type: 'mouseUp', x: 145, y: 345, button: 'left', clickCount: 1 });
        const trimmed = await new Promise<boolean>(resolve => {
          let attempts = 0;
          const inspect = async () => {
            const snapshot = await call({ method: 'open', folder: result.folder }) as { objects: { id: string; pixelsPerSecond?: number; outUs?: number }[] };
            const media = snapshot.objects.find(item => item.id === mediaId);
            if (media?.pixelsPerSecond === 60 && media.outUs !== undefined && media.outUs < waveformAsset.durationUs!) resolve(true);
            else if (++attempts >= 40) resolve(false);
            else setTimeout(inspect, 100);
          };
          void inspect();
        });
        if (!trimmed) {
          writeFileSync(path.join(root, 'trim-debug.png'), (await window.webContents.capturePage()).toPNG());
          const snapshot = await call({ method: 'open', folder: result.folder }) as { objects: { id: string; x: number; y: number; inUs?: number; outUs?: number; pixelsPerSecond?: number }[] };
          throw Error(`裁剪拖动未单独改变源区间：${JSON.stringify(snapshot.objects.find(item => item.id === mediaId))}`);
        }
        await window.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }))`);
        await new Promise(resolve => setTimeout(resolve, 80));
        window.webContents.sendInputEvent({ type: 'mouseDown', x: 800, y: 600, button: 'left', clickCount: 1 });
        window.webContents.sendInputEvent({ type: 'mouseMove', x: 820, y: 620, modifiers: ['leftButtonDown'] });
        window.webContents.sendInputEvent({ type: 'mouseMove', x: 800, y: 600, modifiers: ['leftButtonDown'] });
        window.webContents.sendInputEvent({ type: 'mouseUp', x: 800, y: 600, button: 'left', clickCount: 1 });
        await new Promise(resolve => setTimeout(resolve, 100));
        await window.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }))`);
        const afterPan = await window.webContents.executeJavaScript(`[...document.querySelectorAll('.media-row button')].find(item => item.textContent === '播放' || item.textContent === '暂停')?.textContent`);
        if (afterPan !== '播放') throw Error(`Space 平移误触发媒体播放：${String(afterPan)}`);
        const spacePlayback = await window.webContents.executeJavaScript(`(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 30)); return [...document.querySelectorAll('.media-row button')].some(item => item.textContent === '暂停'); })()`);
        if (!spacePlayback) throw Error('单按 Space 未切换播放');
        await window.webContents.executeJavaScript(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true })); })()`);
        const originalAssetFile = path.join(result.folder, waveformAsset.path);
        renameSync(originalAssetFile, `${originalAssetFile}.missing`);
        const missingDocument = await call({ method: 'open', folder: result.folder }) as { revision: number; assets: { id: string; path: string; status: string }[]; markers: unknown[]; connections: unknown[] };
        if (missingDocument.assets.find(item => item.id === waveformAsset.id)?.status !== 'missing' || missingDocument.markers.length !== 1) throw Error('缺失素材未保留轨道关系');
        const replacement = await call({ method: 'relink', folder: result.folder, source: path.join(result.folder, 'smoke.wav'), expectedKind: 'audio' }) as { path: string };
        await call({ method: 'save', folder: result.folder, document: { ...missingDocument, revision: missingDocument.revision + 1, assets: missingDocument.assets.map(item => item.id === waveformAsset.id ? { ...item, path: replacement.path, status: 'ready' } : item) } });
        const restored = await call({ method: 'open', folder: result.folder }) as { assets: { id: string; status: string }[]; markers: unknown[]; connections: unknown[] };
        if (restored.assets.find(item => item.id === waveformAsset.id)?.status !== 'ready' || restored.markers.length !== 1 || restored.connections.length !== 2) throw Error('重新关联后关系未恢复');
        const relinkedWaveform = await call({ method: 'analyze', folder: result.folder, assetId: waveformAsset.id, assetPath: replacement.path, kind: 'audio', inUs: 0, outUs: waveformAsset.durationUs, pixelsPerSecond: 30 }) as { waveform: { path: string } };
        if (!relinkedWaveform.waveform?.path || relinkedWaveform.waveform.path === waveform.waveform.path) throw Error('重新关联素材沿用了旧波形缓存');
        const textAsset = await call({ method: 'createText', folder: result.folder, name: 'note', content: '纯文本素材' }) as { id: string; path: string; kind: string; content: string };
        const beforeDrop = await call({ method: 'open', folder: result.folder }) as Record<string, unknown>;
        await call({ method: 'save', folder: result.folder, document: { ...beforeDrop, revision: Number(beforeDrop.revision) + 1, assets: [...(beforeDrop.assets as unknown[]), textAsset] } });
        await new Promise<void>(resolve => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload(); });
        const dragResult = await window.webContents.executeJavaScript(`(async () => {
          const name = ${JSON.stringify(result.name)};
          for (let attempt = 0; attempt < 100; attempt++) {
            const card = [...document.querySelectorAll('.gf-hit')].find(item => item.getAttribute('aria-label') === name);
            if (card) { card.click(); break; }
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          for (let attempt = 0; attempt < 100 && !document.querySelector('.asset-list'); attempt++) await new Promise(resolve => setTimeout(resolve, 50));
          let previewsReady = false;
          for (let attempt = 0; attempt < 100; attempt++) {
            const image = [...document.querySelectorAll('.asset')].find(item => item.textContent.includes('smoke.jpg'))?.querySelector('img.asset-preview');
            const video = [...document.querySelectorAll('.asset')].find(item => item.textContent.includes('smoke.mp4'))?.querySelector('img.asset-preview');
            const audio = [...document.querySelectorAll('.asset')].find(item => item.textContent.includes('smoke.wav'))?.querySelector('.asset-preview-empty');
            if (image?.naturalWidth > 0 && video?.naturalWidth > 0 && audio) { previewsReady = true; break; }
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          if (!previewsReady) throw Error('素材库图片、音频或视频缩略预览未加载');
          const canvas = document.querySelector('.canvas');
          const asset = [...document.querySelectorAll('.asset')].find(item => item.textContent.includes('note.txt'));
          if (!canvas || !asset) return false;
          return true;
        })()`);
        if (!dragResult) throw Error('文字素材拖放入口缺失');
        // 内部放置统一使用 Pointer Events，模拟真实鼠标而不保留旧 HTML 拖放协议。
        const dragIntoCanvas = async (selector: string, label: string, x: number, y: number) => {
          // 隐藏窗口先完成绘制及 ResizeObserver 分栏布局，再滚动和测量鼠标起点。
          await window.webContents.capturePage();
          const origin = await window.webContents.executeJavaScript(`(async () => {
            const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(item => item.textContent.includes(${JSON.stringify(label)}));
            await new Promise(requestAnimationFrame);
            await new Promise(requestAnimationFrame);
            element.scrollIntoView({ block: 'center', behavior: 'instant' });
            await new Promise(requestAnimationFrame);
            const box = element.getBoundingClientRect();
            const point = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
            if (!element.contains(document.elementFromPoint(point.x, point.y))) throw Error('拖动入口被遮挡：' + ${JSON.stringify(label)});
            return point;
          })()`) as { x: number; y: number };
          window.webContents.sendInputEvent({ type: 'mouseMove', ...origin });
          window.webContents.sendInputEvent({ type: 'mouseDown', ...origin, button: 'left', clickCount: 1 });
          await new Promise(resolve => setTimeout(resolve, 80));
          window.webContents.sendInputEvent({ type: 'mouseMove', x, y, modifiers: ['leftButtonDown'] });
          await new Promise(resolve => setTimeout(resolve, 80));
          window.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        };
        await dragIntoCanvas('.asset', 'note.txt', 650, 550);
        await dragIntoCanvas('.tool-grid button', '矩形', 700, 600);

        const canvasOrigin = await window.webContents.executeJavaScript(`(() => { const box = document.querySelector('.canvas').getBoundingClientRect(); return { x: box.x, y: box.y }; })()`) as { x: number; y: number };
        const dropped = await new Promise<boolean>(resolve => {
          let attempts = 0;
          const inspect = async () => {
            const snapshot = await call({ method: 'open', folder: result.folder }) as { objects: { kind: string; text?: string; x: number; y: number }[] };
            if (snapshot.objects.some(item => item.kind === 'text' && item.text === '纯文本素材' && Math.abs(item.x - (650 - canvasOrigin.x)) < 2 && Math.abs(item.y - (550 - canvasOrigin.y)) < 2) && snapshot.objects.some(item => item.kind === 'rectangle' && Math.abs(item.x - (700 - canvasOrigin.x)) < 2 && Math.abs(item.y - (600 - canvasOrigin.y)) < 2)) resolve(true);
            else if (++attempts >= 50) resolve(false);
            else setTimeout(inspect, 100);
          };
          void inspect();
        });
        if (!dropped) throw Error('文字素材拖放后未按位置保存');
        await window.webContents.executeJavaScript(`(async () => { document.querySelector('button[aria-label=箭头]').click(); let select; for (let i = 0; i < 30; i++) { select = document.querySelector('[aria-label=箭头路径]'); if (select) break; await new Promise(resolve => setTimeout(resolve, 30)); } if (!select) throw Error('箭头路径控件缺失'); select.value = 'elbow'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        window.webContents.sendInputEvent({ type: 'mouseDown', x: 300, y: 520, button: 'left', clickCount: 1 });
        window.webContents.sendInputEvent({ type: 'mouseMove', x: 440, y: 550, modifiers: ['leftButtonDown'] });
        window.webContents.sendInputEvent({ type: 'mouseUp', x: 440, y: 550, button: 'left', clickCount: 1 });
        const elbowSaved = await new Promise<boolean>(resolve => {
          let attempts = 0;
          const inspect = async () => {
            const snapshot = await call({ method: 'open', folder: result.folder }) as { connections: { routing: string }[] };
            if (snapshot.connections.some(item => item.routing === 'elbow')) resolve(true);
            else if (++attempts >= 40) resolve(false);
            else setTimeout(inspect, 100);
          };
          void inspect();
        });
        if (!elbowSaved) throw Error('折线箭头未保存');
      }
      const unsupportedSource = path.join(result.folder, 'unsupported.mp4');
      writeFileSync(unsupportedSource, 'unsupported video payload', 'utf8');
      const unsupportedAsset = await call({ method: 'import', folder: result.folder, source: unsupportedSource }) as { id: string; path: string; kind: string };
      const beforeUnsupported = await call({ method: 'open', folder: result.folder }) as Record<string, unknown>;
      const unsupportedMedia = { id: crypto.randomUUID(), kind: 'media', assetId: unsupportedAsset.id, x: 400, y: 180, width: 220, height: 90, groupId: null, inUs: 0, outUs: 5_000_000, pixelsPerSecond: 30 };
      await call({ method: 'save', folder: result.folder, document: { ...beforeUnsupported, revision: Number(beforeUnsupported.revision) + 1, assets: [...(beforeUnsupported.assets as unknown[]), unsupportedAsset], objects: [...(beforeUnsupported.objects as unknown[]), unsupportedMedia] } });
      await new Promise<void>(resolve => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload(); });
      const unsupportedPrompt = await window.webContents.executeJavaScript(`(async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
          const card = [...document.querySelectorAll('.gf-hit')].find(item => item.getAttribute('aria-label') === ${JSON.stringify(result.name)});
          if (card) { card.click(); break; }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        for (let attempt = 0; attempt < 100 && !document.querySelector('.canvas'); attempt++) await new Promise(resolve => setTimeout(resolve, 50));
        return !!document.querySelector('.canvas');
      })()`);
      if (!unsupportedPrompt) throw Error('不支持媒体的项目未打开');
      await window.webContents.executeJavaScript(`(async () => { for (let i = 0; i < 80 && document.querySelector('.splash'); i++) await new Promise(resolve => setTimeout(resolve, 50)); return true; })()`);
      window.webContents.sendInputEvent({ type: 'mouseDown', x: 420, y: 250, button: 'left', clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseUp', x: 420, y: 250, button: 'left', clickCount: 1 });
      const unsupportedVisible = await window.webContents.executeJavaScript(`(async () => { for (let i = 0; i < 100; i++) { if (document.querySelector('.media-playback-error')?.textContent.includes('无法播放')) return true; await new Promise(resolve => setTimeout(resolve, 50)); } return false; })()`);
      if (!unsupportedVisible) throw Error('不支持的媒体未显示播放错误');
      const unsupportedStored = await new Promise<boolean>(resolve => {
        let attempts = 0;
        const inspect = async () => {
          const snapshot = await call({ method: 'open', folder: result.folder }) as { assets: { id: string; status: string }[] };
          const shown = await window.webContents.executeJavaScript(`[...document.querySelectorAll('.asset-row')].some(item => item.textContent.includes('unsupported.mp4') && item.textContent.includes('不支持播放'))`);
          if (snapshot.assets.find(item => item.id === unsupportedAsset.id)?.status === 'unsupported' && shown) resolve(true);
          else if (++attempts >= 40) resolve(false);
          else setTimeout(inspect, 100);
        };
        void inspect();
      });
      if (!unsupportedStored) throw Error('不支持媒体的状态未保留在素材库和项目中');
      const beforeRestart = await call({ method: 'open', folder: result.folder }) as { objects: unknown[] };
      await window.webContents.executeJavaScript(`[...document.querySelectorAll('.tool-grid button')].find(item => item.textContent === '矩形').click()`);
      worker.kill();
      const resubmitted = await new Promise<boolean>(resolve => {
        let attempts = 0;
        const inspect = async () => {
          try {
            const snapshot = await call({ method: 'open', folder: result.folder }) as { objects: unknown[] };
            if (snapshot.objects.length === beforeRestart.objects.length + 1) { resolve(true); return; }
          } catch { /* 进程重启期间继续等待 */ }
          if (++attempts >= 60) resolve(false);
          else setTimeout(inspect, 100);
        };
        setTimeout(inspect, 100);
      });
      if (!resubmitted) throw Error('后台重启后内存编辑未重新保存');
      const interruptedImport = path.join(result.folder, 'assets', `${crypto.randomUUID()}.mp4.tmp`);
      writeFileSync(interruptedImport, 'unfinished import', 'utf8');
      await call({ method: 'open', folder: result.folder });
      if (existsSync(interruptedImport)) throw Error('导入中断留下的临时文件未清理');
      // 验证损坏主文件后读取有效快照，并验证整个项目文件夹搬移后相对路径仍可用。
      writeFileSync(path.join(result.folder, 'project.json'), '{broken', 'utf8');
      const recovered = await call({ method: 'open', folder: result.folder }) as { recovered: boolean; revision: number; assets: { status: string }[] };
      if (!recovered.recovered || !recovered.assets.length) throw Error('恢复快照载入失败');
      await new Promise<void>(resolve => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload(); });
      const openedRecovery = await window.webContents.executeJavaScript(`(async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
          const card = [...document.querySelectorAll('.gf-hit')].find(item => item.getAttribute('aria-label') === ${JSON.stringify(result.name)});
          if (card) { card.click(); return true; }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        return false;
      })()`);
      if (!openedRecovery) throw Error('恢复项目入口缺失');
      const recoverySaved = await new Promise<boolean>(resolve => {
        let attempts = 0;
        const inspect = async () => {
          const snapshot = await call({ method: 'open', folder: result.folder }) as { recovered: boolean; assets: unknown[] };
          if (!snapshot.recovered && snapshot.assets.length) resolve(true);
          else if (++attempts >= 50) resolve(false);
          else setTimeout(inspect, 100);
        };
        void inspect();
      });
      if (!recoverySaved) throw Error('界面载入恢复快照后未自动保存');
      const movedFolder = `${result.folder}-moved`;
      renameSync(result.folder, movedFolder);
      const moved = await call({ method: 'open', folder: movedFolder }) as { recovered: boolean; assets: { status: string }[] };
      if (moved.recovered || moved.assets.some(asset => asset.status !== 'ready' && asset.status !== 'unsupported')) throw Error('项目文件夹搬移后无法正常打开素材');
      writeFileSync(path.join(root, 'smoke-result.json'), JSON.stringify({ passed: true, at: new Date().toISOString() }));
      console.log('SMOKE_OK home + project roundtrip');
      exitApplication(0);
    } catch (error) { writeFileSync(path.join(root, 'smoke-result.json'), JSON.stringify({ passed: false, error: String(error) })); console.error('SMOKE_FAILED', error); exitApplication(1); }
  });
});

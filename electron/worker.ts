// 后台只处理项目文件和素材；编辑器事实仍由渲染进程持有。
import { mkdir, readFile, readdir, rename, copyFile, stat, open, rm, realpath, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { documentSchema, readProjectDocument } from '../src/core/document';
import { buildProjectPreview, type ProjectPreview } from '../src/core/projectPreview';
import { aggregatePeaks, encodeWaveform, WAVEFORM_SAMPLES_PER_SECOND, WAVEFORM_VERSION } from '../src/core/waveform';

const requestSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('list'), root: z.string() }),
  z.object({ method: z.literal('create'), root: z.string(), name: z.string().min(1) }),
  z.object({ method: z.literal('open'), folder: z.string() }),
  z.object({ method: z.literal('save'), folder: z.string(), document: documentSchema }),
  z.object({ method: z.literal('import'), folder: z.string(), source: z.string() }),
  z.object({ method: z.literal('relink'), folder: z.string(), source: z.string(), expectedKind: z.enum(['video', 'audio', 'image', 'text']) }),
  z.object({ method: z.literal('createText'), folder: z.string(), name: z.string().trim().min(1).max(100), content: z.string().max(2_000_000) }),
  z.object({ method: z.literal('analyze'), folder: z.string(), assetId: z.string().uuid(), assetPath: z.string(), kind: z.enum(['audio', 'video']), inUs: z.number().int().nonnegative(), outUs: z.number().int().positive(), pixelsPerSecond: z.number().positive(), taskId: z.string().uuid().optional() }),
  z.object({ method: z.literal('cancel'), taskId: z.string().uuid() })
]);
const latestRevision = new Map<string, number>();
const saveQueues = new Map<string, Promise<unknown>>();
const execFileAsync = promisify(execFile);
const taskControllers = new Map<string, AbortController>();
let activeAnalyses = 0;
const analysisQueue: (() => void)[] = [];
const cacheWrites = new Map<string, Promise<void>>();

function insideDirectory(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function withCacheLock(key: string, signal: AbortSignal, prepare: () => Promise<void>): Promise<void> {
  // 同一素材的多个实例可共用缓存，但生成过程必须排队，避免同时重命名到同一路径。
  const previous = cacheWrites.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    if (signal.aborted) throw Error('任务已取消');
    await prepare();
  });
  cacheWrites.set(key, current);
  try { await current; }
  finally { if (cacheWrites.get(key) === current) cacheWrites.delete(key); }
}

function limited<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = () => {
      if (signal.aborted) { reject(Error('任务已取消')); analysisQueue.shift()?.(); return; }
      activeAnalyses++;
      task().then(resolve, reject).finally(() => { activeAnalyses--; analysisQueue.shift()?.(); });
    };
    if (activeAnalyses < 2) start(); else {
      analysisQueue.push(start);
      signal.addEventListener('abort', () => {
        const index = analysisQueue.indexOf(start);
        if (index >= 0) { analysisQueue.splice(index, 1); reject(Error('任务已取消')); }
      }, { once: true });
    }
  });
}

function runFfmpeg(args: string[], durationUs: number, signal: AbortSignal, progress: (value: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(mediaTool('ffmpeg'), ['-nostdin', '-progress', 'pipe:2', ...args], { windowsHide: true, signal });
    let buffer = '', errorTail = '';
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 300_000);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      buffer += chunk;
      errorTail = (errorTail + chunk).slice(-2000);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('out_time_us=')) continue;
        const timeUs = Number(line.slice(12));
        if (Number.isFinite(timeUs)) progress(Math.min(95, Math.max(5, Math.round(timeUs / durationUs * 90))));
      }
    });
    child.once('error', error => { clearTimeout(timeout); reject(signal.aborted ? Error('任务已取消') : error); });
    child.once('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(Error(signal.aborted ? '任务已取消' : timedOut ? '任务超时' : `FFmpeg 处理失败：${errorTail.slice(-300)}`)); });
  });
}

function mediaTool(name: 'ffmpeg' | 'ffprobe'): string {
  const packaged = path.join(process.resourcesPath ?? '', 'vendor', `${name}.exe`);
  const local = path.resolve(__dirname, '../vendor', `${name}.exe`);
  return process.resourcesPath && existsSync(packaged) ? packaged : existsSync(local) ? local : name;
}

async function probeDuration(file: string): Promise<number | undefined> {
  // 优先使用随安装包分发的 ffprobe；开发环境可使用 PATH 中的版本。
  const command = mediaTool('ffprobe');
  try {
    const { stdout } = await execFileAsync(command, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { timeout: 15_000, maxBuffer: 1024 * 1024 });
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1_000_000) : undefined;
  } catch { return undefined; }
}

async function decodePcm(file: string, signal: AbortSignal): Promise<{ pcm: Int16Array; sampleRate: number }> {
  // 把音频解码为单声道 16-bit PCM；8 kHz 采样对 120 列/秒的峰值已足够，且大幅压缩内存占用。
  return new Promise((resolve, reject) => {
    const child = spawn(mediaTool('ffmpeg'), ['-v', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], { windowsHide: true, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let errorTail = '';
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { errorTail = (errorTail + chunk).slice(-2000); });
    child.once('error', error => reject(signal.aborted ? Error('任务已取消') : error));
    child.once('close', code => {
      if (signal.aborted) return reject(Error('任务已取消'));
      if (code !== 0) return reject(Error(`音频解码失败：${errorTail.slice(-300)}`));
      const buffer = Buffer.concat(chunks);
      resolve({ pcm: new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 2)), sampleRate: 8000 });
    });
  });
}

async function analyzeMedia(request: Extract<z.infer<typeof requestSchema>, { method: 'analyze' }>, signal: AbortSignal, progress: (value: number) => void): Promise<unknown> {
  const requested = path.resolve(request.folder, request.assetPath);
  const assetsRoot = path.resolve(request.folder, 'assets');
  if (!requested.startsWith(assetsRoot + path.sep) || request.inUs >= request.outUs) throw Error('媒体分析路径或区间无效');
  const projectRoot = await realpath(request.folder), realAssetsRoot = await realpath(assetsRoot), source = await realpath(requested);
  if (!insideDirectory(projectRoot, realAssetsRoot) || !insideDirectory(realAssetsRoot, source)) throw Error('媒体分析路径或区间无效');
  await stat(source);
  const cacheRoot = path.resolve(request.folder, 'cache');
  await mkdir(cacheRoot, { recursive: true });
  progress(5);
  if (request.kind === 'audio') {
    // 峰值缓存只依赖源文件；缩放、拉长、裁剪与改色都在渲染端重采样，不重新分析音频。
    const sourceKey = crypto.createHash('sha256').update(request.assetPath).digest('hex').slice(0, 12);
    const relative = `cache/${request.assetId}-${sourceKey}-wave-v${WAVEFORM_VERSION}.bin`;
    const output = path.join(request.folder, relative);
    let durationUs = await probeDuration(source) ?? request.outUs;
    await withCacheLock(output, signal, async () => {
      if (await stat(output).then(() => true).catch(() => false)) return;
      const temporary = `${output}.${crypto.randomUUID()}.tmp`;
      try {
        const { pcm, sampleRate } = await decodePcm(source, signal);
        durationUs = Math.round(pcm.length / sampleRate * 1_000_000) || durationUs;
        const columns = aggregatePeaks(pcm, sampleRate, WAVEFORM_SAMPLES_PER_SECOND);
        await writeFile(temporary, Buffer.from(encodeWaveform({ samplesPerSecond: WAVEFORM_SAMPLES_PER_SECOND, sampleRate, durationUs, columns })));
        await rename(temporary, output);
      } catch (error) { await rm(temporary, { force: true }); throw error; }
    });
    return { waveform: { path: relative, samplesPerSecond: WAVEFORM_SAMPLES_PER_SECOND, durationUs } };
  }
  const durationSec = (request.outUs - request.inUs) / 1_000_000;
  const rate = Math.min(2, request.pixelsPerSecond / 110, 60 / durationSec);
  const key = crypto.createHash('sha256').update(`${request.assetId}:${request.assetPath}:${request.inUs}:${request.outUs}:${rate.toFixed(5)}`).digest('hex').slice(0, 16);
  const relativeDir = `cache/frames-${key}`;
  const outputDir = path.join(request.folder, relativeDir);
  await withCacheLock(outputDir, signal, async () => {
    if ((await readdir(outputDir).catch(() => [])).length) return;
    const temporary = `${outputDir}.${crypto.randomUUID()}.tmp`;
    await mkdir(temporary, { recursive: true });
    try {
      await runFfmpeg(['-v', 'error', '-ss', (request.inUs / 1_000_000).toFixed(6), '-i', source, '-t', durationSec.toFixed(6), '-vf', `fps=${rate.toFixed(6)},scale=120:68`, '-frames:v', '60', '-q:v', '5', '-y', path.join(temporary, 'frame-%03d.jpg')], request.outUs - request.inUs, signal, progress);
      await rename(temporary, outputDir);
    } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
  });
  const files = await readdir(outputDir);
  return { frames: files.filter(file => /^frame-\d+\.jpg$/.test(file)).sort().map((file, index) => ({ path: `${relativeDir}/${file}`, timeUs: request.inUs + Math.round(index / rate * 1_000_000) })) };
}

async function durableWrite(file: string, content: string): Promise<void> {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      try { await rename(temporary, file); return; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '') || attempt === 9) throw error;
        await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
      }
    }
  } finally { await rm(temporary, { force: true }); }
}

async function homeMediaThumbnail(folder: string, asset: z.infer<typeof documentSchema>['assets'][number], revision: number): Promise<string | null> {
  if (asset.kind !== 'image' && asset.kind !== 'video') return null;
  const assetsRoot = path.resolve(folder, 'assets');
  const candidate = path.resolve(folder, asset.path);
  if (!insideDirectory(assetsRoot, candidate)) return null;
  const realRoot = await realpath(assetsRoot).catch(() => null);
  const realFile = await realpath(candidate).catch(() => null);
  if (!realRoot || !realFile || !insideDirectory(realRoot, realFile)) return null;
  const cache = path.join(folder, 'cache');
  const target = path.join(cache, `home-${asset.id}-${revision}.jpg`);
  try {
    await mkdir(cache, { recursive: true });
    if (!existsSync(target)) {
      // 缩略图只依赖素材和修订号；首页反复列出项目时直接读取缓存。
      const temporary = `${target}.${crypto.randomUUID()}.tmp.jpg`;
      try {
        const args = ['-v', 'error', ...(asset.kind === 'video' ? ['-ss', '0.5'] : []), '-i', realFile, '-frames:v', '1', '-vf', 'scale=320:200:force_original_aspect_ratio=decrease,pad=320:200:(ow-iw)/2:(oh-ih)/2', '-q:v', '8', '-y', temporary];
        await execFileAsync(mediaTool('ffmpeg'), args, { timeout: 20_000, maxBuffer: 256_000, windowsHide: true });
        await rename(temporary, target);
      } finally { await rm(temporary, { force: true }); }
    }
    const data = await readFile(target);
    return data.length <= 150_000 ? `data:image/jpeg;base64,${data.toString('base64')}` : null;
  } catch { return null; }
}

async function homePreview(folder: string, document: z.infer<typeof documentSchema>): Promise<ProjectPreview> {
  const file = path.join(folder, 'cache', 'home-preview.json');
  try {
    const cached = JSON.parse(await readFile(file, 'utf8')) as { revision: number; preview: ProjectPreview };
    if (cached.revision === document.revision && cached.preview) return cached.preview;
  } catch { /* 首次列出或缓存损坏时重新计算 */ }
  const images = new Map<string, string>();
  const used = new Set(document.objects.flatMap(object => 'assetId' in object && object.assetId ? [object.assetId] : []));
  const candidates = [...document.assets.filter(asset => used.has(asset.id)), ...document.assets.filter(asset => !used.has(asset.id))]
    .filter(asset => asset.kind === 'image' || asset.kind === 'video').slice(0, 8);
  await Promise.all(candidates.map(async asset => {
    const image = await homeMediaThumbnail(folder, asset, document.revision);
    if (image) images.set(asset.id, image);
  }));
  const preview = buildProjectPreview(document, images);
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await durableWrite(file, JSON.stringify({ revision: document.revision, preview }));
  } catch { /* 缓存不可写不影响项目列表 */ }
  return preview;
}

async function handle(raw: unknown): Promise<unknown> {
  const request = requestSchema.parse(raw);
  if (request.method === 'list') {
    await mkdir(request.root, { recursive: true });
    const entries = await readdir(request.root, { withFileTypes: true });
    // 首页只读摘要；读取时不迁移项目，也不改变当前活动项目或修订号。
    return Promise.all(entries.filter(item => item.isDirectory()).map(async item => {
      const folder = path.join(request.root, item.name);
      for (const [file, status] of [['project.json', 'ready'], [path.join('recovery', 'latest.json'), 'recovery']] as const) {
        try {
          const { document } = readProjectDocument(JSON.parse(await readFile(path.join(folder, file), 'utf8')));
          return { name: document.name, folder, revision: document.revision, status, summary: { objects: document.objects.length, assets: document.assets.length, notes: document.notes.length }, preview: await homePreview(folder, document) };
        } catch { /* 尝试有效快照；两者都失效时显示文件夹名 */ }
      }
      return { name: item.name, folder, status: 'invalid', summary: { objects: 0, assets: 0, notes: 0 }, preview: {} };
    }));
  }
  if (request.method === 'create') {
    const folder = path.join(request.root, `${request.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}-${crypto.randomUUID().slice(0, 8)}`);
    await Promise.all(['assets', 'cache', 'recovery'].map(name => mkdir(path.join(folder, name), { recursive: true })));
    return folder;
  }
  if (request.method === 'open') {
    let document: z.infer<typeof documentSchema>;
    let recovered = false;
    let migrated = false;
    let sourceFile = path.join(request.folder, 'project.json');
    try {
      ({ document, migrated } = readProjectDocument(JSON.parse(await readFile(sourceFile, 'utf8'))));
    } catch (originalError) {
      // 主文件损坏时读取上一次有效快照，保留主文件直到用户保存恢复内容。
      try {
        sourceFile = path.join(request.folder, 'recovery', 'latest.json');
        ({ document, migrated } = readProjectDocument(JSON.parse(await readFile(sourceFile, 'utf8'))));
        recovered = true;
      } catch { throw originalError; }
    }
    if (migrated) {
      // 完成结构和关系校验后才备份并原子写入；任何失败都保留升级前原件。
      const recoveryRoot = path.join(request.folder, 'recovery');
      await mkdir(recoveryRoot, { recursive: true });
      const backup = path.join(recoveryRoot, `pre-migration-${Date.now()}-${crypto.randomUUID()}.json`);
      await copyFile(sourceFile, backup);
      await durableWrite(path.join(request.folder, 'project.json'), JSON.stringify(document));
    }
    latestRevision.set(request.folder, recovered ? document.revision : Math.max(latestRevision.get(request.folder) ?? -1, document.revision));
    const assetDirectory = path.join(request.folder, 'assets');
    const entries = await readdir(assetDirectory, { withFileTypes: true }).catch(() => []);
    const projectRoot = await realpath(request.folder);
    const realAssetsRoot = await realpath(assetDirectory).catch(() => null);
    // 只清理本程序生成的未完成导入文件，不触碰用户放入目录的其他文件。
    await Promise.all(entries.filter(entry => entry.isFile() && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|mov|mkv|mp3|wav|jpg|jpeg|png|txt)\.tmp$/i.test(entry.name)).map(entry => rm(path.join(assetDirectory, entry.name), { force: true })));
    await Promise.all(document.assets.map(async asset => {
      const file = path.resolve(request.folder, asset.path);
      const allowed = file.startsWith(path.resolve(request.folder, 'assets') + path.sep);
      const realFile = allowed && realAssetsRoot && insideDirectory(projectRoot, realAssetsRoot) ? await realpath(file).catch(() => null) : null;
      const exists = realFile && realAssetsRoot && insideDirectory(realAssetsRoot, realFile) && await stat(realFile).then(info => info.isFile()).catch(() => false);
      if (!exists) asset.status = 'missing';
      else if (asset.status === 'missing') asset.status = 'ready';
    }));
    return { ...document, recovered, migrated };
  }
  if (request.method === 'save') {
    const file = path.join(request.folder, 'project.json');
    const revision = latestRevision.get(request.folder) ?? -1;
    if (request.document.revision < revision) throw Error('旧版文档不能覆盖新版');
    await mkdir(path.join(request.folder, 'recovery'), { recursive: true });
    try {
      // 仅把可解析的主文件留作恢复快照，避免损坏文件覆盖最近有效版本。
      readProjectDocument(JSON.parse(await readFile(file, 'utf8')));
      await copyFile(file, path.join(request.folder, 'recovery', 'latest.json'));
    } catch { /* 新项目或损坏的主文件没有可用快照 */ }
    await durableWrite(file, JSON.stringify(request.document));
    latestRevision.set(request.folder, request.document.revision);
    return { revision: request.document.revision };
  }
  if (request.method === 'analyze') {
    const taskId = request.taskId ?? crypto.randomUUID();
    const controller = new AbortController();
    taskControllers.set(taskId, controller);
    const progress = (percent: number) => port.postMessage({ type: 'progress', taskId, percent, assetId: request.assetId });
    try {
      const result = await limited(() => analyzeMedia(request, controller.signal, progress), controller.signal);
      progress(100);
      return result;
    } finally { taskControllers.delete(taskId); }
  }
  if (request.method === 'cancel') { const controller = taskControllers.get(request.taskId); controller?.abort(); return { cancelled: !!controller }; }
  if (request.method === 'createText') {
    const fileName = `${crypto.randomUUID()}.txt`;
    const relative = `assets/${fileName}`;
    await mkdir(path.join(request.folder, 'assets'), { recursive: true });
    await durableWrite(path.join(request.folder, relative), request.content);
    return { id: crypto.randomUUID(), name: request.name.endsWith('.txt') ? request.name : `${request.name}.txt`, path: relative, kind: 'text', content: request.content, status: 'ready' };
  }
  const source = request.source;
  const originalName = path.basename(source);
  const extension = path.extname(originalName).toLowerCase();
  const kind = ['.mp4', '.mov', '.mkv', '.webm'].includes(extension) ? 'video' : ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(extension) ? 'audio' : ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(extension) ? 'image' : ['.txt', '.md'].includes(extension) ? 'text' : null;
  if (!kind) throw Error('不支持的素材类型');
  if (request.method === 'relink' && kind !== request.expectedKind) throw Error('重新关联文件的类型不匹配');
  if (!(await stat(source)).isFile()) throw Error('请拖入文件，不支持文件夹');
  const fileName = `${crypto.randomUUID()}${extension}`;
  const destination = path.join(request.folder, 'assets', fileName);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp`;
  try { await pipeline(createReadStream(source), createWriteStream(temporary, { flags: 'wx' })); await rename(temporary, destination); }
  catch (error) { const { rm } = await import('node:fs/promises'); await rm(temporary, { force: true }); throw error; }
  const durationUs = kind === 'video' || kind === 'audio' ? await probeDuration(destination) : undefined;
  const content = kind === 'text' ? await readFile(destination, 'utf8') : undefined;
  return { id: crypto.randomUUID(), name: originalName, path: `assets/${fileName}`, kind, status: 'ready', durationUs, content };
}

const port = (process as NodeJS.Process & { parentPort: { on(event: string, listener: (message: { data: { id: string; request: unknown } }) => void): void; postMessage(message: unknown): void } }).parentPort;
port.on('message', async (message: { data: { id: string; request: unknown } }) => {
  const { id, request } = message.data;
  try {
    const parsed = requestSchema.parse(request);
    if (parsed.method === 'save') {
      // 同一项目保存串行化，修订号在写入时检查。
      const previous = saveQueues.get(parsed.folder) ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(() => handle(parsed));
      saveQueues.set(parsed.folder, next);
      port.postMessage({ id, result: await next });
    } else port.postMessage({ id, result: await handle(parsed) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = message === '任务已取消' ? 'CANCELLED' : message === '任务超时' ? 'TIMEOUT' : error instanceof z.ZodError ? 'INVALID_REQUEST' : message.startsWith('FFmpeg 处理失败') ? 'MEDIA_PROCESSING' : (error as NodeJS.ErrnoException).code ?? 'INTERNAL';
    port.postMessage({ id, error: { code, message, retryable: !['CANCELLED', 'INVALID_REQUEST'].includes(code) } });
  }
});

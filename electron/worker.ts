// 后台只处理项目文件和素材；编辑器事实仍由渲染进程持有。
import { mkdir, readFile, readdir, rename, writeFile, copyFile, stat, open } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { documentSchema } from '../src/core/document';

const requestSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('list'), root: z.string() }),
  z.object({ method: z.literal('create'), root: z.string(), name: z.string().min(1) }),
  z.object({ method: z.literal('open'), folder: z.string() }),
  z.object({ method: z.literal('save'), folder: z.string(), document: documentSchema }),
  z.object({ method: z.literal('import'), folder: z.string(), source: z.string() })
]);
const latestRevision = new Map<string, number>();
const saveQueues = new Map<string, Promise<unknown>>();

async function durableWrite(file: string, content: string): Promise<void> {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, file);
}

async function handle(raw: unknown): Promise<unknown> {
  const request = requestSchema.parse(raw);
  if (request.method === 'list') {
    await mkdir(request.root, { recursive: true });
    const entries = await readdir(request.root, { withFileTypes: true });
    return entries.filter(item => item.isDirectory()).map(item => ({ name: item.name, folder: path.join(request.root, item.name) }));
  }
  if (request.method === 'create') {
    const folder = path.join(request.root, `${request.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}-${crypto.randomUUID().slice(0, 8)}`);
    await Promise.all(['assets', 'cache', 'recovery'].map(name => mkdir(path.join(folder, name), { recursive: true })));
    return folder;
  }
  if (request.method === 'open') return documentSchema.parse(JSON.parse(await readFile(path.join(request.folder, 'project.json'), 'utf8')));
  if (request.method === 'save') {
    const file = path.join(request.folder, 'project.json');
    const revision = latestRevision.get(request.folder) ?? -1;
    if (request.document.revision < revision) throw Error('旧版文档不能覆盖新版');
    await mkdir(path.join(request.folder, 'recovery'), { recursive: true });
    try { await copyFile(file, path.join(request.folder, 'recovery', 'latest.json')); } catch { /* 新项目尚无快照 */ }
    await durableWrite(file, JSON.stringify(request.document));
    latestRevision.set(request.folder, request.document.revision);
    return { revision: request.document.revision };
  }
  const source = request.source;
  const originalName = path.basename(source);
  const extension = path.extname(originalName).toLowerCase();
  const kind = ['.mp4', '.mov', '.mkv'].includes(extension) ? 'video' : ['.mp3', '.wav'].includes(extension) ? 'audio' : ['.jpg', '.jpeg', '.png'].includes(extension) ? 'image' : extension === '.txt' ? 'text' : null;
  if (!kind) throw Error('不支持的素材类型');
  await stat(source);
  const fileName = `${crypto.randomUUID()}${extension}`;
  const destination = path.join(request.folder, 'assets', fileName);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp`;
  try { await pipeline(createReadStream(source), createWriteStream(temporary, { flags: 'wx' })); await rename(temporary, destination); }
  catch (error) { const { rm } = await import('node:fs/promises'); await rm(temporary, { force: true }); throw error; }
  return { id: crypto.randomUUID(), name: originalName, path: `assets/${fileName}`, kind, status: 'ready' };
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
  } catch (error) { port.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
});

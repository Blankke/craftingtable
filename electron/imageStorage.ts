// 用法：withOptimizedImage(source, assets目录, 回调, 'lossy' | 'lossless')；保留尺寸，默认有损 AVIF。
import { constants } from 'node:fs';
import { copyFile, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import crypto from 'node:crypto';
import { mediaToolPath } from './mediaTools';
import { createNumberedImage } from './assetFiles';
import { readProjectDocument } from '../src/core/document';
import { IMAGE_PREVIEW_EDGES } from '../src/core/imageResolution';
import { z } from 'zod';
import { DEFAULT_IMAGE_COMPRESSION, type ImageCompression } from '../src/core/imageCompression';

const execute = promisify(execFile);
const journalName = '.image-optimization.json';
// 编码串行执行，防止一次导入数百张图时同时展开大量完整位图。
let encoding = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const result = encoding.then(task, task);
  encoding = result.then(() => undefined, () => undefined);
  return result;
}
async function ffmpeg(args: string[]): Promise<string> {
  const { stdout } = await execute(mediaToolPath('ffmpeg'), ['-nostdin', '-v', 'error', '-threads', '1', ...args], { timeout: 120_000, maxBuffer: 256_000, windowsHide: true });
  return stdout.trim();
}
async function pixelDigest(file: string, alphaOnly = false): Promise<string> {
  // 强制 RGBA 后比较尺寸与全部像素；包括透明像素，避免悄悄丢失细节。
  const digest = await ffmpeg(['-i', file, '-frames:v', '1', ...(alphaOnly ? ['-vf', 'format=rgba,alphaextract', '-pix_fmt', 'gray'] : ['-pix_fmt', 'rgba']), '-f', 'framemd5', '-']);
  // 容器的时间基准和像素宽高比标记可以不同，只比较像素尺寸、字节数与像素摘要。
  return digest.split(/\r?\n/).filter(line => line.startsWith('#dimensions') || line && !line.startsWith('#')).map(line => line.startsWith('#') ? line : line.split(',').slice(-2).map(value => value.trim()).join(',')).join('\n');
}
async function pngCanOptimize(source: string): Promise<boolean> {
  const file = await open(source, 'r');
  try {
    const header = Buffer.alloc(33);
    if ((await file.read(header, 0, 33, 0)).bytesRead !== 33 || header.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return false;
    // WebP 为每通道 8 位；高位深、动画、色彩配置及方向元数据保持原文件。
    if (header[24] > 8 || header.readUInt32BE(16) > 16383 || header.readUInt32BE(20) > 16383) return false;
    let position = 8;
    const size = (await file.stat()).size, chunk = Buffer.alloc(8);
    while (position + 12 <= size) {
      if ((await file.read(chunk, 0, 8, position)).bytesRead !== 8) return false;
      const kind = chunk.toString('ascii', 4, 8), length = chunk.readUInt32BE(0);
      if (['acTL', 'iCCP', 'eXIf', 'cICP', 'cHRM', 'cLLI', 'mDCV'].includes(kind)) return false;
      // 常见 sRGB gamma 可直接转换；其他传递曲线保留原格式，避免浏览器显示偏色。
      if (kind === 'gAMA') {
        const gamma = Buffer.alloc(4);
        if (length !== 4 || (await file.read(gamma, 0, 4, position + 8)).bytesRead !== 4 || gamma.readUInt32BE() !== 45455) return false;
      }
      if (kind === 'IEND') return true;
      position += length + 12;
    }
    return false;
  } finally { await file.close(); }
}

async function webpCanOptimize(source: string): Promise<boolean> {
  const file = await open(source, 'r');
  try {
    const header = Buffer.alloc(12), chunk = Buffer.alloc(8), size = (await file.stat()).size;
    if ((await file.read(header, 0, 12, 0)).bytesRead !== 12 || header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WEBP') return false;
    let position = 12;
    while (position + 8 <= size) {
      if ((await file.read(chunk, 0, 8, position)).bytesRead !== 8) return false;
      const kind = chunk.toString('ascii', 0, 4), length = chunk.readUInt32LE(4);
      // 已有损的 WebP 不反复转码；动画、配置与方向元数据保留。
      if (['VP8 ', 'ANIM', 'ANMF', 'ICCP', 'EXIF'].includes(kind)) return false;
      position += 8 + length + (length % 2);
    }
    return position === size;
  } finally { await file.close(); }
}
async function jpegCanOptimize(source: string): Promise<boolean> {
  const file = await open(source, 'r');
  try {
    const header = Buffer.alloc(4); let position = 2;
    while ((await file.read(header, 0, 4, position)).bytesRead === 4) {
      if (header[0] !== 0xff) return false;
      if (header[1] === 0xda) return true;
      // EXIF 可包含方向和色彩数据；ICC 保留原文件，避免转换后显示变化。
      if ([0xe1, 0xe2].includes(header[1])) return false;
      const length = header.readUInt16BE(2); if (length < 2) return false;
      position += length + 2;
    }
    return false;
  } finally { await file.close(); }
}
export async function imageDimensions(file: string, applyOrientation = false): Promise<{ width: number; height: number }> {
  // 读取元数据即可放置图片，避免批量导入为了取得比例而在渲染进程展开所有原图。
  const { stdout } = await execute(mediaToolPath('ffprobe'), ['-v', 'error', '-show_entries', 'stream=width,height:stream_side_data=rotation:stream_tags=rotate', '-of', 'json', file], { timeout: 30_000, maxBuffer: 64_000, windowsHide: true });
  const stream = JSON.parse(stdout).streams[0];
  const size = z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).parse(stream);
  const rotation = Number(stream.side_data_list?.find((data: { rotation?: number }) => data.rotation !== undefined)?.rotation ?? stream.tags?.rotate ?? 0);
  return applyOrientation && Math.abs(Math.round(rotation)) % 180 === 90 ? { width: size.height, height: size.width } : size;
}
async function hasTransparency(source: string): Promise<boolean> {
  const alpha = await ffmpeg(['-i', source, '-vf', 'format=rgba,alphaextract,signalstats,metadata=mode=print:key=lavfi.signalstats.YMIN:file=-', '-frames:v', '1', '-f', 'null', '-']);
  const minimum = /lavfi\.signalstats\.YMIN=(\d+)/.exec(alpha);
  if (!minimum) throw Error('无法校验图片透明通道');
  return Number(minimum[1]) < 255;
}

export async function withOptimizedImage<T>(source: string, temporaryDirectory: string, consume: (file: string, optimized: boolean) => Promise<T>, mode: ImageCompression = DEFAULT_IMAGE_COMPRESSION): Promise<T> {
  let candidate = path.join(temporaryDirectory, `.image-${crypto.randomUUID()}.avif`);
  let optimized = false;
  await mkdir(temporaryDirectory, { recursive: true });
  try {
    await serial(async () => {
      try {
        const extension = path.extname(source).toLowerCase();
        let eligible = false;
        if (extension === '.png') eligible = await pngCanOptimize(source);
        else if (mode === 'lossy' && extension === '.webp') eligible = await webpCanOptimize(source);
        else if (mode === 'lossy' && ['.jpg', '.jpeg'].includes(extension)) eligible = await jpegCanOptimize(source);
        if (!eligible) return;
        const transparent = mode === 'lossy' && await hasTransparency(source);
        if (mode === 'lossless' || transparent) {
          candidate = candidate.replace(/\.avif$/, '.webp');
          // WebP 有损仅压缩颜色；透明通道随后独立做像素校验。
          await ffmpeg(['-i', source, '-frames:v', '1', '-c:v', 'libwebp', '-lossless', mode === 'lossless' ? '1' : '0', '-quality', mode === 'lossless' ? '75' : '85', '-pix_fmt', 'bgra', '-y', candidate]);
          if (transparent) {
            const lossless = candidate.replace(/\.webp$/, '.lossless.webp');
            try {
              // 图标和线稿有时无损更小，透明图片从两种 WebP 中采用较小者。
              await ffmpeg(['-i', source, '-frames:v', '1', '-c:v', 'libwebp', '-lossless', '1', '-quality', '75', '-pix_fmt', 'bgra', '-y', lossless]);
              if ((await stat(lossless)).size < (await stat(candidate)).size) await rename(lossless, candidate);
            } finally { await rm(lossless, { force: true }); }
          }
        } else {
          // 4:4:4 保留文字和彩色边缘，10 位中间色降低色阶断层；保持原始像素尺寸。
          // 色彩标记同时写入帧属性；仅设置编码器选项时，未知的源帧标记可能覆盖 AVIF 的 nclx。
          await ffmpeg(['-i', source, '-frames:v', '1', '-vf', 'scale=out_color_matrix=bt709:out_range=full,format=yuv444p10le,setparams=range=full:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709', '-c:v', 'libaom-av1', '-still-picture', '1', '-cpu-used', '6', '-crf', '28', '-b:v', '0', '-row-mt', '1', '-threads', '2', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', '-color_range', 'pc', '-y', candidate]);
        }
        if ((await stat(candidate)).size >= (await stat(source)).size) return;
        const original = await imageDimensions(source), output = await imageDimensions(candidate);
        if (original.width !== output.width || original.height !== output.height) return;
        optimized = mode === 'lossless' ? await pixelDigest(source) === await pixelDigest(candidate) : !transparent || await pixelDigest(source, true) === await pixelDigest(candidate, true);
      } catch { /* 编码不支持或校验失败时保留输入文件。 */ }
    });
    return await consume(optimized ? candidate : source, optimized);
  } finally { await rm(candidate, { force: true }); }
}

export async function storeImage(source: string, directory: string, originalName: string, mode: ImageCompression = DEFAULT_IMAGE_COMPRESSION): Promise<string> {
  return withOptimizedImage(source, directory, file => createNumberedImage(directory, originalName, path.extname(file).toLowerCase(), destination => copyFile(file, destination, constants.COPYFILE_EXCL)), mode);
}

const previews = new Map<string, Promise<string>>();
// 预览编码并发上限为 2；等待中的任务只持路径，不持解码后的像素。
let previewCount = 0;
const previewQueue: (() => void)[] = [];
async function limitPreview<T>(task: () => Promise<T>): Promise<T> {
  await new Promise<void>(resolve => { const start = () => { previewCount++; resolve(); }; if (previewCount < 2) start(); else previewQueue.push(start); });
  try { return await task(); } finally { previewCount--; previewQueue.shift()?.(); }
}

export async function imagePreview(folder: string, source: string, edge: number): Promise<string> {
  if (!IMAGE_PREVIEW_EDGES.includes(edge as typeof IMAGE_PREVIEW_EDGES[number])) throw Error('图片预览尺寸无效');
  const info = await stat(source);
  const key = crypto.createHash('sha256').update(`${source}:${info.size}:${info.mtimeMs}:${edge}`).digest('hex');
  const directory = path.join(folder, 'cache', 'image-previews'), output = path.join(directory, `${key}.webp`);
  await mkdir(directory, { recursive: true });
  const project = await realpath(folder), cache = await realpath(directory);
  if (!cache.startsWith(project + path.sep)) throw Error('预览目录无效');
  const cached = async () => {
    const real = await realpath(output).catch(() => null);
    if (real && path.dirname(real) !== cache) throw Error('预览文件路径无效');
    return real && (await stat(real)).isFile();
  };
  // 热缓存直接返回，不能排在尚未完成的其他图片编码后面；重开、缩放和返回视口应立即复用。
  if (await cached()) return output;
  const pending = previews.get(output);
  if (pending) return pending;
  const prepare = limitPreview(async () => {
    if (await cached()) return output;
    const temporary = path.join(directory, `.preview-${crypto.randomUUID()}.webp`);
    try {
      await ffmpeg(['-i', source, '-frames:v', '1', '-vf', `scale=w='min(${edge},iw)':h='min(${edge},ih)':force_original_aspect_ratio=decrease`, '-c:v', 'libwebp', '-lossless', '1', '-quality', '50', '-pix_fmt', 'bgra', '-y', temporary]);
      await rename(temporary, output);
      // 缓存可再生，限制总磁盘体积 128 MiB，同时限制 256 个档位文件。
      const files = await readdir(directory);
      const entries = await Promise.all(files.filter(name => /^[a-f0-9]{64}\.webp$/.test(name)).map(async name => { const file = path.join(directory, name); return { file, ...await stat(file).catch(() => ({ size: 0, mtimeMs: 0 })) }; }));
      entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
      let bytes = entries.reduce((sum, entry) => sum + entry.size, 0), count = entries.length;
      for (const entry of entries) {
        if (bytes <= 128 * 1024 * 1024 && count <= 256) break;
        if (entry.file === output || previews.has(entry.file)) continue;
        await rm(entry.file, { force: true }); bytes -= entry.size; count--;
      }
      return output;
    } finally { await rm(temporary, { force: true }); }
  });
  previews.set(output, prepare);
  try { return await prepare; } finally { previews.delete(output); }
}

async function atomicJson(file: string, content: string): Promise<void> {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, file); } finally { await rm(temporary, { force: true }); }
}
const journalSchema = z.object({ updates: z.array(z.object({ relative: z.string(), content: z.string() })), obsolete: z.array(z.string()), count: z.number().int().nonnegative(), before: z.number().nonnegative(), after: z.number().nonnegative() });
type ImageJournal = z.infer<typeof journalSchema>;

export async function finishImageOptimization(folder: string): Promise<ImageJournal | null> {
  const file = path.join(folder, journalName);
  const content = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
  if (content === null) return null;
  const journal = journalSchema.parse(JSON.parse(content));
  const root = await realpath(folder), assets = await realpath(path.join(folder, 'assets'));
  if (path.dirname(assets) !== root) throw Error('图片整理素材路径无效');
  const referenced = new Set<string>();
  // 恢复日志仅允许更新项目正文和恢复快照，删除的范围限定为项目 assets 内的普通文件。
  for (const update of journal.updates) {
    if (update.relative !== 'project.json' && !/^recovery\/[\w.-]+\.json$/.test(update.relative)) throw Error('图片整理日志路径无效');
    const parent = await realpath(path.dirname(path.join(folder, update.relative)));
    if (parent !== root && parent !== path.join(root, 'recovery')) throw Error('图片整理日志路径无效');
    // 完成所有预检后再写盘，历史快照也要保持有效引用。
    const { document } = readProjectDocument(JSON.parse(update.content));
    document.assets.forEach(asset => referenced.add(asset.path));
    for (const asset of document.assets) if (asset.kind === 'image' && asset.status !== 'missing') {
      const file = await realpath(path.resolve(folder, asset.path));
      if (path.dirname(file) !== assets) throw Error('图片整理素材路径无效');
    }
  }
  for (const relative of journal.obsolete) {
    if (!/^assets\/[^/\\]+$/.test(relative)) throw Error('图片整理素材路径无效');
    if (referenced.has(relative)) throw Error('图片整理不能移除仍被引用的素材');
    const source = path.join(folder, relative), real = await realpath(source).catch(() => null);
    if (real && path.dirname(real) !== assets) throw Error('图片整理素材路径无效');
  }
  for (const update of journal.updates) await atomicJson(path.join(folder, update.relative), update.content);
  for (const relative of journal.obsolete) await rm(path.join(folder, relative), { force: true });
  await rm(file);
  return journal;
}

export async function optimizeProjectImages(folder: string, progress: (done: number, total: number) => void = () => undefined, mode: ImageCompression = DEFAULT_IMAGE_COMPRESSION): Promise<{ count: number; before: number; after: number }> {
  const resumed = await finishImageOptimization(folder);
  if (resumed) return resumed;
  const primary = await readFile(path.join(folder, 'project.json'), 'utf8');
  const { document } = readProjectDocument(JSON.parse(primary));
  const files = ['project.json', ...(await readdir(path.join(folder, 'recovery')).catch(() => [])).filter(name => name.endsWith('.json')).map(name => `recovery/${name}`)];
  const snapshots = await Promise.all(files.map(async relative => ({ relative, content: await readFile(path.join(folder, relative), 'utf8') })));
  const paths = new Set(document.assets.filter(asset => asset.kind === 'image').map(asset => asset.path));
  const replacements = new Map<string, string>(), created: string[] = [];
  let before = 0, after = 0, done = 0;
  const root = await realpath(folder), assets = await realpath(path.join(folder, 'assets'));
  if (path.dirname(assets) !== root) throw Error('素材目录无效');
  try {
    for (const relative of paths) {
      if (!/^assets\/[^/\\]+$/.test(relative)) throw Error('素材路径无效');
      const source = await realpath(path.join(folder, relative));
      if (path.dirname(source) !== assets) throw Error('素材路径无效');
      const size = (await stat(source)).size; before += size; after += size;
      await withOptimizedImage(source, assets, async (file, optimized) => {
        if (!optimized) return;
        const name = await createNumberedImage(assets, path.basename(source), path.extname(file), destination => copyFile(file, destination, constants.COPYFILE_EXCL));
        const replacement = `assets/${name}`; created.push(path.join(folder, replacement));
        replacements.set(relative, replacement); after += (await stat(file)).size - size;
      }, mode);
      progress(++done, paths.size);
    }
    // 先确认离线处理期间项目未被其他实例改写，再准备可以恢复的原子提交。
    for (const snapshot of snapshots) if (await readFile(path.join(folder, snapshot.relative), 'utf8') !== snapshot.content) throw Error('项目正在被修改，请关闭应用后重试');
    if (!replacements.size) return { count: 0, before, after };
    const updates = snapshots.flatMap(snapshot => {
      const data = JSON.parse(snapshot.content);
      let changed = false;
      for (const asset of data.assets ?? []) {
        const replacement = replacements.get(asset.path);
        if (replacement) { asset.path = replacement; asset.name = asset.name.replace(/\.[^.]+$/, path.extname(replacement)); changed = true; }
      }
      if (!changed) return [];
      // 修订号变化使首页缓存自动失效；保留历史快照的其他内容和格式。
      data.revision++;
      return [{ relative: snapshot.relative, content: JSON.stringify(data) }];
    }).sort((a, b) => Number(a.relative === 'project.json') - Number(b.relative === 'project.json'));
    const journal: ImageJournal = { updates, obsolete: [...replacements.keys()], count: replacements.size, before, after };
    await atomicJson(path.join(folder, journalName), JSON.stringify(journal));
    await finishImageOptimization(folder);
    return { count: journal.count, before, after };
  } catch (error) {
    // 提交前失败可移除本次新文件；日志建立后交给下一次打开/整理继续，旧素材暂留。
    if (!await stat(path.join(folder, journalName)).then(() => true).catch(() => false)) await Promise.all(created.map(file => rm(file, { force: true })));
    throw error;
  }
}

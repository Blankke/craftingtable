// 用法：npm run test:unit；使用本项目离线 FFmpeg 验证无损、预览与项目整理事务。
import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { newDocument } from '../src/core/document';
import { finishImageOptimization, imagePreview, optimizeProjectImages, storeImage } from './imageStorage';
vi.mock('./mediaTools', () => ({ mediaToolPath: (name: string) => path.resolve('vendor', `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`, name + (process.platform === 'win32' ? '.exe' : '')) }));
const execute = promisify(execFile), roots: string[] = [];
const ffmpeg = path.resolve('vendor', `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`, 'ffmpeg' + (process.platform === 'win32' ? '.exe' : ''));
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-image-unit-')); roots.push(root);
  const assets = path.join(root, 'assets'); await mkdir(assets); await mkdir(path.join(root, 'recovery'));
  const source = path.join(root, 'source.png');
  await execute(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1024x768,format=rgba', '-frames:v', '1', '-y', source], { windowsHide: true });
  return { root, assets, source };
}
it('只保存更小且 RGBA 像素一致的无损 WebP，重复导入独立编号', async () => {
  const { assets, source } = await fixture();
  const name = await storeImage(source, assets, 'image.png', 'lossless');
  expect(name).toBe('图片-001.webp');
  expect((await stat(path.join(assets, name))).size).toBeLessThan((await stat(source)).size);
  const digest = async (file: string) => (await execute(ffmpeg, ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', 'setsar=1', '-pix_fmt', 'rgba', '-f', 'framemd5', '-'])).stdout;
  expect(await digest(source)).toBe(await digest(path.join(assets, name)));
  expect(await storeImage(source, assets, 'image.png', 'lossless')).toBe('图片-002.webp');
});
it('默认有损 AVIF 保持尺寸并明显减少体积，透明图片使用 alpha 不变的 WebP', async () => {
  const { root, assets, source } = await fixture();
  const avif = await storeImage(source, assets, '照片.png');
  expect(avif).toBe('照片-001.avif');
  expect((await stat(path.join(assets, avif))).size).toBeLessThan((await stat(source)).size);
  const probe = ffmpeg.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
  const metadata = JSON.parse((await execute(probe, ['-v', 'error', '-show_entries', 'stream=width,height,pix_fmt,color_space,color_transfer,color_primaries', '-of', 'json', path.join(assets, avif)])).stdout).streams[0];
  expect(metadata).toEqual({ width: 1024, height: 768, pix_fmt: 'yuv444p10le', color_space: 'bt709', color_transfer: 'iec61966-2-1', color_primaries: 'bt709' });
  const transparent = path.join(root, 'transparent.png');
  await execute(ffmpeg, ['-v', 'error', '-i', source, '-vf', 'colorchannelmixer=aa=0.5', '-frames:v', '1', '-y', transparent], { windowsHide: true });
  const webp = await storeImage(transparent, assets, '透明.png');
  expect(webp.endsWith('.webp')).toBe(true);
  const alpha = async (file: string) => (await execute(ffmpeg, ['-v', 'error', '-i', file, '-vf', 'format=rgba,alphaextract', '-frames:v', '1', '-f', 'md5', '-'])).stdout;
  expect(await alpha(path.join(assets, webp))).toBe(await alpha(transparent));
});
it('预览按档位缩小，不放大小图，同一请求复用文件且拒绝任意档位', async () => {
  const { root, source } = await fixture();
  const [a, b] = await Promise.all([imagePreview(root, source, 128), imagePreview(root, source, 128)]);
  expect(a).toBe(b);
  const probe = ffmpeg.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
  const dimensions = async (file: string) => JSON.parse((await execute(probe, ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', file])).stdout).streams[0];
  expect(await dimensions(a)).toEqual({ width: 128, height: 96 });
  expect(await dimensions(await imagePreview(root, source, 2048))).toEqual({ width: 1024, height: 768 });
  await expect(imagePreview(root, source, 777)).rejects.toThrow('尺寸无效');
});
it('已压缩 JPEG、动画 PNG 和色彩配置图片不重编码，损坏 PNG 可按原样保存', async () => {
  const { root, source, assets } = await fixture();
  await copyFile('tests/fixtures/sample.jpg', path.join(root, 'source.jpg'));
  const jpg = await storeImage(path.join(root, 'source.jpg'), assets, '照片.jpg');
  expect(await readFile(path.join(assets, jpg))).toEqual(await readFile(path.join(root, 'source.jpg')));
  const png = await readFile(source);
  for (const type of ['acTL', 'iCCP']) {
    const chunk = Buffer.alloc(12); chunk.write(type, 4);
    const file = path.join(root, `${type}.png`); await writeFile(file, Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]));
    const name = await storeImage(file, assets, `${type}.png`);
    expect(name.endsWith('.png')).toBe(true);
    expect(await readFile(path.join(assets, name))).toEqual(await readFile(file));
  }
  await writeFile(path.join(root, 'bad.png'), 'bad');
  expect(await storeImage(path.join(root, 'bad.png'), assets, 'bad.png')).toBe('bad-001.png');
});
it('整理同步主文档与全部恢复引用，移除替换的原件，重复执行保持稳定', async () => {
  const { root, source, assets } = await fixture();
  await copyFile(source, path.join(assets, 'source.png'));
  const doc = newDocument('整理测试'), assetId = crypto.randomUUID();
  doc.assets.push({ id: assetId, name: 'source.png', path: 'assets/source.png', kind: 'image', status: 'ready' });
  doc.objects.push({ id: crypto.randomUUID(), kind: 'image', assetId, x: 1, y: 2, width: 200, height: 150, groupId: null, crop: { x: .1, y: .2, width: .7, height: .6 } });
  for (const relative of ['project.json', 'recovery/latest.json']) await writeFile(path.join(root, relative), JSON.stringify(doc));
  const result = await optimizeProjectImages(root);
  expect(result.count).toBe(1); expect(result.after).toBeLessThan(result.before);
  const current = JSON.parse(await readFile(path.join(root, 'project.json'), 'utf8'));
  expect(current.objects).toEqual(doc.objects); expect(current.assets[0].id).toBe(assetId);
  expect(current.assets[0].path).toBe('assets/source-001.avif');
  expect(JSON.parse(await readFile(path.join(root, 'recovery/latest.json'), 'utf8')).assets).toEqual(current.assets);
  expect(await readdir(assets)).toEqual(['source-001.avif']);
  expect((await optimizeProjectImages(root)).count).toBe(0);
  expect(await finishImageOptimization(root)).toBeNull();
});
it('事务日志可重复恢复，并在写盘前拒绝越界路径', async () => {
  const { root } = await fixture(), doc = newDocument('恢复测试');
  const journal = { updates: [{ relative: 'project.json', content: JSON.stringify(doc) }], obsolete: [], count: 0, before: 0, after: 0 };
  await writeFile(path.join(root, '.image-optimization.json'), JSON.stringify(journal));
  await finishImageOptimization(root);
  expect(JSON.parse(await readFile(path.join(root, 'project.json'), 'utf8')).id).toBe(doc.id);
  journal.updates.push({ relative: '../escape.json', content: '{}' });
  await writeFile(path.join(root, '.image-optimization.json'), JSON.stringify(journal));
  await expect(finishImageOptimization(root)).rejects.toThrow('日志路径无效');
  expect(JSON.parse(await readFile(path.join(root, 'project.json'), 'utf8')).id).toBe(doc.id);
});

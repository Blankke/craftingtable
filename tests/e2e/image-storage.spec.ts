// 用法：npm.cmd run test:e2e -- tests/e2e/image-storage.spec.ts。
// 在真实桌面中验证 300 张大图的按需解码、重复图片共享、离场释放、全尺寸导出和导入压缩。
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { newDocument } from '../../src/core/document';
type BitmapStats = { active: number; bytes: number; peak: number; decoded: number; largest: number };
test('300 张大图按需解码、有损无损切换与全尺寸导出', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-image-scale-')), folder = path.join(root, 'projects', 'large-images');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  const source = path.join(root, 'source.png'), tools = path.resolve('vendor', `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`);
  await promisify(execFile)(path.join(tools, 'ffmpeg' + (process.platform === 'win32' ? '.exe' : '')), ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=4096x3072,format=rgba', '-frames:v', '1', '-y', source], { windowsHide: true });
  const doc = newDocument('数百张图片验收');
  for (let i = 0; i < 300; i++) {
    const id = crypto.randomUUID(), name = `${i}.png`;
    await copyFile(source, path.join(folder, 'assets', name));
    doc.assets.push({ id, name, path: `assets/${name}`, kind: 'image', status: 'ready' });
    doc.objects.push({ id: crypto.randomUUID(), kind: 'image', assetId: id, x: 60 + i % 10 * 140, y: 60 + Math.floor(i / 10) * 100, width: 80, height: 60, groupId: null });
  }
  // 同一素材的第二个实例应共享已有位图。
  doc.objects.push({ ...doc.objects[0], id: crypto.randomUUID(), x: 70, y: 70 });
  await writeFile(path.join(folder, 'project.json'), JSON.stringify(doc));
  let app: ElectronApplication | undefined;
  try {
    const env: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: ['.'], env });
    const page = await app.firstWindow(), errors: string[] = [], requests: string[] = [], failedRequests: string[] = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (request.url().startsWith('project-media://asset/')) requests.push(request.url()); });
    page.on('requestfailed', request => { if (failedRequests.length < 20) failedRequests.push(`${request.url().slice(0, 120)}: ${request.failure()?.errorText}`); });
    page.on('response', response => { if (!response.ok() && failedRequests.length < 20) failedRequests.push(`${response.url().slice(0, 120)}: ${response.status()}`); });
    await expect(page.locator('.home')).toBeVisible();
    await page.evaluate(() => {
      const stats: BitmapStats = { active: 0, bytes: 0, peak: 0, decoded: 0, largest: 0 };
      (window as unknown as { bitmapStats: BitmapStats }).bitmapStats = stats;
      const decode = window.createImageBitmap.bind(window);
      window.createImageBitmap = (async (...args: Parameters<typeof decode>) => {
        const image = await decode(...args), bytes = image.width * image.height * 4, close = image.close.bind(image);
        stats.active++; stats.bytes += bytes; stats.decoded++; stats.peak = Math.max(stats.peak, stats.bytes); stats.largest = Math.max(stats.largest, image.width, image.height);
        let closed = false;
        image.close = () => { if (!closed) { closed = true; stats.active--; stats.bytes -= bytes; } close(); };
        return image;
      }) as typeof window.createImageBitmap;
    });
    await page.getByRole('button', { name: doc.name, exact: true }).click();
    const stats = () => page.evaluate(() => ({ ...(window as unknown as { bitmapStats: BitmapStats }).bitmapStats }));
    await expect.poll(async () => (await stats()).active, { timeout: 60_000 }).toBeGreaterThan(20);
    await expect.poll(() => page.locator('.asset-preview').first().evaluate(image => (image as HTMLImageElement).naturalWidth), { timeout: 20_000 }).toBe(128);
    const initial = await stats(); expect(initial.largest).toBe(128); expect(initial.peak).toBeLessThan(8 * 1024 * 1024);
    expect(requests.every(url => url.includes('edge=128'))).toBe(true);
    // 返回首页卸载画布，所有 ImageBitmap 必须关闭。
    await page.locator('header button').first().click(); await expect(page.locator('.home')).toBeVisible();
    await expect.poll(async () => (await stats()).active).toBe(0);
    await page.getByRole('button', { name: doc.name, exact: true }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    await expect.poll(async () => (await stats()).active, { timeout: 10_000 }).toBeGreaterThan(0).catch(async error => {
      console.log('重开诊断', JSON.stringify({ stats: await stats(), errors, failedRequests, requests: requests.length }));
      throw error;
    });
    // 改写复制出口以验收实际渲染，不依赖宿主机系统剪贴板权限。
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('editing:copy-graphic'); ipcMain.handle('editing:copy-graphic', () => true); });
    const box = (await page.locator('.canvas').boundingBox())!;
    await page.mouse.click(box.x + 100, box.y + 100, { button: 'right' });
    await page.locator('.context-menu > [data-id="png"]').click();
    await expect.poll(() => requests.some(url => /\/0\.png$/.test(url)), { timeout: 20_000 }).toBe(true);
    await expect.poll(async () => (await stats()).largest, { timeout: 20_000 }).toBe(4096);
    await expect.poll(async () => (await stats()).bytes, { timeout: 20_000 }).toBeLessThan(8 * 1024 * 1024);
    // 通过真实导入入口压缩，编号、协议解码与磁盘路径均来自主进程。
    await app.evaluate(({ dialog }, file) => { Object.defineProperty(dialog, 'showOpenDialog', { value: async () => ({ canceled: false, filePaths: [file] }) }); }, source);
    await page.getByRole('button', { name: /导入素材/ }).click();
    await expect.poll(async () => JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8')).assets.length, { timeout: 30_000 }).toBe(301);
    const asset = JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8')).assets.at(-1);
    expect(asset.path.endsWith('.avif')).toBe(true); expect((await stat(path.join(folder, asset.path))).size).toBeLessThan((await stat(source)).size);
    // 直接校验 Chromium 解码全尺寸 AVIF，覆盖原尺寸浏览与导出的实际输入。
    const avifSize = await page.evaluate(async relative => {
      const url = `project-media://asset/${relative.split('/').map(encodeURIComponent).join('/')}`;
      const image = await createImageBitmap(await (await fetch(url)).blob());
      try { return { width: image.width, height: image.height }; } finally { image.close(); }
    }, asset.path as string);
    expect(avifSize).toEqual({ width: 4096, height: 3072 });
    const originalReads = requests.filter(url => url.endsWith('/' + asset.path.split('/').at(-1))).length;
    await page.getByLabel('搜索素材', { exact: true }).fill(asset.name);
    await page.locator('.asset-row .asset').dblclick();
    await expect.poll(async () => JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8')).objects.length).toBe(302);
    const placed = JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8')).objects.at(-1);
    expect(placed).toMatchObject({ kind: 'image', assetId: asset.id, width: 400, height: 300, aspectLocked: true });
    expect(requests.filter(url => url.endsWith('/' + asset.path.split('/').at(-1))).length).toBe(originalReads);
    await expect(page.evaluate(() => window.workbench!.imageDimensions('assets/../../outside.png'))).rejects.toThrow();
    // 设置立即决定后续导入，并持久化；无损模式保留像素的测试由单元用例独立核验。
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const compression = page.getByLabel('图片压缩', { exact: true }); await expect(compression).toHaveValue('lossy');
    await compression.selectOption('lossless'); await expect(compression).toHaveValue('lossless');
    await expect.poll(async () => JSON.parse(await readFile(path.join(root, 'userdata', 'settings.json'), 'utf8')).imageCompression).toBe('lossless');
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await page.getByRole('button', { name: /导入素材/ }).click();
    await expect.poll(async () => JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8')).assets.length, { timeout: 30_000 }).toBe(302);
    const lossless = JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8')).assets.at(-1);
    expect(lossless.path.endsWith('.webp')).toBe(true);
    expect(errors).toEqual([]);
    await writeFile(testInfo.outputPath('image-memory.json'), JSON.stringify({ images: 300, sourceDimensions: [4096, 3072], initial, final: await stats() }, null, 2));
    await app.close();
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: ['.'], env });
    const reopened = await app.firstWindow();
    await reopened.getByRole('button', { name: '设置', exact: true }).click();
    await expect(reopened.getByLabel('图片压缩', { exact: true })).toHaveValue('lossless');
  } finally { await app?.close(); await rm(root, { recursive: true, force: true }); }
});

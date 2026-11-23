import { canvasTextFromPlainText } from '../../src/core/canvasText';
// 使用示例：npm run test:e2e。以实际创作规模验证多媒体、多实例和数十个画布对象的打开与保存。
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { newDocument, type CanvasObject, type ProjectDocument } from '../../src/core/document';

const electronExecutable = createRequire(import.meta.url)('electron') as string;
const fixtures = path.resolve('tests/fixtures');

async function seedProject(root: string): Promise<{ folder: string; document: ProjectDocument }> {
  const folder = path.join(root, 'projects', '创作规模样本-12345678');
  await Promise.all(['assets', 'cache', 'recovery'].map(name => mkdir(path.join(folder, name), { recursive: true })));
  const document = newDocument('创作规模样本');
  for (const file of ['sample.wav', 'sample.mp3', 'sample.mp4', 'sample.jpg', 'sample.png', 'sample.txt']) {
    const [kind, durationUs] = file.endsWith('.wav') || file.endsWith('.mp3') ? ['audio', 2_000_000] as const : file.endsWith('.mp4') ? ['video', 2_000_000] as const : file.endsWith('.txt') ? ['text', undefined] as const : ['image', undefined] as const;
    const relative = `assets/${crypto.randomUUID()}${path.extname(file)}`;
    await copyFile(path.join(fixtures, file), path.join(folder, relative));
    document.assets.push({ id: crypto.randomUUID(), name: file, path: relative, kind, status: 'ready', ...(durationUs ? { durationUs } : {}), ...(kind === 'text' ? { content: '中文创作素材' } : {}) });
  }
  const asset = (name: string) => document.assets.find(item => item.name === name)!;
  const mediaNames = ['sample.wav', 'sample.mp3', 'sample.mp4', 'sample.mp4'];
  for (const [index, name] of mediaNames.entries()) {
    document.objects.push({ id: crypto.randomUUID(), kind: 'media', assetId: asset(name).id, x: 70, y: 80 + index * 130, width: 220, height: 90, groupId: null, inUs: 0, outUs: 2_000_000, pixelsPerSecond: 75 });
  }
  for (let index = 0; index < 4; index++) {
    document.objects.push({ id: crypto.randomUUID(), kind: 'image', assetId: asset(index % 2 ? 'sample.png' : 'sample.jpg').id, x: 310 + index * 165, y: 30, width: 145, height: 82, groupId: null });
  }
  for (let index = 0; index < 30; index++) {
    const kind = index % 3 === 0 ? 'rectangle' : index % 3 === 1 ? 'ellipse' : 'diamond';
    document.objects.push({ id: crypto.randomUUID(), kind, x: 340 + index % 5 * 150, y: 150 + Math.floor(index / 5) * 105, width: 110, height: 65, groupId: null, fill: '#eef2ff', stroke: '#5268e8' });
  }
  const notes: Extract<CanvasObject, { kind: 'text' }>[] = [];
  for (let index = 0; index < 5; index++) {
    const note: Extract<CanvasObject, { kind: 'text' }> = { id: crypto.randomUUID(), kind: 'text', x: 345 + index * 150, y: 790, width: 130, height: 55, groupId: null, text: canvasTextFromPlainText(`中文说明 ${index + 1}`), fontSize: 16, color: '#172033', align: 'left' };
    notes.push(note);
    document.objects.push(note);
  }
  // 一个父组包含两个直接成员和一个子组，用真实文档验证嵌套关系能被读取。
  const parentId = crypto.randomUUID(), childId = crypto.randomUUID();
  document.groups.push({ id: parentId, parentId: null }, { id: childId, parentId });
  document.objects.slice(8, 10).forEach(item => { item.groupId = parentId; });
  document.objects.slice(10, 12).forEach(item => { item.groupId = childId; });
  for (const [index, media] of document.objects.slice(0, 4).entries()) {
    const markerId = crypto.randomUUID();
    document.markers.push({ id: markerId, mediaId: media.id, timeUs: 1_000_000, note: `节拍 ${index + 1}` });
    document.connections.push({ id: crypto.randomUUID(), from: { kind: 'time', markerId }, to: { kind: 'object', objectId: notes[index].id }, routing: 'straight' });
  }
  await writeFile(path.join(folder, 'project.json'), JSON.stringify(document), 'utf8');
  return { folder, document };
}

test('实际创作规模项目能打开、显示素材并保存新增对象', async () => {
  const testRoot = await mkdtemp(path.join(os.tmpdir(), 'workbench-scale-'));
  let application: ElectronApplication | undefined;
  try {
    const seeded = await seedProject(testRoot);
    const missingAsset = seeded.document.assets.find(item => item.name === 'sample.mp3')!;
    // 删除测试副本，验证缺失素材不会破坏轨道与标记，并可从界面重新关联。
    await rm(path.join(seeded.folder, missingAsset.path));
    const outside = path.join(testRoot, 'outside-assets');
    await mkdir(outside);
    await writeFile(path.join(outside, 'secret.txt'), '项目外文件', 'utf8');
    await symlink(outside, path.join(seeded.folder, 'assets', 'external'), 'junction');
    const environment: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: testRoot };
    delete environment.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({ executablePath: electronExecutable, args: ['.'], env: environment });
    const page = await application.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('button', { name: '创作规模样本' }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    // 媒体播放头定位依赖 206 字节段响应；直接检查安装包使用的同一本地协议。
    const audioPath = seeded.document.assets.find(item => item.name === 'sample.wav')!.path;
    const ranged = await application.evaluate(async ({ net }, url) => {
      const response = await net.fetch(url, { headers: { range: 'bytes=0-99' } });
      return { status: response.status, contentRange: response.headers.get('content-range'), bytes: (await response.arrayBuffer()).byteLength };
    }, `project-media://asset/${audioPath}`);
    expect(ranged).toEqual({ status: 206, contentRange: expect.stringMatching(/^bytes 0-99\/\d+$/), bytes: 100 });
    const escapedStatus = await application.evaluate(async ({ net }, url) => (await net.fetch(url)).status, 'project-media://asset/assets/external/secret.txt');
    expect(escapedStatus).toBe(403);
    const escapedAnalysis = await page.evaluate(() => window.workbench!.analyzeAsset({ assetId: crypto.randomUUID(), assetPath: 'assets/external/secret.txt', kind: 'audio', inUs: 0, outUs: 1_000_000, pixelsPerSecond: 30, taskId: crypto.randomUUID() }));
    expect(escapedAnalysis).toMatchObject({ ok: false, error: { message: '媒体分析路径或区间无效' } });
    await expect(page.locator('.asset-row')).toHaveCount(6);
    await expect(page.locator('.asset-row').filter({ hasText: 'sample.mp3' })).toContainText('文件缺失');
    await expect(page.locator('.konvajs-content canvas').first()).toBeVisible();
    await expect.poll(async () => page.locator('.asset-row').filter({ hasText: 'sample.mp4' }).locator('img.asset-preview').evaluateAll(images => images.some(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    // 四条轨道中两条引用同一个视频，缓存生成必须共享结果且不能留下失败任务。
    await expect(page.locator('.task-list')).toHaveCount(0, { timeout: 15_000 });
    // Electron 对话框在测试进程中指向固定样本，仍通过真实 preload 和后台复制流程。
    await application.evaluate(({ dialog }, source) => { Object.defineProperty(dialog, 'showOpenDialog', { value: async () => ({ canceled: false, filePaths: [source] }) }); }, path.join(fixtures, 'sample.mp3'));
    await page.getByRole('button', { name: '重新关联 sample.mp3' }).click();
    await expect(page.locator('.asset-row').filter({ hasText: 'sample.mp3' })).toContainText('就绪');
    await expect(page.locator('.task-list')).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(async () => {
      const snapshot = JSON.parse(await readFile(path.join(seeded.folder, 'project.json'), 'utf8')) as ProjectDocument;
      const updated = snapshot.assets.find(item => item.id === missingAsset.id);
      if (!updated || updated.path === missingAsset.path) return false;
      const sourceKey = createHash('sha256').update(updated.path).digest('hex').slice(0, 12);
      return (await readdir(path.join(seeded.folder, 'cache'))).some(file => file.startsWith(`${updated.id}-${sourceKey}-`) && file.endsWith('-wave-v1.bin'));
    }, { timeout: 15_000 }).toBe(true);
    await page.mouse.click(100, 180);
    await expect(page.locator('.media-controls')).toContainText('sample.wav');
    await expect(page.locator('.marker-row')).toHaveCount(1);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect(page.getByRole('slider', { name: '显示长度' })).toHaveValue('83');
    await page.getByRole('button', { name: '裁剪', exact: true }).click();
    const trimStart = page.getByRole('spinbutton', { name: '裁剪起点' });
    const trimEnd = page.getByRole('spinbutton', { name: '裁剪终点' });
    await trimStart.fill('0.2');
    await trimStart.press('Enter');
    await trimEnd.fill('10');
    await trimEnd.press('Enter');
    await expect(trimEnd).toHaveValue('2.00');
    await trimEnd.fill('1.6');
    await trimEnd.press('Enter');
    await page.getByRole('button', { name: '完成裁剪' }).click();
    const markerTime = page.getByRole('spinbutton', { name: '标记源时间（秒）' });
    await markerTime.fill('1.25');
    await markerTime.press('Enter');
    await page.getByRole('button', { name: '播放标记' }).click();
    await expect(page.locator('.media-row').first().getByRole('button', { name: '暂停' })).toBeVisible();
    await expect(page.locator('.media-row').first().getByRole('button', { name: '播放', exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.media-row').first()).toContainText('1.6s / 1.6s');
    await expect.poll(async () => page.locator('audio').evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(1.55);
    await expect(page.locator('audio')).toHaveJSProperty('paused', true);
    await page.getByRole('button', { name: '矩形', exact: true }).dblclick();
    await page.locator('header button').first().click();
    await expect(page.locator('.home')).toBeVisible();
    const saved = JSON.parse(await readFile(path.join(seeded.folder, 'project.json'), 'utf8')) as ProjectDocument;
    expect(saved.objects).toHaveLength(seeded.document.objects.length + 1);
    expect(saved.assets).toHaveLength(6);
    expect(saved.assets.find(item => item.id === missingAsset.id)?.path).not.toBe(missingAsset.path);
    expect(saved.markers).toHaveLength(4);
    expect(saved.markers.find(item => item.mediaId === seeded.document.objects[0].id)?.timeUs).toBe(1_250_000);
    expect(saved.camera.scale).toBe(1);
    expect(saved.objects.find(item => item.id === seeded.document.objects[0].id)).toMatchObject({ kind: 'media', inUs: 200_000, outUs: 1_600_000, pixelsPerSecond: 83 });
    expect(saved.connections).toHaveLength(4);
    expect(saved.groups).toHaveLength(2);
    expect(errors).toEqual([]);
  } finally {
    await application?.close();
    // 只清理本测试创建的临时项目和数据目录。
    await rm(testRoot, { recursive: true, force: true }).catch(() => undefined);
  }
});

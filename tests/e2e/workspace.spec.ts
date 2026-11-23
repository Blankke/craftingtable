// 用法：npm.cmd run test:e2e -- tests/e2e/workspace.spec.ts。验证真实 preload 文件拖入、虚影取消、图片属性及标记笔记。
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import type { ProjectDocument } from '../../src/core/document';

test('拖放、图片比例和标记笔记形成可撤销的操作', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-interaction-'));
  let app: ElectronApplication | undefined;
  try {
    const env: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: ['.'], env });
    const page = await app.firstWindow(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.locator('.plus').click(); await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page.getByLabel('项目名称').fill('交互验收'); await page.getByRole('button', { name: '创建项目', exact: true }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    const folder = path.join(root, 'projects', (await readdir(path.join(root, 'projects')))[0]);
    const saved = async (): Promise<ProjectDocument> => JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8'));
    // input 提供真实磁盘 File，DataTransfer 只模拟释放事件，仍经过 webUtils、IPC 和后台导入。
    await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.id = 'drop-source'; input.style.display = 'none'; document.body.append(input); });
    await page.locator('#drop-source').setInputFiles([path.resolve('tests/fixtures/sample.png'), path.resolve('tests/fixtures/sample.wav')]);
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('#drop-source')!, transfer = new DataTransfer();
      Array.from(input.files!).forEach(file => transfer.items.add(file));
      document.querySelector('.canvas')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 100, clientY: 160, dataTransfer: transfer }));
    });
    await expect.poll(async () => (await saved()).objects.length).toBe(2);
    const initial = await saved(), image = initial.objects[0], media = initial.objects[1];
    const box = await page.locator('.canvas').boundingBox(); expect(box).not.toBeNull();
    const point = (x: number, y: number) => ({ x: box!.x + x, y: box!.y + y });
    const imagePoint = point(image.x + 20, image.y + 20);
    await page.mouse.click(imagePoint.x, imagePoint.y);
    await page.getByRole('button', { name: '编辑视图' }).click(); await page.getByRole('tab', { name: '排列' }).click();
    await expect(page.getByLabel('锁定比例')).toBeChecked();
    const width = page.getByLabel('宽度', { exact: true }); await width.fill('320'); await width.press('Enter');
    await expect.poll(async () => (await saved()).objects[0].width).toBe(320);
    expect((await saved()).objects[0].height).toBeCloseTo(320 * image.height / image.width);
    await page.getByLabel('锁定比例').uncheck(); await page.getByLabel('高度', { exact: true }).fill('140'); await page.getByLabel('高度', { exact: true }).press('Enter');
    await expect.poll(async () => (await saved()).objects[0].height).toBe(140);
    // 取消移动时事实文档与修订号均不发生变化。
    const before = await saved();
    await page.mouse.move(imagePoint.x, imagePoint.y); await page.mouse.down(); await page.mouse.move(imagePoint.x + 100, imagePoint.y + 80, { steps: 8 });
    await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' }); await page.mouse.up();
    expect((await saved()).objects[0].x).toBe(before.objects[0].x);
    expect((await saved()).revision).toBe(before.revision);
    await page.mouse.move(imagePoint.x, imagePoint.y); await page.mouse.down(); await page.mouse.move(imagePoint.x + 80, imagePoint.y, { steps: 8 });
    expect((await saved()).objects[0].x).toBe(before.objects[0].x);
    await page.mouse.up(); await expect.poll(async () => (await saved()).objects[0].x).toBe(before.objects[0].x + 80);
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect.poll(async () => (await saved()).objects[0].x).toBe(before.objects[0].x);
    await page.mouse.click(imagePoint.x, imagePoint.y);
    await page.getByRole('tab', { name: '排列' }).click();
    await page.getByLabel('裁剪宽度').fill('50'); await page.getByLabel('裁剪宽度').press('Enter');
    await expect.poll(async () => { const o = (await saved()).objects[0]; return o.kind === 'image' ? o.crop?.width : 0; }).toBe(.5);
    // 画布裁剪框的边角直接修改与数值字段相同的归一化裁剪数据。
    const cropped = (await saved()).objects[0];
    if (cropped.kind !== 'image' || !cropped.crop) throw Error('未创建图片裁剪区域');
    await page.mouse.move(box!.x + cropped.x + cropped.width * cropped.crop.width, box!.y + cropped.y + cropped.height * cropped.crop.height);
    await page.mouse.down(); await page.mouse.move(box!.x + cropped.x + cropped.width * cropped.crop.width - 30, box!.y + cropped.y + cropped.height * cropped.crop.height - 20, { steps: 5 }); await page.mouse.up();
    await expect.poll(async () => { const o = (await saved()).objects[0]; return o.kind === 'image' ? o.crop?.width ?? 1 : 1; }).toBeLessThan(.5);
    await page.getByRole('button', { name: '恢复原图' }).click();
    await expect.poll(async () => { const o = (await saved()).objects[0]; return o.kind === 'image' ? o.crop : null; }).toBeUndefined();
    // 侧栏宽度改变后画布实时跟随，素材库拖动右键取消不产生实例。
    const separator = await page.getByRole('separator', { name: '调整侧栏宽度' }).boundingBox();
    await page.mouse.move(separator!.x + 3, separator!.y + 80); await page.mouse.down(); await page.mouse.move(separator!.x - 40, separator!.y + 80, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await page.locator('.canvas').boundingBox())!.width).toBeLessThan(box!.width);
    const asset = page.locator('.asset').filter({ hasText: 'sample-001.png' }); await asset.scrollIntoViewIfNeeded();
    const assetBox = await asset.boundingBox();
    await page.mouse.move(assetBox!.x + 30, assetBox!.y + 20); await page.mouse.down(); await page.mouse.move(400, 300, { steps: 10 });
    await expect(page.locator('.canvas')).toHaveAttribute('data-placement-preview', 'image');
    await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' }); await page.mouse.up();
    await expect(page.locator('.canvas')).not.toHaveAttribute('data-placement-preview', /.+/); expect((await saved()).objects).toHaveLength(2);
    // 轨道先选择、M 打标、单击标记，再从独立连接柄拖出笔记。
    const track = point(media.x + 20, media.y + 45); await page.mouse.click(track.x, track.y);
    // 仅拖动波形不会创建标记和笔记。
    await page.mouse.move(track.x, track.y); await page.mouse.down(); await page.mouse.move(500, 480, { steps: 8 }); await page.mouse.up();
    expect((await saved()).markers).toHaveLength(0); expect((await saved()).objects).toHaveLength(2);
    await page.mouse.click(track.x, track.y); await page.keyboard.press('m');
    await expect.poll(async () => (await saved()).markers.length).toBe(1);
    const marker = (await saved()).markers[0];
    if (media.kind !== 'media') throw Error('未生成媒体轨道');
    const markerX = media.x + marker.timeUs / 1e6 * media.pixelsPerSecond;
    await page.mouse.click(box!.x + markerX, box!.y + media.y + 24);
    await page.mouse.move(box!.x + markerX, box!.y + media.y - 16); await page.mouse.down();
    await page.mouse.move(box!.x + 500, box!.y + 420, { steps: 10 }); await page.mouse.up();
    await expect(page.getByLabel('编辑画布文字')).toBeVisible(); await page.getByLabel('编辑画布文字').fill('标记笔记'); await page.getByRole('button', { name: '完成文字编辑' }).click();
    await expect.poll(async () => (await saved()).connections.length).toBe(1);
    const final = await saved(); expect(final.markers).toHaveLength(1); expect(final.objects).toHaveLength(3);
    expect(final.connections[0].from).toEqual({ kind: 'time', markerId: marker.id }); expect(errors).toEqual([]);
    await page.screenshot({ path: 'test-results/workspace.png' });
  } finally {
    await app?.close().catch(() => undefined);
    // 测试目录留在系统临时区供失败复查，不清理任何用户项目。
  }
});

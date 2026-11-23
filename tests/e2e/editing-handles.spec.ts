// 使用范例：npm.cmd run test:e2e -- tests/e2e/editing-handles.spec.ts。
// 四主题/缩放真实桌面验证四角、箭头两端、编号图片及受限资源管理器入口。
import { _electron, expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { newDocument, type ProjectDocument } from '../../src/core/document';

for (const scale of [1, 1.5]) for (const theme of ['light', 'dark']) test(`缩放点与箭头端点、图片素材 ${theme} ${scale * 100}%`, async ({}, info) => {
  test.setTimeout(90_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-handles-')), folder = path.join(root, 'projects', 'handles');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  const document = newDocument('缩放与端点验收'); document.camera = { x: 70, y: 40, scale: .5 };
  const shape = { id: crypto.randomUUID(), kind: 'rectangle' as const, x: 150, y: 120, width: 240, height: 160, groupId: null, fill: '#d8e5f3', stroke: '#274d7b' };
  document.objects.push(shape);
  for (const [index, routing] of (['straight', 'elbow', 'curve'] as const).entries()) document.connections.push({ id: crypto.randomUUID(), from: { kind: 'free', point: { x: 100, y: 500 + index * 220 } }, to: { kind: 'free', point: { x: 600, y: 600 + index * 220 } }, routing, style: { dash: 'dashed', endHead: 'arrow' } });
  await writeFile(path.join(folder, 'project.json'), JSON.stringify(document));
  const saved = async (): Promise<ProjectDocument> => JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8'));
  const env: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [`--force-device-scale-factor=${scale}`, '.'], env });
  try {
    await app.evaluate(({ BrowserWindow, shell }) => {
      BrowserWindow.getAllWindows()[0].setSize(1440, 960);
      const calls: string[] = []; (globalThis as unknown as { revealed: string[] }).revealed = calls;
      shell.showItemInFolder = file => { calls.push(file); };
    });
    const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    if (theme === 'dark') await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
    await page.getByRole('button', { name: document.name, exact: true }).click();
    const canvas = (await page.locator('.canvas').boundingBox())!;
    const point = (x: number, y: number) => ({ x: canvas.x + 70 + x * .5, y: canvas.y + 40 + y * .5 });
    // 高 DPI 的指针坐标存在亚像素换算误差；比较到一个世界像素（此处半个屏幕像素）。
    const roundedAnchor = (anchor: ProjectDocument['connections'][number]['from']) => anchor.kind === 'free' ? { ...anchor, point: { x: Math.round(anchor.point.x), y: Math.round(anchor.point.y) } } : anchor;
    const click = async (x: number, y: number) => { const p = point(x, y); await page.mouse.click(p.x, p.y); };
    const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => { const a = point(from.x, from.y), b = point(to.x, to.y); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 12 }); await page.mouse.up(); };
    const capture = async (name: string) => {
      // 等待字体与布局绘制完成，避免截到菜单出现前的合成帧。
      await page.evaluate(async () => { await window.document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
      const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
      await writeFile(info.outputPath(name), Buffer.from(png, 'base64'));
    };
    await click(250, 180); await expect(page.locator('.canvas')).toHaveAttribute('data-selected', shape.id);
    await capture('four-corners.png');
    for (const [x, y, dx, dy] of [[150, 120, -40, -30], [390, 120, 40, -30], [150, 280, -40, 30], [390, 280, 40, 30]]) {
      await drag({ x, y }, { x: x + dx, y: y + dy });
      await expect.poll(async () => (await saved()).objects[0].width).toBeCloseTo(280, 0);
      await expect.poll(async () => (await saved()).objects[0].height).toBeCloseTo(190, 0);
      await page.keyboard.press('Control+z'); await expect.poll(async () => (await saved()).objects[0]).toMatchObject(shape);
    }
    for (const [index, connection] of document.connections.entries()) {
      const y = 500 + index * 220;
      await click(350, connection.routing === 'elbow' ? y : y + 50);
      await capture(`arrow-${connection.routing}.png`);
      await drag({ x: 100, y }, { x: 50, y: y + 40 });
      await expect.poll(async () => roundedAnchor((await saved()).connections[index].from)).toEqual({ kind: 'free', point: { x: 50, y: y + 40 } });
      await page.keyboard.press('Control+z'); await expect.poll(async () => (await saved()).connections[index]).toEqual(connection);
      await drag({ x: 600, y: y + 100 }, { x: 650, y: y + 160 });
      await expect.poll(async () => roundedAnchor((await saved()).connections[index].to)).toEqual({ kind: 'free', point: { x: 650, y: y + 160 } });
      await page.keyboard.press('Control+z'); await expect.poll(async () => (await saved()).connections[index]).toEqual(connection);
    }
    await click(350, 550);
    const beforeCancel = await saved(), from = point(100, 500), moving = point(50, 540);
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(moving.x, moving.y, { steps: 8 });
    await page.keyboard.press('Escape'); await page.mouse.up();
    expect((await saved()).connections).toEqual(beforeCancel.connections);
    expect((await saved()).revision).toBe(beforeCancel.revision);
    await drag({ x: 100, y: 500 }, { x: 270, y: 200 });
    await expect.poll(async () => (await saved()).connections[0].from).toEqual({ kind: 'object', objectId: shape.id });
    await page.keyboard.press('Control+z'); await expect.poll(async () => (await saved()).connections[0]).toEqual(document.connections[0]);
    // 通过浏览器粘贴事件导入真实 PNG，两次粘贴不能同名或互相覆盖。
    const bytes = [...await readFile('build/source/Crafting_Table_JE4_BE3.png')];
    for (let i = 1; i <= 2; i++) {
      await page.evaluate(bytes => { const data = new DataTransfer(); data.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' })); window.document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); }, bytes);
      await expect.poll(async () => (await saved()).assets.length).toBe(i);
    }
    const assets = (await saved()).assets;
    expect(assets.map(asset => asset.name)).toEqual(['图片-001.png', '图片-002.png']);
    expect(await readFile(path.join(folder, assets[0].path))).toEqual(Buffer.from(bytes));
    await page.locator('.asset-row').filter({ hasText: '图片-002.png' }).click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '在资源管理器中显示', exact: true })).toBeVisible();
    await capture('asset-context.png');
    await page.getByRole('menuitem', { name: '在资源管理器中显示', exact: true }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { revealed: string[] }).revealed)).toEqual([path.join(folder, assets[1].path)]);
    await expect(page.evaluate(() => window.workbench!.revealAsset('assets/../../outside.txt'))).rejects.toThrow('素材路径无效');
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

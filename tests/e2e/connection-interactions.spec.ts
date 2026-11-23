// 用法：npm.cmd run test:e2e -- tests/e2e/connection-interactions.spec.ts。
// 真实鼠标覆盖箭头整体/混合移动、标准端口、中文加粗和首页卡片跳转，不依赖系统剪贴板。
import { _electron, expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { newDocument, type ProjectDocument } from '../../src/core/document';
import { newNote } from '../../src/core/note';
import { emptyCanvasText } from '../../src/core/canvasText';

for (const scale of [1, 1.5]) for (const theme of ['light', 'dark']) test(`连接、正文与项目入口 ${theme} ${scale * 100}%`, async ({}, info) => {
  test.setTimeout(90_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-connect-')), folder = path.join(root, 'projects', 'connect');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  const doc = newDocument('连接与输入验收'); doc.notes.push(newNote('现场笔记'));
  const assetId = crypto.randomUUID(); await copyFile('tests/fixtures/sample.png', path.join(folder, 'assets', 'sample.png'));
  doc.assets.push({ id: assetId, kind: 'image', name: 'sample.png', path: 'assets/sample.png', status: 'ready' });
  const shape = { id: crypto.randomUUID(), kind: 'rectangle' as const, x: 100, y: 100, width: 180, height: 100, groupId: null, fill: '#e0ebff', stroke: '#315a87' };
  const text = { id: crypto.randomUUID(), kind: 'text' as const, x: 450, y: 100, width: 360, height: 120, groupId: null, text: emptyCanvasText(), fontSize: 18, color: '#172033', align: 'left' as const };
  const line = { id: crypto.randomUUID(), routing: 'straight' as const, from: { kind: 'free' as const, point: { x: 100, y: 350 } }, to: { kind: 'free' as const, point: { x: 400, y: 350 } } };
  doc.objects.push(shape, text); doc.connections.push(line);
  await writeFile(path.join(folder, 'project.json'), JSON.stringify(doc));
  const saved = async (): Promise<ProjectDocument> => JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8'));
  // Windows 150% 的鼠标坐标会有亚像素换算，按一个世界像素核对几何。
  const firstPoint = async () => { const anchor = (await saved()).connections[0].from; return anchor.kind === 'free' ? { x: Math.round(anchor.point.x), y: Math.round(anchor.point.y) } : null; };
  const env: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [`--force-device-scale-factor=${scale}`, '.'], env });
  try {
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1440, 960); BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false); });
    const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    if (theme === 'dark') await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
    await page.getByRole('button', { name: '主题', exact: true }).click();
    expect(await page.locator('.theme-card b').evaluateAll(nodes => nodes.every(el => el.scrollWidth <= el.clientWidth))).toBe(true);
    await expect(page.locator('.theme-card button button')).toHaveCount(0);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    // 三张卡片应直达对应区域；先用可访问键盘激活，鼠标点击另外覆盖画布入口。
    const openSection = async (name: string) => {
      await page.locator('.gf-hit').hover(); await page.waitForTimeout(800);
      const card = page.locator('.gf-sheet').filter({ has: page.locator('.gf-sheet-name', { hasText: name }) });
      await card.focus(); await card.press('Enter');
    };
    await openSection('笔记'); await expect(page.locator('.note-workspace')).toBeVisible();
    await page.getByRole('button', { name: '‹ 项目', exact: true }).click();
    await openSection('素材'); await expect(page.locator('.library-panel')).toBeVisible(); await expect(page.locator('.tools-panel')).toHaveCount(0);
    await page.getByRole('button', { name: '‹ 项目', exact: true }).click();
    await page.locator('.gf-hit').hover(); await page.waitForTimeout(800);
    await page.locator('.gf-sheet').filter({ has: page.locator('.gf-sheet-name', { hasText: '画布' }) }).click({ position: { x: 40, y: 18 } });
    await expect(page.locator('.canvas')).toBeVisible();
    const canvas = (await page.locator('.canvas').boundingBox())!;
    const click = async (x: number, y: number) => page.mouse.click(canvas.x + x, canvas.y + y);
    const startDrag = async (x: number, y: number, dx: number, dy: number) => { await page.mouse.move(canvas.x + x, canvas.y + y); await page.mouse.down(); await page.mouse.move(canvas.x + x + dx, canvas.y + y + dy, { steps: 12 }); };
    const drag = async (x: number, y: number, dx: number, dy: number) => { await startDrag(x, y, dx, dy); await page.mouse.up(); };
    const capture = async (name: string) => {
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
      await writeFile(info.outputPath(`${name}.png`), Buffer.from(png, 'base64'));
    };
    // 合成实际画布像素，检查原件和虚影同时可见及透明度，不读取内部 React/Konva 状态。
    const alphaAt = async (x: number, y: number) => page.locator('.canvas').evaluate((host, point) => {
      const buffer = document.createElement('canvas'); buffer.width = host.clientWidth; buffer.height = host.clientHeight;
      const context = buffer.getContext('2d')!;
      for (const canvas of host.querySelectorAll('canvas')) context.drawImage(canvas, 0, 0, canvas.clientWidth, canvas.clientHeight);
      const pixels = context.getImageData(point.x, point.y, 20, 6).data;
      let alpha = 0; for (let i = 3; i < pixels.length; i += 4) alpha = Math.max(alpha, pixels[i]);
      return alpha / 255;
    }, { x, y });
    const expectGhost = async (x: number, y: number) => { await expect.poll(() => alphaAt(x, y)).toBeGreaterThan(.25); expect(await alphaAt(x, y)).toBeLessThan(.6); };
    const initial = await saved();
    await click(250, 350); await startDrag(250, 350, 40, 40); await capture('arrow-drag');
    expect(await saved()).toEqual(initial);
    expect(await alphaAt(200, 347)).toBeGreaterThan(.9); await expectGhost(240, 387);
    await page.keyboard.press('Escape'); await page.mouse.up();
    await expect.poll(() => alphaAt(240, 387)).toBe(0); expect(await saved()).toEqual(initial);
    await startDrag(250, 350, 40, 40); await page.mouse.up();
    await expect.poll(firstPoint).toEqual({ x: 140, y: 390 });
    await page.keyboard.press('Control+z'); await expect.poll(async () => (await saved()).connections[0]).toEqual(line);
    await drag(70, 70, 350, 310); // 同时框住矩形和整条连线，排除文本框。
    const beforeMixed = await saved();
    await startDrag(180, 150, 30, 20); await capture('mixed-drag');
    expect(await saved()).toEqual(beforeMixed); expect(await alphaAt(200, 347)).toBeGreaterThan(.9);
    await expectGhost(240, 367); await expectGhost(180, 207);
    await page.mouse.up();
    await expect.poll(async () => (await saved()).objects[0].x).toBeCloseTo(130, 0);
    await expect.poll(firstPoint).toEqual({ x: 130, y: 370 });
    await page.keyboard.press('Control+z'); await expect.poll(async () => (await saved()).objects[0].x).toBe(100);
    await expect.poll(async () => (await saved()).connections[0]).toEqual(line);
    // 从矩形右侧附着点拖至文本框左侧，不需要先切换箭头工具。
    await click(180, 150); await startDrag(280, 150, 164, 16); await capture('arrow-snap');
    // 指针停在端口外侧，吸附环仍在端口中心；离开、重新进入和滞回保持均用真实指针检查。
    expect(await alphaAt(457, 157)).toBeGreaterThan(.5);
    expect(await alphaAt(340, 152)).toBeGreaterThan(.8);
    await page.mouse.move(canvas.x + 425, canvas.y + 160, { steps: 4 });
    await expect.poll(() => alphaAt(457, 157)).toBe(0);
    await page.mouse.move(canvas.x + 444, canvas.y + 166, { steps: 4 });
    await expect.poll(() => alphaAt(457, 157)).toBeGreaterThan(.5);
    await page.mouse.move(canvas.x + 436, canvas.y + 160, { steps: 4 });
    await expect.poll(() => alphaAt(457, 157)).toBeGreaterThan(.5);
    await page.mouse.up();
    await expect.poll(async () => (await saved()).connections.length).toBe(2);
    await expect.poll(async () => (await saved()).connections[1]).toMatchObject({ from: { kind: 'object', objectId: shape.id, port: 'e' }, to: { kind: 'object', objectId: text.id, port: 'w' } });
    // 已有箭头的端点使用同样的磁吸反馈；取消不能留下端点变化或高亮。
    await click(250, 350); const beforeEndpoint = await saved();
    await startDrag(400, 350, 44, -184); await capture('endpoint-snap');
    expect(await alphaAt(457, 157)).toBeGreaterThan(.5);
    await page.keyboard.press('Escape'); await page.mouse.up();
    await expect.poll(() => alphaAt(457, 157)).toBe(0);
    expect((await saved()).connections).toEqual(beforeEndpoint.connections);
    await click(180, 150);
    await drag(180, 150, 20, 30); await expect.poll(async () => (await saved()).objects[0].x).toBeCloseTo(120, 0);
    expect((await saved()).connections[1].from).toMatchObject({ objectId: shape.id, port: 'e' });
    await page.mouse.dblclick(canvas.x + 530, canvas.y + 150);
    const input = page.getByRole('textbox', { name: '编辑画布文字', exact: true }); await expect(input).toBeVisible();
    const prefix = '着玻璃还能听见刹车的泄气声。我举起手腕看了一眼，';
    await input.focus(); await page.keyboard.insertText(prefix);
    await expect(input).toHaveText(prefix);
    await input.pressSequentially('**7:30 a.m.**', { delay: 35 });
    await expect(input.locator('strong')).toHaveText('7:30 a.m.');
    await expect(input).toHaveText(prefix + '7:30 a.m.');
    await page.getByRole('button', { name: '完成文字编辑', exact: true }).click();
    await expect.poll(async () => JSON.stringify((await saved()).objects[1])).toContain('"bold"');
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    await writeFile(info.outputPath('connections-text.png'), Buffer.from(png, 'base64'));
    await page.getByRole('button', { name: '‹ 项目', exact: true }).click(); await openSection('画布'); await expect(page.locator('.canvas')).toBeVisible();
    await page.locator('.canvas canvas').first().waitFor({ state: 'visible' });
    // 容器可见时 Konva 的命中图可能尚未绘制，等待重新挂载的两帧后再双击。
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const reopened = (await page.locator('.canvas').boundingBox())!;
    await page.mouse.dblclick(reopened.x + 530, reopened.y + 150); await expect(input.locator('strong')).toHaveText('7:30 a.m.'); await expect(input).toHaveText(prefix + '7:30 a.m.');
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

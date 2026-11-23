// 使用范例：npm.cmd run test:e2e -- tests/e2e/image-stack.spec.ts。
// 真实桌面验证多图收起、翻页、逐图备注、拆开、撤销与持久化；明暗及 100%/150% 截图使用原生窗口采集。
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { newDocument, type ProjectDocument } from '../../src/core/document';

for (const scale of [1, 1.5]) for (const theme of ['light', 'dark']) test(`叠图浏览与逐图备注 ${theme} ${scale * 100}%`, async ({}, testInfo) => {
  test.setTimeout(60_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-image-stack-'));
  const folder = path.join(root, 'projects', '叠图');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  const document = newDocument('叠图备注验收');
  for (const [index, source] of ['build/source/Crafting_Table_JE4_BE3.png', 'tests/fixtures/sample.jpg', 'tests/fixtures/sample.png'].entries()) {
    const assetId = crypto.randomUUID(), name = `${index + 1}${path.extname(source)}`;
    await copyFile(source, path.join(folder, 'assets', name));
    document.assets.push({ id: assetId, name, path: `assets/${name}`, kind: 'image', status: 'ready' });
    document.objects.push({ id: crypto.randomUUID(), kind: 'image', assetId, x: 90 + index * 270, y: 110, width: 220, height: 180, groupId: null, aspectLocked: true });
  }
  await writeFile(path.join(folder, 'project.json'), JSON.stringify(document));
  const saved = async (): Promise<ProjectDocument> => JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8'));
  let app: ElectronApplication | undefined;
  try {
    const env: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [`--force-device-scale-factor=${scale}`, '.'], env });
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(1440, 960); window.webContents.setBackgroundThrottling(false); });
    const page = await app.firstWindow(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const capture = async (name: string) => {
      await page.evaluate(async () => { await window.document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
      const png = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
      await writeFile(testInfo.outputPath(name), Buffer.from(png, 'base64'));
    };
    if (theme === 'dark') await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
    await page.getByRole('button', { name: document.name, exact: true }).click();
    const canvas = (await page.locator('.canvas').boundingBox())!;
    await page.waitForTimeout(1800); await capture('separate-before.png');
    await page.mouse.click(canvas.x + 150, canvas.y + 180);
    await page.keyboard.down('Shift');
    await page.mouse.click(canvas.x + 420, canvas.y + 180);
    await page.keyboard.up('Shift');
    await page.mouse.click(canvas.x + 150, canvas.y + 180, { button: 'right' });
    await page.getByRole('menuitem', { name: '收起为叠图', exact: true }).click();
    await expect.poll(async () => (await saved()).objects.length).toBe(2);
    expect((await saved()).objects[0].kind).toBe('imageStack');
    await page.keyboard.press('Control+z'); await expect.poll(async () => (await saved()).objects.length).toBe(3);
    await page.keyboard.press('Control+y'); await expect.poll(async () => (await saved()).objects.length).toBe(2);
    // 原叠图与剩余单图再次多选，仍提供收起；Ctrl+Z 恢复原来的叠图及单张图片。
    await page.keyboard.press('Control+A');
    await page.mouse.click(canvas.x + 150, canvas.y + 180, { button: 'right' });
    await expect(page.getByRole('menuitem', { name: '收起为叠图', exact: true })).toBeVisible();
    await capture('stack-merge-menu.png');
    await page.getByRole('menuitem', { name: '收起为叠图', exact: true }).click();
    await expect.poll(async () => (await saved()).objects.length).toBe(1);
    await page.keyboard.press('Control+z'); await expect.poll(async () => (await saved()).objects.length).toBe(2);
    expect((await saved()).objects.map(object => object.kind)).toEqual(['imageStack', 'image']);
    await page.keyboard.press('Control+y'); await expect.poll(async () => (await saved()).objects.length).toBe(1);
    await capture('stack-collapsed.png');
    // 点击叠图上的“查看”区域进入真正模态浏览，键盘输入不能触发画布快捷键。
    await page.mouse.click(canvas.x + 260, canvas.y + 270);
    const viewer = page.getByRole('dialog', { name: '叠图浏览', exact: true });
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.jsc-page')).toHaveCount(6);
    // 模态浏览中 Ctrl+Z 直接撤销刚完成的合并，Ctrl+Y 可恢复。
    await viewer.getByRole('region', { name: '叠图', exact: true }).focus();
    await page.keyboard.press('Control+z'); await expect(viewer).toHaveCount(0);
    await expect.poll(async () => (await saved()).objects.length).toBe(2);
    await page.keyboard.press('Control+y'); await expect.poll(async () => (await saved()).objects.length).toBe(1);
    await page.mouse.dblclick(canvas.x + 180, canvas.y + 190); await expect(viewer).toBeVisible();
    await page.waitForTimeout(650); await capture('viewer-fit.png');
    const caption = viewer.getByRole('textbox', { name: '当前图片备注', exact: true });
    const pageSize = () => viewer.locator('.jsc-item').evaluateAll(elements => elements.map(element => { const rect = element.querySelector('.jsc-page')!; const style = getComputedStyle(rect); return { width: style.width, height: style.height, background: style.backgroundColor, perspective: getComputedStyle(element.closest('.jsc-view')!).perspective }; }));
    const sizesBefore = await pageSize();
    await caption.fill('第一张：工作台的设计参考'); await caption.blur();
    // 不同比例的图片也按各自的展示大小折叠，截取真实手势的中间帧。
    const firstStage = (await viewer.locator('.jsc-stage').boundingBox())!;
    await page.mouse.move(firstStage.x + firstStage.width * .65, firstStage.y + firstStage.height / 2);
    await page.mouse.down(); await page.mouse.move(firstStage.x + firstStage.width * .55, firstStage.y + firstStage.height / 2, { steps: 8 });
    await expect.poll(pageSize).toEqual(sizesBefore); await capture('viewer-mixed-ratio-turn.png');
    await viewer.locator('.jsc-stage').dispatchEvent('pointercancel'); await page.mouse.up();
    await viewer.getByRole('button', { name: '下一张图片', exact: true }).click();
    await expect(caption).toHaveValue('');
    await expect.poll(pageSize).toEqual(sizesBefore);
    expect(sizesBefore.every(size => size.background === 'rgba(0, 0, 0, 0)')).toBe(true);
    await caption.fill('第二张：保留现场颜色\n用于后期对照');
    await caption.blur();
    await expect.poll(() => viewer.locator('.jsc-item[data-i="1"]').evaluate(element => (element as HTMLElement).style.transform)).toBe('translate3d(0px, 0px, 0px)');
    await expect.poll(() => viewer.locator('.jsc-item[data-i="1"] .jsc-page').first().evaluate(element => (element as HTMLElement).style.transform)).toBe('rotateY(0deg)');
    await page.waitForTimeout(650); await capture('viewer-caption.png');
    // 横图应充分利用窗口；100% 表示适应窗口，控件和备注不跟随图片缩放。
    const fit = await viewer.locator('.jsc-root').evaluate(element => ({ width: parseFloat((element as HTMLElement).style.getPropertyValue('--jsc-w')), height: parseFloat((element as HTMLElement).style.getPropertyValue('--jsc-h')), viewport: innerWidth }));
    expect(fit.width / fit.viewport).toBeGreaterThan(.7);
    const zoom = viewer.getByLabel('图片缩放比例', { exact: true });
    await viewer.getByRole('button', { name: '放大图片', exact: true }).click();
    await expect(zoom).toHaveText('125%');
    await expect(viewer.locator('.jsc-detail')).toBeVisible();
    await expect(viewer.locator('.jsc-view')).not.toBeVisible();
    const zoomStage = (await viewer.locator('.jsc-stage').boundingBox())!;
    await page.mouse.move(zoomStage.x + zoomStage.width / 2, zoomStage.y + zoomStage.height / 2);
    await page.mouse.wheel(0, -160);
    await expect.poll(async () => Number((await zoom.textContent())?.replace('%', ''))).toBeGreaterThan(150);
    const beforePan = await viewer.locator('.jsc-camera').getAttribute('style');
    await page.mouse.down(); await page.mouse.move(zoomStage.x + zoomStage.width / 2 + 100, zoomStage.y + zoomStage.height / 2 + 70, { steps: 8 }); await page.mouse.up();
    expect(await viewer.locator('.jsc-camera').getAttribute('style')).not.toBe(beforePan);
    await expect(viewer.locator('.jsc-position')).toHaveText('2 / 3');
    await expect(caption).toHaveValue('第二张：保留现场颜色\n用于后期对照');
    await capture('viewer-zoom-pan.png');
    await viewer.getByRole('button', { name: '适应窗口', exact: true }).click(); await expect(zoom).toHaveText('100%');
    await viewer.getByRole('region', { name: '叠图', exact: true }).focus();
    await page.keyboard.press('+'); await expect(zoom).toHaveText('125%');
    await page.keyboard.press('-'); await expect(zoom).toHaveText('100%');
    await page.keyboard.press('+'); await page.keyboard.press('0'); await expect(zoom).toHaveText('100%');
    // 从第二张拖到末张，确认实际手势与图片下方备注始终对应。
    await viewer.locator('.jsc-stage').evaluate(element => {
      const events: { type: string; x: number; buttons: number; time: number }[] = [];
      (element as HTMLElement & { dragEvents: typeof events }).dragEvents = events;
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(type, event => {
        const pointer = event as PointerEvent;
        if (events.length < 64) events.push({ type, x: pointer.clientX, buttons: pointer.buttons, time: pointer.timeStamp });
      });
    });
    const stage = (await viewer.locator('.jsc-stage').boundingBox())!;
    await page.mouse.move(stage.x + stage.width * .65, stage.y + stage.height / 2);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width * .55, stage.y + stage.height / 2, { steps: 8 });
    await capture('viewer-dragging.png');
    await page.mouse.move(stage.x + stage.width * .25, stage.y + stage.height / 2, { steps: 12 });
    await page.mouse.up();
    await testInfo.attach('翻页指针事件', { body: JSON.stringify(await viewer.locator('.jsc-stage').evaluate(element => (element as HTMLElement & { dragEvents: unknown[] }).dragEvents)), contentType: 'application/json' });
    await expect(viewer.locator('.jsc-position')).toHaveText('3 / 3');
    await expect(caption).toHaveValue('');
    await viewer.getByRole('button', { name: '上一张图片', exact: true }).click();
    await expect(caption).toHaveValue('第二张：保留现场颜色\n用于后期对照');
    await viewer.getByRole('button', { name: '上一张图片', exact: true }).click();
    await expect(caption).toHaveValue('第一张：工作台的设计参考');
    await viewer.getByRole('button', { name: '缩略图列表', exact: true }).click();
    await expect(viewer.locator('.jsc-grid button')).toHaveCount(3);
    await capture('viewer-grid.png');
    const gridImages = viewer.locator('.jsc-grid button');
    const imageOrder = async () => { const object = (await saved()).objects[0]; return object.kind === 'imageStack' ? object.images.map(image => image.id) : []; };
    const originalOrder = await imageOrder();
    await viewer.locator('.jsc-grid').evaluate(element => {
      const events: unknown[] = []; (element as HTMLElement & { sortEvents: unknown[] }).sortEvents = events;
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(type, event => {
        const pointer = event as PointerEvent;
        if (events.length < 100) events.push({ type, x: pointer.clientX, y: pointer.clientY, id: (event.target as HTMLElement).closest('button')?.dataset.imageId });
      });
    });
    const first = (await gridImages.nth(0).boundingBox())!, last = (await gridImages.nth(2).boundingBox())!;
    const startDrag = async () => { await page.mouse.move(first.x + first.width / 2, first.y + 60); await page.mouse.down(); await page.mouse.move(last.x + last.width / 2, last.y + 60, { steps: 12 }); };
    await startDrag();
    await expect(viewer.locator('[data-drop-target]')).toHaveCount(1);
    await capture('viewer-grid-dragging.png');
    await page.keyboard.press('Escape');
    const cancelledX = await gridImages.nth(0).evaluate(element => element.getBoundingClientRect().x);
    expect(cancelledX).toBeCloseTo(first.x, 1);
    await page.mouse.up();
    await expect(viewer).toBeVisible(); await expect(gridImages).toHaveCount(3);
    expect(await imageOrder()).toEqual(originalOrder);
    await startDrag(); await page.mouse.up();
    await testInfo.attach('排序指针事件', { body: JSON.stringify(await viewer.locator('.jsc-grid').evaluate(element => (element as HTMLElement & { sortEvents: unknown[] }).sortEvents)), contentType: 'application/json' });
    await expect.poll(imageOrder).toEqual([originalOrder[1], originalOrder[2], originalOrder[0]]);
    await expect(viewer.locator('.jsc-position')).toHaveText('3 / 3');
    await capture('viewer-grid-reordered.png');
    await gridImages.nth(2).click(); await expect(caption).toHaveValue('第一张：工作台的设计参考');
    await viewer.getByRole('button', { name: '关闭叠图浏览', exact: true }).click();
    await page.keyboard.press('Control+z'); await expect.poll(imageOrder).toEqual(originalOrder);
    await page.keyboard.press('Control+y'); await expect.poll(imageOrder).toEqual([originalOrder[1], originalOrder[2], originalOrder[0]]);
    // 保存重开保留新顺序；当前身份及备注随图片移动，键盘排序保留焦点。
    await page.getByRole('button', { name: '‹ 项目', exact: true }).click(); await page.getByRole('button', { name: document.name, exact: true }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.mouse.dblclick(canvas.x + 180, canvas.y + 190); await expect(viewer).toBeVisible();
    await expect(caption).toHaveValue('第二张：保留现场颜色\n用于后期对照');
    await viewer.getByRole('button', { name: '缩略图列表', exact: true }).click();
    await gridImages.nth(2).focus(); await page.keyboard.press('Alt+ArrowLeft');
    await expect(gridImages.nth(1)).toBeFocused(); await page.keyboard.press('Alt+ArrowLeft');
    await expect.poll(imageOrder).toEqual(originalOrder);
    await expect(gridImages.nth(0)).toBeFocused();
    await viewer.getByRole('button', { name: '查看图片 2', exact: true }).click();
    await expect(caption).toHaveValue('第二张：保留现场颜色\n用于后期对照');
    await viewer.getByRole('region', { name: '叠图', exact: true }).focus();
    await page.keyboard.press('ArrowRight'); await expect(caption).toHaveValue('');
    await page.keyboard.press('ArrowLeft'); await expect(caption).toHaveValue('第二张：保留现场颜色\n用于后期对照');
    await page.keyboard.press('Escape'); await expect(viewer).toHaveCount(0);
    await expect.poll(async () => { const stack = (await saved()).objects[0]; return stack.kind === 'imageStack' && stack.images[1].caption; }).toBe('第二张：保留现场颜色\n用于后期对照');
    await page.getByRole('button', { name: '‹ 项目', exact: true }).click(); await page.getByRole('button', { name: document.name, exact: true }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    // 等待实际画布重新挂载后再发坐标事件，避免首页尚未退出时过早双击。
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.mouse.dblclick(canvas.x + 180, canvas.y + 190); await expect(viewer).toBeVisible();
    await expect(caption).toHaveValue('第一张：工作台的设计参考');
    // 缩小桌面窗口并开启减少动态效果，备注与导航仍须位于可见区域。
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 768));
    await viewer.getByRole('button', { name: '下一张图片', exact: true }).click();
    await expect(caption).toHaveValue('第二张：保留现场颜色\n用于后期对照');
    await expect(caption).toBeInViewport();
    await expect(viewer.getByRole('button', { name: '下一张图片', exact: true })).toBeInViewport();
    await capture('viewer-narrow-reduced-motion.png');
    await viewer.getByRole('button', { name: '放大图片', exact: true }).click();
    await expect(zoom).toHaveText('125%');
    await viewer.getByRole('button', { name: '下一张图片', exact: true }).click();
    await expect(zoom).toHaveText('100%');
    await viewer.getByRole('button', { name: '关闭叠图浏览', exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
    // 共享菜单会在窗口变化时关闭；等画布完成本轮尺寸更新后再打开菜单。
    await expect.poll(async () => (await page.locator('.canvas').boundingBox())!.width).toBe(canvas.width);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.mouse.click(canvas.x + 180, canvas.y + 190, { button: 'right' });
    await page.getByRole('menuitem', { name: '锁定', exact: true }).click();
    await page.mouse.dblclick(canvas.x + 180, canvas.y + 190); await expect(viewer).toBeVisible();
    await viewer.getByRole('button', { name: '缩略图列表', exact: true }).click();
    await expect(viewer.locator('.jsc-grid[data-sortable]')).toHaveCount(0);
    await gridImages.nth(0).focus(); await page.keyboard.press('Alt+ArrowRight');
    expect(await imageOrder()).toEqual(originalOrder);
    await gridImages.nth(0).click(); await expect(caption).toHaveAttribute('readonly', '');
    await viewer.getByRole('button', { name: '关闭叠图浏览', exact: true }).click();
    await page.keyboard.press('Control+z');
    await page.mouse.click(canvas.x + 180, canvas.y + 190, { button: 'right' });
    await page.getByRole('menuitem', { name: '拆开叠图', exact: true }).click();
    await expect.poll(async () => (await saved()).objects.length).toBe(3);
    expect((await saved()).objects[1]).toMatchObject({ kind: 'image', caption: '第二张：保留现场颜色\n用于后期对照' });
    await page.keyboard.press('Control+z'); await expect.poll(async () => (await saved()).objects.length).toBe(1);
    await page.keyboard.press('Control+y'); await expect.poll(async () => (await saved()).objects.length).toBe(3);
    expect(errors).toEqual([]);
  } finally { await app?.close().catch(() => undefined); console.log(`叠图验收数据：${root}`); }
});

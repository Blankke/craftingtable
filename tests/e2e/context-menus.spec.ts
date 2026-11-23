// 使用范例：npm.cmd run test:e2e -- tests/e2e/context-menus.spec.ts。
// 独立项目中走真实系统剪贴板、菜单与键盘，核对保存结果及明暗/100%/150% 截图。
import { _electron, expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { newDocument, type ProjectDocument } from '../../src/core/document';
import { newNote } from '../../src/core/note';
import { canvasTextFromPlainText, canvasTextPlainText } from '../../src/core/canvasText';

for (const scale of [1, 1.5]) for (const theme of ['light', 'dark']) test(`右键菜单与格式快捷键 ${theme} ${scale * 100}%`, async ({}, testInfo) => {
  test.setTimeout(120_000);
  const testClipboard = process.env.WORKBENCH_SKIP_CLIPBOARD !== '1';
  if (!testClipboard) testInfo.annotations.push({ type: '未验证', description: '系统剪贴板不可用，本次仅运行非剪贴板操作' });
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-context-'));
  const folder = path.join(root, 'projects', '菜单验收'); await mkdir(path.join(folder, 'assets'), { recursive: true });
  const document = newDocument('右键菜单验收');
  for (let i = 0; i < 2; i++) document.objects.push({ id: crypto.randomUUID(), kind: 'rectangle', x: 100 + i * 300, y: 120, width: 220, height: 120, groupId: null, fill: '#ffffff', stroke: '#4358c5', text: canvasTextFromPlainText(i ? '场景分镜' : '访谈计划') });
  const note = newNote('访谈笔记'); note.document = canvasTextFromPlainText('采访提纲与现场记录\n记录受访者的经历，保留真实声音。');
  document.notes.push(note, newNote('素材摘录'));
  await writeFile(path.join(folder, 'project.json'), JSON.stringify(document));
  const saved = async (): Promise<ProjectDocument> => JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8'));
  const env: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [`--force-device-scale-factor=${scale}`, '.'], env });
  try {
    await app.evaluate(async ({ BrowserWindow, clipboard, ClipboardItem }) => {
      const window = BrowserWindow.getAllWindows()[0]; window.setSize(1440, 960); window.webContents.setBackgroundThrottling(false);
      const snapshot = await clipboard.read();
      (globalThis as unknown as { menuClipboard: Electron.ClipboardItem[] }).menuClipboard = await Promise.all(snapshot.filter(item => item.types.length).map(async item => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
    });
    const page = await app.firstWindow(), errors: string[] = [];
    page.on('pageerror', error => { errors.push(error.message); console.log('page-error', error.message); }); page.on('dialog', async dialog => { errors.push(dialog.message()); console.log('dialog-error', dialog.message()); await dialog.dismiss(); });
    const capture = async (name: string) => {
      await page.evaluate(async () => { await window.document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
      const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
      await writeFile(testInfo.outputPath(name), Buffer.from(png, 'base64'));
    };
    const menu = (id: string) => page.locator(`.context-menu > [data-id="${id}"]`);
    if (theme === 'dark') await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
    await page.getByRole('button', { name: document.name, exact: true }).click();
    const canvas = (await page.locator('.canvas').boundingBox())!;
    const point = { x: canvas.x + 170, y: canvas.y + 180 };
    const right = async () => { await page.mouse.click(point.x, point.y, { button: 'right' }); await expect(menu('copy')).toBeVisible(); };
    const object = async () => (await saved()).objects.find(object => object.id === document.objects[0].id)!;
    await right(); await capture('canvas-context.png');
    await menu('front').click(); await expect.poll(async () => (await saved()).objects.at(-1)!.id).toBe(document.objects[0].id);
    await page.keyboard.press('Control+Z'); await expect.poll(async () => (await saved()).objects[0].id).toBe(document.objects[0].id);
    await page.keyboard.press('Control+Shift+Z'); await expect.poll(async () => (await saved()).objects.at(-1)!.id).toBe(document.objects[0].id);
    await page.keyboard.press('Control+Z');

    // 组合、锁定及解组既可从菜单执行，也可从画布快捷键执行。
    await page.keyboard.press('Control+A'); await right(); await menu('group').click();
    await expect.poll(async () => (await saved()).groups.length).toBe(1);
    await page.keyboard.press('Control+L'); await expect.poll(async () => (await saved()).objects.every(object => object.locked)).toBe(true);
    await right(); await expect(menu('delete')).toBeDisabled(); await page.keyboard.press('Escape');
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 70, point.y + 35, { steps: 5 }); await page.mouse.up();
    await page.keyboard.press('Delete');
    expect((await saved()).objects.map(object => object.x)).toEqual([100, 400]);
    await right(); await menu('lock').click(); await page.keyboard.press('Control+Shift+G');
    await expect.poll(async () => (await saved()).groups.length).toBe(0);

    await page.mouse.click(point.x, point.y); await page.keyboard.press('Control+B'); await page.keyboard.press('Control+I'); await page.keyboard.press('Control+U');
    await expect.poll(async () => (await object()).style).toMatchObject({ bold: true, italic: true, underline: true });
    if (testClipboard) {
    await page.keyboard.press('Control+C'); await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('访谈计划');
    await right(); await menu('copy').click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('访谈计划');
    await page.keyboard.press('Control+V'); await expect.poll(async () => (await saved()).objects.length).toBe(3);
    await page.keyboard.press('Control+Z'); await expect.poll(async () => (await saved()).objects.length).toBe(2);
    await right(); await menu('cut').click(); await expect.poll(async () => (await saved()).objects.length).toBe(1);
    await page.keyboard.press('Control+V'); await expect.poll(async () => (await saved()).objects.length).toBe(2);
    const pasted = (await saved()).objects.find(object => object.id !== document.objects[1].id)!;
    expect('text' in pasted && canvasTextPlainText(pasted.text)).toBe('访谈计划');
    await page.keyboard.press('Control+Z'); await page.keyboard.press('Control+Z');
    await expect.poll(async () => (await saved()).objects.map(object => object.id)).toEqual(document.objects.map(object => object.id));

    await right(); await menu('png').click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.has('image/png'))).toBe(true);
    await right(); await menu('svg').click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('<svg');
    expect(await app.evaluate(({ clipboard }) => clipboard.has('image/svg+xml'))).toBe(true);
    expect(await app.evaluate(({ clipboard }) => clipboard.has('image/png'))).toBe(true);
    // SVG 与可解码的位图同时存在；再复制 PNG 应清除上一次 SVG，防止残留格式造成误判。
    expect(await app.evaluate(async ({ clipboard, nativeImage }) => {
      const [item] = await clipboard.read();
      const png = await item.getType('image/png');
      return nativeImage.createFromBuffer(Buffer.from(await png.arrayBuffer())).isEmpty();
    })).toBe(false);
    await right(); await menu('png').click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('');
    expect(await app.evaluate(({ clipboard }) => clipboard.has('image/svg+xml'))).toBe(false);
    expect(await app.evaluate(({ clipboard }) => clipboard.has('image/png'))).toBe(true);
    }

    // 编辑中的右键应保留原位编辑层与选区，菜单命令进入同一个文字事务。
    await page.mouse.dblclick(point.x, point.y);
    const input = page.getByRole('textbox', { name: '编辑画布文字', exact: true }); await expect(input).toBeFocused();
    await input.press('Control+A'); await input.click({ button: 'right' }); await menu('format').click(); await menu('strike').click();
    await expect(input).toBeVisible(); await expect(input.locator('s')).toHaveText('访谈计划');
    await input.press('Control+Shift+E'); await expect(input.locator('p')).toHaveCSS('text-align', 'center');
    await input.press('Control+Enter'); await expect(input).toBeHidden();
    await expect.poll(async () => JSON.stringify(await object())).toContain('strike');

    // 自定义连接点按实际拖拽生成连接；调整点位置只修改锚点，不写死世界坐标。
    await right(); await menu('add-point').click(); await expect.poll(async () => (await object()).connectionPoints?.length).toBe(1);
    await page.mouse.move(canvas.x + 320, canvas.y + 180); await page.mouse.down(); await page.mouse.move(canvas.x + 430, canvas.y + 180, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await saved()).connections.length).toBe(1);
    expect((await saved()).connections[0].from).toMatchObject({ kind: 'object', objectId: document.objects[0].id, pointId: (await object()).connectionPoints![0].id });
    await right(); await menu('edit-points').click();
    await page.getByRole('dialog', { name: '连接点位置' }).locator('textarea').fill('50, 0'); await page.getByRole('button', { name: '应用', exact: true }).click();
    await expect.poll(async () => (await object()).connectionPoints?.[0]).toMatchObject({ x: .5, y: 0 });

    await page.getByRole('radio', { name: '笔记', exact: true }).click();
    const body = page.locator('.note-editor .tiptap'); await expect(body).toBeVisible();
    await body.click(); await page.keyboard.press('Control+A'); await body.click({ button: 'right' });
    await capture('note-context.png'); await menu('format').click(); await capture('note-format-submenu.png'); await menu('bold').click();
    await expect(body.locator('strong')).toHaveCount(2); await expect(body).toBeFocused();
    await page.keyboard.press('Control+I'); await page.keyboard.press('Control+U');
    await expect(body.locator('em')).toHaveCount(2); await expect(body.locator('u')).toHaveCount(2);
    await page.keyboard.press('Control+Shift+E'); await expect(body.locator('p').first()).toHaveCSS('text-align', 'center');
    await page.keyboard.press('Control+Shift+>'); await expect(body.locator('span[style*="font-size"]').first()).toHaveCSS('font-size', '20px');
    await page.keyboard.press('Control+Alt+2'); await expect(body.locator('h2')).toHaveCount(2);
    await page.keyboard.press('Control+Alt+0'); await expect(body.locator('h2')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+8'); await expect(body.locator('ul')).toHaveCount(1);
    await page.keyboard.press('Control+Shift+8'); await expect(body.locator('ul')).toHaveCount(0);
    await page.keyboard.press('Control+K'); await page.getByRole('dialog', { name: '编辑链接' }).getByRole('textbox').fill('https://example.com/interview');
    await page.getByRole('button', { name: '应用', exact: true }).click(); await expect(body.locator('a').first()).toHaveAttribute('href', 'https://example.com/interview');
    await expect(body).toBeFocused();
    await page.keyboard.press('Control+End'); await expect.poll(() => body.evaluate(element => (element as HTMLElement & { editor: import('@tiptap/core').Editor }).editor.state.selection.empty)).toBe(true); await page.keyboard.press('Enter');
    await expect(body).toContainText('采访提纲');
    if (testClipboard) {
    await app.evaluate(({ clipboard }) => clipboard.writeText('**保留字面语法**'));
    await page.keyboard.press('Control+Shift+V'); await expect(body).toContainText('**保留字面语法**');
    }
    await page.keyboard.press('Control+A'); await page.keyboard.press('Shift+F10'); await expect(menu('format')).toBeVisible();
    await menu('format').focus(); await page.keyboard.press('ArrowRight'); await expect(menu('bold')).toBeFocused();
    await page.keyboard.press('ArrowLeft'); await expect(menu('format')).toBeFocused(); await page.keyboard.press('Escape'); await expect(body).toBeFocused();

    // 跨笔记移动由项目级一次事务完成，顶栏一次撤销同时恢复两篇内容。
    await body.click({ button: 'right' }); await menu('move').click(); await page.getByRole('menuitem', { name: '素材摘录', exact: true }).click();
    await expect.poll(async () => canvasTextPlainText((await saved()).notes[0].document)).toBe('');
    await expect.poll(async () => canvasTextPlainText((await saved()).notes[1].document)).toContain('采访提纲');
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(body).toContainText('采访提纲'); await expect.poll(async () => canvasTextPlainText((await saved()).notes[1].document)).toBe('');
    // 贴近窗口右边缘时，子菜单应向左展开且完整可见。
    const bodyBox = (await body.boundingBox())!;
    await body.click({ button: 'right', position: { x: bodyBox.width - 4, y: 12 } }); await menu('format').click();
    const parentBox = (await page.getByRole('menu', { name: '正文右键菜单', exact: true }).boundingBox())!, childBox = (await page.getByRole('menu', { name: '文本格式', exact: true }).boundingBox())!;
    await capture('note-submenu-edge.png');
    expect(childBox.x + childBox.width).toBeLessThanOrEqual(parentBox.x + 1);
    expect(childBox.x).toBeGreaterThanOrEqual(8);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '渲染模式', exact: true }).click();
    await page.locator('.note-markdown-preview article').click({ button: 'right' }); await expect(menu('format')).toBeDisabled();
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(async ({ clipboard }) => { const snapshot = (globalThis as unknown as { menuClipboard?: Electron.ClipboardItem[] }).menuClipboard; if (snapshot) await clipboard.write(snapshot); }).catch(() => undefined);
    await app.close(); console.log(`菜单验收数据：${root}`);
  }
});

test('各类对象、图像导出、连接线与图片裁剪的菜单入口', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-object-menu-')), folder = path.join(root, 'projects', '对象菜单');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  await copyFile('tests/fixtures/sample.png', path.join(folder, 'assets', 'sample.png'));
  await copyFile('tests/fixtures/sample.mp3', path.join(folder, 'assets', 'sample.mp3'));
  const document = newDocument('对象类型验收'), imageId = crypto.randomUUID(), audioId = crypto.randomUUID(), note = newNote('场景笔记');
  document.notes.push(note); document.assets.push({ id: imageId, kind: 'image', name: '现场照片', path: 'assets/sample.png', status: 'ready' }, { id: audioId, kind: 'audio', name: '现场声音', path: 'assets/sample.mp3', status: 'ready', durationUs: 4_000_000 });
  const base = (x: number, y: number) => ({ id: crypto.randomUUID(), x, y, width: 160, height: 100, groupId: null });
  document.objects.push(
    { ...base(80, 80), kind: 'text', text: canvasTextFromPlainText('拍摄记录'), fontSize: 18, color: '#123456', align: 'left' },
    { ...base(330, 80), kind: 'ellipse', fill: '#fff', stroke: '#456789' },
    { ...base(580, 80), kind: 'image', assetId: imageId },
    { ...base(80, 330), kind: 'note', noteId: note.id },
    { ...base(330, 330), kind: 'stroke', points: [{ x: 330, y: 330 }, { x: 490, y: 430 }], color: '#456789', strokeWidth: 4 },
    { ...base(580, 330), kind: 'media', assetId: audioId, inUs: 0, outUs: 4_000_000, pixelsPerSecond: 40 },
    { ...base(80, 580), kind: 'imageStack', images: [{ ...base(0, 0), kind: 'image', assetId: imageId }, { ...base(20, 20), kind: 'image', assetId: imageId }] }
  );
  document.connections.push({ id: crypto.randomUUID(), from: { kind: 'free', point: { x: 600, y: 600 } }, to: { kind: 'free', point: { x: 760, y: 660 } }, routing: 'straight' });
  await writeFile(path.join(folder, 'project.json'), JSON.stringify(document));
  const saved = async (): Promise<ProjectDocument> => JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8'));
  const env: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: ['.'], env });
  try {
    await app.evaluate(({ BrowserWindow, ipcMain, nativeImage }) => {
      BrowserWindow.getAllWindows()[0].setSize(1440, 960);
      // 此用例验证真实渲染输出；系统剪贴板写入由上面的四主题用例另行验证。
      const results: { png: string; svg: string; width: number; height: number }[] = [];
      (globalThis as unknown as { menuGraphics: typeof results }).menuGraphics = results;
      ipcMain.removeHandler('editing:copy-graphic');
      ipcMain.handle('editing:copy-graphic', (_event, data: { png: string; svg: string }) => { results.push({ ...data, ...nativeImage.createFromDataURL(data.png).getSize() }); });
    });
    const page = await app.firstWindow(); await page.getByRole('button', { name: document.name, exact: true }).click();
    const errors: string[] = []; page.on('dialog', async dialog => { errors.push(dialog.message()); await dialog.dismiss(); }); page.on('pageerror', error => errors.push(error.message));
    const box = (await page.locator('.canvas').boundingBox())!, menu = (id: string) => page.locator(`.context-menu > [data-id="${id}"]`);
    for (const object of document.objects) {
      await page.mouse.click(box.x + object.x + 80, box.y + object.y + 50, { button: 'right' });
      for (const id of ['copy', 'cut', 'paste', 'front', 'back', 'lock', 'style', 'duplicate']) await expect(menu(id)).toHaveCount(1);
      await menu('svg').click();
      await expect.poll(() => app.evaluate(() => (globalThis as unknown as { menuGraphics: unknown[] }).menuGraphics.length)).toBe(document.objects.indexOf(object) + 1);
      await page.mouse.click(box.x + object.x + 80, box.y + object.y + 50, { button: 'right' });
      await menu('duplicate').click(); await expect.poll(async () => (await saved()).objects.length).toBe(8);
      await page.keyboard.press('Control+Z'); await expect.poll(async () => (await saved()).objects.length).toBe(7);
    }
    await page.mouse.click(box.x + 660, box.y + 130); await page.keyboard.press('Shift+F10');
    await expect(menu('crop')).toHaveCount(1); await menu('crop').click();
    await expect(page.getByRole('tab', { name: '排列', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByLabel('裁剪宽度', { exact: true }).fill('60'); await page.getByLabel('裁剪宽度', { exact: true }).press('Enter');
    await expect.poll(async () => (await saved()).objects[2]).toMatchObject({ crop: { width: .6 } });
    await page.mouse.click(box.x + 680, box.y + 630, { button: 'right' });
    await expect(menu('copy')).toBeVisible(); await menu('duplicate').click();
    await expect.poll(async () => (await saved()).connections.length).toBe(2);
    await page.keyboard.press('Delete'); await expect.poll(async () => (await saved()).connections.length).toBe(1);
    const graphics = await app.evaluate(() => (globalThis as unknown as { menuGraphics: { png: string; svg: string; width: number; height: number }[] }).menuGraphics);
    for (const [index, graphic] of graphics.entries()) {
      expect(graphic.width).toBeGreaterThan(50); expect(graphic.height).toBeGreaterThan(20); expect(graphic.svg).toContain('<svg');
      await writeFile(testInfo.outputPath(`export-${document.objects[index].kind}.png`), Buffer.from(graphic.png.split(',')[1], 'base64'));
    }
    expect(graphics[1].svg).toContain('<ellipse'); expect(errors).toEqual([]);
  } finally { await app.close(); console.log(`对象菜单验收数据：${root}`); }
});

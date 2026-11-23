// 使用范例：npm.cmd run test:e2e -- tests/e2e/canvas-rich-text.spec.ts。
// 用真实系统剪贴板验证文字/图片粘贴、Markdown、尺寸、主题与持久化；截图留在 test-results。
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { newDocument, type ProjectDocument, type CanvasObject } from '../../src/core/document';
import { canvasTextFromPlainText, canvasTextPlainText, CANVAS_TEXT_WIDTH, emptyCanvasText } from '../../src/core/canvasText';
import { styleOf } from '../../src/core/appearance';

for (const scale of [1, 1.5]) for (const theme of ['light', 'dark']) test(`画布富文本与粘贴 ${theme} ${scale * 100}%`, async ({}, testInfo) => {
  test.setTimeout(90_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-rich-canvas-'));
  const folder = path.join(root, 'projects', 'rich');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  const project = newDocument('画布排版与剪贴板');
  const shape: CanvasObject = { id: crypto.randomUUID(), kind: 'rectangle', x: 500, y: 190, width: 240, height: 100, groupId: null, fill: '#ffffff', stroke: '#111111', color: '#172033', align: 'center', text: canvasTextFromPlainText('居中说明') };
  const blank: CanvasObject = { id: crypto.randomUUID(), kind: 'text', x: 500, y: 410, width: 260, height: 42, groupId: null, text: emptyCanvasText(), fontSize: 18, color: '#172033', align: 'left' };
  project.objects.push(shape, blank);
  await writeFile(path.join(folder, 'project.json'), JSON.stringify(project));
  const saved = async (): Promise<ProjectDocument> => JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8'));
  let app: ElectronApplication | undefined;
  let clipboardSaved = false;
  try {
    const env: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [`--force-device-scale-factor=${scale}`, '.'], env });
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(1440, 960); window.webContents.setBackgroundThrottling(false); });
    await app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const snapshot = await clipboard.read();
      (globalThis as unknown as { canvasClipboard: Electron.ClipboardItem[] }).canvasClipboard = await Promise.all(snapshot.filter(item => item.types.length).map(async item => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
    });
    clipboardSaved = true;
    const page = await app.firstWindow();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const capture = async (name: string) => {
      // 高 DPI 下粘贴图片后 CDP 截图可能等待超时；直接采集 Electron 实际窗口，保留设备像素比。
      await page.evaluate(async () => { await window.document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
      const png = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
      expect(png.length).toBeGreaterThan(1000);
      await writeFile(testInfo.outputPath(name), Buffer.from(png, 'base64'));
    };
    if (theme === 'dark') await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
    await page.getByRole('button', { name: project.name, exact: true }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    const canvas = (await page.locator('.canvas').boundingBox())!;
    const input = page.getByRole('textbox', { name: '编辑画布文字', exact: true });
    const doubleClick = async (object: CanvasObject) => {
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const camera = (await saved()).camera;
      await page.mouse.dblclick(canvas.x + camera.x + (object.x + object.width / 2) * camera.scale, canvas.y + camera.y + (object.y + object.height / 2) * camera.scale);
      await expect(input).toBeFocused();
    };
    const pasteText = async (source: string) => { await app!.evaluate(({ clipboard }, text) => clipboard.writeText(text), source); await page.keyboard.press('Control+V'); };
    await page.waitForTimeout(1700);
    await capture('theme-before.png');
    const revision = (await saved()).revision;
    await page.getByRole('button', { name: theme === 'dark' ? '切换到浅色模式' : '切换到深色模式', exact: true }).click();
    await page.waitForTimeout(1700);
    await capture('theme-switched.png');
    expect((await saved()).revision).toBe(revision);
    expect((await saved()).objects[0]).toMatchObject({ color: '#172033', fill: '#ffffff', stroke: '#111111' });
    await page.getByRole('button', { name: theme === 'dark' ? '切换到深色模式' : '切换到浅色模式', exact: true }).click();

    // 内部复制走真实剪贴板；之后粘贴外部文本时不应误用曾复制的对象。
    await page.mouse.click(canvas.x + shape.x + shape.width / 2, canvas.y + shape.y + shape.height / 2);
    await page.keyboard.press('Control+C'); await page.keyboard.press('Control+V');
    await expect.poll(async () => (await saved()).objects.length).toBe(3);
    const copied = (await saved()).objects.find(item => item.id !== shape.id && item.id !== blank.id)!;
    expect(copied).toMatchObject({ kind: shape.kind, width: shape.width, height: shape.height, text: shape.text });
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect.poll(async () => (await saved()).objects.length).toBe(2);

    // 默认提示不是正文；输入时隐藏，Markdown 输入规则立即生成标题与粗体。
    await doubleClick(blank); await expect(input).toHaveText('');
    await input.pressSequentially('## '); await page.keyboard.insertText('拍摄清单');
    await expect(input.locator('h2')).toHaveText('拍摄清单');
    await input.press('Enter'); await input.pressSequentially('**important** ');
    await expect(input.locator('strong')).toHaveText('important');
    await input.press('Control+Enter');
    await expect.poll(async () => canvasTextPlainText(((await saved()).objects.find(item => item.id === blank.id) as typeof blank).text)).toBe('拍摄清单\nimportant ');

    await page.mouse.click(canvas.x + 70, canvas.y + 70);
    const markdown = '# 城市声音\n\n**收音重点**与*现场旁白*\n\n- 开场环境\n- 人物采访\n\n> 保留自然停顿\n\n| 镜头 | 时长 |\n| --- | --- |\n| 街景 | 10 秒 |';
    await pasteText(markdown);
    await expect.poll(async () => (await saved()).objects.length).toBe(3);
    const pasted = (await saved()).objects.find(item => item.id !== shape.id && item.id !== blank.id)!;
    expect(pasted.kind).toBe('text'); expect(pasted.width).toBe(CANVAS_TEXT_WIDTH); expect(pasted.height).toBeGreaterThan(150);
    expect(styleOf(pasted)).toMatchObject({ fillEnabled: false, strokeEnabled: false });
    expect(JSON.stringify('text' in pasted && pasted.text)).not.toContain('**');
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect.poll(async () => (await saved()).objects.length).toBe(2);
    await page.getByRole('button', { name: '重做', exact: true }).click(); await expect.poll(async () => (await saved()).objects.length).toBe(3);
    await doubleClick(pasted);
    await expect(input.locator('h1')).toHaveText('城市声音'); await expect(input.locator('strong')).toHaveText('收音重点'); await expect(input.locator('table')).toHaveCount(1);
    const unchangedRevision = (await saved()).revision;
    await page.getByRole('button', { name: '完成文字编辑', exact: true }).click();
    expect((await saved()).revision).toBe(unchangedRevision);

    // 形状编辑层与图形同心，长文字可以越出上下边界，图形几何保持不变。
    await doubleClick(shape);
    const center = (await input.boundingBox())!;
    expect(Math.abs(center.x + center.width / 2 - (canvas.x + shape.x + shape.width / 2))).toBeLessThan(2);
    expect(Math.abs(center.y + center.height / 2 - (canvas.y + shape.y + shape.height / 2))).toBeLessThan(2);
    await input.press('Control+A');
    const longText = Array.from({ length: 8 }, (_, index) => `第 ${index + 1} 段：保留现场声音`).join('\n\n');
    await pasteText(longText);
    await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThan(shape.height);
    const expanded = (await input.boundingBox())!;
    expect(Math.abs(expanded.y + expanded.height / 2 - (canvas.y + shape.y + shape.height / 2))).toBeLessThan(2);
    await capture('shape-edit-overflow.png');
    await input.press('Control+Enter');
    await expect.poll(async () => (await saved()).objects.find(item => item.id === shape.id)).toMatchObject({ width: shape.width, height: shape.height });

    // 在已存在的文本框内粘贴，内容合并进正文，宽度固定而高度增加，不创建额外对象。
    await doubleClick(blank); const before = (await saved()).objects.find(item => item.id === blank.id)!;
    await input.press('Control+End'); await input.press('Enter'); await pasteText(longText);
    await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThan(before.height);
    await input.press('Control+Enter');
    await expect.poll(async () => (await saved()).objects.find(item => item.id === blank.id)!.height).toBeGreaterThan(before.height);
    expect((await saved()).objects.find(item => item.id === blank.id)!.width).toBe(blank.width);
    expect((await saved()).objects).toHaveLength(3);

    // 从系统剪贴板读入无路径 PNG，画布和素材库共用新建的素材记录。
    await page.mouse.click(canvas.x + 820, canvas.y + 80);
    const imageBytes = [...await readFile('tests/fixtures/sample.png')];
    await app.evaluate(async ({ clipboard, ClipboardItem }, bytes) => { await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(bytes)], { type: 'image/png' }) })]); }, imageBytes);
    await page.keyboard.press('Control+V');
    await expect.poll(async () => (await saved()).assets.length).toBe(1);
    const withImage = await saved(), asset = withImage.assets[0];
    expect(asset.kind).toBe('image'); expect(withImage.objects.find(item => item.kind === 'image')).toMatchObject({ assetId: asset.id });
    expect((await stat(path.join(folder, asset.path))).size).toBeGreaterThan(0);
    await expect(page.locator('.asset-row').filter({ hasText: asset.name })).toBeVisible();
    await capture('rich-canvas-saved.png');
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect.poll(async () => (await saved()).objects.length).toBe(3);
    await page.getByRole('button', { name: '重做', exact: true }).click(); await expect.poll(async () => (await saved()).objects.length).toBe(4);
    const contentBeforeReopen = await saved();
    await page.getByRole('button', { name: '‹ 项目', exact: true }).click(); await page.getByRole('button', { name: project.name, exact: true }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    expect((await saved()).objects).toEqual(contentBeforeReopen.objects);
    expect((await saved()).assets).toEqual(contentBeforeReopen.assets);

    // 侧栏共用正文编辑器，Esc 应同时还原文档和输入框，避免下一次编辑带回已取消的内容。
    await doubleClick(shape); await input.press('Escape');
    await page.getByRole('tab', { name: '文本', exact: true }).click();
    const sidebarText = page.getByRole('textbox', { name: '对象文字', exact: true });
    const sidebarOriginal = await sidebarText.innerText();
    const sidebarRevision = (await saved()).revision;
    await sidebarText.fill('这次侧栏输入需要取消'); await sidebarText.press('Escape');
    await expect.poll(() => sidebarText.innerText()).toBe(sidebarOriginal);
    expect((await saved()).revision).toBe(sidebarRevision);
    expect(errors).toEqual([]);
  } finally {
    if (app && clipboardSaved) await app.evaluate(async ({ clipboard }) => { await clipboard.write((globalThis as unknown as { canvasClipboard: Electron.ClipboardItem[] }).canvasClipboard); }).catch(() => undefined);
    await app?.close().catch(() => undefined);
    console.log(`画布富文本验收数据：${root}`);
  }
});

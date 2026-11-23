// 用法：先 npm.cmd run build，再 npx.cmd playwright test tests/e2e/canvas-controls.spec.ts --output test-results/canvas-controls-e2e。
// 真实鼠标覆盖关闭设置、侧栏最大化、工具放置、形状调节点、横竖排和存盘撤销；截图按四组主题/缩放保留。
import { _electron, expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { newDocument, type ProjectDocument } from '../../src/core/document';
import { canvasTextFromPlainText } from '../../src/core/canvasText';

for (const scale of [1, 1.5]) for (const theme of ['light', 'dark']) test(`画布控件 ${theme} ${scale * 100}%`, async ({}, info) => {
  test.setTimeout(90_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-canvas-controls-')), folder = path.join(root, 'projects', 'controls');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  const doc = newDocument('画布控件');
  const base = { x: 80, y: 80, width: 220, height: 140, groupId: null, fill: '#e0ebff', stroke: '#315a87' };
  doc.objects.push({ ...base, id: crypto.randomUUID(), kind: 'roundedRectangle' }, { ...base, id: crypto.randomUUID(), kind: 'callout', x: 370 },
    { id: crypto.randomUUID(), kind: 'text', x: 100, y: 350, width: 260, height: 160, groupId: null, fontSize: 20, color: '#172033', align: 'left', text: canvasTextFromPlainText('窗外的雨慢慢停了。早上七点半。') });
  await writeFile(path.join(folder, 'project.json'), JSON.stringify(doc));
  const saved = async (): Promise<ProjectDocument> => JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8'));
  const env: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [`--force-device-scale-factor=${scale}`, '.'], env });
  try {
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1440, 960); BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false); });
    const page = await app.firstWindow(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    if (theme === 'dark') await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
    await page.getByRole('button', { name: doc.name, exact: true }).click(); await page.locator('.canvas canvas').first().waitFor();
    const capture = async (name: string) => { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')); await writeFile(info.outputPath(`${name}.png`), Buffer.from(png, 'base64')); };
    const settings = page.getByRole('button', { name: '设置', exact: true });
    await settings.click(); await page.getByRole('button', { name: '关闭设置', exact: true }).click(); await expect(page.locator('.settings-panel')).toHaveCount(0); await expect(settings).toBeFocused();
    await settings.click(); await page.keyboard.press('Escape'); await expect(page.locator('.settings-panel')).toHaveCount(0);
    await settings.click(); await page.locator('.canvas').click({ position: { x: 30, y: 30 } }); await expect(page.locator('.settings-panel')).toHaveCount(0);
    for (const label of ['工具', '素材库', '编辑']) {
      await page.getByRole('button', { name: `${label}视图`, exact: true }).dblclick();
      await expect(page.locator('.dock-section')).toHaveCount(1);
      await expect(page.locator('.dock-section h3')).toHaveText(label);
    }
    await capture('sidebar-maximized');
    await page.getByRole('button', { name: '工具视图', exact: true }).dblclick();
    const count = (kind: string) => saved().then(doc => doc.objects.filter(object => object.kind === kind).length);
    const shapeTool = page.getByRole('button', { name: '矩形', exact: true });
    await shapeTool.click(); await page.waitForTimeout(550); expect(await count('rectangle')).toBe(0);
    await shapeTool.dblclick(); await expect.poll(() => count('rectangle')).toBe(1); await page.keyboard.press('Control+z');
    const textTool = page.locator('.canvas-basic-tools').getByRole('button', { name: '文字', exact: true });
    await textTool.click(); await page.waitForTimeout(550); expect(await count('text')).toBe(1);
    await textTool.dblclick(); await expect.poll(() => count('text')).toBe(2); await page.keyboard.press('Control+z');
    // 拖放结束后，尾随 click 不得阻断下一次工具选择，包括键盘激活。
    await shapeTool.dragTo(page.locator('.canvas'), { targetPosition: { x: 650, y: 420 } });
    await expect.poll(() => count('rectangle')).toBe(1);
    const arrowTool = page.getByRole('button', { name: '箭头', exact: true });
    await arrowTool.click(); await expect(arrowTool).toHaveAttribute('aria-pressed', 'true');
    await shapeTool.dragTo(page.locator('.canvas'), { targetPosition: { x: 650, y: 540 } });
    await expect.poll(() => count('rectangle')).toBe(2);
    await arrowTool.focus(); await page.keyboard.press('Enter'); await expect(arrowTool).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    await page.getByRole('button', { name: '选择', exact: true }).click();
    const canvas = (await page.locator('.canvas').boundingBox())!;
    const click = (x: number, y: number) => page.mouse.click(canvas.x + x, canvas.y + y);
    const drag = async (x: number, y: number, dx: number, dy: number) => { await page.mouse.move(canvas.x + x, canvas.y + y); await page.mouse.down(); await page.mouse.move(canvas.x + x + dx, canvas.y + y + dy, { steps: 12 }); await page.mouse.up(); };
    await click(180, 150); await drag(101, 80, 40, 0);
    await expect.poll(async () => { const object = (await saved()).objects[0]; return 'adjustments' in object ? object.adjustments?.radius : undefined; }).toBeCloseTo(61 / 140, 2);
    await capture('rounded-adjusted'); await page.keyboard.press('Control+z');
    await expect.poll(async () => (await saved()).objects[0]).toMatchObject(doc.objects[0]);
    await click(460, 130); await drag(414, 220, 200, -60);
    await expect.poll(async () => { const object = (await saved()).objects[1]; return 'adjustments' in object ? object.adjustments?.tailX : undefined; }).toBeCloseTo(244 / 220, 2);
    await capture('callout-adjusted');
    await page.getByRole('button', { name: '编辑视图', exact: true }).dblclick();
    await click(180, 400); await page.getByRole('tab', { name: '文本', exact: true }).click();
    await page.getByLabel('书写方向', { exact: true }).selectOption('vertical-rl');
    await expect.poll(async () => (await saved()).objects[2]).toMatchObject({ writingMode: 'vertical-rl' });
    await capture('vertical-static');
    await page.mouse.dblclick(canvas.x + 310, canvas.y + 410);
    await expect(page.locator('.dock-section')).toHaveCount(1);
    const input = page.getByRole('textbox', { name: '编辑画布文字', exact: true });
    await expect(input).toBeVisible(); await expect(input).toHaveCSS('writing-mode', 'vertical-rl');
    const edited = '窗外的雨慢慢停了。早上七点半。记录雨后的声音。';
    await input.fill(edited); await capture('vertical-editing'); await input.press('Control+Enter');
    await expect(input).toHaveCount(0); await expect.poll(async () => JSON.stringify((await saved()).objects[2])).toContain(edited);
    await page.getByRole('button', { name: '‹ 项目', exact: true }).click(); await page.getByRole('button', { name: doc.name, exact: true }).click();
    await page.locator('.canvas canvas').first().waitFor(); await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.mouse.dblclick(canvas.x + 310, canvas.y + 410); await expect(input).toHaveText(edited); await expect(input).toHaveCSS('writing-mode', 'vertical-rl');
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

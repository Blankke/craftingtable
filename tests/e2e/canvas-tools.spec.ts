// 使用范例：npm.cmd run test:e2e -- tests/e2e/canvas-tools.spec.ts。
// 真实 Electron 核对低缩放选区和工具持续使用；原生截图覆盖明暗及 Windows 100%/150%。
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { newDocument, type ProjectDocument } from '../../src/core/document';
import { canvasTextFromPlainText } from '../../src/core/canvasText';

for (const scale of [1, 1.5]) for (const theme of ['light', 'dark']) test(`低缩放选区 ${theme} ${scale * 100}%`, async ({}, testInfo) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-canvas-tools-'));
  const folder = path.join(root, 'projects', 'tools');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  await copyFile('build/source/Crafting_Table_JE4_BE3.png', path.join(folder, 'assets', 'table.png'));
  const document = newDocument('工具与选区验收');
  document.camera = { x: 100, y: 100, scale: .2 };
  const assetId = crypto.randomUUID();
  document.assets.push({ id: assetId, name: '工作台', path: 'assets/table.png', kind: 'image', status: 'ready' });
  document.objects.push(
    { id: crypto.randomUUID(), kind: 'image', assetId, x: 100, y: 100, width: 400, height: 400, groupId: null },
    { id: crypto.randomUUID(), kind: 'rectangle', x: 700, y: 100, width: 400, height: 300, groupId: null, rotation: 15, fill: '#5268e8', stroke: '#5268e8' },
    { id: crypto.randomUUID(), kind: 'text', x: 100, y: 700, width: 600, height: 180, groupId: null, text: canvasTextFromPlainText('拍摄提纲：黄昏的城市'), fontSize: 48, color: '#172033', align: 'left' },
    { id: crypto.randomUUID(), kind: 'ellipse', x: 900, y: 700, width: 400, height: 300, groupId: null, fill: '#e08a27', stroke: '#e08a27', locked: true },
  );
  await writeFile(path.join(folder, 'project.json'), JSON.stringify(document));
  let app: ElectronApplication | undefined;
  try {
    const env: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [`--force-device-scale-factor=${scale}`, '.'], env });
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(1440, 960); window.webContents.setBackgroundThrottling(false); });
    const page = await app.firstWindow();
    if (theme === 'dark') await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
    await page.getByRole('button', { name: document.name, exact: true }).click();
    await page.locator('.konvajs-content').focus();
    await page.keyboard.press('Control+a');
    await expect(page.locator('.canvas')).toHaveAttribute('data-selected', document.objects.map(object => object.id).join(','));
    await page.waitForTimeout(1800);
    const capture = async (name: string) => {
      await page.evaluate(async () => { await window.document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
      const png = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
      await writeFile(testInfo.outputPath(name), Buffer.from(png, 'base64'));
    };
    await capture('selection-20.png');
    const canvas = (await page.locator('.canvas').boundingBox())!;
    await page.mouse.click(canvas.x + 160, canvas.y + 160);
    await expect(page.locator('.canvas')).toHaveAttribute('data-selected', document.objects[0].id);
    await capture('single-selection-20.png');
    // 在 20% 缩放下仍能从可见缩放柄调整图片；只修改选中的对象。
    await page.mouse.move(canvas.x + 199, canvas.y + 199); await page.mouse.down();
    await page.mouse.move(canvas.x + 220, canvas.y + 220, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => {
      const saved = JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8')) as ProjectDocument;
      return saved.objects[0].width;
    }).toBeGreaterThan(400);
    await page.keyboard.press('Control+z');
    await capture('selection-resize-undone.png');
  } finally { await app?.close(); }
});

for (const scale of [1, 1.5]) for (const theme of ['light', 'dark']) test(`工具单击与双击持续使用 ${theme} ${scale * 100}%`, async ({}, testInfo) => {
  test.setTimeout(60_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-persistent-tools-'));
  const folder = path.join(root, 'projects', 'tools');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  const document = newDocument('持续工具验收');
  await writeFile(path.join(folder, 'project.json'), JSON.stringify(document));
  const saved = async (): Promise<ProjectDocument> => JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8'));
  let app: ElectronApplication | undefined;
  try {
    const env: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [`--force-device-scale-factor=${scale}`, '.'], env });
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(1440, 960); window.webContents.setBackgroundThrottling(false); });
    const page = await app.firstWindow(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    if (theme === 'dark') await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
    await page.getByRole('button', { name: document.name, exact: true }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    const canvas = (await page.locator('.canvas').boundingBox())!;
    const tool = (name: string) => page.locator('.canvas-basic-tools').getByRole('button', { name, exact: true });
    const draw = async (y: number) => { await page.mouse.move(canvas.x + 400, canvas.y + y); await page.mouse.down(); await page.mouse.move(canvas.x + 620, canvas.y + y + 30, { steps: 8 }); await page.mouse.up(); };
    // 单击箭头创建一次后回到选择；双击后可连续创建直线与折线。
    await tool('箭头').click(); await draw(120);
    await expect(tool('选择')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await saved()).connections.length).toBe(1);
    await tool('箭头').dblclick(); await draw(220); await draw(320);
    await expect(tool('箭头')).toHaveAttribute('data-persistent', 'true');
    await page.getByLabel('箭头路径', { exact: true }).selectOption('elbow'); await draw(420);
    await expect.poll(async () => (await saved()).connections.length).toBe(4);
    expect((await saved()).connections.at(-1)?.routing).toBe('elbow');
    await page.keyboard.press('Control+z'); await expect.poll(async () => (await saved()).connections.length).toBe(3);
    await expect(tool('箭头')).toHaveAttribute('data-persistent', 'true');
    // Esc 取消未完成的手势并退出持续使用，松开鼠标不能提交半条连接线。
    await page.mouse.move(canvas.x + 400, canvas.y + 520); await page.mouse.down(); await page.mouse.move(canvas.x + 500, canvas.y + 550);
    await page.keyboard.press('Escape'); await page.mouse.up();
    await expect(tool('选择')).toHaveAttribute('aria-pressed', 'true');
    expect((await saved()).connections).toHaveLength(3);
    await tool('画笔').click(); await draw(520); await draw(620);
    await expect(tool('画笔')).toHaveAttribute('aria-pressed', 'true');
    await tool('画笔').dblclick(); await draw(570); await draw(670);
    await expect(tool('画笔')).toHaveAttribute('data-persistent', 'true');
    await expect.poll(async () => (await saved()).objects.filter(object => object.kind === 'stroke').length).toBe(4);
    await tool('文字').click();
    await expect.poll(async () => (await saved()).objects.filter(object => object.kind === 'text').length).toBe(1);
    await expect(tool('选择')).toHaveAttribute('aria-pressed', 'true');
    // 双击只激活工具，不应把两次 click 当成两个新对象。
    await tool('文字').dblclick({ delay: 180 }); await page.waitForTimeout(550);
    await expect(tool('文字')).toHaveAttribute('data-persistent', 'true');
    expect((await saved()).objects.filter(object => object.kind === 'text')).toHaveLength(1);
    const input = page.getByLabel('编辑画布文字', { exact: true });
    await page.mouse.click(canvas.x + 150, canvas.y + 250);
    await expect(input).toBeFocused(); await input.fill('开场镜头'); await input.press('Control+Enter');
    await expect(tool('文字')).toHaveAttribute('data-persistent', 'true');
    await page.mouse.move(canvas.x + 100, canvas.y + 400); await page.mouse.down(); await page.mouse.move(canvas.x + 310, canvas.y + 470, { steps: 8 }); await page.mouse.up();
    await expect(input).toBeFocused(); await input.fill('环境声与对白'); await input.press('Control+Enter');
    await expect.poll(async () => (await saved()).objects.filter(object => object.kind === 'text').length).toBe(3);
    await expect(tool('文字')).toHaveAttribute('data-persistent', 'true');
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    await writeFile(testInfo.outputPath('persistent-text.png'), Buffer.from(png, 'base64'));
    await tool('选择').click();
    await expect(page.locator('[data-persistent=true]')).toHaveCount(0);
    // 键盘提供等价操作，切换项目清除本机工具状态。
    await tool('箭头').focus(); await page.keyboard.press('Shift+Enter');
    await expect(tool('箭头')).toHaveAttribute('data-persistent', 'true');
    await page.getByRole('button', { name: '‹ 项目', exact: true }).click(); await page.getByRole('button', { name: document.name, exact: true }).click();
    await expect(tool('选择')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-persistent=true]')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await app?.close(); }
});

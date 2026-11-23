// 使用示例：npm run test:e2e。验证项目从首页创建、编辑、保存和重开。
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const electronExecutable = createRequire(import.meta.url)('electron') as string;

test('项目创建后画布对象能保存并重开', async () => {
  const testRoot = await mkdtemp(path.join(os.tmpdir(), 'workbench-e2e-'));
  let application: ElectronApplication | undefined;
  try {
    const environment: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: testRoot };
    delete environment.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({ executablePath: electronExecutable, args: ['.'], env: environment });
    const page = await application.firstWindow();
    await expect(page.locator('.home')).toBeVisible();
    const chosenRoot = path.join(testRoot, 'chosen-projects');
    await mkdir(chosenRoot);
    await application.evaluate(({ dialog }, folder) => { Object.defineProperty(dialog, 'showOpenDialog', { value: async () => ({ canceled: false, filePaths: [folder] }) }); }, chosenRoot);
    await page.getByRole('button', { name: '设置' }).click();
    await page.getByLabel('强制播放动画').check();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.forceMotion)).toBe('true');
    await page.getByLabel('强制播放动画').uncheck();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.forceMotion)).toBe('false');
    await page.getByRole('button', { name: '选择文件夹' }).click();
    await expect(page.locator('.settings-path')).toHaveText(chosenRoot);
    await page.getByRole('button', { name: '设置' }).click();
    await page.locator('.plus').click();
    await page.getByRole('button', { name: '新建项目' }).click();
    await page.getByLabel('项目名称').fill('端到端项目');
    await page.getByRole('button', { name: '创建项目' }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    await page.getByRole('button', { name: '矩形', exact: true }).click();
    // 中键平移后，网格与画布对象使用同一相机偏移，并一同写入项目。
    await expect(page.locator('.canvas')).toHaveCSS('background-position', '0px 0px, 0px 0px');
    await page.locator('.canvas').evaluate(element => {
      const events: { type: string; x: number; y: number; buttons: number; button: number }[] = [];
      (window as Window & { panEvents?: typeof events }).panEvents = events;
      for (const type of ['mousedown', 'mousemove', 'mouseup']) element.addEventListener(type, event => {
        const mouse = event as MouseEvent;
        if (type !== 'mousemove' || mouse.buttons === 4) events.push({ type, x: mouse.clientX, y: mouse.clientY, buttons: mouse.buttons, button: mouse.button });
      }, true);
    });
    await page.mouse.move(700, 450);
    await page.waitForTimeout(80);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(750, 470, { steps: 5 });
    await page.mouse.up({ button: 'middle' });
    const panEvents = await page.evaluate(() => (window as Window & { panEvents?: { type: string; x: number; y: number; buttons: number; button: number }[] }).panEvents ?? []);
    expect(panEvents.find(event => event.type === 'mousedown' && event.button === 1), JSON.stringify(panEvents)).toMatchObject({ x: 700, y: 450 });
    await expect(page.locator('.canvas'), JSON.stringify(panEvents)).toHaveCSS('background-position', '50px 20px, 50px 20px');
    // Ctrl + 滚轮改变相机比例时，背景网格和对象保持同一缩放尺度。
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect(page.locator('.canvas')).toHaveCSS('background-size', '26.4px 26.4px, 26.4px 26.4px');
    await page.getByRole('button', { name: '箭头', exact: true }).click();
    await page.locator('header button').first().click();
    await expect(page.locator('.home')).toBeVisible();

    const folders = await readdir(chosenRoot);
    expect(folders).toHaveLength(1);
    const saved = JSON.parse(await readFile(path.join(chosenRoot, folders[0], 'project.json'), 'utf8')) as { objects: { kind: string }[]; camera: { x: number; y: number; scale: number } };
    expect(saved.objects.map(item => item.kind)).toEqual(['rectangle']);
    expect(saved.camera.scale).toBeCloseTo(1.1);

    await page.getByRole('button', { name: '端到端项目' }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    await expect(page.locator('header strong')).toHaveText('端到端项目');
    await expect(page.locator('.canvas')).toHaveCSS('background-size', '26.4px 26.4px, 26.4px 26.4px');
    await expect(page.locator('.canvas')).toHaveAttribute('data-selected', '');
    await expect(page.getByRole('button', { name: '选择' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '矩形', exact: true }).click();
    // 直接关闭窗口时，主进程必须等待渲染端提交最后一次编辑。
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
    await expect.poll(async () => {
      const closed = JSON.parse(await readFile(path.join(chosenRoot, folders[0], 'project.json'), 'utf8')) as { objects: unknown[] };
      return closed.objects.length;
    }).toBe(2);
  } finally {
    await application?.close().catch(() => undefined);
    // 仅清理本测试创建的临时目录。
    await rm(testRoot, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('素材库移除会同步删除项目素材文件', async () => {
  const testRoot = await mkdtemp(path.join(os.tmpdir(), 'workbench-asset-remove-'));
  let application: ElectronApplication | undefined;
  try {
    const environment: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: testRoot };
    delete environment.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({ executablePath: electronExecutable, args: ['.'], env: environment });
    const page = await application.firstWindow();
    const chosenRoot = path.join(testRoot, 'chosen-projects');
    await mkdir(chosenRoot);
    await application.evaluate(({ dialog }, folder) => { Object.defineProperty(dialog, 'showOpenDialog', { value: async () => ({ canceled: false, filePaths: [folder] }) }); }, chosenRoot);
    await page.getByRole('button', { name: '设置' }).click();
    await page.getByRole('button', { name: '选择文件夹' }).click();
    await page.getByRole('button', { name: '设置' }).click();
    await page.locator('.plus').click();
    await page.getByRole('button', { name: '新建项目' }).click();
    await page.getByLabel('项目名称').fill('素材清理');
    await page.getByRole('button', { name: '创建项目' }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    const fixture = path.resolve('tests/fixtures/sample.txt');
    await application.evaluate(({ dialog }, source) => { Object.defineProperty(dialog, 'showOpenDialog', { value: async () => ({ canceled: false, filePaths: [source] }) }); }, fixture);
    await page.getByRole('button', { name: /导入素材/ }).click();
    await expect(page.locator('.asset-row')).toContainText('sample.txt');
    const assetPath = await page.locator('.asset-row').first().evaluate(row => row.querySelector('.asset-details b')?.textContent);
    expect(assetPath).toBe('sample.txt');
    await page.getByRole('button', { name: '移除 sample.txt' }).click();
    await expect(page.locator('.asset-row')).toHaveCount(0);
    const folders = await readdir(chosenRoot);
    const projectFolder = path.join(chosenRoot, folders[0]);
    const assets = await readdir(path.join(projectFolder, 'assets'));
    expect(assets).toHaveLength(0);
  } finally {
    await application?.close().catch(() => undefined);
    await rm(testRoot, { recursive: true, force: true }).catch(() => undefined);
  }
});

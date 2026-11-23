// 使用范例：npm.cmd run test:e2e -- tests/e2e/project-close.spec.ts。
// 验证纯文本项目迁移、前后端热更新不同步，以及打开失败后的真实窗口关闭流程。
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { newDocument, PROJECT_SCHEMA_VERSION } from '../../src/core/document';
import { canvasTextFromPlainText, canvasTextPlainText } from '../../src/core/canvasText';

for (const scenario of ['迁移纯文本', '打开失败', '桌面进程过期'] as const) test(`项目关闭：${scenario}`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-project-close-'));
  const folder = path.join(root, 'projects', '原有项目');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  const original = { ...newDocument('原有项目'), schemaVersion: 3, objects: [{ id: crypto.randomUUID(), kind: 'text', x: 40, y: 40, width: 240, height: 80, groupId: null, text: '已有文字\n第二行', fontSize: 18, color: '#172033', align: 'left' }] };
  await writeFile(path.join(folder, 'project.json'), JSON.stringify(original));
  let app: ElectronApplication | undefined;
  try {
    const env: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: ['.'], env });
    const page = await app.firstWindow();
    await expect(page.getByRole('button', { name: '原有项目', exact: true })).toBeVisible();
    if (scenario !== '迁移纯文本') {
      // 先建立主进程活动项目，复现「后台已打开、界面未能载入」的残留状态。
      await page.evaluate(folder => (window as unknown as { workbench: { openProject(folder: string): Promise<unknown> } }).workbench.openProject(folder), folder);
      await app.evaluate(({ ipcMain }, { scenario, original }) => {
        if (scenario === '打开失败') { ipcMain.removeHandler('projects:open'); ipcMain.handle('projects:open', () => original); }
        else { ipcMain.removeHandler('settings:get'); ipcMain.handle('settings:get', () => ({ projectsRoot: 'test', documentSchemaVersion: 3 })); }
      }, { scenario, original });
    }
    await page.getByRole('button', { name: '原有项目', exact: true }).click();
    if (scenario === '迁移纯文本') {
      await expect(page.locator('.canvas')).toBeVisible();
      const saved = JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8'));
      expect(saved.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
      expect(canvasTextPlainText(saved.objects[0].text)).toBe('已有文字\n第二行');
      const backup = (await readdir(path.join(folder, 'recovery'))).find(name => name.startsWith('pre-migration-'))!;
      expect(JSON.parse(await readFile(path.join(folder, 'recovery', backup), 'utf8'))).toEqual(original);
    } else {
      await expect(page.getByRole('button', { name: '重试打开', exact: true })).toBeVisible();
      if (scenario === '桌面进程过期') await expect(page.locator('.home-error')).toContainText('重新运行');
    }
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => { throw Error('没有待保存修改时不应弹出保存警告'); };
    });
    const closed = page.waitForEvent('close', { timeout: 4000 });
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
    await closed;
  } finally {
    await app?.close().catch(() => undefined);
    console.log(`项目关闭验收数据：${root}`);
  }
});

for (const failSave of [false, true]) test(`项目关闭：当前文字${failSave ? '保存失败可选择退出' : '先提交再关闭'}`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-close-edit-'));
  const folder = path.join(root, 'projects', '编辑关闭');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  const source = newDocument('编辑关闭');
  source.objects.push({ id: crypto.randomUUID(), kind: 'text', x: 60, y: 80, width: 240, height: 80, groupId: null, text: canvasTextFromPlainText('已保存正文'), fontSize: 18, color: '#172033', align: 'left' });
  await writeFile(path.join(folder, 'project.json'), JSON.stringify(source));
  let app: ElectronApplication | undefined;
  try {
    const env: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: ['.'], env });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: source.name, exact: true }).click();
    const canvas = (await page.locator('.canvas').boundingBox())!;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.mouse.dblclick(canvas.x + 180, canvas.y + 120);
    const input = page.getByRole('textbox', { name: '编辑画布文字', exact: true });
    await expect(input).toBeFocused(); await input.fill('关闭前的最后修改');
    if (failSave) {
      await app.evaluate(({ ipcMain, dialog }) => {
        ipcMain.removeHandler('projects:save'); ipcMain.handle('projects:save', () => { throw Error('模拟磁盘不可写'); });
        const state = globalThis as unknown as { closeWarnings: string[][]; allowDiscard: boolean };
        state.closeWarnings = []; state.allowDiscard = false;
        dialog.showMessageBox = async (windowOrOptions: Electron.BaseWindow | Electron.MessageBoxOptions, suppliedOptions?: Electron.MessageBoxOptions) => {
          const options = suppliedOptions ?? windowOrOptions as Electron.MessageBoxOptions;
          state.closeWarnings.push(options.buttons ?? []);
          return { response: state.allowDiscard ? 1 : 0, checkboxChecked: false };
        };
      });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
      await expect.poll(() => app!.evaluate(() => (globalThis as unknown as { closeWarnings: string[][] }).closeWarnings.length)).toBe(1);
      expect(page.isClosed()).toBe(false);
      expect(await app.evaluate(() => (globalThis as unknown as { closeWarnings: string[][] }).closeWarnings[0])).toEqual(['返回编辑器', '不保存并关闭']);
      await app.evaluate(() => { (globalThis as unknown as { allowDiscard: boolean }).allowDiscard = true; });
    }
    const closed = page.waitForEvent('close', { timeout: 5000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    const persisted = JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8'));
    expect(canvasTextPlainText(persisted.objects[0].text)).toBe(failSave ? '已保存正文' : '关闭前的最后修改');
  } finally {
    await app?.close().catch(() => undefined);
    console.log(`编辑关闭验收数据：${root}`);
  }
});

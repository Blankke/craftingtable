// 使用范例：npm.cmd run test:e2e -- tests/e2e/project-delete.spec.ts。
// 删除仅作用于本测试创建的项目；覆盖正常删除、目录已移除、重复请求及根目录边界。
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { newDocument } from '../../src/core/document';

for (const alreadyMissing of [false, true]) test(`删除项目：${alreadyMissing ? '失效卡片' : '正常目录'}立即从首页移除`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-project-delete-'));
  const folder = path.join(root, 'projects', '删除对象'), keep = path.join(root, 'projects', '保留对象');
  for (const selected of [folder, keep]) { await mkdir(path.join(selected, 'assets'), { recursive: true }); await writeFile(path.join(selected, 'project.json'), JSON.stringify(newDocument(path.basename(selected)))); }
  let app: ElectronApplication | undefined;
  try {
    const env: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: ['.'], env });
    const page = await app.firstWindow();
    const card = page.locator('.glass-folder-wrap').filter({ hasText: '删除对象' });
    await expect(card).toBeVisible();
    if (alreadyMissing) await rm(folder, { recursive: true });
    page.on('dialog', dialog => dialog.accept());
    await card.getByRole('button', { name: '项目菜单', exact: true }).click();
    await card.getByRole('menuitem', { name: '删除项目', exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('.home-error')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '保留对象', exact: true })).toBeVisible();
    expect(await stat(folder).catch(() => null)).toBeNull();
    // 同一已删除路径再次请求应成功；外部路径仍须被拒绝。
    expect(await page.evaluate(folder => (window as unknown as { workbench: { deleteProject(folder: string): Promise<boolean> } }).workbench.deleteProject(folder), folder)).toBe(true);
    const outside = path.join(root, '外部目录'); await mkdir(outside);
    const error = await page.evaluate(async folder => { try { await (window as unknown as { workbench: { deleteProject(folder: string): Promise<boolean> } }).workbench.deleteProject(folder); return ''; } catch (error) { return String(error); } }, outside);
    expect(error).toContain('项目位置无效'); expect((await stat(outside)).isDirectory()).toBe(true);
  } finally { await app?.close().catch(() => undefined); console.log(`删除验收数据：${root}`); }
});

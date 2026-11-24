// 用法：npm.cmd run build 后执行 node scripts/visual/preview-image-storage.mjs [--baseline]。
// 用固定真实图片复拍画布、裁剪与叠图；只写 test-results 和独立临时项目。
import { _electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const baseline = process.argv.includes('--baseline');
const output = path.resolve('test-results/image-storage', baseline ? 'before' : 'after');
await mkdir(output, { recursive: true });
for (const scale of [1, 1.5]) for (const theme of ['light', 'dark']) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-image-preview-')), folder = path.join(root, 'projects', 'preview');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  const doc = { schemaVersion: 5, id: crypto.randomUUID(), name: '图片存储验收', revision: 0, camera: { x: 0, y: 0, scale: 1 }, assets: [], objects: [], notes: [], markers: [], connections: [], groups: [] };
  const images = [];
  for (const [i, source] of ['tests/fixtures/sample.jpg', 'build/source/Crafting_Table_JE4_BE3.png', 'tests/fixtures/sample.png'].entries()) {
    const name = `${i}${path.extname(source)}`, assetId = crypto.randomUUID();
    await copyFile(source, path.join(folder, 'assets', name));
    doc.assets.push({ id: assetId, name, path: `assets/${name}`, kind: 'image', status: 'ready' });
    images.push({ id: crypto.randomUUID(), kind: 'image', assetId, x: i * 40, y: 0, width: 220, height: 180, groupId: null });
    doc.objects.push({ ...images.at(-1), id: crypto.randomUUID(), x: 60 + i * 270, y: 70, ...(i === 2 ? { crop: { x: .1, y: .1, width: .7, height: .8 } } : {}) });
  }
  doc.objects.push({ id: crypto.randomUUID(), kind: 'imageStack', x: 80, y: 330, width: 220, height: 180, groupId: null, images });
  await writeFile(path.join(folder, 'project.json'), JSON.stringify(doc));
  if (!baseline) execFileSync(process.execPath, ['scripts/maintenance/optimize-project-images.mjs', folder, '--apply'], { stdio: 'pipe' });
  const env = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [`--force-device-scale-factor=${scale}`, '.'], env });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
    if (theme === 'dark') await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
    await page.getByRole('button', { name: doc.name, exact: true }).click();
    await expect(page.locator('.canvas canvas').first()).toBeVisible();
    const capture = async name => {
      await page.waitForTimeout(1200);
      const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
      await writeFile(path.join(output, `${theme}-${scale}-${name}.png`), Buffer.from(png, 'base64'));
    };
    await capture('canvas');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await capture('settings');
    if (!baseline) {
      const compression = page.getByLabel('图片压缩', { exact: true });
      await expect(compression).toHaveValue('lossy');
      await compression.focus(); await page.keyboard.press('End');
      await expect(compression).toHaveValue('lossless'); await capture('settings-lossless');
      await compression.focus(); await page.keyboard.press('Home'); await expect(compression).toHaveValue('lossy');
    }
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    const box = await page.locator('.canvas').boundingBox();
    await page.mouse.dblclick(box.x + 180, box.y + 420);
    await expect(page.locator('.image-stack-dialog')).toBeVisible();
    await capture('stack');
    await page.getByRole('button', { name: '缩略图列表', exact: true }).click();
    await capture('overview');
    console.log(theme, scale, '图片存储复拍完成');
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}

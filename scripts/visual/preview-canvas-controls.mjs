// 用法：npm.cmd run build 后运行 node scripts/visual/preview-canvas-controls.mjs [--baseline]。
// 固定真实图片、形状和中文正文，采集明暗主题与 Windows 100%/150% 的画布、设置和插入排序状态。
import { _electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const baseline = process.argv.includes('--baseline');
const output = path.resolve('test-results/canvas-controls', baseline ? 'before' : 'after');
await mkdir(output, { recursive: true });
for (const scale of [1, 1.5]) for (const theme of ['light', 'dark']) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-controls-')), folder = path.join(root, 'projects', 'preview');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  const doc = { schemaVersion: 5, id: crypto.randomUUID(), name: '画布控件验收', revision: 0, camera: { x: 0, y: 0, scale: 1 }, assets: [], objects: [], notes: [], markers: [], connections: [], groups: [] };
  const base = { x: 80, y: 80, width: 220, height: 140, groupId: null, fill: '#e0ebff', stroke: '#315a87' };
  doc.objects.push({ ...base, id: crypto.randomUUID(), kind: 'roundedRectangle' }, { ...base, id: crypto.randomUUID(), kind: 'callout', x: 370 });
  doc.objects.push({ id: crypto.randomUUID(), kind: 'text', x: 680, y: 80, width: 190, height: 240, groupId: null, fontSize: 20, color: '#172033', align: 'left', writingMode: 'vertical-rl', text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '窗外的雨慢慢停了。' }, { type: 'text', text: '早上七点半', marks: [{ type: 'bold' }] }] }] } });
  const images = [];
  for (const [i, source] of ['tests/fixtures/sample.jpg', 'build/source/Crafting_Table_JE4_BE3.png', 'tests/fixtures/sample.png'].entries()) {
    const name = `${i}${path.extname(source)}`, assetId = crypto.randomUUID();
    await copyFile(source, path.join(folder, 'assets', name));
    doc.assets.push({ id: assetId, name, path: `assets/${name}`, kind: 'image', status: 'ready' });
    images.push({ id: crypto.randomUUID(), kind: 'image', assetId, x: i * 40, y: 0, width: 220, height: 180, groupId: null });
  }
  doc.objects.push({ id: crypto.randomUUID(), kind: 'imageStack', x: 80, y: 350, width: 220, height: 180, groupId: null, images });
  await writeFile(path.join(folder, 'project.json'), JSON.stringify(doc));
  const env = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [`--force-device-scale-factor=${scale}`, '.'], env });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1440, 960); BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false); });
    if (theme === 'dark') await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
    await page.getByRole('button', { name: doc.name, exact: true }).click();
    await page.locator('.canvas canvas').first().waitFor(); await page.waitForTimeout(500);
    const capture = async name => { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')); await writeFile(path.join(output, `${theme}-${scale}-${name}.png`), Buffer.from(png, 'base64')); };
    const box = await page.locator('.canvas').boundingBox();
    await page.mouse.click(box.x + 180, box.y + 150); await capture('canvas');
    await page.getByRole('button', { name: '设置', exact: true }).click(); await capture('settings');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.mouse.dblclick(box.x + 180, box.y + 440); await page.locator('.image-stack-dialog').waitFor();
    await page.getByRole('button', { name: '缩略图列表', exact: true }).click(); await capture('overview');
    const cards = page.locator('.jsc-grid button[data-image-id]'); const a = await cards.nth(0).boundingBox(), b = await cards.nth(1).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + 60); await page.mouse.down();
    await page.mouse.move(b.x + b.width + 7, b.y + 60, { steps: 12 }); await page.waitForTimeout(200); await capture('insert');
    await page.keyboard.press('Escape'); await page.mouse.up();
    console.log(theme, scale, '画布、设置与排序截图完成');
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}

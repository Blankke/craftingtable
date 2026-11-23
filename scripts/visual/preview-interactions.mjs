// 用法：npm.cmd run build 后运行 node scripts/visual/preview-interactions.mjs [--baseline]。
// 真实图片、固定窗口、明暗主题及 100%/150% 缩放，复拍开屏、主题选择和混合比例叠图。
import { _electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, copyFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const baseline = process.argv.includes('--baseline');
const output = path.resolve('test-results/interactions', baseline ? 'before' : 'after');
await mkdir(output, { recursive: true });
for (const scale of [1, 1.5]) for (const theme of ['light', 'dark']) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-interactions-')), folder = path.join(root, 'projects', 'preview');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  const doc = { schemaVersion: 5, id: crypto.randomUUID(), name: '交互预览', revision: 0, camera: { x: 0, y: 0, scale: 1 }, assets: [], objects: [], notes: [], markers: [], connections: [], groups: [] };
  const images = [];
  for (const [i, source] of ['tests/fixtures/sample.jpg', 'build/source/Crafting_Table_JE4_BE3.png', 'tests/fixtures/sample.png'].entries()) {
    const name = `${i}${path.extname(source)}`, assetId = crypto.randomUUID();
    await copyFile(source, path.join(folder, 'assets', name));
    doc.assets.push({ id: assetId, name, path: `assets/${name}`, kind: 'image', status: 'ready' });
    images.push({ id: crypto.randomUUID(), kind: 'image', assetId, x: i * 40, y: 0, width: 220, height: 180, groupId: null });
  }
  doc.objects.push({ id: crypto.randomUUID(), kind: 'imageStack', x: 80, y: 100, width: 220, height: 180, groupId: null, images });
  await writeFile(path.join(folder, 'project.json'), JSON.stringify(doc));
  const env = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [`--force-device-scale-factor=${scale}`, '.'], env });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1440, 960); BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false); });
    await page.evaluate(theme => { const saved = JSON.parse(localStorage.getItem('workbench-theme') || '{}'); localStorage.setItem('workbench-theme', JSON.stringify({ ...saved, mode: theme, forceMotion: true })); sessionStorage.removeItem('workbench-splash-shown'); }, theme);
    await page.reload();
    const capture = async name => { await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); }); const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')); await writeFile(path.join(output, `${theme}-${scale}-${name}.png`), Buffer.from(png, 'base64')); };
    await page.locator('.splash-title').waitFor();
    await page.waitForTimeout(900); await capture('hello-early');
    const early = await page.locator('.splash-title').evaluate(el => ({ offset: parseFloat(getComputedStyle(el).strokeDashoffset), animations: el.getAnimations().length }));
    if (!baseline) { expect(early.offset).toBeGreaterThan(0); expect(early.animations).toBe(1); }
    await page.waitForTimeout(900); await capture('hello-late');
    const late = await page.locator('.splash-title').evaluate(el => parseFloat(getComputedStyle(el).strokeDashoffset));
    if (!baseline) expect(late).toBeLessThan(early.offset);
    console.log(theme, scale, '描线进度', early.offset, '→', late);
    await page.locator('.splash').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '主题', exact: true }).click();
    await capture('themes');
    const clipped = await page.locator('.theme-card b').evaluateAll(nodes => nodes.filter(el => el.scrollWidth > el.clientWidth).length);
    if (!baseline) expect(clipped).toBe(0);
    console.log('名称被裁切', clipped);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.locator('.gf-hit').hover(); await page.waitForTimeout(850); await capture('folder');
    await page.getByRole('button', { name: doc.name, exact: true }).click();
    const box = await page.locator('.canvas').boundingBox();
    await page.mouse.dblclick(box.x + 160, box.y + 170);
    await page.locator('.image-stack-dialog').waitFor(); await page.waitForTimeout(900); await capture('stack');
    const stage = await page.locator('.jsc-stage').boundingBox();
    await page.mouse.move(stage.x + stage.width * .65, stage.y + stage.height / 2); await page.mouse.down();
    await page.mouse.move(stage.x + stage.width * .5, stage.y + stage.height / 2, { steps: 10 }); await capture('stack-turn');
    await page.mouse.up();
    if (!baseline) {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => { const saved = JSON.parse(localStorage.getItem('workbench-theme') || '{}'); localStorage.setItem('workbench-theme', JSON.stringify({ ...saved, forceMotion: false })); sessionStorage.removeItem('workbench-splash-shown'); });
      await page.reload();
      await expect(page.locator('.splash-title')).toHaveCSS('stroke-dasharray', 'none');
      await expect(page.locator('.splash')).toHaveCount(0);
    }
  } finally { await app.close(); }
}

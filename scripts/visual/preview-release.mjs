// 使用范例：npm run build 后执行 node scripts/visual/preview-release.mjs --baseline；修复后去掉 --baseline。
// 用真实音视频复现数值预览引发的闪动，同时复拍开屏、图库和比例锁；覆盖明暗与 100%/150% 缩放。
import { _electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const baseline = process.argv.includes('--baseline');
const output = path.resolve(process.env.WORKBENCH_VISUAL_OUTPUT ?? 'test-results/release-visual', baseline ? 'before' : 'after');
const executable = createRequire(import.meta.url)('electron');
await mkdir(output, { recursive: true });
for (const scale of [1, 1.5]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-release-'));
  const folder = path.join(root, 'projects', 'release-preview');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  const document = { schemaVersion: 4, id: crypto.randomUUID(), name: '城市声音 · 创作工作台', revision: 0, camera: { x: 0, y: 0, scale: 1 }, assets: [], objects: [], notes: [], markers: [], connections: [], groups: [] };
  for (const [index, kind, file] of [[0, 'video', 'sample.mp4'], [1, 'audio', 'sample.wav']]) {
    const assetId = crypto.randomUUID();
    await copyFile(path.resolve('tests/fixtures', file), path.join(folder, 'assets', file));
    document.assets.push({ id: assetId, name: file, path: `assets/${file}`, kind, durationUs: 2_000_000, status: 'ready' });
    document.objects.push({ id: crypto.randomUUID(), kind: 'media', assetId, x: 60, y: 80 + index * 130, width: 500, height: 100, inUs: 0, outUs: 2_000_000, pixelsPerSecond: 250, color: '#5268e8', groupId: null });
  }
  const shapeId = crypto.randomUUID();
  document.objects.push({ id: shapeId, kind: 'rectangle', x: 60, y: 360, width: 180, height: 100, fill: '#e8ecff', stroke: '#5268e8', groupId: null });
  await writeFile(path.join(folder, 'project.json'), JSON.stringify(document));
  const env = { ...process.env, WORKBENCH_E2E_ROOT: root };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({ executablePath: executable, args: [`--force-device-scale-factor=${scale}`, '.'], env });
    const page = await app.firstWindow();
    page.setDefaultTimeout(20_000);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
    await page.locator('.splash-title').evaluate(element => { element.style.transition = 'none'; element.style.strokeDashoffset = '0'; });
    const helloBounds = await page.locator('.splash-title').evaluate(element => { const r = element.getBoundingClientRect(); return { width: r.width, height: r.height }; });
    await page.screenshot({ path: path.join(output, `hello-${scale}.png`) });
    if (!baseline) {
      // 独立测试会话重置开屏标记，使用真实主题复拍；窄窗口检查字形仍完整且居中。
      for (const theme of ['light', 'dark']) {
        if (theme === 'dark') {
          await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
          await page.evaluate(() => sessionStorage.removeItem('workbench-splash-shown'));
          await page.reload();
          await page.locator('.splash-title').evaluate(element => { element.style.transition = 'none'; element.style.strokeDashoffset = '0'; });
          await page.screenshot({ path: path.join(output, `hello-dark-${scale}.png`) });
        }
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 768));
        const bounds = await page.locator('.splash-title').evaluate(element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, viewport: innerWidth }; });
        expect(bounds.left).toBeGreaterThan(0);
        expect(bounds.right).toBeLessThan(bounds.viewport);
        await page.screenshot({ path: path.join(output, `hello-${theme}-narrow-${scale}.png`) });
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
      }
      await page.getByRole('button', { name: '切换到浅色模式', exact: true }).click();
    }
    await page.getByRole('button', { name: document.name, exact: true }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    await expect(page.locator('.task-list')).toHaveCount(0);
    await page.waitForTimeout(1200);
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') {
        await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
        await page.waitForTimeout(1800);
      }
      await page.getByRole('button', { name: '展开工具面板', exact: true }).click();
      await page.screenshot({ path: path.join(output, `tools-${theme}-${scale}.png`), animations: 'disabled' });
      await page.getByRole('button', { name: '还原工具面板', exact: true }).click();
      const canvas = await page.locator('.canvas').boundingBox();
      await page.mouse.dblclick(canvas.x + 140, canvas.y + 410);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '展开编辑面板', exact: true }).click();
      await expect(page.getByLabel('宽度', { exact: true })).toBeVisible();
      await page.evaluate(() => {
        window.__taskAppearances = 0;
        window.__taskObserver?.disconnect();
        window.__taskObserver = new MutationObserver(() => { if (document.querySelector('.task-list')) window.__taskAppearances++; });
        window.__taskObserver.observe(document.body, { childList: true, subtree: true });
      });
      let cacheRequests = 0;
      const observe = request => { if (request.url().startsWith('project-media://cache/')) cacheRequests++; };
      page.on('request', observe);
      for (const label of ['宽度', '高度', '旋转（°）', '不透明度（%）']) {
        const field = page.getByLabel(label, { exact: true });
        await field.fill(String(label === '旋转（°）' ? theme === 'light' ? 15 : 25 : label === '不透明度（%）' ? theme === 'light' ? 80 : 60 : theme === 'light' ? 160 : 180));
        await page.waitForTimeout(80);
        await page.screenshot({ path: path.join(output, `editing-${theme}-${scale}-${label === '宽度' ? 'width' : label === '高度' ? 'height' : label === '旋转（°）' ? 'rotation' : 'opacity'}.png`), animations: 'disabled' });
        await field.press('Enter');
        await page.waitForTimeout(300);
      }
      page.off('request', observe);
      const taskAppearances = await page.evaluate(() => { window.__taskObserver.disconnect(); return window.__taskAppearances; });
      console.log(JSON.stringify({ scale, theme, baseline, helloBounds, cacheRequests, taskAppearances }));
      if (!baseline) {
        expect(cacheRequests, '修改其他元素不得重新加载媒体缓存').toBe(0);
        expect(taskAppearances, '修改其他元素不得重启媒体任务').toBe(0);
        const lock = page.getByRole('checkbox', { name: '锁定标准比例', exact: true });
        await lock.focus(); await lock.press('Space');
        await expect(lock).toBeChecked();
        await page.getByLabel('宽度', { exact: true }).fill('220');
        await page.getByLabel('宽度', { exact: true }).press('Enter');
        await expect(page.getByLabel('高度', { exact: true })).toHaveValue('220');
        await page.screenshot({ path: path.join(output, `locked-${theme}-${scale}.png`), animations: 'disabled' });
        await lock.uncheck();
      }
      await page.getByRole('button', { name: '还原编辑面板', exact: true }).click();
    }
    await page.keyboard.press('Control+s');
    await expect.poll(async () => JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8')).revision).toBeGreaterThan(0);
  } finally {
    await app?.close();
    // 只释放本脚本创建的独立夹具项目，截图保留在 test-results 供人工核验。
    await rm(root, { recursive: true, force: true });
  }
}

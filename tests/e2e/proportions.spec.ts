// 使用范例：npm run test:e2e -- tests/e2e/proportions.spec.ts。
// 真实桌面验证规则图形的锁定、数值调整、手柄缩放、撤销和重开持久化。
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { newDocument, type ProjectDocument } from '../../src/core/document';
import { standardShapeRatio } from '../../src/core/shapeGeometry';

test('规则图形比例锁覆盖输入、鼠标缩放与保存重开', async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-proportions-'));
  const folder = path.join(root, 'projects', 'proportions');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  const document = newDocument('规则图形验收');
  for (const [index, kind] of (['rectangle', 'ellipse', 'diamond', 'star', 'triangle', 'hexagon'] as const).entries()) document.objects.push({ id: crypto.randomUUID(), kind, x: 60 + index % 3 * 270, y: 80 + Math.floor(index / 3) * 260, width: 140, height: 100, groupId: null, fill: '#e8ecff', stroke: '#5268e8' });
  await writeFile(path.join(folder, 'project.json'), JSON.stringify(document));
  const saved = async (): Promise<ProjectDocument> => JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8'));
  let app: ElectronApplication | undefined;
  try {
    const env: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: ['.'], env });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: document.name, exact: true }).click();
    const canvas = (await page.locator('.canvas').boundingBox())!;
    for (const object of document.objects) {
      await page.mouse.dblclick(canvas.x + object.x + object.width / 2, canvas.y + object.y + object.height / 2);
      await page.keyboard.press('Escape');
      const lock = page.getByRole('checkbox', { name: '锁定标准比例', exact: true });
      await lock.check();
      const width = page.getByLabel('宽度', { exact: true }), height = page.getByLabel('高度', { exact: true });
      await width.fill('180'); await width.press('Enter');
      await height.fill('100'); await height.press('Enter');
      await page.keyboard.press('Control+s');
      await expect.poll(async () => (await saved()).objects.find(item => item.id === object.id)?.width).toBeCloseTo(100 * standardShapeRatio(object.kind), 4);
      const current = (await saved()).objects.find(item => item.id === object.id)!;
      const x = canvas.x + current.x + current.width - 2, y = canvas.y + current.y + current.height - 2;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 50, y + 25, { steps: 5 }); await page.mouse.up();
      await page.keyboard.press('Control+s');
      await expect.poll(async () => (await saved()).objects.find(item => item.id === object.id)!.width).toBeGreaterThan(current.width + 20);
      const resized = (await saved()).objects.find(item => item.id === object.id)!;
      expect(resized.width / resized.height).toBeCloseTo(standardShapeRatio(object.kind), 5);
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      await expect(width).toHaveValue(String(Math.round(current.width * 100) / 100));
    }
    await page.getByRole('button', { name: '‹ 项目', exact: true }).click();
    await page.getByRole('button', { name: document.name, exact: true }).click();
    for (const object of (await saved()).objects) {
      expect('aspectLocked' in object && object.aspectLocked).toBe(true);
      expect(object.width / object.height).toBeCloseTo(standardShapeRatio(object.kind), 5);
    }
  } finally { await app?.close(); await rm(root, { recursive: true, force: true }); }
});

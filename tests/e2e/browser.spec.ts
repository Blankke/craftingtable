// 使用示例：npx playwright test tests/e2e/browser.spec.ts。用本机 Chrome 验证网页版导入与重开。
import { chromium, expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import path from 'node:path';
import { existsSync } from 'node:fs';

test('网页版可以导入素材并在重开项目后显示', async () => {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ];
  const executablePath = candidates.find(existsSync);
  test.skip(!executablePath, '本机没有 Chrome 或 Edge');
  let server: ViteDevServer | undefined;
  const browser = await chromium.launch({ executablePath });
  try {
    server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
    await server.listen();
    const page = await browser.newPage();
    await page.goto(server.resolvedUrls!.local[0]);
    await page.getByRole('button', { name: '设置' }).click();
    await page.getByLabel('界面语言').selectOption('en');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByLabel('Language')).toHaveValue('en');
    await page.getByLabel('Language').selectOption('zh-CN');
    await page.getByRole('button', { name: '设置' }).click();
    await page.getByRole('button', { name: '添加项目' }).click();
    await page.getByRole('button', { name: '新建项目' }).click();
    await page.getByLabel('项目名称').fill('浏览器测试项目');
    await page.getByRole('button', { name: '创建项目' }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '导入素材' }).click();
    await (await chooser).setFiles(path.resolve('tests/fixtures/sample.png'));
    await expect(page.locator('.asset-details b')).toHaveText('sample.png');
    await expect(page.locator('.asset-preview')).toHaveJSProperty('complete', true);
    await page.locator('header button').first().click();
    await expect(page.getByRole('button', { name: '浏览器测试项目' })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: '浏览器测试项目' }).click();
    await expect(page.locator('.asset-details b')).toHaveText('sample.png');
    await expect(page.locator('.asset-preview')).toHaveJSProperty('naturalWidth', 160);
  } finally {
    await browser.close();
    await server?.close();
  }
});

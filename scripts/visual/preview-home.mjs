// 用法：先运行 npm.cmd run build，再运行 node scripts/visual/preview-home.mjs；截图输出到 test-results/。
// 使用独立临时项目目录并导入固定图片，便于核对 Hello 与有真实内容的文件夹静止、展开两种视觉状态。
import { _electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const executable = createRequire(import.meta.url)('electron');
const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-preview-'));
const environment = { ...process.env, WORKBENCH_E2E_ROOT: root };
delete environment.ELECTRON_RUN_AS_NODE;
// 可用 WORKBENCH_DEVICE_SCALE_FACTOR=1.5 复现 Windows 150% 缩放的渲染结果。
const scaleFactor = process.env.WORKBENCH_DEVICE_SCALE_FACTOR || '1';
if (!/^(1|1\.25|1\.5|2)$/.test(scaleFactor)) throw Error('WORKBENCH_DEVICE_SCALE_FACTOR 仅支持 1、1.25、1.5 或 2');
const suffix = scaleFactor !== '1' ? `-${scaleFactor.replace('.', '_')}` : '';
let application;
try {
  await mkdir('test-results', { recursive: true });
  application = await _electron.launch({ executablePath: executable, args: [`--force-device-scale-factor=${scaleFactor}`, '.'], env: environment });
  const page = await application.firstWindow();
  await page.locator('.splash path').waitFor();
  await page.screenshot({ path: `test-results/hello-preview${suffix}.png` });
  await page.locator('.splash').waitFor({ state: 'detached' });
  await page.locator('.plus').click();
  await page.getByRole('button', { name: '新建项目' }).click();
  await page.getByLabel('项目名称').fill('视觉预览');
  await page.getByRole('button', { name: '创建项目' }).click();
  await page.locator('.canvas').waitFor();
  // 用真实磁盘 File 经过页面拖入、preload 和后台导入，保证首页截图没有虚构素材。
  await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'preview-source'; input.style.display = 'none'; document.body.append(input); });
  await page.locator('#preview-source').setInputFiles(path.resolve('tests/fixtures/sample.png'));
  await page.evaluate(() => {
    const input = document.querySelector('#preview-source');
    if (!(input instanceof HTMLInputElement)) throw Error('预览素材输入框未创建');
    const transfer = new DataTransfer();
    Array.from(input.files ?? []).forEach(file => transfer.items.add(file));
    const canvas = document.querySelector('.canvas');
    if (!canvas) throw Error('预览画布未创建');
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 180, clientY: 180, dataTransfer: transfer }));
  });
  await page.locator('.asset').filter({ hasText: 'sample.png' }).waitFor();
  await page.locator('header button').first().click();
  await page.locator('.gf-hit').waitFor();
  // 等待真实图片完成解码，静止态截图才会反映文件夹内的实际内容。
  await page.locator('.gf-sheet-art').first().waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `test-results/folder-rest${suffix}.png` });
  await page.locator('.gf-hit').hover();
  await page.waitForTimeout(180);
  await page.screenshot({ path: `test-results/folder-slide-early${suffix}.png` });
  await page.waitForTimeout(220);
  await page.screenshot({ path: `test-results/folder-slide-mid${suffix}.png` });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `test-results/folder-open${suffix}.png` });
  // 同一真实项目在深色下复拍，检查玻璃展开后仍能看清素材、标题和元数据。
  await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `test-results/folder-rest-dark${suffix}.png` });
  await page.locator('.gf-hit').hover();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `test-results/folder-open-dark${suffix}.png` });
  console.log('预览图已输出到 test-results/。');
} finally {
  await application?.close().catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}

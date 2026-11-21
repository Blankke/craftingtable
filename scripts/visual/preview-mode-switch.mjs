// 用法：npm.cmd run build；node scripts/visual/preview-mode-switch.mjs。--baseline 保存修改前截图。
// PowerShell：$env:WORKBENCH_DEVICE_SCALE_FACTOR='1.5'；node scripts/visual/preview-mode-switch.mjs。
// 使用独立临时项目和真实 Electron，复拍明暗主题、两种模式、过渡帧及窄窗口；图片写入 test-results/。
import { _electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const scale = Number(process.env.WORKBENCH_DEVICE_SCALE_FACTOR || 1);
const baseline = process.argv.includes('--baseline');
const output = path.resolve('test-results/mode-switch', `${baseline ? 'before' : 'after'}-${scale}`);
await mkdir(output, { recursive: true });
const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-switch-preview-'));
const env = { ...process.env, WORKBENCH_E2E_ROOT: root };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [`--force-device-scale-factor=${scale}`, '.'], env });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.plus').click();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByLabel('项目名称').fill('城市声音 · 影像策划');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.canvas')).toBeVisible();
  const control = page.locator('.mode-switch');
  const canvas = control.locator('button').filter({ hasText: '画布' });
  const notes = control.locator('button').filter({ hasText: '笔记' });
  const capture = async name => {
    await page.waitForTimeout(720);
    await page.locator('.workspace-header').screenshot({ path: path.join(output, `${name}-header.png`) });
    await control.screenshot({ path: path.join(output, `${name}-control.png`) });
  };
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
    await canvas.click();
    await capture(`${theme}-canvas`);
    await notes.click();
    await expect(page.locator('.note-tiptap .ProseMirror')).toBeVisible();
    await capture(`${theme}-notes`);
  }
  await canvas.click();
  await page.waitForTimeout(720);
  await notes.click();
  await page.waitForTimeout(60);
  await control.screenshot({ path: path.join(output, 'transition-early.png') });
  await page.waitForTimeout(100);
  await control.screenshot({ path: path.join(output, 'transition-mid.png') });
  await capture('transition-end');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 768));
  await capture('compact-dark');
  const bounds = await control.boundingBox();
  const center = await page.locator('.workspace-header-center').boundingBox();
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(center.x);
  await page.getByRole('button', { name: '切换到浅色模式', exact: true }).click();
  await capture('compact-light');
  if (!baseline) {
    // 快速反向只保留最后一次选择；减少动态效果与强制动画各自遵循设置。
    await canvas.click(); await notes.click(); await canvas.click();
    await expect(canvas).toBeChecked();
    await capture('rapid-reverse');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await notes.click();
    await expect(notes).toBeChecked();
    expect(await control.locator('.mode-switch-indicator').evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(.001);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('强制播放动画', { exact: true }).check();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await canvas.click();
    expect(await control.locator('.mode-switch-indicator').evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeGreaterThan(0);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('界面语言', { exact: true }).selectOption('en');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await control.getByRole('radio', { name: 'Notes', exact: true }).click();
    await capture('compact-english');
    const selected = await control.getByRole('radio', { name: 'Notes', exact: true }).boundingBox();
    const highlight = await control.locator('.mode-switch-indicator').boundingBox();
    expect(Math.abs(selected.x - highlight.x)).toBeLessThan(1);
    expect(Math.abs(selected.width - highlight.width)).toBeLessThan(1);
  }
  expect(errors).toEqual([]);
  console.log(`模式切换视觉复拍通过：${output}`);
} finally {
  await app?.close();
  // 关闭 Electron 后清理本次创建的临时项目，截图由统一清理命令管理。
  await rm(root, { recursive: true, force: true });
}

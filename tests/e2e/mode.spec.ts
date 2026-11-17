// 用法：npm.cmd run test:e2e -- tests/e2e/mode.spec.ts。验证工作台模式切换、开屏一次性状态、分栏与颜色/图形/箭头入口。
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const electronExecutable = createRequire(import.meta.url)('electron') as string;

test('开屏 Hello World、笔记/画布来回切换与分栏', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-mode-'));
  let app: ElectronApplication | undefined;
  try {
    const env = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: electronExecutable, args: ['.'], env });
    const page = await app.firstWindow();
    // 开屏以本地 Indie Flower 72px 路径描绘 Hello World。
    await expect(page.locator('.splash path')).toBeVisible();
    // 开屏覆盖层可由一次点击立即跳过，后续进入项目不应再出现。
    await page.mouse.click(12, 12);
    await expect(page.locator('.splash')).toHaveCount(0);
    await page.locator('.plus').click();
    await page.getByRole('button', { name: '新建项目' }).click();
    await page.getByLabel('项目名称').fill('模式验收');
    await page.getByRole('button', { name: '创建项目' }).click();
    // 创建项目立即结束开屏，进入画布默认模式。
    await expect(page.locator('.canvas')).toBeVisible();
    await expect(page.locator('.splash')).toHaveCount(0);
    const canvasButton = page.locator('.mode-switch-btn').filter({ hasText: '画布' });
    const notesButton = page.locator('.mode-switch-btn').filter({ hasText: '笔记' });
    await expect(canvasButton).toHaveAttribute('aria-pressed', 'true');
    // 首次进入笔记自动创建一篇，选中层与小球停在笔记项两端。
    await notesButton.click();
    await expect(notesButton).toHaveAttribute('aria-pressed', 'true');
    await expect(canvasButton).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.note-tiptap .ProseMirror')).toBeVisible();
    const ball = page.locator('.mode-switch-ball');
    const thumb = page.locator('.mode-switch-thumb');
    const face = page.locator('.mode-switch-ball-face');
    await expect(page.locator('.mode-switch')).toHaveClass(/is-notes/);
    await expect.poll(async () => {
      const ballBox = await ball.boundingBox();
      const thumbBox = await thumb.boundingBox();
      return ballBox && thumbBox ? Math.round(thumbBox.x + thumbBox.width - ballBox.x - ballBox.width) : null;
    }).toBe(5);
    await expect(face).toHaveAttribute('style', /rotate\(-360deg\)/);
    // 来回切换两次，两端 aria-pressed 与小球位置正确，笔记内容恢复且不重现开屏。
    for (let round = 0; round < 2; round++) {
      await canvasButton.click();
      await expect(canvasButton).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.canvas')).toBeVisible();
      await expect(page.locator('.mode-switch')).toHaveClass(/is-canvas/);
      await expect.poll(async () => {
        const ballBox = await ball.boundingBox();
        const thumbBox = await thumb.boundingBox();
        return ballBox && thumbBox ? Math.round(ballBox.x - thumbBox.x) : null;
      }).toBeGreaterThanOrEqual(4);
      await expect(face).toHaveAttribute('style', /rotate\(0deg\)/);
      await notesButton.click();
      await expect(notesButton).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.note-tiptap .ProseMirror')).toBeVisible();
      await expect(page.locator('.mode-switch')).toHaveClass(/is-notes/);
      await expect.poll(async () => {
        const ballBox = await ball.boundingBox();
        const thumbBox = await thumb.boundingBox();
        return ballBox && thumbBox ? Math.round(thumbBox.x + thumbBox.width - ballBox.x - ballBox.width) : null;
      }).toBe(5);
      await expect(face).toHaveAttribute('style', /rotate\(-360deg\)/);
    }
    await expect(page.locator('.splash')).toHaveCount(0);
    // 三块面板间存在水平分隔线，键盘方向键可调整相邻两块。
    await canvasButton.click();
    await expect(page.locator('.dock-divider').first()).toBeVisible();
    await page.locator('.dock-divider').first().focus();
    await page.keyboard.press('ArrowUp');
    // 首页项目卡片右下角的菜单提供常用项目操作，打开项目可回到原工作台。
    await page.locator('header button').first().click();
    await expect(page.locator('.home')).toBeVisible();
    await page.locator('.glass-folder-more').click();
    await expect(page.locator('.glass-folder-menu')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: '在资源管理器中显示' })).toBeVisible();
    await page.getByRole('menuitem', { name: '打开项目' }).click();
    await expect(page.locator('.canvas')).toBeVisible();
  } finally {
    await app?.close().catch(() => undefined);
  }
});

test('颜色弹层、图形轮廓与箭头头部预览', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-color-'));
  let app: ElectronApplication | undefined;
  try {
    const env = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: electronExecutable, args: ['.'], env });
    const page = await app.firstWindow();
    await page.locator('.plus').click();
    await page.getByRole('button', { name: '新建项目' }).click();
    await page.getByLabel('项目名称').fill('颜色验收');
    await page.getByRole('button', { name: '创建项目' }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    // 工具区图形预览为无填充、主题色描边的轮廓。
    await expect(page.locator('.shape-icon path').first()).toHaveAttribute('fill', 'none');
    // 放置矩形并打开编辑面板，颜色入口弹出统一弹层，Pantone 扁平展示（无年份分组标题）。
    await page.getByRole('button', { name: '矩形' }).first().click();
    await page.getByRole('button', { name: '编辑视图' }).click();
    await page.getByRole('button', { name: '填充颜色' }).click();
    await expect(page.locator('.color-popover')).toBeVisible();
    await page.getByRole('tab', { name: 'Pantone' }).click();
    await expect(page.locator('.swatch').first()).toBeVisible();
    await expect(page.locator('.pantone-year')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.color-popover')).toHaveCount(0);
    // 画一条箭头并点击选中，连接线检查器提供带 SVG 预览的头部选项网格。
    await page.getByRole('button', { name: '箭头', exact: true }).click();
    const box = await page.locator('.canvas').boundingBox();
    await page.mouse.move(box!.x + 200, box!.y + 200);
    await page.mouse.down();
    await page.mouse.move(box!.x + 360, box!.y + 260, { steps: 6 });
    await page.mouse.up();
    await page.getByRole('button', { name: '选择', exact: true }).click();
    await page.mouse.click(box!.x + 280, box!.y + 228);
    await expect(page.locator('.arrow-head-grid').first()).toBeVisible();
    await expect(page.locator('.arrow-head-preview').first()).toBeVisible();
  } finally {
    await app?.close().catch(() => undefined);
  }
});

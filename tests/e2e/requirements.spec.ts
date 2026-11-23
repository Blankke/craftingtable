// 用法：npm.cmd run test:e2e -- tests/e2e/requirements.spec.ts。
// 通过真实 Electron、preload 与项目文件验证阅读批注、剪贴板、拖入和连续数值编辑。
import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import type { ProjectDocument } from '../../src/core/document';

async function createProject(page: Page, name: string) {
  await page.locator('.plus').click();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByLabel('项目名称').fill(name);
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.canvas')).toBeVisible();
}

test('阅读批注、Markdown 导出与无路径剪贴板图片', async () => {
  test.setTimeout(90_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-reading-'));
  let app: ElectronApplication | undefined;
  try {
    const env: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: ['.'], env });
    const page = await app.firstWindow();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await createProject(page, '阅读批注验收');
    const folder = path.join(root, 'projects', (await readdir(path.join(root, 'projects')))[0]);
    const saved = async (): Promise<ProjectDocument> => JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8'));
    await page.locator('.mode-switch-btn').filter({ hasText: '笔记' }).click();
    const body = page.locator('.note-tiptap .ProseMirror');
    await body.fill('# 拍摄提纲\n\n这是 **重点原文**，保留标记。\n\n> [!tip] 提示\n> 先录环境声。\n\n- [x] 准备设备\n\n$x^2$');
    await expect(body).toContainText('**重点原文**');
    await page.getByLabel('渲染模式', { exact: true }).click();
    const preview = page.locator('.note-paper > .note-markdown-preview');
    await expect(preview.locator('h1')).toHaveText('拍摄提纲');
    await expect(preview.locator('.note-callout')).toContainText('先录环境声');
    await expect(preview.locator('.katex')).toBeVisible();
    await expect(page.locator('[contenteditable=true]')).toHaveCount(0);
    const selectReadingText = async () => {
      await preview.locator('strong [data-note-positions]').filter({ hasText: '重点原文' }).evaluate(element => {
        const range = document.createRange(); range.selectNodeContents(element);
        const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      });
      await expect(page.locator('.note-reading-menu')).toBeVisible();
    };
    await selectReadingText();
    await page.locator('.note-reading-menu').getByRole('button', { name: '划线 #8cb8e8', exact: true }).click();
    await expect(preview.locator('mark')).toContainText('重点原文');
    await selectReadingText();
    await page.locator('.note-reading-menu').getByRole('button', { name: '批注', exact: true }).click();
    await page.getByPlaceholder('批注内容…').fill('注意收声距离');
    await page.getByPlaceholder('批注内容…').blur();
    await expect(page.locator('.note-annotation')).toContainText('注意收声距离');
    await expect(preview.locator('[data-note-annotation]')).toHaveText('重点原文');
    await expect(page.locator('.note-annotation-links path')).toHaveCount(1);
    await page.screenshot({ path: 'test-results/requirements-reading.png' });
    const output = path.join(root, 'export.md');
    await app.evaluate(({ dialog }, filePath) => { Object.defineProperty(dialog, 'showSaveDialog', { value: async () => ({ canceled: false, filePath }) }); }, output);
    await page.getByLabel('导出 Markdown', { exact: true }).click();
    await expect.poll(() => readFile(output, 'utf8').catch(() => '')).toContain('# 拍摄提纲');
    const markdown = await readFile(output, 'utf8');
    expect(markdown).toContain('# 拍摄提纲'); expect(markdown).not.toContain('\\# 拍摄提纲');
    expect(markdown).toContain('> [!tip] 提示');
    await page.getByLabel('编辑模式', { exact: true }).click();
    await body.press('Control+End');
    const png = await readFile('tests/fixtures/sample.png');
    // 构造真正无磁盘路径的 File，验证 Electron 跨进程序列化和落盘后的图片解码。
    await body.evaluate((element, bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], '剪贴板图片.png', { type: 'image/png' }));
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
    }, [...png]);
    await expect(body.locator('.note-project-image')).toBeVisible();
    await expect.poll(() => body.locator('.note-project-image').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(160);
    await expect.poll(async () => (await saved()).assets.length).toBe(1);
    expect(await readFile(path.join(folder, (await saved()).assets[0].path))).toEqual(png);
    await page.getByLabel('分屏预览', { exact: true }).click();
    await expect(page.locator('.note-assist')).toBeVisible();
    const resizer = page.getByRole('separator', { name: '调整预览宽度' });
    const original = Number(await resizer.getAttribute('aria-valuenow'));
    await resizer.focus(); await page.keyboard.press('ArrowLeft');
    await expect(resizer).toHaveAttribute('aria-valuenow', String(original + 16));
    await page.locator('header button').first().click();
    await page.getByRole('button', { name: '项目菜单', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.home')).toBeVisible();
    await expect(page.getByRole('menu')).not.toBeVisible();
    await page.getByRole('button', { name: '项目菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '重命名项目' }).click();
    await page.getByLabel('项目名称').fill('阅读批注已重命名');
    await page.getByRole('button', { name: '保存名称' }).click();
    await expect(page.locator('.glass-folder-title')).toHaveText('阅读批注已重命名');
    expect((await saved()).name).toBe('阅读批注已重命名');
    expect((await saved()).notes[0].annotations[0].note).toBe('注意收声距离');
    expect(errors).toEqual([]);
  } finally { await app?.close().catch(() => undefined); }
});

test('实际形状虚影、连续数值一次撤销、重复双击与笔记拖入', async () => {
  test.setTimeout(60_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-placement-'));
  let app: ElectronApplication | undefined;
  try {
    const env: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: ['.'], env });
    const page = await app.firstWindow();
    await createProject(page, '画布补全验收');
    const folder = path.join(root, 'projects', (await readdir(path.join(root, 'projects')))[0]);
    const saved = async (): Promise<ProjectDocument> => JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8'));
    const canvas = page.locator('.canvas');
    const dragTool = async () => {
      const tool = await page.getByRole('button', { name: '矩形', exact: true }).boundingBox();
      await page.mouse.move(tool!.x + tool!.width / 2, tool!.y + tool!.height / 2); await page.mouse.down();
      await page.mouse.move(300, 300, { steps: 8 });
      await expect(canvas).toHaveAttribute('data-placement-preview', 'rectangle');
    };
    await dragTool();
    expect((await saved()).objects).toHaveLength(0);
    await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' }); await page.mouse.up();
    await expect(canvas).not.toHaveAttribute('data-placement-preview', /.+/);
    expect((await saved()).objects).toHaveLength(0);
    await dragTool(); await page.screenshot({ path: 'test-results/requirements-shape-ghost.png' }); await page.mouse.up();
    await expect.poll(async () => (await saved()).objects.length).toBe(1);
    const object = (await saved()).objects[0];
    expect(object.style?.fillEnabled).toBe(false);
    const bounds = await canvas.boundingBox();
    await page.mouse.dblclick(bounds!.x + object.x + 2, bounds!.y + object.y + 2);
    const rotation = page.getByLabel('旋转（°）', { exact: true });
    await expect(rotation).toBeVisible();
    const before = await canvas.locator('canvas').first().evaluate((element: HTMLCanvasElement) => element.toDataURL());
    await rotation.focus();
    for (let count = 0; count < 8; count++) await page.keyboard.down('ArrowUp');
    await expect(rotation).toHaveValue('8');
    expect(await canvas.locator('canvas').first().evaluate((element: HTMLCanvasElement) => element.toDataURL())).not.toBe(before);
    await page.keyboard.up('ArrowUp');
    await rotation.press('Control+z');
    await expect(rotation).toHaveValue('0');
    await expect.poll(async () => (await saved()).objects[0].rotation ?? 0).toBe(0);
    // 原生数字框的微调箭头在鼠标持续按住时预览，松手只增加一个撤销步骤。
    const spinner = await rotation.boundingBox();
    await page.mouse.move(spinner!.x + spinner!.width - 16, spinner!.y + spinner!.height / 2 - 4); await page.mouse.down();
    await expect.poll(async () => Number(await rotation.inputValue())).toBeGreaterThan(2);
    await page.mouse.up();
    await rotation.press('Control+z');
    await expect(rotation).toHaveValue('0');
    await page.getByRole('button', { name: '编辑视图', exact: true }).click();
    await expect(rotation).not.toBeVisible();
    await page.mouse.dblclick(bounds!.x + object.x + 2, bounds!.y + object.y + 2);
    await expect(rotation).toBeVisible();
    await page.locator('.mode-switch-btn').filter({ hasText: '笔记' }).click();
    await page.getByLabel('笔记名称', { exact: true }).fill('可拖入的笔记');
    await page.locator('.note-tiptap .ProseMirror').fill('画布缩略图正文');
    await page.locator('.mode-switch-btn').filter({ hasText: '画布' }).click();
    const note = page.locator('.note-library .asset').filter({ hasText: '可拖入的笔记' });
    await note.scrollIntoViewIfNeeded();
    const noteBounds = await note.boundingBox();
    await page.mouse.move(noteBounds!.x + 40, noteBounds!.y + 20); await page.mouse.down();
    await page.mouse.move(500, 400, { steps: 8 });
    await expect(canvas).toHaveAttribute('data-placement-preview', 'note'); await page.mouse.up();
    await expect.poll(async () => (await saved()).objects.filter(item => item.kind === 'note').length).toBe(1);
    await expect(canvas).toBeVisible();
  } finally { await app?.close().catch(() => undefined); }
});

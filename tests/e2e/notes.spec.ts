// 使用范例：npm.cmd run test:e2e -- tests/e2e/notes.spec.ts。验证 Tiptap 输入、浮动菜单、批注、图片与笔记标签生命周期。
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const electronExecutable = createRequire(import.meta.url)('electron') as string;

test('笔记输入、浮动菜单批注、图片与标签恢复', async () => {
  test.setTimeout(60_000);
  const testRoot = await mkdtemp(path.join(os.tmpdir(), 'workbench-notes-'));
  let application: ElectronApplication | undefined;
  try {
    const environment = { ...process.env, WORKBENCH_E2E_ROOT: testRoot };
    delete environment.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({ executablePath: electronExecutable, args: ['.'], env: environment });
    const page = await application.firstWindow();
    await expect(page.locator('.home')).toBeVisible();
    await page.locator('.plus').click();
    await page.getByRole('button', { name: '新建项目' }).click();
    await page.getByLabel('项目名称').fill('笔记验收');
    await page.getByRole('button', { name: '创建项目' }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    // 首次进入笔记：切换器切到笔记，自动创建一篇。
    await page.locator('.mode-switch-btn').filter({ hasText: '笔记' }).click();
    const body = page.locator('.note-tiptap .ProseMirror');
    await expect(body).toBeVisible();
    await body.click();
    await body.fill('中文输入与保存');
    await expect(body).toHaveText('中文输入与保存');
    // “开始”组：无选区时字体和字号为空；版心调整会让居中的划线正文列同步收窄。
    const startGroup = page.locator('.note-start-group');
    const fontControl = startGroup.locator('select');
    const sizeControl = startGroup.locator('input[type=number]').nth(0);
    const marginControl = startGroup.locator('input[type=number]').nth(2);
    await expect(fontControl).toHaveValue('');
    await expect(sizeControl).toHaveValue('');
    const beforeMargin = await page.locator('.note-text').boundingBox();
    await marginControl.fill('120');
    await expect.poll(async () => (await page.locator('.note-text').boundingBox())?.width ?? 0).toBeLessThan(beforeMargin!.width - 40);
    await body.press('Control+A');
    await expect(fontControl).toHaveValue('Georgia');
    await expect(sizeControl).toHaveValue('17');
    // Markdown 快捷块：`# ` 实时转为标题。
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('# 标题段落');
    await expect(body.locator('h1')).toHaveText('标题段落');
    // 选中全文后浮动菜单出现，可新增批注与统一划线。
    await body.press('Control+A');
    await page.locator('.note-bubble-menu button').filter({ hasText: '批注' }).click();
    await expect(page.locator('.note-annotation')).toHaveCount(1);
    await page.getByPlaceholder('批注内容…').fill('正文批注');
    await page.getByPlaceholder('批注内容…').blur();
    await body.press('Control+A');
    await page.getByRole('button', { name: '划线', exact: true }).click();
    // 阅读模式保持只读，但仍可通过浮动菜单对选中文字划线与批注。
    await page.getByRole('button', { name: '阅读模式' }).click();
    await expect(body).toHaveAttribute('contenteditable', 'false');
    await page.evaluate(() => {
      const text = document.querySelector('.note-tiptap .ProseMirror p')?.firstChild;
      if (!text) throw Error('未找到笔记正文');
      const range = document.createRange(); range.selectNodeContents(text);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    });
    await page.getByRole('button', { name: '划线', exact: true }).click();
    // 划线提交后浮动菜单随选区清除而关闭，重新选择文字再新增批注。
    await page.evaluate(() => {
      const text = document.querySelector('.note-tiptap .ProseMirror p')?.firstChild;
      if (!text) throw Error('未找到笔记正文');
      const range = document.createRange(); range.selectNodeContents(text);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    });
    await page.locator('.note-bubble-menu button').filter({ hasText: '批注' }).click();
    await expect.poll(async () => { const folders = await readdir(path.join(testRoot, 'projects')); const project = JSON.parse(await readFile(path.join(testRoot, 'projects', folders[0], 'project.json'), 'utf8')) as { notes: { annotations: unknown[] }[] }; return project.notes[0]?.annotations.length ?? 0; }).toBe(2);
    await page.getByPlaceholder('批注内容…').last().fill('阅读批注');
    await page.getByPlaceholder('批注内容…').last().blur();
    await page.getByRole('button', { name: '编辑模式' }).click();
    // 拖入真实图片文件：preload 负责解析路径，笔记正文仅接收项目素材 ID。
    await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'note-drop-source'; input.style.display = 'none'; document.body.append(input); });
    await page.locator('#note-drop-source').setInputFiles(path.resolve('tests/fixtures/sample.png'));
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('#note-drop-source')!, transfer = new DataTransfer();
      transfer.items.add(input.files![0]);
      document.querySelector('.note-tiptap .ProseMirror')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    await expect.poll(async () => { const folders = await readdir(path.join(testRoot, 'projects')); const project = JSON.parse(await readFile(path.join(testRoot, 'projects', folders[0], 'project.json'), 'utf8')) as { notes: { document: { content: { type: string }[] } }[] }; return project.notes[0]?.document.content.some(node => node.type === 'projectImage') ?? false; }).toBe(true);
    await page.locator('.note-project-image').click();
    await expect(page.getByLabel('图片宽度')).toBeVisible();
    await page.getByLabel('图片宽度').fill('280');
    const alignRight = page.locator('.note-image-tools button').filter({ hasText: '右' });
    await expect(alignRight).toBeEnabled();
    await alignRight.click();
    // 关闭最后一个标签回到画布；切换器重新进入后恢复同一篇笔记。
    await page.getByRole('button', { name: '关闭标签' }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    await page.locator('.mode-switch-btn').filter({ hasText: '笔记' }).click();
    await expect(page.locator('.note-tiptap .ProseMirror')).toContainText('中文输入与保存');
    await page.locator('header button').first().click();
    await expect(page.locator('.home')).toBeVisible();
    const [folder] = await readdir(path.join(testRoot, 'projects'));
    const saved = JSON.parse(await readFile(path.join(testRoot, 'projects', folder, 'project.json'), 'utf8')) as { schemaVersion: number; assets: { kind: string }[]; notes: { annotations: { note: string }[]; document: { content: { type: string; attrs?: { width?: number; align?: string }; content?: { text?: string; marks?: { type: string }[] }[] }[] } }[] };
    expect(saved.schemaVersion).toBe(3);
    const paragraph = saved.notes[0].document.content.find(node => node.type === 'paragraph');
    expect(paragraph?.content?.[0].text).toBe('中文输入与保存');
    expect(paragraph?.content?.[0].marks?.some(mark => mark.type === 'noteAnnotation' || mark.type === 'highlight')).toBe(true);
    expect(saved.notes[0].document.content.some(node => node.type === 'heading')).toBe(true);
    expect(saved.notes[0].annotations[0].note).toBe('正文批注');
    expect(saved.assets.some(asset => asset.kind === 'image')).toBe(true);
    expect(saved.notes[0].document.content.some(node => node.type === 'projectImage')).toBe(true);
    expect(saved.notes[0].document.content.find(node => node.type === 'projectImage')?.attrs).toMatchObject({ width: 280, align: 'right' });
  } finally {
    await application?.close().catch(() => undefined);
    await rm(testRoot, { recursive: true, force: true });
  }
});

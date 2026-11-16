// 使用范例：npm.cmd run test:e2e -- tests/e2e/notes.spec.ts。验证 Tiptap 输入与笔记标签生命周期。
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const electronExecutable = createRequire(import.meta.url)('electron') as string;

test('笔记中文输入、关闭标签与重启恢复', async () => {
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
    await page.locator('header button').filter({ hasText: '笔记' }).click();
    const body = page.locator('.note-tiptap .ProseMirror');
    await expect(body).toBeVisible();
    await body.fill('中文输入与保存');
    await expect(body).toHaveText('中文输入与保存');
    await body.press('Control+A');
    await page.getByRole('button', { name: '＋ 批注' }).click();
    await expect(page.locator('.note-annotation')).toHaveCount(1);
    await page.getByPlaceholder('批注内容…').fill('正文批注');
    await page.getByPlaceholder('批注内容…').blur();
    // 阅读模式锁定直接输入，但保留选中文本后的划线和新增批注。
    await page.getByRole('button', { name: '阅读模式' }).click();
    await expect(body).toHaveAttribute('contenteditable', 'false');
    await page.evaluate(() => {
      const text = document.querySelector('.note-tiptap .ProseMirror p')?.firstChild;
      if (!text) throw Error('未找到笔记正文');
      const range = document.createRange(); range.selectNodeContents(text);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    });
    await page.locator('.note-highlight').first().click();
    await page.locator('.note-actions button').filter({ hasText: '批注' }).click();
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
    const alignRight = page.getByRole('button', { name: '右' });
    await expect(alignRight).toBeEnabled();
    await alignRight.click();
    await page.getByRole('button', { name: '关闭标签' }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    await page.locator('header button').filter({ hasText: '笔记' }).click();
    await expect(page.locator('.note-tiptap .ProseMirror')).toHaveText('中文输入与保存');
    await page.locator('header button').first().click();
    await expect(page.locator('.home')).toBeVisible();
    const [folder] = await readdir(path.join(testRoot, 'projects'));
    const saved = JSON.parse(await readFile(path.join(testRoot, 'projects', folder, 'project.json'), 'utf8')) as { schemaVersion: number; assets: { kind: string }[]; notes: { annotations: { note: string }[]; document: { content: { type: string; attrs?: { width?: number; align?: string }; content?: { text?: string; marks?: { type: string }[] }[] }[] } }[] };
    expect(saved.schemaVersion).toBe(3);
    const paragraph = saved.notes[0].document.content.find(node => node.type === 'paragraph');
    expect(paragraph?.content?.[0].text).toBe('中文输入与保存');
    expect(paragraph?.content?.[0].marks?.some(mark => mark.type === 'noteAnnotation')).toBe(true);
    expect(saved.notes[0].annotations[0].note).toBe('正文批注');
    expect(saved.assets.some(asset => asset.kind === 'image')).toBe(true);
    expect(saved.notes[0].document.content.some(node => node.type === 'projectImage')).toBe(true);
    expect(saved.notes[0].document.content.find(node => node.type === 'projectImage')?.attrs).toMatchObject({ width: 280, align: 'right' });
  } finally {
    await application?.close().catch(() => undefined);
    await rm(testRoot, { recursive: true, force: true });
  }
});

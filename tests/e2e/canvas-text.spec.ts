// 使用范例：npm.cmd run test:e2e -- tests/e2e/canvas-text.spec.ts。
// 验证安装包：PowerShell 设置 $env:WORKBENCH_TEST_EXECUTABLE='安装目录/工作台.exe'，再执行 npx playwright test tests/e2e/canvas-text.spec.ts。
// 真实 Electron 验证双击文字、空形状与音频标记批注；截图覆盖明暗及 100%/150% 缩放。
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { newDocument, type CanvasObject, type ProjectDocument } from '../../src/core/document';
import { styleOf } from '../../src/core/appearance';

for (const scale of [1, 1.5]) for (const theme of ['light', 'dark']) {
  test(`画布双击文字编辑 ${theme} ${scale * 100}%`, async ({}, testInfo) => {
    test.setTimeout(60_000);
    const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-canvas-text-'));
    const folder = path.join(root, 'projects', 'canvas-text');
    await mkdir(path.join(folder, 'assets'), { recursive: true });
    await copyFile(path.resolve('tests/fixtures/sample.wav'), path.join(folder, 'assets', 'sample.wav'));
    const document = newDocument('画布文字编辑验收');
    const ink = theme === 'dark' ? '#e4e8f2' : '#172033';
    const text: CanvasObject = { id: crypto.randomUUID(), kind: 'text', x: 80, y: 90, width: 240, height: 90, groupId: null, text: '拍摄提纲', fontSize: 18, color: ink, align: 'left' };
    // 特意省略可选 text 字段，验证从未输入文字的透明形状也能进入编辑。
    const shape: CanvasObject = { id: crypto.randomUUID(), kind: 'rectangle', x: 410, y: 90, width: 240, height: 90, groupId: null, fill: 'transparent', stroke: '#5268e8', color: ink };
    shape.style = { ...styleOf(shape), fillEnabled: false };
    const assetId = crypto.randomUUID(), mediaId = crypto.randomUUID(), markerId = crypto.randomUUID();
    document.assets.push({ id: assetId, name: 'sample.wav', path: 'assets/sample.wav', kind: 'audio', durationUs: 2_000_000, status: 'ready' });
    document.objects.push(text, shape, { id: mediaId, kind: 'media', assetId, x: 80, y: 270, width: 340, height: 100, groupId: null, inUs: 0, outUs: 2_000_000, pixelsPerSecond: 170 });
    document.markers.push({ id: markerId, mediaId, timeUs: 800_000, note: '' });
    await writeFile(path.join(folder, 'project.json'), JSON.stringify(document));
    const saved = async (): Promise<ProjectDocument> => JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8'));
    const savedText = async (id: string) => {
      const object = (await saved()).objects.find(item => item.id === id);
      return object && 'text' in object ? object.text : '';
    };
    let app: ElectronApplication | undefined;
    try {
      const env: Record<string, string> = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
      // 打包程序与开发程序运行同一组真实操作，确保上传产物包含文字编辑修复。
      const packagedExecutable = process.env.WORKBENCH_TEST_EXECUTABLE;
      app = await _electron.launch({ executablePath: packagedExecutable ? path.resolve(packagedExecutable) : createRequire(import.meta.url)('electron'), args: [`--force-device-scale-factor=${scale}`, ...(packagedExecutable ? [] : ['.'])], env });
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.setSize(1440, 960);
        // 桌面验收即使窗口被遮挡也应继续绘制，避免截图和命中图被后台节流。
        window.webContents.setBackgroundThrottling(false);
      });
      await app.context().tracing.start({ screenshots: true, snapshots: true });
      const page = await app.firstWindow();
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      if (theme === 'dark') await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
      await page.getByRole('button', { name: document.name, exact: true }).click();
      await expect(page.locator('.canvas')).toBeVisible();
      await expect(page.locator('.task-list')).toHaveCount(0);
      const canvas = (await page.locator('.canvas').boundingBox())!;
      const input = page.getByLabel('编辑画布文字', { exact: true });
      const done = page.getByRole('button', { name: '完成文字编辑', exact: true });
      const doubleClick = async (object: CanvasObject) => {
        await expect(page.locator('.konvajs-content')).toBeVisible();
        // 重新打开项目后，等待 Konva 首帧及命中图绘制完成再发送坐标事件。
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        const camera = (await saved()).camera;
        await page.mouse.dblclick(canvas.x + camera.x + (object.x + object.width / 2) * camera.scale, canvas.y + camera.y + (object.y + object.height / 2) * camera.scale);
      };
      // 批注通过实际连接柄拖出，先完成首次输入，再复现第二次双击无法编辑的用户路径。
      await page.mouse.click(canvas.x + 120, canvas.y + 315);
      await page.mouse.click(canvas.x + 216, canvas.y + 294);
      await page.mouse.move(canvas.x + 216, canvas.y + 254); await page.mouse.down();
      await page.mouse.move(canvas.x + 480, canvas.y + 325, { steps: 10 }); await page.mouse.up();
      await expect(input).toBeFocused();
      await input.fill('音频批注'); await done.click();
      await expect.poll(async () => (await saved()).objects.length).toBe(4);
      const annotation = (await saved()).objects.find(item => item.kind === 'text' && item.id !== text.id)!;
      await expect.poll(() => savedText(annotation.id)).toBe('音频批注');
      // 等待主题切换与侧栏布局稳定，保证修复前后截图处于相同条件。
      await page.waitForTimeout(1800);
      await page.screenshot({ path: testInfo.outputPath('idle.png'), animations: 'disabled' });
      const expectedTexts = new Map<string, string>();
      for (const [index, object] of [text, shape, annotation].entries()) {
        const original = await savedText(object.id);
        await doubleClick(object);
        await expect(page.getByLabel('旋转（°）', { exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`double-click-${object.kind}-${index}.png`), animations: 'disabled' });
        // 软断言在修复前收集三类对象的独立失败证据，仍将本用例标为失败。
        await expect.soft(input).toBeFocused({ timeout: 1500 });
        if (!await input.isVisible()) continue;
        await expect(input).toHaveValue(original ?? '');
        const revision = (await saved()).revision;
        const content = `${['文字提纲', '形状说明', '声音批注'][index]}：收录现场声音\n保留第二行`;
        await input.fill(content);
        // 普通 Enter 保留换行；输入内容不触发画布删除、标记或平移快捷键。
        await input.press('End'); await input.press('Enter'); await page.keyboard.insertText('补充内容');
        const finalText = await input.inputValue();
        if (index === 0) await done.click();
        else if (index === 1) await input.press('Control+Enter');
        else await page.mouse.click(canvas.x + 740, canvas.y + 480);
        await expect(input).toHaveCount(0);
        await expect.poll(() => savedText(object.id)).toBe(finalText);
        expect((await saved()).revision).toBe(revision + 1);
        expectedTexts.set(object.id, finalText);
        await page.getByRole('button', { name: '撤销', exact: true }).click();
        await expect.poll(() => savedText(object.id)).toBe(original);
        await page.getByRole('button', { name: '重做', exact: true }).click();
        await expect.poll(() => savedText(object.id)).toBe(finalText);
        // Esc 放弃本次输入，随后再双击仍可获取焦点，且不会新增撤销记录。
        await doubleClick(object); await expect(input).toBeFocused();
        await expect(input).toHaveValue(finalText);
        const beforeCancel = (await saved()).revision;
        await input.fill('这段输入应被取消'); await input.press('Escape');
        await expect(input).toHaveCount(0);
        expect(await savedText(object.id)).toBe(finalText);
        expect((await saved()).revision).toBe(beforeCancel);
        await page.screenshot({ path: testInfo.outputPath(`saved-${object.kind}-${index}.png`), animations: 'disabled' });
      }
      const final = await saved();
      expect(final.markers).toHaveLength(1);
      expect(final.connections).toHaveLength(1);
      expect(final.connections[0]).toMatchObject({ from: { kind: 'time', markerId }, to: { kind: 'object', objectId: annotation.id } });
      await page.getByRole('button', { name: '‹ 项目', exact: true }).click();
      await page.getByRole('button', { name: document.name, exact: true }).click();
      for (const [id, content] of expectedTexts) {
        await doubleClick(final.objects.find(item => item.id === id)!);
        await expect(input).toBeFocused(); await expect(input).toHaveValue(content); await input.press('Escape');
      }
      expect(errors).toEqual([]);
    } finally {
      await app?.context().tracing.stop(testInfo.status !== testInfo.expectedStatus ? { path: testInfo.outputPath('desktop-trace.zip') } : undefined);
      await app?.close();
      // 保留本次独立临时项目和 runtime.log，便于失败诊断，不访问用户项目。
      console.log(`画布文字验收数据：${root}`);
    }
  });
}

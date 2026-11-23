// 使用范例：npm run build && node scripts/visual/preview-workspace.mjs；验证桌面笔记与画布，截图写入 test-results/workspace-ui/。
// WSL 无法启动 Windows Electron 时：先启动 Vite，再运行 node scripts/visual/preview-workspace.mjs --browser --url=http://127.0.0.1:5173。
// --baseline 只记录改版前画面。浏览器模式使用内存 IPC 夹具，仅验证渲染与界面交互，不替代桌面文件读写验收。
import { _electron, chromium, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const browserMode = process.argv.includes('--browser');
const baseline = process.argv.includes('--baseline');
const url = process.argv.find(arg => arg.startsWith('--url='))?.slice(6) ?? 'http://127.0.0.1:5173';
const scale = Number(process.env.WORKBENCH_DEVICE_SCALE_FACTOR || 1);
const output = path.resolve('test-results/workspace-ui', `${baseline ? 'before' : 'after'}${scale === 1 ? '' : `-${scale}`}`);
await mkdir(output, { recursive: true });
let application;
let browser;
let page;
let projectRoot;
// 静态验收等待自动保存并结束 CSS 过渡，固定保存状态与明暗颜色，避免截到过渡中间帧。
const capture = async name => {
  await expect(page.locator('.workspace-header-center>span')).toHaveText('已保存');
  return page.screenshot({ path: path.join(output, name), animations: 'disabled' });
};
try {
  if (browserMode) {
    const cache = path.join(os.homedir(), '.cache/ms-playwright');
    const installed = (await readdir(cache)).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? path.join(cache, installed[0], 'chrome-linux64/chrome');
    browser = await chromium.launch({ executablePath, headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: scale });
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
    // 使用仓库真实图片验证渲染；协议响应与导入元数据仍为夹具，桌面磁盘导入由 Electron 用例验收。
    await page.route('project-media://asset/assets/**', route => route.fulfill({ path: 'tests/fixtures/sample.png', contentType: 'image/png' }));
    await page.addInitScript(() => {
      let saved;
      window.workbench = {
        getSettings: async () => ({ projectsRoot: '/preview/projects', documentSchemaVersion: 4 }),
        listProjects: async () => [],
        createProject: async () => '/preview/projects/workspace',
        saveProject: async document => { saved = structuredClone(document); window.__previewSnapshot = saved; return { revision: document.revision }; },
        openProject: async () => saved,
        leaveProject: async () => {},
        exportNote: async ({ markdown }) => { window.__exportedMarkdown = markdown; return true; },
        onTaskProgress: () => () => {}, onBackendRestart: () => () => {}, onFlushRequest: () => () => {},
        importAssets: async () => ({ assets: [], errors: [] }),
        importDroppedFiles: async files => ({ assets: files.map(file => ({ id: crypto.randomUUID(), name: file.name, path: `assets/${file.name}`, kind: 'image', status: 'ready' })), errors: [] }),
        cancelTask: async () => ({ cancelled: true })
      };
    });
    await page.goto(url);
  } else {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), 'workbench-workspace-ui-'));
    const env = { ...process.env, WORKBENCH_E2E_ROOT: projectRoot };
    delete env.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [`--force-device-scale-factor=${scale}`, '.'], env });
    page = await application.firstWindow();
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
  }
  const errors = [];
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack ?? error.message); });
  page.on('console', message => { if (message.type() === 'error') console.error(message.text().slice(0,1200)); });
  await page.locator('.plus').click();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByLabel('项目名称').fill('城市声音 · 影像策划');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page.locator('.canvas')).toBeVisible();
  await page.getByRole('button', { name: '矩形', exact: true }).dblclick();
  await capture('canvas-light.png');
  if (!baseline) {
    console.log('验证侧栏拖动、取消和面板展开');
    const resizer = page.getByRole('separator', { name: '调整侧栏宽度' });
    const originalWidth = Number(await resizer.getAttribute('aria-valuenow'));
    await resizer.focus(); await page.keyboard.press('ArrowLeft');
    await expect(resizer).toHaveAttribute('aria-valuenow', String(originalWidth + 16));
    const edge = await resizer.boundingBox();
    await page.mouse.move(edge.x + 2, edge.y + 100); await page.mouse.down(); await page.mouse.move(edge.x - 70, edge.y + 100, { steps: 5 });
    await page.keyboard.press('Escape'); await page.mouse.up();
    await expect(resizer).toHaveAttribute('aria-valuenow', String(originalWidth + 16));
    await resizer.dblclick();
    await expect(resizer).toHaveAttribute('aria-valuenow', '360');
    const separator = page.locator('.dock-divider').first();
    const before = Number(await separator.getAttribute('aria-valuenow'));
    await separator.focus(); await page.keyboard.press('ArrowDown');
    await expect.poll(async () => Number(await separator.getAttribute('aria-valuenow'))).toBe(before + 16);
    await page.getByRole('button', { name: '展开工具面板', exact: true }).click();
    await expect(page.locator('.dock-section')).toHaveCount(1);
    await page.getByRole('button', { name: '还原工具面板', exact: true }).click();
    await expect(page.locator('.dock-section')).toHaveCount(2);
    await page.getByRole('button', { name: '编辑视图', exact: true }).click();
    await page.getByRole('button', { name: '展开编辑面板', exact: true }).click();
    await page.getByLabel('线条颜色', { exact: true }).click();
    const color = page.getByRole('dialog', { name: '选择颜色' });
    await expect(color).toBeVisible();
    const colorBounds = await color.boundingBox();
    expect(colorBounds.x).toBeGreaterThanOrEqual(0);
    expect(colorBounds.x + colorBounds.width).toBeLessThanOrEqual(1440);
    await capture('canvas-inspector.png');
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: '排列', exact: true }).click();
    const rotation = page.getByLabel('旋转（°）', { exact: true });
    await rotation.fill('30'); await rotation.blur();
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await expect(rotation).toHaveValue('0');
  }
  await page.locator('.mode-switch-btn').filter({ hasText: '笔记' }).click();
  await page.getByLabel('笔记名称', { exact: true }).fill('城市声音拍摄提纲');
  const body = page.locator('.note-tiptap .ProseMirror');
  await body.fill('拍摄目标\n以清晨的街道、车站和沿江步道为线索，记录城市从安静到繁忙的声音变化。\n\n镜头安排\n开场保留十五秒环境声，随后进入人物与空间的关系。\n记录行人的脚步、早餐店的对话与列车进站声。\n\n声音设计\n现场录制单独保留，后期根据镜头节奏调整层次。\n旁白保持简洁，让环境声成为叙事的一部分。');
  await capture('notes-light.png');
  if (!baseline) {
    await expect(page.locator('.note-sidebar')).toBeVisible();
    await page.getByLabel('查找正文', { exact: true }).click();
    await page.getByPlaceholder('查找内容').fill('环境声');
    await expect(page.locator('.note-find-count')).toHaveText('1 / 2');
    await page.getByLabel('替换为', { exact: true }).fill('现场声音');
    await page.getByRole('button', { name: '全部替换', exact: true }).click();
    await expect(page.locator('.note-find-count')).toHaveText('0 / 0');
    await page.getByLabel('撤销正文', { exact: true }).click();
    await expect(page.locator('.note-find-count')).toHaveText('1 / 2');
    await page.getByLabel('关闭查找').click();
    console.log('验证标题、大纲、待办清单、表格、批注和导出');
    // 点击正文后再使用导航键，避免原生 focus 被 ProseMirror 的焦点恢复逻辑判为浏览器选区重置。
    await body.click();
    await body.press('Control+Home');
    // 原生 selectionchange 异步进入 ProseMirror，确认快捷键选区后再操作原生 select。
    await expect.poll(() => body.evaluate(element => element.editor.state.selection.from)).toBe(1);
    await page.getByLabel('段落样式', { exact: true }).selectOption('2');
    await expect(body.locator('h2')).toHaveText('拍摄目标');
    await expect(page.locator('.note-outline')).toContainText('拍摄目标');
    await body.click();
    await body.press('Control+End');
    await expect.poll(() => body.evaluate(element => element.editor.state.selection.from === element.editor.state.doc.content.size - 1)).toBe(true);
    await page.keyboard.press('Enter');
    await page.getByLabel('待办清单', { exact: true }).click();
    await expect(body).toBeFocused();
    await page.keyboard.insertText('检查录音设备');
    await expect(body.locator('li[data-type=taskItem]>div')).toHaveText('检查录音设备');
    await body.locator('li[data-type=taskItem] input').check();
    await expect(body.locator('li[data-type=taskItem]')).toHaveAttribute('data-checked', 'true');
    await body.press('Control+End'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    await page.getByLabel('插入表格', { exact: true }).click();
    await expect(body.locator('table')).toBeVisible();
    await page.keyboard.insertText('场景');
    await page.getByRole('button', { name: '添加行', exact: true }).click();
    await expect(body.locator('tr')).toHaveCount(4);
    await page.getByRole('button', { name: '添加列', exact: true }).click();
    await expect(body.locator('tr').first().locator('th,td')).toHaveCount(4);
    await body.locator('h2').click();
    await body.press('Control+Home');
    await expect.poll(() => body.evaluate(element => element.editor.state.selection.from)).toBe(1);
    await body.press('Control+Shift+ArrowRight');
    await page.getByLabel('排版', { exact: true }).click();
    await page.getByLabel('字体', { exact: true }).selectOption('Arial');
    await page.getByLabel('字号', { exact: true }).fill('20');
    await expect(body.locator('h2 span[style*="font-size: 20px"]')).toBeVisible();
    await page.getByLabel('关闭排版', { exact: true }).click();
    await page.getByLabel('插入链接', { exact: true }).click();
    await page.getByLabel('链接地址', { exact: true }).fill('https://example.com/recording');
    await page.getByRole('button', { name: '应用', exact: true }).click();
    await expect(body.locator('a')).toHaveAttribute('href', 'https://example.com/recording');
    await page.locator('.note-bubble-menu').getByRole('button', { name: '批注', exact: true }).click();
    await page.getByPlaceholder('批注内容…').fill('开场镜头先录制环境声。');
    await expect(page.locator('.note-bubble-menu')).not.toBeVisible();
    await page.getByPlaceholder('批注内容…').blur();
    await expect(page.locator('.note-annotation')).toContainText('开场镜头');
    await capture('notes-comments.png');
    console.log('验证图片插入、尺寸、对齐和预览');
    await body.locator('p').last().click();
    await body.press('Control+End');
    await page.locator('.note-toolbar input[type=file]').setInputFiles(path.resolve('tests/fixtures/sample.png'));
    const insertedImage = body.locator('.note-project-image');
    await expect(insertedImage).toBeVisible();
    await expect.poll(() => insertedImage.evaluate(image => image.naturalWidth)).toBe(160);
    await insertedImage.click();
    await page.getByLabel('图片宽度', { exact: true }).fill('280');
    await page.locator('.note-image-tools').getByRole('button', { name: '右', exact: true }).click();
    await expect(insertedImage).toHaveAttribute('width', '280');
    await expect(insertedImage).toHaveAttribute('data-align', 'right');
    await expect.poll(async () => {
      const image = await insertedImage.boundingBox();
      const toolbar = await page.locator('.note-image-tools').boundingBox();
      return Math.abs(image.y - toolbar.y - toolbar.height - 8);
    }).toBeLessThanOrEqual(2);
    await capture('notes-image.png');
    await body.press('ArrowRight');
    await expect(page.locator('.note-image-tools')).not.toBeVisible();
    const exportPath = path.join(output, '城市声音拍摄提纲.md');
    if (!browserMode) await application.evaluate(({ dialog }, filePath) => { Object.defineProperty(dialog, 'showSaveDialog', { value: async () => ({ canceled: false, filePath }) }); }, exportPath);
    await page.getByLabel('导出 Markdown', { exact: true }).click();
    await expect.poll(() => browserMode ? page.evaluate(() => window.__exportedMarkdown ?? '') : readFile(exportPath, 'utf8').catch(() => '')).toContain('拍摄');
    const markdown = browserMode ? await page.evaluate(() => window.__exportedMarkdown) : await readFile(exportPath, 'utf8');
    expect(markdown).toMatch(/## .*拍摄/);
    expect(markdown).toContain('https://example.com/recording');
    expect(markdown).toContain('- [x] 检查录音设备');
    expect(markdown).toMatch(/\| 场景\s+\|/);
    expect(markdown).toMatch(/!\[图片\]\(assets\/.+\.png\)/);
    await page.getByLabel('渲染模式', { exact: true }).click();
    await expect(page.locator('.note-markdown-preview table')).toBeVisible();
    await expect(page.locator('.note-markdown-preview h2')).toHaveText('拍摄目标');
    await expect(page.locator('.note-preview-image')).toHaveAttribute('data-align', 'right');
    await capture('notes-reading.png');
    await page.getByLabel('编辑模式', { exact: true }).click();
    await page.getByRole('tab', { name: '目录', exact: true }).click();
    await page.getByLabel('专注模式', { exact: true }).click();
    await expect(page.locator('.note-sidebar')).not.toBeVisible();
    await capture('notes-focus.png');
    await page.getByLabel('退出专注模式').click();
    await page.getByLabel('搜索笔记', { exact: true }).fill('不存在的标题');
    await expect(page.locator('.note-navigation-item')).toHaveCount(0);
    await page.getByLabel('清空搜索', { exact: true }).click();
    await page.getByLabel('收藏笔记', { exact: true }).click();
    await expect(page.locator('.note-navigation-list h3').first()).toHaveText('收藏');
    await capture('notes-content.png');
  }
  const toggle = page.getByRole('button', { name: /切换到深色|深色模式|Switch to dark/ }).first();
  if (await toggle.count()) await toggle.click();
  await capture('notes-dark.png');
  if (browserMode) await page.setViewportSize({ width: 1024, height: 768 });
  else await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 768));
  await capture('notes-compact.png');
  if (!baseline) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByLabel('分屏预览', { exact: true }).click();
    await expect(page.locator('.note-markdown-preview')).toBeVisible();
    await capture('notes-split-compact.png');
    // 窄窗口分屏仍须留出正文宽度，并让批注栏固定在可见的窗口右侧。
    const textWidth = (await body.boundingBox()).width;
    // clientWidth 为整数，150% 缩放下允许一枚物理像素的取整误差。
    const physicalPixel = await page.evaluate(() => 1 / devicePixelRatio);
    expect(textWidth + physicalPixel).toBeGreaterThanOrEqual(208);
    await page.getByRole('tab', { name: /^批注/ }).click();
    const assistBounds = await page.locator('.note-assist').boundingBox();
    expect(assistBounds.x + assistBounds.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
    await capture('notes-split-comments-dark.png');
    await page.getByRole('button', { name: '切换到浅色模式', exact: true }).click();
    await capture('notes-split-comments-light.png');
    await page.getByLabel('关闭预览', { exact: true }).click();
    await capture('notes-compact-light.png');
    if (browserMode) {
      await page.setViewportSize({ width: 760, height: 700 });
      await capture('notes-small.png');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const navigation = page.getByRole('separator', { name: '调整笔记导航宽度' });
      const displayedWidth = (await page.locator('.note-sidebar').boundingBox()).width;
      expect(Number(await navigation.getAttribute('aria-valuenow'))).toBe(displayedWidth);
    }
    await page.getByLabel('删除批注', { exact: true }).click();
    await expect(page.locator('.note-annotation')).toHaveCount(0);
    await expect(body.locator('[data-note-annotation]')).toHaveCount(0);
    if (browserMode) await page.setViewportSize({ width: 1024, height: 768 });
    await page.locator('.mode-switch-btn').filter({ hasText: '画布' }).click();
    // 切回画布后继续跟踪尺寸，防止 ResizeObserver 仍订阅已卸载的旧节点。
    await expect.poll(async () => {
      const canvas = await page.locator('.canvas').boundingBox();
      const stage = await page.locator('.konvajs-content').boundingBox();
      return Math.abs(canvas.width - stage.width);
    }).toBeLessThanOrEqual(1);
    await capture('canvas-compact-light.png');
    await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
    await capture('canvas-compact-dark.png');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
  console.log(`${browserMode ? '浏览器界面' : 'Electron 桌面'}验证通过，截图目录 ${output}`);
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await application?.close();
  await browser?.close();
  // 验收项目仅由本脚本创建，窗口退出后释放，避免系统临时目录持续堆积。
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
}

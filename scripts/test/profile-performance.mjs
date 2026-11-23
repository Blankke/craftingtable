// 用法：npm run build 后执行 node scripts/test/profile-performance.mjs baseline（或 after）。
// 使用独立 Electron 项目测量编辑耗时、JS 堆与进程内存；结果写入 test-results/performance，不接触用户项目。
import { build } from 'esbuild';
import { _electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const label = process.argv[2] ?? 'sample';
if (!/^[\w-]+$/.test(label)) throw Error('结果名称仅支持字母、数字、横线和下划线');
const output = path.resolve('test-results/performance');
await mkdir(output, { recursive: true });
const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-performance-'));
const bundled = await build({ stdin: { contents: `
import { Editor } from './src/core/editor';
import { newDocument } from './src/core/document';
import { canvasTextFromPlainText } from './src/core/canvasText';
import { canvasTextLayout } from './src/ui/canvas/canvasTextLayout';
import { canvasDisplayObject } from './src/core/canvasColors';
import { themes } from './src/core/theme';
globalThis.profileModules = { Editor, newDocument, canvasTextFromPlainText, canvasTextLayout, canvasDisplayObject, themes };`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser', loader: { '.css': 'text' } });
const env = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: ['--force-device-scale-factor=1.5', '.'], env });
try {
  const page = await app.firstWindow();
  await page.locator('.home').waitFor();
  await page.evaluate(code => (0, eval)(code), bundled.outputFiles[0].text);
  const cdp = await app.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Performance.getMetrics')).metrics.find(x => x.name === 'JSHeapUsedSize').value; };
  const before = await heap();
  console.log('[1/5] 测量 300 个富文本对象、60 次单对象编辑');
  const editing = await page.evaluate(() => {
    const { Editor, newDocument, canvasTextFromPlainText } = globalThis.profileModules;
    const doc = newDocument('性能测量');
    for (let i = 0; i < 300; i++) doc.objects.push({ id: crypto.randomUUID(), kind: 'text', x: i % 10 * 340, y: Math.floor(i / 10) * 160, width: 320, height: 120, groupId: null, text: canvasTextFromPlainText(('拍摄说明与素材备注 ' + i + '。').repeat(60)), fontSize: 18, color: '#172033', align: 'left' });
    const editor = new Editor(doc), times = [];
    globalThis.profileEditor = editor;
    for (let i = 0; i < 60; i++) { const start = performance.now(); editor.execute(draft => { draft.objects[i % 300].x += 1; }); times.push(performance.now() - start); }
    const objects = new Set(), texts = new Set();
    for (let i = 0; i < 61; i++) { for (const object of editor.document.objects) { objects.add(object); texts.add(object.text); } if (i < 60) editor.undo(); }
    for (let i = 0; i < 60; i++) editor.redo();
    times.sort((a,b) => a-b);
    return { medianMs: times[30], p95Ms: times[57], uniqueObjects: objects.size, uniqueTexts: texts.size, revision: editor.document.revision };
  });
  const retained = await heap();
  console.log('[2/5] 测量文字排版热缓存');
  const layout = await page.evaluate(() => {
    const { canvasTextLayout } = globalThis.profileModules, objects = globalThis.profileEditor.document.objects;
    objects.forEach(canvasTextLayout);
    const start = performance.now();
    for (let i=0;i<10;i++) objects.forEach(canvasTextLayout);
    return { calls: 3000, elapsedMs: performance.now()-start };
  });
  const colors = await page.evaluate(() => {
    const { canvasDisplayObject, themes } = globalThis.profileModules;
    const start = performance.now();
    for (let i=0;i<10;i++) for (const object of globalThis.profileEditor.document.objects) canvasDisplayObject(object, themes[0].dark.tokens);
    return { calls: 3000, elapsedMs: performance.now()-start };
  });
  console.log('[3/5] 记录 Electron 各进程内存');
  const processes = await app.evaluate(({ app }) => app.getAppMetrics().map(({ type, memory }) => ({ type, workingSetKiB: memory.workingSetSize, privateKiB: memory.privateBytes })));
  console.log('[4/5] 打开真实项目并测量 90 帧滚轮交互');
  const project = await page.evaluate(() => globalThis.profileEditor.document);
  const folder = path.join(root, 'projects', '性能样本');
  await mkdir(path.join(folder, 'assets'), { recursive: true });
  await writeFile(path.join(folder, 'project.json'), JSON.stringify(project));
  await page.reload();
  const opening = performance.now();
  await page.getByRole('button', { name: '性能测量', exact: true }).click();
  await page.locator('.canvas').waitFor();
  const openMs = performance.now() - opening;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  const uiHeapBefore = await heap();
  const interaction = await page.evaluate(async () => {
    const canvas = document.querySelector('.konvajs-content');
    const rect = canvas.getBoundingClientRect(), frames = [];
    let last = performance.now();
    for (let i=0;i<90;i++) {
      await new Promise(requestAnimationFrame);
      const now=performance.now(); frames.push(now-last); last=now;
      canvas.dispatchEvent(new WheelEvent('wheel', { bubbles:true, cancelable:true, clientX:rect.x+20, clientY:rect.y+20, deltaY:i<45?2:-2 }));
    }
    frames.sort((a,b)=>a-b);
    return { medianFrameMs:frames[45], p95FrameMs:frames[85], over50ms:frames.filter(x=>x>50).length };
  });
  await page.waitForTimeout(700);
  const uiHeapAfter = await heap();
  console.log('[5/5] 记录真实画布内存与截图');
  const uiProcesses = await app.evaluate(({ app }) => app.getAppMetrics().map(({ type, memory }) => ({ type, workingSetKiB: memory.workingSetSize, privateKiB: memory.privateBytes })));
  await page.screenshot({ path:path.join(output, label+'-canvas.png') });
  const result = { label, environment: { scale: 1.5, rendering: 'software', objects: 300, core: 'source bundle', ui: 'current dist build' }, ui: { openMs, interaction, uiHeapBefore, uiHeapAfter, processes:uiProcesses }, editing, layout, colors, heap: { baselineBytes: before, retainedBytes: retained, historyDeltaBytes: retained-before }, processes };
  await writeFile(path.join(output, `${label}.json`), JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally { await app.close(); }

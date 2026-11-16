// 使用示例：npx.cmd playwright test tests/e2e/migration.spec.ts。验证历史项目打开后的安全迁移与备份。
import { _electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { newDocument } from '../../src/core/document';

const electronExecutable = createRequire(import.meta.url)('electron') as string;

test('历史项目打开后备份原件并升级为当前格式', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-migration-'));
  const folder = path.join(root, 'projects', '历史项目');
  let application: ElectronApplication | undefined;
  try {
    const source = newDocument('历史项目');
    source.objects.push({ id: crypto.randomUUID(), kind: 'rectangle', x: 24, y: 36, width: 180, height: 90, groupId: null, fill: '#ffffff', stroke: '#000000' });
    await mkdir(path.join(folder, 'assets'), { recursive: true });
    await mkdir(path.join(folder, 'recovery'), { recursive: true });
    await writeFile(path.join(folder, 'project.json'), JSON.stringify({ ...source, schemaVersion: 2, notes: [] }));
    const environment = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete environment.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({ executablePath: electronExecutable, args: ['.'], env: environment });
    const page = await application.firstWindow();
    await expect(page.getByRole('button', { name: '历史项目' })).toBeVisible();
    await page.getByRole('button', { name: '历史项目' }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    await expect.poll(async () => JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8')) as { schemaVersion: number }).toMatchObject({ schemaVersion: 3 });
    const upgraded = JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8')) as { objects: { id: string }[] };
    expect(upgraded.objects).toEqual([{ id: source.objects[0].id, kind: 'rectangle', x: 24, y: 36, width: 180, height: 90, groupId: null, fill: '#ffffff', stroke: '#000000' }]);
    expect((await readdir(path.join(folder, 'recovery'))).some(name => name.startsWith('pre-migration-'))).toBe(true);
  } finally {
    await application?.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('无笔记项目与恢复快照均可安全升级', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-recovery-migration-'));
  const firstFolder = path.join(root, 'projects', '无笔记项目');
  const recoveryFolder = path.join(root, 'projects', '恢复快照项目');
  let application: ElectronApplication | undefined;
  try {
    const first = newDocument('无笔记项目');
    const recovered = newDocument('恢复快照项目');
    recovered.objects.push({ id: crypto.randomUUID(), kind: 'ellipse', x: 12, y: 18, width: 80, height: 50, groupId: null, fill: '#eeeeee', stroke: '#111111' });
    await mkdir(path.join(firstFolder, 'assets'), { recursive: true });
    await mkdir(path.join(recoveryFolder, 'assets'), { recursive: true });
    await mkdir(path.join(recoveryFolder, 'recovery'), { recursive: true });
    const { notes: _notes, ...early } = { ...first, schemaVersion: 1 as const };
    await writeFile(path.join(firstFolder, 'project.json'), JSON.stringify(early));
    await writeFile(path.join(recoveryFolder, 'project.json'), '{broken');
    await writeFile(path.join(recoveryFolder, 'recovery', 'latest.json'), JSON.stringify({ ...recovered, schemaVersion: 2, notes: [] }));
    const environment = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete environment.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({ executablePath: electronExecutable, args: ['.'], env: environment });
    const page = await application.firstWindow();
    await page.getByRole('button', { name: '无笔记项目' }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    await expect.poll(async () => JSON.parse(await readFile(path.join(firstFolder, 'project.json'), 'utf8')) as { schemaVersion: number }).toMatchObject({ schemaVersion: 3 });
    await page.locator('header button').first().click();
    await page.getByRole('button', { name: '恢复快照项目' }).click();
    await expect(page.locator('.canvas')).toBeVisible();
    await expect.poll(async () => JSON.parse(await readFile(path.join(recoveryFolder, 'project.json'), 'utf8')) as { schemaVersion: number; objects: unknown[] }).toMatchObject({ schemaVersion: 3, objects: [expect.anything()] });
    expect((await readdir(path.join(recoveryFolder, 'recovery'))).some(name => name.startsWith('pre-migration-'))).toBe(true);
  } finally {
    await application?.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('迁移校验失败时保留原始文件并提供重试', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-invalid-migration-'));
  const folder = path.join(root, 'projects', '损坏项目');
  let application: ElectronApplication | undefined;
  try {
    const source = newDocument('损坏项目');
    source.objects.push({ id: crypto.randomUUID(), kind: 'image', assetId: crypto.randomUUID(), x: 0, y: 0, width: 100, height: 80, groupId: null });
    const original = JSON.stringify({ ...source, schemaVersion: 2, notes: [] });
    await mkdir(folder, { recursive: true }); await writeFile(path.join(folder, 'project.json'), original);
    const environment = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete environment.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({ executablePath: electronExecutable, args: ['.'], env: environment });
    const page = await application.firstWindow();
    await page.getByRole('button', { name: '损坏项目' }).click();
    await expect(page.getByRole('button', { name: '重试打开' })).toBeVisible();
    expect(await readFile(path.join(folder, 'project.json'), 'utf8')).toBe(original);
    expect((await readdir(folder)).includes('recovery')).toBe(false);
  } finally {
    await application?.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
});

// 使用示例：npx vitest run electron/projectSettings.test.ts。验证默认目录、持久化与损坏设置回退。
import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSettings, saveSettings } from './projectSettings';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test('用户项目目录持久化，损坏设置回退默认目录', () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'workbench-settings-'));
  roots.push(folder);
  const file = path.join(folder, 'settings.json');
  const fallback = path.join(folder, 'default');
  const chosen = path.join(folder, 'chosen');
  expect(readSettings(file, fallback)).toEqual({ projectsRoot: fallback, imageCompression: 'lossy' });
  saveSettings(file, { projectsRoot: chosen, imageCompression: 'lossless' });
  expect(readSettings(file, fallback)).toEqual({ projectsRoot: chosen, imageCompression: 'lossless' });
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ projectsRoot: chosen, imageCompression: 'lossless' });
  const changed = path.join(folder, 'changed');
  saveSettings(file, { ...readSettings(file, fallback), projectsRoot: changed });
  expect(readSettings(file, fallback)).toEqual({ projectsRoot: changed, imageCompression: 'lossless' });
  writeFileSync(file, JSON.stringify({ projectsRoot: chosen }), 'utf8');
  expect(readSettings(file, fallback)).toEqual({ projectsRoot: chosen, imageCompression: 'lossy' });
  writeFileSync(file, '{bad json', 'utf8');
  expect(readSettings(file, fallback)).toEqual({ projectsRoot: fallback, imageCompression: 'lossy' });
});

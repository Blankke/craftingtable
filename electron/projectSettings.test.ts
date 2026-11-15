// 使用示例：npx vitest run electron/projectSettings.test.ts。验证默认目录、持久化与损坏设置回退。
import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readProjectsRoot, saveProjectsRoot } from './projectSettings';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test('用户项目目录持久化，损坏设置回退默认目录', () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'workbench-settings-'));
  roots.push(folder);
  const file = path.join(folder, 'settings.json');
  const fallback = path.join(folder, 'default');
  const chosen = path.join(folder, 'chosen');
  expect(readProjectsRoot(file, fallback)).toBe(fallback);
  saveProjectsRoot(file, chosen);
  expect(readProjectsRoot(file, fallback)).toBe(chosen);
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ projectsRoot: chosen });
  const changed = path.join(folder, 'changed');
  saveProjectsRoot(file, changed);
  expect(readProjectsRoot(file, fallback)).toBe(changed);
  writeFileSync(file, '{bad json', 'utf8');
  expect(readProjectsRoot(file, fallback)).toBe(fallback);
});

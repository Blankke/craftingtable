// 使用示例：npx vitest run electron/devDirectories.test.ts。确保开发缓存不落在项目工作区。
import { expect, test } from 'vitest';
import path from 'node:path';
import { developmentDirectories } from './devDirectories';

test('开发缓存使用 Windows 用户目录，项目仍使用独立开发目录', () => {
  const appData = path.resolve('C:/Users/example/AppData/Roaming');
  const workspace = path.resolve('D:/WSL/proj/.runtime');
  const directories = developmentDirectories(appData, workspace);
  expect(directories.userData).toBe(path.join(appData, 'media-planning-workbench-dev'));
  expect(directories.projects).toBe(path.join(workspace, 'projects'));
  expect(directories.userData.startsWith(workspace + path.sep)).toBe(false);
});

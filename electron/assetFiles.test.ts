// 使用范例：npm.cmd exec -- vitest run electron/assetFiles.test.ts；验证并发导入不覆盖及重开后编号继续。
import { it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createNumberedImage } from './assetFiles';
it('并发同名图片使用不同编号，已有文件内容不受影响', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workbench-asset-names-'));
  try {
    const names = await Promise.all(Array.from({ length: 6 }, (_, index) => createNumberedImage(directory, 'image.png', '.png', file => writeFile(file, String(index), { flag: 'wx' }))));
    expect(new Set(names).size).toBe(6);
    expect([...names].sort()).toEqual(Array.from({ length: 6 }, (_, i) => `图片-00${i + 1}.png`));
    for (const [index, name] of names.entries()) expect(await readFile(path.join(directory, name), 'utf8')).toBe(String(index));
    expect(await createNumberedImage(directory, 'image.png', '.png', file => writeFile(file, 'new', { flag: 'wx' }))).toBe('图片-007.png');
    expect(await createNumberedImage(directory, '../会议照片.jpg', '.jpg', file => writeFile(file, 'photo', { flag: 'wx' }))).toBe('会议照片-001.jpg');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

// 用法：npm.cmd run test:tooling；在独立临时目录验证清理范围、预览模式和目录联接保护。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanArtifacts } from '../../scripts/maintenance/clean.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-clean-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async file => {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, '保留内容');
  };
  return { root, put, log: () => {} };
}

test('完整清理删除生成物，保留项目、设置、样本、依赖和媒体工具', async t => {
  const options = await fixture(t);
  const removed = ['test-results/view.png', 'dist/index.html', 'node_modules/.cache/media-tools/extracted/ffmpeg.exe', '.runtime/userdata/Cache/data'];
  const preserved = ['.runtime/projects/demo/project.json', '.runtime/userdata/Preferences', 'tests/fixtures/sample.png', 'node_modules/electron/package.json', 'vendor/ffmpeg.exe', 'node_modules/.cache/media-tools/ffmpeg.7z', '.env'];
  for (const file of [...removed, ...preserved]) await options.put(file);
  await cleanArtifacts(options);
  for (const file of removed) await assert.rejects(access(path.join(options.root, file)), { code: 'ENOENT' });
  for (const file of preserved) assert.equal(await readFile(path.join(options.root, file), 'utf8'), '保留内容');
});

test('预览不删除文件，仅测试模式不删除构建产物', async t => {
  const options = await fixture(t);
  await options.put('test-results/view.png');
  await options.put('dist/index.html');
  const preview = await cleanArtifacts({ ...options, dryRun: true });
  assert.deepEqual(preview, ['test-results', 'dist']);
  await access(path.join(options.root, 'test-results/view.png'));
  await access(path.join(options.root, 'dist/index.html'));
  await cleanArtifacts({ ...options, testsOnly: true });
  await assert.rejects(access(path.join(options.root, 'test-results/view.png')), { code: 'ENOENT' });
  await access(path.join(options.root, 'dist/index.html'));
});

test('父目录联接被整体拒绝，目标内的联接不跟随删除', async t => {
  const options = await fixture(t);
  const outside = await fixture(t);
  await outside.put('Cache/important.txt');
  await options.put('test-results/view.png');
  await mkdir(path.join(options.root, '.runtime'));
  await symlink(outside.root, path.join(options.root, '.runtime/userdata'), 'junction');
  await assert.rejects(cleanArtifacts(options), /拒绝清理/);
  await access(path.join(options.root, 'test-results/view.png'));
  await access(path.join(outside.root, 'Cache/important.txt'));
  // 产物目录内的链接仅移除链接本身，外部内容保持完整。
  await symlink(outside.root, path.join(options.root, 'test-results/external'), 'junction');
  await cleanArtifacts({ ...options, testsOnly: true });
  await access(path.join(outside.root, 'Cache/important.txt'));
});

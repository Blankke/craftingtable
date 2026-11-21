// 用法：npm.cmd run clean -- --dry-run 预览；npm.cmd run clean 清理；npm.cmd run clean:test 仅清理验收产物。
// 关闭开发窗口后执行。固定白名单不包含项目、设置、依赖包、媒体可执行文件和下载归档。
import { lstat, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const testArtifacts = ['test-results', 'playwright-report'];
const buildArtifacts = [
  'dist', 'dist-electron',
  'node_modules/.vite', 'node_modules/.vite-temp',
  'node_modules/.cache/media-tools/extracted',
  'release/installed-smoke', 'release/builder-debug.yml', 'release/builder-effective-config.yaml',
  ...['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Shared Dictionary/cache']
    .map(name => `.runtime/userdata/${name}`)
];

async function inspect(file) {
  try { return await lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function cleanArtifacts({ root = projectRoot, testsOnly = false, dryRun = false, log = console.log } = {}) {
  const workspace = await realpath(root);
  const targets = testsOnly ? testArtifacts : [...testArtifacts, ...buildArtifacts];
  const pending = [];
  // 先检查全部目标及其父目录；符号链接或 Windows 目录联接不能把清理引向仓库之外。
  for (const relative of targets) {
    let current = workspace;
    let exists = true;
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      const info = await inspect(current);
      if (!info) { exists = false; break; }
      if (info.isSymbolicLink()) throw Error(`拒绝清理符号链接或目录联接：${relative}`);
    }
    if (exists) pending.push({ relative, absolute: current });
  }
  for (const [index, target] of pending.entries()) {
    if (!dryRun) await rm(target.absolute, { recursive: true, force: true, maxRetries: 3 });
    log(`[${index + 1}/${pending.length}] ${dryRun ? '将清理' : '已清理'}：${target.relative}`);
  }
  if (!pending.length) log('没有需要清理的产物。');
  return pending.map(target => target.relative);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const unknown = args.filter(arg => !['--tests', '--dry-run'].includes(arg));
  if (unknown.length) throw Error(`未知参数：${unknown.join(' ')}`);
  await cleanArtifacts({ testsOnly: args.includes('--tests'), dryRun: args.includes('--dry-run') });
}

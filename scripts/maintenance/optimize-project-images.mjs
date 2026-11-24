// 用法：node scripts/maintenance/optimize-project-images.mjs ".runtime/projects/项目目录" [--apply] [--mode=lossy|lossless]。
// 默认只查看；关闭应用后加 --apply，默认有损 AVIF，--mode=lossless 使用无损 WebP，显示逐图进度。
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const argument = process.argv.slice(2).find(value => !value.startsWith('--'));
const mode = process.argv.find(value => value.startsWith('--mode='))?.slice(7) ?? 'lossy';
if (!argument || !['lossy', 'lossless'].includes(mode) || process.argv.slice(2).some(value => value.startsWith('--') && value !== '--apply' && !value.startsWith('--mode='))) throw Error('用法：node scripts/maintenance/optimize-project-images.mjs "项目目录" [--apply] [--mode=lossy|lossless]');
const folder = await realpath(argument), apply = process.argv.includes('--apply');
// 离线整理不能与自动保存并行；检测当前工作区启动的桌面实例，保留用户的其他应用。
if (apply && process.platform === 'win32') {
  const workspace = process.cwd().replaceAll("'", "''");
  const script = `$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'electron.exe' -and $_.CommandLine -like '*${workspace}*' }; if ($p) { exit 2 }`;
  try { execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { stdio: 'pipe' }); }
  catch { throw Error('请先关闭本工作区的应用和开发服务，再整理项目'); }
} else if (apply && process.platform === 'linux') {
  for (const pid of (await readdir('/proc')).filter(name => /^\d+$/.test(name))) {
    const command = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '');
    const cwd = await realpath(`/proc/${pid}/cwd`).catch(() => '');
    if (/(^|\/)electron\x00/.test(command) && cwd === process.cwd()) throw Error('请先关闭本工作区的应用和开发服务，再整理项目');
  }
}
if (!apply) {
  const doc = JSON.parse(await readFile(path.join(folder, 'project.json'), 'utf8'));
  const images = doc.assets.filter(asset => asset.kind === 'image');
  let bytes = 0;
  for (const asset of images) {
    const file = path.resolve(folder, asset.path);
    if (!file.startsWith(path.join(folder, 'assets') + path.sep)) throw Error('素材路径无效');
    bytes += (await stat(file)).size;
  }
  console.log(`图片 ${images.length} 张，合计 ${(bytes / 1024 / 1024).toFixed(2)} MiB。模式：${mode === 'lossy' ? '有损' : '无损'}；关闭应用后添加 --apply 执行。`);
} else {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'workbench-image-maintenance-'));
  try {
    const output = path.join(temporary, 'imageStorage.cjs');
    await build({ entryPoints: ['electron/imageStorage.ts'], outfile: output, platform: 'node', format: 'cjs', bundle: true, target: 'node22', define: { __dirname: JSON.stringify(path.resolve('dist-electron')) } });
    const { optimizeProjectImages } = createRequire(import.meta.url)(output);
    const result = await optimizeProjectImages(folder, (done, total) => console.log(`[${done}/${total}] 图片整理 ${Math.round(done / total * 100)}%`), mode);
    console.log(`已替换 ${result.count} 张图片：${(result.before / 1024 / 1024).toFixed(2)} → ${(result.after / 1024 / 1024).toFixed(2)} MiB，节省 ${((result.before - result.after) / 1024 / 1024).toFixed(2)} MiB。`);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

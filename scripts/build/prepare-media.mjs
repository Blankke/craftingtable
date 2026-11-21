// 使用范例：npm run prepare:media；可加 --platform=linux --arch=x64 为目标平台准备工具。
// 下载固定版本、校验 SHA-256，再提取到 vendor/<平台>-<架构>；不依赖用户系统中的 FFmpeg。
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Node 的 fetch 默认不读取代理变量；在受代理管理的开发网络中显式启用，构建命令仍可直接复现。
if ((process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy) && process.env.NODE_USE_ENV_PROXY !== '1' && !process.execArgv.includes('--use-env-proxy')) {
  const child = spawnSync(process.execPath, ['--use-env-proxy', ...process.argv.slice(1)], { stdio: 'inherit', env: process.env });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}
const platform = process.argv.find(arg => arg.startsWith('--platform='))?.split('=')[1] ?? (process.platform === 'win32' ? 'win' : process.platform);
const arch = process.argv.find(arg => arg.startsWith('--arch='))?.split('=')[1] ?? process.arch;
const key = `${platform}-${arch}`;
const manifest = JSON.parse(await readFile(new URL('./media-tools.json', import.meta.url), 'utf8'));
const entry = manifest[key];
if (!entry) throw Error(`未配置 ${key} 的媒体工具`);
const cache = path.join(root, 'node_modules/.cache/media-tools');
const destination = path.join(root, 'vendor', key);
const archive = path.join(cache, path.basename(new URL(entry.url).pathname));
const suffix = platform === 'win' ? '.exe' : '';
const hash = async file => {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
};
await mkdir(destination, { recursive: true });
await mkdir(cache, { recursive: true });
// 每次核验已提取二进制的哈希，避免缓存存在但已损坏时被当作可发布资源。
const stamp = await readFile(path.join(destination, 'integrity.json'), 'utf8').then(JSON.parse).catch(() => null);
if (stamp?.archive === entry.sha256 && await Promise.all(['ffmpeg', 'ffprobe'].map(async name => hash(path.join(destination, name + suffix)).then(value => value === stamp[name]).catch(() => false))).then(values => values.every(Boolean))) {
  console.log(`[media] ${key} FFmpeg ${entry.version} 已校验`);
  process.exit(0);
}
if (!await stat(archive).then(info => info.isFile()).catch(() => false)) {
  console.log(`[media] 下载 ${key} FFmpeg ${entry.version}`);
  const partial = `${archive}.partial`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const offset = await stat(partial).then(info => info.size).catch(() => 0);
      if (offset && await hash(partial) === entry.sha256) { await rename(partial, archive); break; }
      const response = await fetch(entry.url, { headers: offset ? { Range: `bytes=${offset}-` } : {}, signal: AbortSignal.timeout(300_000) });
      if (!response.ok || !response.body) throw Error(`HTTP ${response.status}`);
      const resumed = offset > 0 && response.status === 206 && response.headers.get('content-range')?.startsWith(`bytes ${offset}-`);
      const size = Number(response.headers.get('content-length')) + (resumed ? offset : 0);
      let received = resumed ? offset : 0, last = -1;
      const progress = new Transform({ transform(chunk, _encoding, next) {
        received += chunk.length;
        const percent = size ? Math.floor(received / size * 100) : 0;
        if (Math.floor(percent / 10) > last) { last = Math.floor(percent / 10); console.log(`[media] ${percent}% (${Math.round(received / 1024 / 1024)} MiB)`); }
        next(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(partial, { flags: resumed ? 'a' : 'w' }));
      await rename(partial, archive);
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      console.log(`[media] 连接中断，保留下载进度并重试 (${attempt}/4)`);
    }
  }
}
if (await hash(archive) !== entry.sha256) throw Error(`媒体工具校验失败，请检查下载缓存：${archive}`);
const extracted = path.join(cache, key, 'extracted');
await mkdir(extracted, { recursive: true });
const command = platform === 'win' && process.platform === 'win32' ? path.join(root, 'node_modules/7zip-bin/win/x64/7za.exe') : 'tar';
const args = command === 'tar' ? ['-xf', archive, '-C', extracted] : ['x', '-y', `-o${extracted}`, archive];
const extraction = spawnSync(command, args, { stdio: 'pipe', encoding: 'utf8' });
if (extraction.error || extraction.status !== 0) throw Error(`媒体工具解压失败：${extraction.error ?? extraction.stderr}`);
const files = [];
async function walk(folder) { for (const item of await readdir(folder, { withFileTypes: true })) { const file = path.join(folder, item.name); if (item.isDirectory()) await walk(file); else if (item.isFile()) files.push(file); } }
await walk(extracted);
const integrity = { archive: entry.sha256 };
for (const name of ['ffmpeg', 'ffprobe']) {
  const file = files.find(file => path.basename(file) === name + suffix);
  if (!file) throw Error(`媒体工具归档缺少 ${name}`);
  const target = path.join(destination, name + suffix);
  await copyFile(file, target);
  if (platform === 'linux') await chmod(target, 0o755);
  integrity[name] = await hash(target);
}
for (const file of files.filter(file => /^(LICENSE|COPYING|README)(\.|$)/i.test(path.basename(file)))) await copyFile(file, path.join(destination, `FFmpeg-${path.basename(file)}`));
await writeFile(path.join(destination, 'FFmpeg-build.txt'), `FFmpeg / ffprobe ${entry.version}\nArchive: ${entry.url}\nSHA-256: ${entry.sha256}\nSource: ${entry.source}\nLicense: GPL-3.0; see bundled license files.\nThe application invokes these tools as separate processes.\n`);
await writeFile(path.join(destination, 'integrity.json'), JSON.stringify(integrity, null, 2));
console.log(`[media] ${key} 已准备并校验`);

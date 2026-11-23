// 使用范例：npm run dist:linux:docker。需要 Docker；产物复制到 release/，不影响本机 node_modules。
// 容器只构建，不启动 Electron；桌面冒烟请在 Linux 主机执行 release/linux-unpacked/craftingtable --smoke。
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
// 构建镜像标签与应用版本同步，避免不同发布版本共用固定标签。
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const image = `craftingtable-linux-builder:${version}`;
const container = `craftingtable-artifacts-${process.pid}-${Date.now()}`;
async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn('docker', args, { cwd: root, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error(`Docker 退出码 ${code}`)));
  });
}
const buildArgs = process.env.CRAFTINGTABLE_NODE_IMAGE ? ['--build-arg', `NODE_IMAGE=${process.env.CRAFTINGTABLE_NODE_IMAGE}`] : [];
if (process.env.CRAFTINGTABLE_DEBIAN_MIRROR) buildArgs.push('--build-arg', `DEBIAN_MIRROR=${process.env.CRAFTINGTABLE_DEBIAN_MIRROR}`);
// 网络配置通过构建参数传递；Docker 的代理预定义参数不会写入最终镜像环境。
for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ELECTRON_MIRROR', 'ELECTRON_BUILDER_BINARIES_MIRROR']) {
  if (process.env[name]) buildArgs.push('--build-arg', name);
}
if (process.env.CRAFTINGTABLE_BUILD_NETWORK) buildArgs.push('--network', process.env.CRAFTINGTABLE_BUILD_NETWORK);
await run(['build', ...buildArgs, '-f', 'scripts/build/linux.Dockerfile', '-t', image, '.']);
await mkdir(path.join(root, 'release'), { recursive: true });
await run(['create', '--name', container, image]);
try { await run(['cp', `${container}:/workspace/release/.`, path.join(root, 'release')]); }
finally { await run(['rm', container]); }
console.log('[release] Linux 安装包已输出到 release/');

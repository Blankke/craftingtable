// 使用范例：node scripts/build/stage-release.mjs --prepare；随后在输出目录 npm ci、npm run smoke、npm run verify、npm run dist:win。
// 为发布创建独立源码副本，保持当前开发窗口与 node_modules 可用；准备完成后会写入 test-results/staged-release.json 供复测定位。
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const target = await mkdtemp(path.join(os.tmpdir(), 'craftingtable-release-'));
// 固定源码白名单，不复制用户项目、凭据、Git 信息或现有依赖。
for (const name of ['src', 'electron', 'tests', 'scripts', 'build', 'vendor', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'playwright.config.ts', 'index.html']) {
  await cp(path.join(root, name), path.join(target, name), { recursive: true, filter: source => !source.endsWith('.exe') || source.includes(`${path.sep}win-x64${path.sep}`) });
}
await mkdir(path.join(root, 'test-results'), { recursive: true });
await writeFile(path.join(root, 'test-results/staged-release.json'), JSON.stringify({ root: target, platform: process.platform }, null, 2));
console.log(`[release] 独立构建目录：${target}`);

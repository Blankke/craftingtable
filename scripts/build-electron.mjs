// 使用范例：node scripts/build-electron.mjs。将桌面主进程、preload 与后台打包到 dist-electron。
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('dist-electron', { recursive: true });
for (const entry of ['main', 'preload', 'worker']) {
  await build({
    entryPoints: [`electron/${entry}.ts`],
    outfile: `dist-electron/${entry}.cjs`,
    platform: 'node', format: 'cjs', target: 'node20', bundle: true,
    external: ['electron'], sourcemap: false
  });
}

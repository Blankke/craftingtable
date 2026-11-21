// 使用范例：npm run release:checksums；对 release 中的当前版本安装包生成 SHA256SUMS.txt。
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { version } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const directory = new URL('../../release/', import.meta.url);
const files = (await readdir(directory)).filter(name => name.startsWith(`CraftingTable-${version}-`) && /\.(exe|AppImage|deb|rpm)$/.test(name)).sort();
if (!files.length) throw Error('尚未生成安装包，请先运行 dist:win 或 dist:linux');
const lines = [];
for (const file of files) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(new URL(file, directory))) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${path.basename(file)}`);
  console.log(`[release] 已校验 ${file}`);
}
await writeFile(new URL('SHA256SUMS.txt', directory), lines.join('\n') + '\n');

// 用法：node scripts/build/generate-hello-path.mjs；从本地 Indie Flower 字体生成开屏 Hello 的固定 SVG 路径。
// 字体依据用户提供的原组件镜像资源，授权见 src/assets/fonts/OFL.txt。
import { readFile, writeFile } from 'node:fs/promises';
import opentype from 'opentype.js';

const fontFile = new URL('../../src/assets/fonts/handwriting.ttf', import.meta.url);
const outputFile = new URL('../../src/ui/home/helloPath.ts', import.meta.url);
const bytes = await readFile(fontFile);
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const font = opentype.parse(buffer);
const fontSize = 288;
const height = 320;
const path = font.getPath('Hello World', 0, fontSize, fontSize);
const box = path.getBoundingBox();
// 字号加倍至 288px，可见字形约 1267×210px；视口同步放大，窄窗口由 CSS 等比限幅。
const width = Math.max(320, Math.ceil(box.x2 - box.x1) + 40);
const viewBox = `${(box.x1 + box.x2 - width) / 2} ${(box.y1 + box.y2 - height) / 2} ${width} ${height}`;
// opentype.js 的压缩序列化在这个字体的连续二次曲线上会输出 NaN；直接写出已解析的有限坐标。
const number = value => {
  if (!Number.isFinite(value)) throw Error('字形路径存在无效坐标');
  return Number(value.toFixed(2));
};
const data = path.commands.map(command => {
  if (command.type === 'M' || command.type === 'L') return `${command.type}${number(command.x)} ${number(command.y)}`;
  if (command.type === 'Q') return `Q${number(command.x1)} ${number(command.y1)} ${number(command.x)} ${number(command.y)}`;
  if (command.type === 'C') return `C${number(command.x1)} ${number(command.y1)} ${number(command.x2)} ${number(command.y2)} ${number(command.x)} ${number(command.y)}`;
  if (command.type === 'Z') return 'Z';
  throw Error(`不支持的字形命令：${command.type}`);
}).join('');
const source = `// 由 scripts/build/generate-hello-path.mjs 生成；源字体为 Indie Flower，授权见 src/assets/fonts/OFL.txt。\nexport const helloPath = ${JSON.stringify(data)};\nexport const helloViewBox = ${JSON.stringify(viewBox)};\nexport const helloWidth = ${width};\nexport const helloHeight = ${height};\n`;
await writeFile(outputFile, source, 'utf8');

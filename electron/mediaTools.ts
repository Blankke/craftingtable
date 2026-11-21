// 用法：mediaToolPath('ffmpeg')。主进程冒烟与后台分析共用平台路径，确保发行包离线可用。
import { existsSync } from 'node:fs';
import path from 'node:path';

export function mediaToolPath(name: 'ffmpeg' | 'ffprobe'): string {
  const filename = name + (process.platform === 'win32' ? '.exe' : '');
  const packaged = path.join(process.resourcesPath ?? '', 'vendor', filename);
  const platform = process.platform === 'win32' ? 'win' : process.platform;
  const local = path.resolve(__dirname, '../vendor', `${platform}-${process.arch}`, filename);
  if (process.resourcesPath && existsSync(packaged)) return packaged;
  if (existsSync(local)) return local;
  throw Error(`缺少媒体工具 ${filename}，请运行 npm run prepare:media`);
}

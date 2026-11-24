// 使用示例：readSettings(settingsFile, defaultRoot)；更新目录或压缩方式后调用 saveSettings。
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { imageCompressionSchema, DEFAULT_IMAGE_COMPRESSION } from '../src/core/imageCompression';

const settingsSchema = z.object({ projectsRoot: z.string().min(1), imageCompression: imageCompressionSchema.default(DEFAULT_IMAGE_COMPRESSION) });
export type DesktopSettings = z.infer<typeof settingsSchema>;

export function readSettings(file: string, fallback: string): DesktopSettings {
  const defaults = { projectsRoot: fallback, imageCompression: DEFAULT_IMAGE_COMPRESSION };
  if (!existsSync(file)) return defaults;
  try { const settings = settingsSchema.parse(JSON.parse(readFileSync(file, 'utf8'))); return { ...settings, projectsRoot: path.resolve(settings.projectsRoot) }; }
  catch { return defaults; }
}

export function saveSettings(file: string, settings: DesktopSettings): void {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(settingsSchema.parse(settings)), 'utf8');
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
}

// 使用示例：主进程以 readProjectsRoot(settingsFile, defaultRoot) 读取目录，选择新目录后调用 saveProjectsRoot。
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const settingsSchema = z.object({ projectsRoot: z.string().min(1) });

export function readProjectsRoot(file: string, fallback: string): string {
  if (!existsSync(file)) return fallback;
  try { return path.resolve(settingsSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).projectsRoot); }
  catch { return fallback; }
}

export function saveProjectsRoot(file: string, root: string): void {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(settingsSchema.parse({ projectsRoot: root })), 'utf8');
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
}

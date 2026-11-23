// 用法：createNumberedImage(assets目录, 原名称, 扩展名, 写入回调)，原子创建“图片-001.png”等编号文件。
import path from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';

export async function createNumberedImage(directory: string, original: string, extension: string, write: (destination: string) => Promise<unknown>): Promise<string> {
  await mkdir(directory, { recursive: true });
  const stem = path.parse(original.replaceAll('\\', '/')).name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/g, '').slice(0, 100);
  const base = !stem || /^(image|blob|clipboard|粘贴图片)$/i.test(stem) || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(stem) ? '图片' : stem;
  const files = await readdir(directory);
  let number = 1;
  for (const file of files) {
    const name = path.parse(file).name;
    if (name.toLocaleLowerCase().startsWith(base.toLocaleLowerCase() + '-')) {
      const suffix = name.slice(base.length + 1);
      if (/^\d+$/.test(suffix) && Number.isSafeInteger(Number(suffix))) number = Math.max(number, Number(suffix) + 1);
    }
  }
  // 并发粘贴可能取得相同编号，以独占创建结果为准，绝不覆盖已存在的素材。
  for (;;) {
    const name = `${base}-${String(number++).padStart(3, '0')}${extension}`;
    try { await write(path.join(directory, name)); return name; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
}

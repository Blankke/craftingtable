// 用法：npm run test:unit；验证相同图片共享解码、最后一个使用者释放和取消请求。
import { afterEach, expect, it, vi } from 'vitest';
import { acquireImage } from './imageResources';
afterEach(() => vi.unstubAllGlobals());
it('同一 URL 只读取/解码一次，最后一个引用释放时关闭位图，之后可重新加载', async () => {
  const close = vi.fn(), fetchImage = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['image']) }));
  vi.stubGlobal('fetch', fetchImage); vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 128, height: 128, close })));
  const a = acquireImage('project-media://asset/shared.png?edge=128'), b = acquireImage('project-media://asset/shared.png?edge=128');
  expect(await a.promise).toBe(await b.promise); expect(fetchImage).toHaveBeenCalledTimes(1);
  a.release(); a.release(); expect(close).not.toHaveBeenCalled();
  b.release(); expect(close).toHaveBeenCalledTimes(1);
  const c = acquireImage('project-media://asset/shared.png?edge=128'); await c.promise; c.release();
  expect(fetchImage).toHaveBeenCalledTimes(2); expect(close).toHaveBeenCalledTimes(2);
});
it('资源在解码期间失去全部引用时关闭迟到的位图', async () => {
  const close = vi.fn(); let finish!: (value: unknown) => void;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['image']) })));
  const decode = vi.fn(() => new Promise(resolve => { finish = resolve; })); vi.stubGlobal('createImageBitmap', decode);
  const resource = acquireImage('project-media://asset/cancel.png?edge=128');
  await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
  resource.release(); finish({ width: 128, height: 128, close });
  await expect(resource.promise).rejects.toThrow(); expect(close).toHaveBeenCalledTimes(1);
});

// 用法：acquireImage(url) 后 await promise，使用结束调用 release()；共享解码且及时关闭位图。
// 仅保留使用中的资源，最多四个读取/解码任务并行，队列不持有像素或 Blob。
type Resource = { refs: number; controller: AbortController; promise: Promise<ImageBitmap>; bitmap?: ImageBitmap };
const resources = new Map<string, Resource>();
let running = 0;
const queue: (() => void)[] = [];
async function limited<T>(task: () => Promise<T>): Promise<T> {
  await new Promise<void>(resolve => { const start = () => { running++; resolve(); }; if (running < 4) start(); else queue.push(start); });
  try { return await task(); } finally { running--; queue.shift()?.(); }
}
export function acquireImage(url: string): { promise: Promise<ImageBitmap>; release(): void } {
  let resource = resources.get(url);
  if (!resource) {
    const controller = new AbortController();
    const current: Resource = { refs: 0, controller, promise: limited(async () => {
      controller.signal.throwIfAborted();
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw Error('图片无法读取');
      const bitmap = await createImageBitmap(await response.blob());
      if (controller.signal.aborted) { bitmap.close(); controller.signal.throwIfAborted(); }
      current.bitmap = bitmap;
      return bitmap;
    }) };
    resource = current;
    resources.set(url, resource);
  }
  resource.refs++;
  const current = resource;
  let released = false;
  return { promise: current.promise, release() {
    if (released) return;
    released = true;
    if (--current.refs) return;
    current.controller.abort(); current.bitmap?.close();
    if (resources.get(url) === current) resources.delete(url);
  } };
}

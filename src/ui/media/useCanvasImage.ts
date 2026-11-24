// 用法：useCanvasImage(url)。路径或分辨率改变时替换资源，卸载时释放共享位图。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { acquireImage } from './imageResources';
export function useCanvasImage(url: string): ImageBitmap | null {
  type Lease = ReturnType<typeof acquireImage>;
  const retained = useRef(new Set<Lease>());
  const [loaded, setLoaded] = useState<{ url: string; bitmap: ImageBitmap; resource: Lease } | null>(null);
  useEffect(() => () => { retained.current.forEach(resource => resource.release()); retained.current.clear(); }, []);
  useEffect(() => {
    let active = true, settled = false;
    const resource = acquireImage(url);
    retained.current.add(resource);
    void resource.promise.then(bitmap => { if (active) { settled = true; setLoaded({ url, bitmap, resource }); } }).catch(() => { resource.release(); retained.current.delete(resource); });
    return () => { active = false; if (!settled) { resource.release(); retained.current.delete(resource); } };
  }, [url]);
  useLayoutEffect(() => {
    // 新档位已交给 Konva 后才关闭旧位图，缩放等待期间继续显示已有的清晰内容。
    for (const resource of retained.current) if (resource !== loaded?.resource) { resource.release(); retained.current.delete(resource); }
  }, [loaded]);
  return loaded?.url.split('?')[0] === url.split('?')[0] ? loaded.bitmap : null;
}

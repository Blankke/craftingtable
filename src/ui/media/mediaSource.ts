// 使用示例：mediaSource('assets/example.png')。把项目内相对路径映射到 Electron 受限媒体协议。
export function mediaSource(assetPath: string, host: 'asset' | 'cache' = 'asset', edge?: number): string {
  return `project-media://${host}/${assetPath.split('/').map(encodeURIComponent).join('/')}${edge ? `?edge=${edge}` : ''}`;
}
// 叠图内已有完整 URL 时，只为项目图片附加固定预览档位。
export function imageSourceAt(source: string, edge: number): string {
  if (!source.startsWith('project-media://asset/')) return source;
  const url = new URL(source); url.searchParams.set('edge', String(edge)); return url.toString();
}

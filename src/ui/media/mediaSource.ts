// 使用示例：mediaSource('assets/example.png')。把项目内相对路径映射到 Electron 受限媒体协议。
export function mediaSource(assetPath: string, host: 'asset' | 'cache' = 'asset'): string {
  return `project-media://${host}/${assetPath.split('/').map(encodeURIComponent).join('/')}`;
}

// 使用示例：developmentDirectories(app.getPath('appData'), projectRoot)。将 Chromium 数据与开发项目分置在不同磁盘目录。
import path from 'node:path';

export function developmentDirectories(appData: string, projectRoot: string): { userData: string; projects: string } {
  return {
    // Chromium 沙箱需要能够给缓存和网络目录授权，不能把 userData 放在 WSL 仓库所在卷。
    userData: path.join(appData, 'media-planning-workbench-dev'),
    projects: path.join(projectRoot, 'projects')
  };
}

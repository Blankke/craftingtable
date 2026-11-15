// 使用示例：npm run test:e2e。配置只启动本地 Electron，不下载浏览器或连接网络。
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 30_000,
  use: { trace: 'retain-on-failure' }
});

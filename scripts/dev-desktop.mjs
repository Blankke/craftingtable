// 使用示例：npm.cmd run dev:desktop。启动 Vite 和未安装的 Electron，修改界面后自动刷新。
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import path from 'node:path';

const require = createRequire(import.meta.url);
const executable = require('electron');
const server = await createServer({ server: { host: '127.0.0.1', port: 5173 } });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw Error('Vite 未提供本地地址');
const environment = { ...process.env, VITE_DEV_SERVER_URL: url };
// 某些开发终端设置此变量供 Node 使用；桌面预览必须以 Electron 模式启动。
delete environment.ELECTRON_RUN_AS_NODE;
const electron = spawn(executable, ['.'], { cwd: path.resolve('.'), env: environment, stdio: 'inherit', windowsHide: true });
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  electron.kill();
  await server.close();
  process.exit(code);
}
process.on('SIGINT', () => { void close(); });
process.on('SIGTERM', () => { void close(); });
electron.on('exit', code => { void close(code ?? 1); });

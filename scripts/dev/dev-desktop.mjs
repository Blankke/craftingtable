// 使用示例：npm.cmd run dev。启动 Vite 和未安装的 Electron，修改界面后自动刷新。
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import path from 'node:path';

// Electron 子进程的 UTF-8 字节先由 Node 解码再转发，避免 PowerShell 把它按本地代码页显示为乱码。
process.stdout.setDefaultEncoding('utf8');
process.stderr.setDefaultEncoding('utf8');
if (process.platform === 'win32') spawnSync('cmd.exe', ['/d', '/c', 'chcp 65001>nul'], { stdio: 'inherit' });

const require = createRequire(import.meta.url);
const executable = require('electron');
const server = await createServer({ server: { host: '127.0.0.1', port: 5173 } });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw Error('Vite 未提供本地地址');
const environment = { ...process.env, VITE_DEV_SERVER_URL: url, WORKBENCH_DEV_ROOT: path.resolve('.runtime') };
// 某些开发终端设置此变量供 Node 使用；桌面预览必须以 Electron 模式启动。
delete environment.ELECTRON_RUN_AS_NODE;
console.log(`[dev] 界面服务已就绪：${url}`);
console.log('[dev] 正在打开 Electron 桌面窗口；此命令会持续运行，按 Ctrl+C 停止。');
// 用户需要看见桌面窗口；显式以 UTF-8 转发子进程日志，保留启动诊断且不污染终端编码。
const electron = spawn(executable, ['.'], { cwd: path.resolve('.'), env: environment, stdio: ['inherit', 'pipe', 'pipe'] });
for (const [stream, output] of [[electron.stdout, process.stdout], [electron.stderr, process.stderr]]) {
  stream?.setEncoding('utf8');
  stream?.on('data', chunk => output.write(chunk));
}
electron.on('error', error => { console.error('[dev] Electron 启动失败：', error); void close(1); });
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

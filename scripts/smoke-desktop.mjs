// 使用范例：npm.cmd run smoke。以真正的 Electron 模式运行内置桌面冒烟测试。
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const executable = createRequire(import.meta.url)('electron');
const environment = { ...process.env };
// 某些终端把 Electron 强制切换为 Node；桌面测试必须清理该变量。
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, ['.', '--smoke'], { env: environment, stdio: 'inherit' });
child.once('error', error => { console.error('桌面冒烟测试无法启动：', error); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });

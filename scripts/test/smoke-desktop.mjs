// 使用范例：npm run smoke；node scripts/test/smoke-desktop.mjs --executable=release/linux-unpacked/craftingtable。
// 以真正的 Electron 模式验证开发构建或已打包应用；所有测试数据写入应用的独立冒烟目录。
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

const packaged = process.argv.find(argument => argument.startsWith('--executable='))?.slice('--executable='.length);
const executable = packaged ? path.resolve(packaged) : createRequire(import.meta.url)('electron');
const environment = { ...process.env };
const testRoot = await mkdtemp(path.join(os.tmpdir(), 'workbench-smoke-'));
environment.WORKBENCH_E2E_ROOT = testRoot;
// 某些终端把 Electron 强制切换为 Node；桌面测试必须清理该变量。
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [...(packaged ? [] : ['.']), '--smoke'], { env: environment, stdio: 'inherit' });
child.once('error', error => { console.error('桌面冒烟测试无法启动：', error); process.exitCode = 1; });
child.once('exit', async code => {
  // 某些安装器启动器会吞掉应用异常退出码；必须同时确认本次独立目录中的真实验收结果。
  const result = await readFile(path.join(testRoot, 'projects', 'smoke-result.json'), 'utf8').then(JSON.parse).catch(() => null);
  process.exitCode = code === 0 && result?.passed === true ? 0 : 1;
  if (process.exitCode) console.error(`桌面冒烟未通过，诊断数据保留在：${testRoot}`);
  else await rm(testRoot, { recursive: true, force: true });
});

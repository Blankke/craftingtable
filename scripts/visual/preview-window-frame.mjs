// 用法：npm.cmd run build；node scripts/visual/preview-window-frame.mjs；修改前加 --baseline。
// 在 Windows 桌面运行，采集包含原生标题栏的本应用窗口，覆盖明暗主题及 100%/150% 缩放。
// 不修改系统强调色；仅保存本应用截图到 test-results/window-frame。
import { _electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

if (process.platform !== 'win32') throw Error('请在 Windows 宿主机运行此标题栏复拍脚本');
const baseline = process.argv.includes('--baseline');
const output = path.resolve('test-results/window-frame', baseline ? 'before' : 'after');
await mkdir(output, { recursive: true });
// Chromium 缩略图会裁掉边框，PrintWindow 也可能漏掉 DWM 材质；采集置顶窗口的实际屏幕区域。
function captureFrame(handle, destination) {
  const script = `
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public class WindowFrameCapture {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  public static void Save(long handle, string path) {
    SetProcessDPIAware();
    IntPtr hwnd = new IntPtr(handle); Rect rect;
    if (!GetWindowRect(hwnd, out rect)) throw new Exception("GetWindowRect failed");
    using (var bitmap = new Bitmap(rect.Right - rect.Left, rect.Bottom - rect.Top)) {
      using (var graphics = Graphics.FromImage(bitmap)) {
        graphics.CopyFromScreen(rect.Left, rect.Top, 0, 0, bitmap.Size);
      }
      bitmap.Save(path, System.Drawing.Imaging.ImageFormat.Png);
    }
  }
}
'@
[WindowFrameCapture]::Save(${handle}, [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(destination).toString('base64')}')))
`;
  execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { stdio: 'pipe', timeout: 15_000 });
}
for (const scale of [1, 1.5]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workbench-window-frame-'));
  const env = { ...process.env, WORKBENCH_E2E_ROOT: root }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [`--force-device-scale-factor=${scale}`, '.'], env });
    const page = await app.firstWindow();
    await expect(page.locator('.home')).toBeVisible();
    await expect(page.locator('.splash')).toHaveCount(0, { timeout: 15_000 });
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      // 标题栏验收需要真实焦点；仍隔离宿主鼠标，避免干扰页面操作。
      window.setSize(1000, 720); window.setPosition(0, 0); window.setAlwaysOnTop(true); window.setFocusable(true); window.focus();
    });
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
      await page.waitForTimeout(1800);
      const capture = await app.evaluate(({ BrowserWindow, nativeTheme }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return { accent: window.getAccentColor(), expected: nativeTheme.shouldUseDarkColors ? '#202020' : '#f5f5f5', focused: window.isFocused(), handle: window.getNativeWindowHandle().readBigUInt64LE().toString() };
      });
      if (!baseline) expect(String(capture.accent).toLowerCase()).toBe(capture.expected);
      captureFrame(capture.handle, path.join(output, `${theme}-${scale}.png`));
      console.log(`${theme} ${scale * 100}%：accent=${capture.accent}，focused=${capture.focused}`);
    }
    if (!baseline) {
      // 仅覆盖此测试进程的原生明暗来源，验证系统主题更新事件，不修改 Windows 设置。
      for (const theme of ['light', 'dark']) {
        await app.evaluate(({ nativeTheme }, theme) => { nativeTheme.themeSource = theme; }, theme);
        await expect.poll(() => app.evaluate(({ BrowserWindow }) => String(BrowserWindow.getAllWindows()[0].getAccentColor()).toLowerCase())).toBe(theme === 'dark' ? '#202020' : '#f5f5f5');
        await page.waitForTimeout(500);
        const handle = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString());
        captureFrame(handle, path.join(output, `system-${theme}-${scale}.png`));
      }
    }
  } finally {
    await app?.close();
    // 只清理本脚本创建的隔离数据，保留截图供人工复核。
    await rm(root, { recursive: true, force: true });
  }
}
console.log(`标题栏截图：${output}`);

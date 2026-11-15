# 使用范例：powershell -ExecutionPolicy Bypass -File scripts/build.ps1。先安装 npm 依赖；验证与打包会自动准备媒体工具。
$ErrorActionPreference = 'Stop'
npm.cmd run verify
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm.cmd run dist:win
exit $LASTEXITCODE

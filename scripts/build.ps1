# 使用范例：powershell -ExecutionPolicy Bypass -File scripts/build.ps1。须先按 README 安装依赖和媒体工具。
$ErrorActionPreference = 'Stop'
npm.cmd run verify
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm.cmd run dist:win
exit $LASTEXITCODE

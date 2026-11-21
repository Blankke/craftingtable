# 使用范例：powershell -ExecutionPolicy Bypass -File scripts/test/verify.ps1。
# 此脚本执行完整回归验证，不生成安装包；获得人工稳定发布确认后，才可另行运行 npm.cmd run dist:win。
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '../..')
npm.cmd run verify
exit $LASTEXITCODE

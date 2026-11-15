# 使用示例：powershell -ExecutionPolicy Bypass -File scripts/clean-test-artifacts.ps1。
# 仅清理仓库内的端到端测试残留和打包调试配置，保留源码、样本、dist 和安装包。
$ErrorActionPreference = 'Stop'
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$targets = @(
  'test-results',
  'playwright-report',
  'release/installed-smoke',
  'release/builder-debug.yml',
  'release/builder-effective-config.yaml'
)
foreach ($relative in $targets) {
  $absolute = [System.IO.Path]::GetFullPath((Join-Path $workspace $relative))
  if (-not $absolute.StartsWith($workspace + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "清理目标超出仓库：$absolute"
  }
  if (Test-Path -LiteralPath $absolute) {
    Remove-Item -LiteralPath $absolute -Recurse -Force
    Write-Output "已清理：$relative"
  }
}

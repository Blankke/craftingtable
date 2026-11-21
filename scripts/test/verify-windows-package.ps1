# 使用范例：powershell -ExecutionPolicy Bypass -File scripts/test/verify-windows-package.ps1
# 在临时目录验证 NSIS 安装、图标、已安装应用冒烟与卸载；如已有正式安装则停止，避免覆盖用户应用。
param([string]$ReleaseDirectory = 'release', [string]$ApplicationExecutable = '')
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$releaseRoot = if ([IO.Path]::IsPathRooted($ReleaseDirectory)) { $ReleaseDirectory } else { [IO.Path]::GetFullPath((Join-Path $projectRoot $ReleaseDirectory)) }
$version = (Get-Content (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$installer = Join-Path $releaseRoot "CraftingTable-$version-win-x64.exe"
if (!(Test-Path $installer)) { throw "缺少安装包：$installer" }
$results = Join-Path $projectRoot 'test-results/package-windows'
New-Item -ItemType Directory -Force -Path $results | Out-Null
if ($ApplicationExecutable) {
    # Shell 图标提取会缓存 EXE 资源句柄；放到独立进程，退出后释放文件再验证卸载。
    Add-Type -AssemblyName System.Drawing
    foreach ($entry in @(@($installer, 'installer'), @($ApplicationExecutable, 'application'))) {
        $icon = [Drawing.Icon]::ExtractAssociatedIcon($entry[0])
        if (!$icon) { throw 'EXE 缺少关联图标' }
        $bitmap = $icon.ToBitmap()
        $bitmap.Save((Join-Path $results ($entry[1] + '-icon.png')))
        $bitmap.Dispose(); $icon.Dispose()
    }
    exit 0
}
$installed = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq '工作台' }
if ($installed) { throw '已存在工作台安装，请在干净的 Windows 测试用户中执行安装验收。' }
$target = Join-Path ([IO.Path]::GetTempPath()) ('craftingtable-install-' + [Guid]::NewGuid().ToString('N'))
try {
    Write-Host '[package] 1/4 安装到独立临时目录'
    $setup = Start-Process -FilePath $installer -ArgumentList "/S /currentuser /D=$target" -Wait -PassThru
    if ($setup.ExitCode -ne 0) { throw "安装失败：$($setup.ExitCode)" }
    $executable = Join-Path $target '工作台.exe'
    if (!(Test-Path $executable)) { throw '安装后未找到应用' }
    Write-Host '[package] 2/4 提取安装器与应用图标'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -ReleaseDirectory $releaseRoot -ApplicationExecutable $executable
    if ($LASTEXITCODE -ne 0) { throw '图标提取失败' }
    Write-Host '[package] 3/4 验证已安装程序与离线媒体工具'
    & node (Join-Path $PSScriptRoot 'smoke-desktop.mjs') "--executable=$executable"
    if ($LASTEXITCODE -ne 0) { throw "安装版冒烟失败：$LASTEXITCODE" }
} finally {
    $uninstaller = Join-Path $target 'Uninstall 工作台.exe'
    if (Test-Path $uninstaller) {
        Write-Host '[package] 4/4 卸载本次测试安装'
        $removal = Start-Process -FilePath $uninstaller -ArgumentList '/S /currentuser' -Wait -PassThru
        if ($removal.ExitCode -ne 0) { throw "卸载失败：$($removal.ExitCode)" }
        # NSIS 会把卸载器复制到临时目录后重新启动；原启动器退出后等待实际应用文件移除。
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        while ((Test-Path (Join-Path $target '工作台.exe')) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
        if (Test-Path (Join-Path $target '工作台.exe')) { throw '卸载后应用仍然存在' }
        # 仅删除此脚本创建的临时安装目录，保留验收图标和用户数据。
        Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Write-Host '[package] NSIS 安装、应用冒烟和卸载全部通过'

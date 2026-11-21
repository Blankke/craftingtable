# 使用范例：powershell -ExecutionPolicy Bypass -File scripts/build/prepare-media.ps1。
# 下载固定版本的 Windows x64 FFmpeg essentials，校验 SHA-256，提取 ffmpeg/ffprobe 和许可证到 vendor。
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$cache = Join-Path $projectRoot 'node_modules/.cache/media-tools'
$vendor = Join-Path $projectRoot 'vendor'
$archive = Join-Path $cache 'ffmpeg-9.0.2-essentials_build.7z'
$extract = Join-Path $cache 'extracted'
$sevenZip = Join-Path $projectRoot 'node_modules/7zip-bin/win/x64/7za.exe'
$expectedHash = '4705843ccaaf54257c16ad90f3e952ece33c17df964ecf7bfdbb0f49c7171077'
$url = 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.7z'

if (-not (Test-Path -LiteralPath $sevenZip)) { throw '请先安装项目依赖，缺少 7za.exe。' }
New-Item -ItemType Directory -Force -Path $cache, $vendor, $extract | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
    Write-Host '下载 FFmpeg 9.0.2 essentials...'
    Invoke-WebRequest -Uri $url -OutFile $archive
}
$actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) { throw "FFmpeg 文件校验失败：$actualHash" }
& $sevenZip x -y "-o$extract" $archive | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'FFmpeg 解压失败。' }
$ffmpeg = Get-ChildItem -Path $extract -Filter ffmpeg.exe -Recurse -File | Select-Object -First 1
$ffprobe = Get-ChildItem -Path $extract -Filter ffprobe.exe -Recurse -File | Select-Object -First 1
if (-not $ffmpeg -or -not $ffprobe) { throw 'FFmpeg 包内缺少 ffmpeg.exe 或 ffprobe.exe。' }
Copy-Item -LiteralPath $ffmpeg.FullName -Destination (Join-Path $vendor 'ffmpeg.exe') -Force
Copy-Item -LiteralPath $ffprobe.FullName -Destination (Join-Path $vendor 'ffprobe.exe') -Force
Get-ChildItem -Path $extract -Recurse -File | Where-Object { $_.Name -match '^(LICENSE|COPYING|README)' } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $vendor $_.Name) -Force
}
Write-Host '媒体工具已准备在 vendor/。'

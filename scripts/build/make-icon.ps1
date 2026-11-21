# 生成 Windows 应用图标：把工作台 PNG 缩放为多尺寸并组装成 .ico，同时输出 256px icon.png。
# 用法：powershell -ExecutionPolicy Bypass -File scripts/build/make-icon.ps1
param(
  [string]$Source = (Join-Path $PSScriptRoot '../../build/source/Crafting_Table_JE4_BE3.png'),
  [string]$OutDir = (Join-Path $PSScriptRoot '../../build')
)
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$sizes = @(16, 24, 32, 48, 64, 128, 256)
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$src = [System.Drawing.Image]::FromFile((Resolve-Path $Source))
$images = New-Object System.Collections.Generic.List[byte[]]
foreach ($size in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($src, 0, 0, $size, $size)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $images.Add($ms.ToArray())
  $ms.Dispose()
}
$src.Dispose()

$count = $images.Count
$dirSize = 6 + 16 * $count
$offset = $dirSize
$entries = New-Object System.Collections.Generic.List[byte]
$pngBlob = New-Object System.Collections.Generic.List[byte]
for ($i = 0; $i -lt $count; $i++) {
  $img = $images[$i]
  $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
  $entry = New-Object byte[] 16
  $entry[0] = [byte]$dim
  $entry[1] = [byte]$dim
  $entry[2] = 0
  $entry[3] = 0
  $entry[4] = 1; $entry[5] = 0
  $entry[6] = 32; $entry[7] = 0
  $len = $img.Length
  [System.BitConverter]::GetBytes([int]$len).CopyTo($entry, 8)
  [System.BitConverter]::GetBytes([int]$offset).CopyTo($entry, 12)
  $entries.AddRange($entry)
  $pngBlob.AddRange($img)
  $offset += $len
}
$header = New-Object byte[] 6
$header[0] = 0; $header[1] = 0
$header[2] = 1; $header[3] = 0
$header[4] = [byte]($count -band 0xff); $header[5] = [byte](($count -shr 8) -band 0xff)

$icoPath = Join-Path $OutDir 'icon.ico'
$fs = [System.IO.File]::Create($icoPath)
$fs.Write($header, 0, 6)
$fs.Write($entries.ToArray(), 0, $entries.Count)
$fs.Write($pngBlob.ToArray(), 0, $pngBlob.Count)
$fs.Close()
[System.IO.File]::WriteAllBytes((Join-Path $OutDir 'icon.png'), $images[$count - 1])
Write-Output "ICON_OK $icoPath ($count sizes)"

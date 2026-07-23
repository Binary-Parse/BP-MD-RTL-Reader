<#
  generate-markdown-file-icon.ps1 — regenerate the Markdown document icon.

  Produces (overwrites only these dedicated file-association artifacts):
    build/icons/markdown-file-icon.png  — 256x256 transparent PNG
    build/icons/markdown-file-icon.ico  — PNG-in-ICO entries at 256, 48, 32, 16

  The application/window/installer icon artifacts are intentionally untouched.
  Run with Windows PowerShell:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/generate-markdown-file-icon.ps1
#>
[CmdletBinding()]
param(
  [string]$Source = '',
  [int[]]$Sizes = @(256, 48, 32, 16)
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path (Join-Path $here '..')).Path
if (-not $Source) {
  $Source = Join-Path $repo 'build\icons\markdown-file-icon-source.png'
}
$src = (Resolve-Path $Source).Path
$img = [System.Drawing.Image]::FromFile($src)

function Render-PngBytes([System.Drawing.Image]$image, [int]$size) {
  $bitmap = New-Object System.Drawing.Bitmap(
    $size,
    $size,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.DrawImage($image, (New-Object System.Drawing.Rectangle 0, 0, $size, $size))
  $graphics.Dispose()

  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
  return , $stream.ToArray()
}

try {
  $pngs = @{}
  foreach ($size in $Sizes) {
    $pngs[$size] = Render-PngBytes $img $size
  }

  [System.IO.File]::WriteAllBytes(
    (Join-Path $repo 'build\icons\markdown-file-icon.png'),
    $pngs[256]
  )

  $count = $Sizes.Count
  $header = New-Object byte[] (6 + 16 * $count)
  [BitConverter]::GetBytes([uint16]0).CopyTo($header, 0)
  [BitConverter]::GetBytes([uint16]1).CopyTo($header, 2)
  [BitConverter]::GetBytes([uint16]$count).CopyTo($header, 4)

  $offset = 6 + 16 * $count
  $blobs = New-Object System.Collections.Generic.List[byte[]]
  for ($index = 0; $index -lt $count; $index++) {
    $size = $Sizes[$index]
    $data = $pngs[$size]
    $entryOffset = 6 + 16 * $index
    $dimension = if ($size -ge 256) { 0 } else { $size }
    $header[$entryOffset] = [byte]$dimension
    $header[$entryOffset + 1] = [byte]$dimension
    $header[$entryOffset + 2] = 0
    $header[$entryOffset + 3] = 0
    [BitConverter]::GetBytes([uint16]1).CopyTo($header, $entryOffset + 4)
    [BitConverter]::GetBytes([uint16]32).CopyTo($header, $entryOffset + 6)
    [BitConverter]::GetBytes([uint32]$data.Length).CopyTo($header, $entryOffset + 8)
    [BitConverter]::GetBytes([uint32]$offset).CopyTo($header, $entryOffset + 12)
    $offset += $data.Length
    $blobs.Add($data)
  }

  $output = New-Object System.IO.MemoryStream
  $output.Write($header, 0, $header.Length)
  foreach ($blob in $blobs) {
    $output.Write($blob, 0, $blob.Length)
  }
  $icoBytes = $output.ToArray()
  [System.IO.File]::WriteAllBytes(
    (Join-Path $repo 'build\icons\markdown-file-icon.ico'),
    $icoBytes
  )

  Write-Host (
    'markdown-file-icon.png = {0} bytes; markdown-file-icon.ico = {1} bytes; sizes = {2}' -f
      $pngs[256].Length,
      $icoBytes.Length,
      ($Sizes -join ',')
  )
}
finally {
  $img.Dispose()
}

<#
  generate-icons.ps1 — regenerate the app icon artifacts from icon-source.png.

  Produces (overwrites):
    icon.png                     — 256x256 PNG (app/window icon, Linux + fallback)
    icon.ico                     — multi-size PNG-in-ICO (256,48,32,16) used by
                                   main.js BrowserWindow + electron-builder + fileAssociations
    installer/assets/icon.ico  — byte-identical copy used by Inno SetupIconFile

  All ICO entries are PNG-compressed, matching the format the build chain already
  accepts (verified against the previous icon.ico). Pure .NET System.Drawing — no
  external tools or npm deps. Run with Windows PowerShell:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
#>
[CmdletBinding()]
param(
  [string]$Source = '',
  [int[]]$Sizes   = @(256, 48, 32, 16)   # order preserved in the ICO directory
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path   # scripts/
$repo = (Resolve-Path (Join-Path $here '..')).Path
if (-not $Source) { $Source = Join-Path $repo 'assets\icon-source.png' }
$src  = (Resolve-Path $Source).Path
$img  = [System.Drawing.Image]::FromFile($src)

function Render-PngBytes([System.Drawing.Image]$image, [int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($image, (New-Object System.Drawing.Rectangle 0, 0, $size, $size))
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  return , $ms.ToArray()
}

try {
  $pngs = @{}
  foreach ($s in $Sizes) { $pngs[$s] = Render-PngBytes $img $s }

  # --- icon.png (256) ---
  [System.IO.File]::WriteAllBytes((Join-Path $repo 'assets\icon.png'), $pngs[256])

  # --- assemble the .ico (all entries PNG-compressed) ---
  $count  = $Sizes.Count
  $header = New-Object byte[] (6 + 16 * $count)
  [BitConverter]::GetBytes([uint16]0).CopyTo($header, 0)       # idReserved
  [BitConverter]::GetBytes([uint16]1).CopyTo($header, 2)       # idType = 1 (icon)
  [BitConverter]::GetBytes([uint16]$count).CopyTo($header, 4)  # idCount

  $offset = 6 + 16 * $count
  $blobs  = New-Object System.Collections.Generic.List[byte[]]
  for ($i = 0; $i -lt $count; $i++) {
    $s = $Sizes[$i]; $data = $pngs[$s]; $o = 6 + 16 * $i
    $dim = if ($s -ge 256) { 0 } else { $s }                  # 0 means 256 in an ICONDIRENTRY
    $header[$o]     = [byte]$dim                               # bWidth
    $header[$o + 1] = [byte]$dim                               # bHeight
    $header[$o + 2] = 0                                        # bColorCount
    $header[$o + 3] = 0                                        # bReserved
    [BitConverter]::GetBytes([uint16]1).CopyTo($header, $o + 4)            # wPlanes
    [BitConverter]::GetBytes([uint16]32).CopyTo($header, $o + 6)          # wBitCount
    [BitConverter]::GetBytes([uint32]$data.Length).CopyTo($header, $o + 8)  # dwBytesInRes
    [BitConverter]::GetBytes([uint32]$offset).CopyTo($header, $o + 12)      # dwImageOffset
    $offset += $data.Length
    $blobs.Add($data)
  }

  $out = New-Object System.IO.MemoryStream
  $out.Write($header, 0, $header.Length)
  foreach ($b in $blobs) { $out.Write($b, 0, $b.Length) }
  $icoBytes = $out.ToArray()

  [System.IO.File]::WriteAllBytes((Join-Path $repo 'assets\icon.ico'), $icoBytes)
  [System.IO.File]::WriteAllBytes((Join-Path $repo 'installer\assets\icon.ico'), $icoBytes)

  Write-Host ("icon.png = {0} bytes; icon.ico = {1} bytes; sizes = {2}" -f `
    $pngs[256].Length, $icoBytes.Length, ($Sizes -join ','))
}
finally { $img.Dispose() }

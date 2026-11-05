# Draws every logo file of the app from assets/logo-tom-rpm.png (the Tom.RPM logo, black on a
# transparent background, the same one as tom-rpm.fr). Windows PowerShell 5.1 + System.Drawing, so
# there is nothing to install. Run it from the repository root:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/brand/make-logo-assets.ps1
#
# Writes:
#   frontend/android/app/src/main/res/mipmap-*/ic_launcher*.png   launcher icons, every density,
#                                                                 plus the adaptive icon layers
#   frontend/android/app/src/main/res/drawable*/splash.png        the launch screens
#   frontend/public/icon-180.png, icon-512.png, favicon-48.png    web icons (PWA manifest, favicon)
#   frontend/public/logo-white.png, logo-black.png                the logo inside the app
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$src  = Join-Path $root 'assets/logo-tom-rpm.png'
$res  = Join-Path $root 'frontend/android/app/src/main/res'
$pub  = Join-Path $root 'frontend/public'
$ink  = [System.Drawing.Color]::FromArgb(255, 0, 0, 0)         # the icon background: the logo's black
$page = [System.Drawing.Color]::FromArgb(255, 10, 10, 11)      # #0a0a0b, the app's page colour

$black = New-Object System.Drawing.Bitmap $src

# The same logo with its black turned white (alpha kept), the red of the rev counter untouched.
function New-White($bmp) {
  $w = New-Object System.Drawing.Bitmap $bmp.Width, $bmp.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  for ($y = 0; $y -lt $bmp.Height; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) {
      $c = $bmp.GetPixel($x, $y)
      if ($c.A -eq 0) { continue }
      $red = ($c.R -gt 120 -and $c.G -lt 80 -and $c.B -lt 80)
      if ($red) { $w.SetPixel($x, $y, $c) } else { $w.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($c.A, 255, 255, 255)) }
    }
  }
  return $w
}
$white = New-White $black

function New-Canvas($w, $h, $bg) {
  $b = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  if ($bg) { $g.Clear($bg) } else { $g.Clear([System.Drawing.Color]::Transparent) }
  return @($b, $g)
}
# The logo centred on a canvas, `$ratio` of the width wide (capped so it also fits the height).
function Draw-Logo($g, $logo, $w, $h, $ratio, $maxH) {
  $lw = $w * $ratio; $lh = $lw * $logo.Height / $logo.Width
  if ($lh -gt $h * $maxH) { $lh = $h * $maxH; $lw = $lh * $logo.Width / $logo.Height }
  $g.DrawImage($logo, [single](($w - $lw) / 2), [single](($h - $lh) / 2), [single]$lw, [single]$lh)
}
function Save($b, $path) {
  New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
  $b.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose()
}
function Make-Icon($size, $ratio, $round, $path) {
  $b, $g = New-Canvas $size $size $null
  if ($round) {
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $gp.AddEllipse(0, 0, $size - 1, $size - 1); $g.SetClip($gp)
  }
  $g.Clear($ink)
  Draw-Logo $g $white $size $size $ratio 0.8
  $g.Dispose(); Save $b $path
}

# --- Android launcher icons ------------------------------------------------------------------
$legacy = @{ ldpi = 36; mdpi = 48; hdpi = 72; xhdpi = 96; xxhdpi = 144; xxxhdpi = 192 }
$layer  = @{ ldpi = 81; mdpi = 108; hdpi = 162; xhdpi = 216; xxhdpi = 324; xxxhdpi = 432 }
foreach ($d in $legacy.Keys) {
  $dir = Join-Path $res "mipmap-$d"
  Make-Icon $legacy[$d] 0.78 $false (Join-Path $dir 'ic_launcher.png')
  Make-Icon $legacy[$d] 0.66 $true  (Join-Path $dir 'ic_launcher_round.png')
  $n = $layer[$d]
  # adaptive icon: a flat black background layer and the white logo on a transparent one
  $b, $g = New-Canvas $n $n $ink; $g.Dispose(); Save $b (Join-Path $dir 'ic_launcher_background.png')
  $b, $g = New-Canvas $n $n $null; Draw-Logo $g $white $n $n 0.84 0.8; $g.Dispose(); Save $b (Join-Path $dir 'ic_launcher_foreground.png')
}

# --- Android launch screens: the white logo on the page colour, same sizes as before ----------
Get-ChildItem $res -Recurse -Filter splash.png | ForEach-Object {
  $im = [System.Drawing.Image]::FromFile($_.FullName); $w = $im.Width; $h = $im.Height; $im.Dispose()
  $b, $g = New-Canvas $w $h $page
  Draw-Logo $g $white $w $h 0.56 0.3
  $g.Dispose(); Save $b $_.FullName
}

# --- Web: PWA icons, favicon, and the logo shown inside the app --------------------------------
Make-Icon 180 0.78 $false (Join-Path $pub 'icon-180.png')
Make-Icon 512 0.62 $false (Join-Path $pub 'icon-512.png')    # "maskable": kept inside the safe zone
Make-Icon 48  0.84 $false (Join-Path $pub 'favicon-48.png')
foreach ($v in @(@('white', $white), @('black', $black))) {
  $w = 720; $h = [int]($w * $v[1].Height / $v[1].Width)
  $b, $g = New-Canvas $w $h $null; $g.DrawImage($v[1], 0, 0, $w, $h); $g.Dispose()
  Save $b (Join-Path $pub ("logo-" + $v[0] + ".png"))
}
Write-Host 'Logo files written.'

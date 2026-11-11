Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$radius) {
    $d = $radius * 2
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function Save-PngResized([System.Drawing.Image]$source, [int]$targetSize, [string]$outPath) {
    $bmp = New-Object System.Drawing.Bitmap($targetSize, $targetSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($source, 0, 0, $targetSize, $targetSize)
    $g.Dispose()
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

function Write-MultiSizeIco([System.Drawing.Image]$source, [int[]]$sizes, [string]$icoPath) {
    $frames = @()
    foreach ($s in $sizes) {
        $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $g.DrawImage($source, 0, 0, $s, $s)
        $g.Dispose()
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        $frames += ,@{ Size = $s; Bytes = $ms.ToArray() }
        $ms.Dispose()
    }

    $fs = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    $bw = New-Object System.IO.BinaryWriter($fs)
    $bw.Write([uint16]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]$frames.Count)

    $offset = 6 + (16 * $frames.Count)
    foreach ($f in $frames) {
        $dim = if ($f.Size -ge 256) { [byte]0 } else { [byte]$f.Size }
        $bw.Write($dim)
        $bw.Write($dim)
        $bw.Write([byte]0)
        $bw.Write([byte]0)
        $bw.Write([uint16]1)
        $bw.Write([uint16]32)
        $bw.Write([uint32]$f.Bytes.Length)
        $bw.Write([uint32]$offset)
        $offset += $f.Bytes.Length
    }
    foreach ($f in $frames) {
        $bw.Write($f.Bytes)
    }
    $bw.Flush()
    $bw.Dispose()
    $fs.Dispose()
}

$size = 1024
$bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

# Pure black background
$graphics.Clear([System.Drawing.Color]::FromArgb(255, 0, 0, 0))

# Smooth radial glow behind the orange square with zero visible banding
$glowEllipse = New-Object System.Drawing.Drawing2D.GraphicsPath
$glowEllipse.AddEllipse(80, 96, 864, 864)
$glowBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($glowEllipse)
$glowBrush.CenterColor = [System.Drawing.Color]::FromArgb(85, 225, 73, 35)
$glowBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 225, 73, 35))
$glowBrush.SetSigmaBellShape(0.85, 1.0)
$graphics.FillPath($glowBrush, $glowEllipse)
$glowBrush.Dispose()
$glowEllipse.Dispose()

# Orange square badge matching Header.tsx (.aether-logo-mark: linear-gradient(145deg, #ff9a52, #e14923))
$badgeX = 182.0
$badgeY = 182.0
$badgeSize = 660.0
$badgeRadius = 156.0
$badgePath = New-RoundedRectPath $badgeX $badgeY $badgeSize $badgeSize $badgeRadius

$gradStart = [System.Drawing.PointF]::new([float]($badgeX - 4), [float]($badgeY - 4))
$gradEnd = [System.Drawing.PointF]::new([float]($badgeX + $badgeSize + 4), [float]($badgeY + $badgeSize + 4))
$badgeBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $gradStart,
    $gradEnd,
    [System.Drawing.Color]::FromArgb(255, 255, 154, 82),
    [System.Drawing.Color]::FromArgb(255, 225, 73, 35)
)
$badgeBrush.WrapMode = [System.Drawing.Drawing2D.WrapMode]::TileFlipXY
$graphics.FillPath($badgeBrush, $badgePath)
$badgeBrush.Dispose()

# Subtle soft glass inner border matching inset 0 1px rgba(255,255,255,.3)
$rimPath = New-RoundedRectPath ($badgeX + 3) ($badgeY + 3) ($badgeSize - 6) ($badgeSize - 6) ($badgeRadius - 3)
$rimPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(62, 255, 255, 255), 4)
$graphics.DrawPath($rimPen, $rimPath)
$rimPen.Dispose()
$rimPath.Dispose()
$badgePath.Dispose()

# White Lucide Monitor outline centered cleanly inside the orange badge
$whitePen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 34)
$whitePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$whitePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$whitePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

$screenPath = New-RoundedRectPath 348 384 328 214 28
$graphics.DrawPath($whitePen, $screenPath)
$screenPath.Dispose()

$graphics.DrawLine($whitePen, 512, 600, 512, 666)
$graphics.DrawLine($whitePen, 444, 666, 580, 666)
$whitePen.Dispose()

$hostIcon = Join-Path $PSScriptRoot 'icon.png'
$bitmap.Save($hostIcon, [System.Drawing.Imaging.ImageFormat]::Png)

$icoPath = Join-Path $PSScriptRoot 'icon.ico'
Write-MultiSizeIco $bitmap @(256, 128, 64, 48, 32, 16) $icoPath

$mobileRes = Resolve-Path (Join-Path $PSScriptRoot '..\..\aether-remote-mobile\app\src\main\res')
$androidDrawableIcon = Join-Path $mobileRes 'drawable-nodpi\aether_remote_icon.png'
Save-PngResized $bitmap 512 $androidDrawableIcon

$graphics.Dispose()
$bitmap.Dispose()

$ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
$targets = @{
    'mipmap-mdpi' = 48
    'mipmap-hdpi' = 72
    'mipmap-xhdpi' = 96
    'mipmap-xxhdpi' = 144
    'mipmap-xxxhdpi' = 192
}
foreach ($entry in $targets.GetEnumerator()) {
    $directory = Join-Path $mobileRes $entry.Key
    $pixels = $entry.Value
    & $ffmpeg -hide_banner -loglevel error -y -i $hostIcon -vf "scale=${pixels}:${pixels}" (Join-Path $directory 'ic_launcher.webp')
    & $ffmpeg -hide_banner -loglevel error -y -i $hostIcon -vf "scale=${pixels}:${pixels}" (Join-Path $directory 'ic_launcher_round.webp')
}

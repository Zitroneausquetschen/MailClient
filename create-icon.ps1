Add-Type -AssemblyName System.Drawing

$bmp = New-Object System.Drawing.Bitmap(1024, 1024)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# Background - Blue gradient
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point(1024, 1024)),
    [System.Drawing.Color]::FromArgb(59, 130, 246),
    [System.Drawing.Color]::FromArgb(37, 99, 235)
)
$g.FillRectangle($brush, 0, 0, 1024, 1024)

# Draw envelope icon
$whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 40)

# Envelope body
$rect = New-Object System.Drawing.Rectangle(150, 300, 724, 450)
$g.FillRectangle($whiteBrush, $rect)

# Envelope flap (triangle)
$points = @(
    (New-Object System.Drawing.Point(150, 300)),
    (New-Object System.Drawing.Point(512, 550)),
    (New-Object System.Drawing.Point(874, 300))
)
$blueBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(37, 99, 235))
$g.FillPolygon($blueBrush, $points)

$bmp.Save("app-icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()

Write-Host "Icon created successfully"

Add-Type -AssemblyName System.Drawing

function New-MemoryLanesIcon {
    param(
        [Parameter(Mandatory = $true)][int]$Size,
        [Parameter(Mandatory = $true)][string]$OutputPath
    )

    $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $greenBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#176b3a'))
    $whiteBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
    $mintBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#d8f3df'))
    $mPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $lPath = [System.Drawing.Drawing2D.GraphicsPath]::new()

    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.FillRectangle($greenBrush, 0, 0, $Size, $Size)
        $scale = [single]($Size / 512.0)
        $graphics.ScaleTransform($scale, $scale)

        [System.Drawing.PointF[]]$mPoints = @(
            [System.Drawing.PointF]::new(105, 350),
            [System.Drawing.PointF]::new(105, 157),
            [System.Drawing.PointF]::new(153, 157),
            [System.Drawing.PointF]::new(213, 258),
            [System.Drawing.PointF]::new(273, 157),
            [System.Drawing.PointF]::new(321, 157),
            [System.Drawing.PointF]::new(321, 350),
            [System.Drawing.PointF]::new(272, 350),
            [System.Drawing.PointF]::new(272, 233),
            [System.Drawing.PointF]::new(214, 327),
            [System.Drawing.PointF]::new(210, 327),
            [System.Drawing.PointF]::new(153, 233),
            [System.Drawing.PointF]::new(153, 350)
        )
        $mPath.AddPolygon($mPoints)

        [System.Drawing.PointF[]]$lPoints = @(
            [System.Drawing.PointF]::new(340, 157),
            [System.Drawing.PointF]::new(390, 157),
            [System.Drawing.PointF]::new(390, 304),
            [System.Drawing.PointF]::new(461, 304),
            [System.Drawing.PointF]::new(461, 350),
            [System.Drawing.PointF]::new(340, 350)
        )
        $lPath.AddPolygon($lPoints)

        $graphics.FillPath($whiteBrush, $mPath)
        $graphics.FillPath($mintBrush, $lPath)
        $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $lPath.Dispose()
        $mPath.Dispose()
        $mintBrush.Dispose()
        $whiteBrush.Dispose()
        $greenBrush.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

New-MemoryLanesIcon -Size 180 -OutputPath (Join-Path $PSScriptRoot 'icon-180.png')
New-MemoryLanesIcon -Size 192 -OutputPath (Join-Path $PSScriptRoot 'icon-192.png')
New-MemoryLanesIcon -Size 512 -OutputPath (Join-Path $PSScriptRoot 'icon-512.png')

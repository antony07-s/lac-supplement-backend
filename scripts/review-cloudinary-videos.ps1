param(
  [string]$InventoryPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'videos-inventory.csv'),
  [string]$OutputRoot = (Join-Path (Split-Path $PSScriptRoot -Parent) 'video-review')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$assets = @(Import-Csv -LiteralPath $InventoryPath | Where-Object { $_.asset_folder -eq 'ayusydah-products/videos' })
$frameRoot = Join-Path $OutputRoot 'frames'
$sheetRoot = Join-Path $OutputRoot 'contact-sheets'
New-Item -ItemType Directory -Force -Path $frameRoot, $sheetRoot | Out-Null

$reviewRows = [System.Collections.Generic.List[object]]::new()
for ($i = 0; $i -lt $assets.Count; $i++) {
  $asset = $assets[$i]
  $number = $i + 1
  $frameName = '{0:D3}.jpg' -f $number
  $framePath = Join-Path $frameRoot $frameName
  $frameUrl = $asset.secure_url -replace '/video/upload/(v\d+/)', '/video/upload/so_2,w_480/$1'
  $frameUrl = $frameUrl -replace '\.(mp4|webm|mov)$', '.jpg'

  try {
    Invoke-WebRequest -Uri $frameUrl -OutFile $framePath -TimeoutSec 45 -UseBasicParsing
    $reviewRows.Add([pscustomobject]@{ number = $number; public_id = $asset.public_id; secure_url = $asset.secure_url; frame = $frameName; frame_status = 'ok' })
  } catch {
    if (Test-Path -LiteralPath $framePath) { Remove-Item -LiteralPath $framePath -Force }
    $reviewRows.Add([pscustomobject]@{ number = $number; public_id = $asset.public_id; secure_url = $asset.secure_url; frame = ''; frame_status = 'failed' })
  }
}

$reviewRows | Export-Csv -LiteralPath (Join-Path $OutputRoot 'review-index.csv') -NoTypeInformation -Encoding UTF8

$font = [System.Drawing.Font]::new('Arial', 13, [System.Drawing.FontStyle]::Bold)
$brush = [System.Drawing.Brushes]::Black
$cols = 5
$tileWidth = 320
$imageHeight = 180
$labelHeight = 46
$perSheet = 10
$sheetNumber = 0

for ($offset = 0; $offset -lt $reviewRows.Count; $offset += $perSheet) {
  $sheetNumber++
  $batch = @($reviewRows | Select-Object -Skip $offset -First $perSheet)
  $rows = [Math]::Ceiling($batch.Count / $cols)
  $bitmap = [System.Drawing.Bitmap]::new($cols * $tileWidth, $rows * ($imageHeight + $labelHeight))
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::White)

  for ($j = 0; $j -lt $batch.Count; $j++) {
    $entry = $batch[$j]
    $x = ($j % $cols) * $tileWidth
    $y = [Math]::Floor($j / $cols) * ($imageHeight + $labelHeight)
    if ($entry.frame_status -eq 'ok') {
      $image = [System.Drawing.Image]::FromFile((Join-Path $frameRoot $entry.frame))
      $graphics.DrawImage($image, $x, $y, $tileWidth, $imageHeight)
      $image.Dispose()
    }
    $label = '{0:D3}  {1}' -f $entry.number, $entry.public_id
    $graphics.DrawString($label, $font, $brush, [System.Drawing.RectangleF]::new($x + 4, $y + $imageHeight + 3, $tileWidth - 8, $labelHeight - 4)) | Out-Null
  }

  $sheetPath = Join-Path $sheetRoot ('videos-{0:D2}.jpg' -f $sheetNumber)
  $bitmap.Save($sheetPath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $graphics.Dispose()
  $bitmap.Dispose()
}

$failed = @($reviewRows | Where-Object frame_status -ne 'ok').Count
Write-Output "Videos reviewed: $($assets.Count); frames saved: $($assets.Count - $failed); frame failures: $failed; contact sheets: $sheetNumber."

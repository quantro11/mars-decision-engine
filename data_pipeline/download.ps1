# Downloads the raw NASA / PSI datasets used by the Mars Base Decision Engine.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File download.ps1
#
# 1) MOLA elevation  - NASA Mars Trek WMTS, 8-bit MOLA DEM (Mars_MGS_MOLA_DEM_mosaic_global_463m_8)
#                      zoom 4 = 32 x 16 tiles x 256 px = 8192 x 4096 px (~2.6 km/px)
# 2) SWIM 2.0        - Subsurface Water Ice Mapping, global composite ice-consistency GeoTIFFs (PSI / NASA)
#                      swim.psi.edu/output/SWIM2/Global/Composite/

$raw = Join-Path $PSScriptRoot "raw"
New-Item -ItemType Directory -Force "$raw\mola_z4" | Out-Null

$ok = 0; $fail = 0
for ($y = 0; $y -lt 16; $y++) {
  for ($x = 0; $x -lt 32; $x++) {
    $f = "$raw\mola_z4\${y}_${x}.png"
    if (Test-Path $f) { $ok++; continue }
    $u = "https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_DEM_mosaic_global_463m_8/1.0.0/default/default028mm/4/$y/$x.png"
    try { Invoke-WebRequest -Uri $u -OutFile $f -TimeoutSec 60 -UseBasicParsing; $ok++ } catch { $fail++; Write-Host "FAIL $u" }
  }
}
Write-Host "MOLA tiles: ok=$ok fail=$fail"

$wc = New-Object System.Net.WebClient
foreach ($f in @("SWIM2_c0_1.tif", "SWIM2_c1_5.tif", "SWIM2_c_5.tif")) {
  $u = "https://swim.psi.edu/output/SWIM2/Global/Composite/$f"
  $h = Invoke-WebRequest -Uri $u -Method Head -TimeoutSec 60 -UseBasicParsing
  $cl = [int64]$h.Headers['Content-Length']
  $dest = "$raw\$f"
  if ((Test-Path $dest) -and ((Get-Item $dest).Length -eq $cl)) { Write-Host "$f already complete"; continue }
  $wc.DownloadFile($u, $dest)
  Write-Host "$f -> $((Get-Item $dest).Length) bytes (server $cl)"
}
# 3) TES thermal inertia + dust abundance - ASU JMARS WMS (numeric VICAR). PowerShell's HTTP stack rejects this
#    server's response headers, so the fetch is done with Python.
python -I (Join-Path $PSScriptRoot "download_tes.py")
# 4) NASA Viking Orbiter MDIM 2.1 Colorized Global Mosaic (Mars Trek WMTS zoom 3 = 4096x2048 px)
python -I (Join-Path $PSScriptRoot "download_viking.py")
Write-Host "Done. Now run:  python preprocess.py"

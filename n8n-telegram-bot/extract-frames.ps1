# Extracts up to 5 evenly-spaced frames from a video (or single photo),
# base64-encodes them, prints one JSON line: {"frames":[...],"count":N}
# Used by the n8n Driftpost bot (Execute Command node) so Grok can SEE the video.
param(
  [Parameter(Mandatory = $true)][string]$Video,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string]$Ffmpeg = "ffmpeg",
  [int]$Count = 5
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $Video)) { throw "Video not found: $Video" }
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$frames = @()
try {
  $pattern = Join-Path $OutDir "vf_%02d.jpg"
  # 1 frame every 6s (short videos yield fewer), max $Count, 768px wide.
  & $Ffmpeg -y -loglevel error -i $Video -vf "fps=1/6,scale=768:-1" -vframes $Count $pattern
  $jpgs = Get-ChildItem -LiteralPath $OutDir -Filter "vf_*.jpg" | Sort-Object Name | Select-Object -First $Count
  foreach ($j in $jpgs) {
    $bytes = [System.IO.File]::ReadAllBytes($j.FullName)
    # Skip tiny/corrupt frames; keep each under ~350KB for the API.
    if ($bytes.Length -gt 2000 -and $bytes.Length -lt 400000) {
      $frames += [System.Convert]::ToBase64String($bytes)
    }
    Remove-Item -LiteralPath $j.FullName -Force -ErrorAction SilentlyContinue
  }
} catch {
  $frames = @()
}
@{ frames = $frames; count = $frames.Count } | ConvertTo-Json -Compress -Depth 3

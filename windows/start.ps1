# Start the game (if it isn't already running) and open it in the browser.
. "$PSScriptRoot\common.ps1"
$Host.UI.RawUI.WindowTitle = "Dungeon Master"
Set-Location $Root

$url = Game-Url
if (Test-Url "$url/api/session") {
  Say "The game is already running. Opening it..."
  Start-Process $url
  Start-Sleep -Seconds 2
  exit 0
}

try {
  Ensure-Ollama
  if (-not (Test-Path (Join-Path $Root "dist\client"))) {
    Say "Building the game (first time only)..."
    Run npm.cmd run build
  }
} catch {
  Fail $_.Exception.Message
}

# Open the browser once the server answers, while this window shows the server's output.
Start-Job -ArgumentList $url -ScriptBlock {
  param($url)
  for ($i = 0; $i -lt 120; $i++) {
    try { Invoke-WebRequest "$url/api/session" -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process $url; return } catch { Start-Sleep -Seconds 1 }
  }
} | Out-Null

Write-Host ""
Write-Host "  Leave this window open while you play." -ForegroundColor Green
Write-Host "  Close it to stop the game." -ForegroundColor Green
Write-Host ""
# A marker left by an interrupted update would otherwise hide real crashes below.
Remove-Item -Force $UpdatingMarker -ErrorAction SilentlyContinue
npm.cmd start
if (Test-Path $UpdatingMarker) { exit 0 }
if ($LASTEXITCODE -ne 0) { Fail "The game stopped unexpectedly." }

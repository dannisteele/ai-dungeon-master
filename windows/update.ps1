# Check GitHub for a newer version; if there is one, install it and restart the game.
. "$PSScriptRoot\common.ps1"
$Host.UI.RawUI.WindowTitle = "Check for Updates"
Set-Location $Root

try {
  Say "Checking for updates..."
  Run git fetch --quiet
  $behind = [int](git rev-list --count "HEAD..@{u}")
  if ($LASTEXITCODE -ne 0) { throw "Couldn't compare with GitHub." }
} catch {
  Fail $_.Exception.Message
}

if ($behind -eq 0) {
  Write-Host ""
  Write-Host "You're up to date!" -ForegroundColor Green
  Read-Host "Press Enter to close"
  exit 0
}

Write-Host ""
Write-Host "What's new:" -ForegroundColor Green
git --no-pager log --no-merges --format="  - %s" "HEAD..@{u}"
Write-Host ""
$answer = Read-Host "Install now? This closes the game, so finish your round first (y/n)"
if ($answer -notmatch "^\s*y") { Write-Host "OK, maybe later."; Start-Sleep -Seconds 2; exit 0 }

# Stop the running game: whatever listens on its port, then anything else running from the
# game folder (e.g. esbuild.exe), since Windows won't let npm replace a running program.
New-Item -ItemType File -Force $UpdatingMarker | Out-Null
$port = [int](Env-Value "PORT" "3000")
Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
$leftovers = @(Get-Process | Where-Object { $_.Path -and $_.Path -like "$Root\*" })
$leftovers | Stop-Process -Force -ErrorAction SilentlyContinue
$leftovers | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue

# npm ci, retried once in case Windows still had a file locked. --ignore-scripts stops newer
# npm from compiling better-sqlite3, which ships ready-made Windows builds (see setup.ps1).
function Install {
  try { Run npm.cmd ci --ignore-scripts --no-audit --no-fund } catch { Start-Sleep -Seconds 3; Run npm.cmd ci --ignore-scripts --no-audit --no-fund }
}

$before = (git rev-parse HEAD).Trim()
try {
  Say "Downloading the update..."
  Run git pull --ff-only --quiet
  Say "Installing..."
  Install
  Say "Building..."
  Run npm.cmd run build
} catch {
  $problem = $_.Exception.Message
  Say "That didn't work. Putting the old version back..."
  try {
    Run git reset --hard --quiet $before
    Install
    Run npm.cmd run build
    Remove-Item -Force $UpdatingMarker -ErrorAction SilentlyContinue
    Start-Process (Join-Path $PSScriptRoot "Start Dungeon Master.bat")
    Fail "The update didn't install ($problem). The old version is back and starting."
  } catch {
    Remove-Item -Force $UpdatingMarker -ErrorAction SilentlyContinue
    Fail "The update didn't install ($problem), and putting the old version back failed too ($($_.Exception.Message))."
  }
}
Remove-Item -Force $UpdatingMarker -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Updated! Starting the game..." -ForegroundColor Green
Start-Process (Join-Path $PSScriptRoot "Start Dungeon Master.bat")
Start-Sleep -Seconds 2

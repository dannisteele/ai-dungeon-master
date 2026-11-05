# Check GitHub for a newer release; if there is one, back up the saves, install it and
# restart the game. Runs in two halves: this copy moves to the new release, then hands over
# to that release's update.ps1 (with -AfterPull) to install it, so a fix to the install steps
# themselves takes effect in the same update.
param([string]$AfterPull)

. "$PSScriptRoot\common.ps1"
$Host.UI.RawUI.WindowTitle = "Check for Updates"
Set-Location $Root

# Plain release tags (v1.2.3), newest first.
function Release-Tags { @(git tag --list "v*" --sort=-v:refname | Where-Object { $_ -match "^v\d+\.\d+\.\d+$" }) }
function As-Version($tag) { [version]($tag -replace "^v", "") }

# Release notes for each tag newer than $current, oldest first, from GitHub.
function Show-Notes($tags) {
  $repo = (git remote get-url origin) -replace "^.*github\.com[:/]", "" -replace "\.git$", ""
  $releases = $null
  # curl's output is UTF-8; without this, 5.1 decodes it in the console code page.
  $previous = [Console]::OutputEncoding
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  try {
    $json = curl.exe --silent --fail --max-time 10 --noproxy "*" -H "User-Agent: ai-dungeon-master" "https://api.github.com/repos/$repo/releases?per_page=50"
    if ($LASTEXITCODE -eq 0) { $releases = $json | Out-String | ConvertFrom-Json }
  } catch { } finally { [Console]::OutputEncoding = $previous }
  foreach ($tag in $tags) {
    Write-Host ""
    Write-Host "  $tag" -ForegroundColor Green
    $release = $releases | Where-Object { $_.tag_name -eq $tag } | Select-Object -First 1
    if (-not $release) { Write-Host "    (couldn't fetch the notes for this one)"; continue }
    foreach ($line in ($release.body -split "`r?`n")) {
      if ($line.Trim() -eq "") { continue }
      Write-Host "    $($line -replace '^###\s*', '')"
    }
  }
}

# Copy the saves (database plus its WAL files) to data\backups\<time> <version>, keep the newest 10.
function Backup-Saves($label) {
  $db = Env-Value "DB_PATH" "./data/game.sqlite"
  if (-not [IO.Path]::IsPathRooted($db)) { $db = [IO.Path]::GetFullPath((Join-Path $Root $db)) }
  if (-not (Test-Path $db)) { return $null }
  $backups = Join-Path (Split-Path -Parent $db) "backups"
  $dest = Join-Path $backups "$(Get-Date -Format 'yyyy-MM-dd HHmm') $label"
  New-Item -ItemType Directory -Force $dest | Out-Null
  foreach ($suffix in "", "-wal", "-shm") {
    if (Test-Path "$db$suffix") { Copy-Item "$db$suffix" $dest }
  }
  Get-ChildItem $backups -Directory | Sort-Object Name -Descending | Select-Object -Skip 10 | Remove-Item -Recurse -Force
  return $dest
}

if (-not $AfterPull) {
  try {
    Say "Checking for updates..."
    Run git fetch --quiet --tags --force
    $tags = Release-Tags
    if ($tags.Count -eq 0) { throw "No releases found on GitHub." }
    $latest = $tags[0]
  } catch {
    Fail $_.Exception.Message
  }

  git merge-base --is-ancestor $latest HEAD
  if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "You're up to date! ($latest)" -ForegroundColor Green
    Read-Host "Press Enter to close"
    exit 0
  }

  # Which releases she's missing: everything newer than the release this copy is on.
  $current = Quiet git describe --tags --abbrev=0 --match "v[0-9]*" --exclude "*-*"
  $missing = @($tags | Where-Object { -not $current -or (As-Version $_) -gt (As-Version $current) })
  [array]::Reverse($missing)

  Write-Host ""
  if ($current) { Write-Host "You have $current. What's new since then:" -ForegroundColor Green }
  else { Write-Host "What's new:" -ForegroundColor Green }
  Show-Notes $missing
  Write-Host ""
  $answer = Read-Host "Install $latest now? This closes the game, so finish your round first (y/n)"
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

  $before = (git rev-parse HEAD).Trim()
  try {
    $backup = Backup-Saves $(if ($current) { "before $latest (was $current)" } else { "before $latest" })
    if ($backup) { Say "Saved a copy of your games in $backup" }
    Say "Downloading $latest..."
    Run git merge --ff-only --quiet $latest
  } catch {
    Remove-Item -Force $UpdatingMarker -ErrorAction SilentlyContinue
    Start-Process (Join-Path $PSScriptRoot "Start Dungeon Master.bat")
    Fail "Couldn't update ($($_.Exception.Message)). Nothing was changed; the game is starting again."
  }

  # Hand over to the new copy of this script for the install.
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "update.ps1") -AfterPull $before
  exit $LASTEXITCODE
}

# Second half: install what was just downloaded, or roll back to $AfterPull.

# npm ci, retried once in case Windows still had a file locked. --ignore-scripts stops newer
# npm from compiling better-sqlite3, which ships ready-made Windows builds (see setup.ps1).
function Install {
  try { Run npm.cmd ci --ignore-scripts --no-audit --no-fund } catch { Start-Sleep -Seconds 3; Run npm.cmd ci --ignore-scripts --no-audit --no-fund }
}

try {
  Say "Installing..."
  Install
  Say "Building..."
  Run npm.cmd run build
} catch {
  $problem = $_.Exception.Message
  Say "That didn't work. Putting the old version back..."
  try {
    Run git reset --hard --quiet $AfterPull
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
Write-Host "Updated to $(git describe --tags --match 'v[0-9]*' --exclude '*-*')! Starting the game..." -ForegroundColor Green
if ($env:DM_UPDATE_NO_START) { exit 0 }  # CI (.github/scripts/windows-check.ps1) has no Ollama to start
Start-Process (Join-Path $PSScriptRoot "Start Dungeon Master.bat")
Start-Sleep -Seconds 2

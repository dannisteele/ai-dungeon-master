# One-time setup on a Windows laptop: installs Node, Git and Ollama, downloads the game,
# asks for the table password, downloads the AI model(s) and adds desktop shortcuts.
# Safe to run again: it skips whatever is already done.
# Self-contained (no common.ps1) because it may be run before the game is downloaded.
# npm is called as npm.cmd: npm.ps1 rebuilds its arguments from the caller's source text.
# npm ci runs with --ignore-scripts; see the install step for why.

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "Dungeon Master setup"
$RepoUrl = "https://github.com/dannisteele/ai-dungeon-master.git"

function Say($text) { Write-Host ""; Write-Host $text -ForegroundColor Yellow }
# The .bat launcher pauses after a failure, so the message stays on screen.
function Fail($text) {
  Write-Host ""
  Write-Host $text -ForegroundColor Red
  Write-Host "Setup stopped. Take a photo of this window and send it to Daniella." -ForegroundColor Red
  exit 1
}
function Run($exe) {
  & $exe @args
  if ($LASTEXITCODE -ne 0) { throw "$exe $($args -join ' ') failed (exit code $LASTEXITCODE)" }
}
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Node-Major { if (Has "node") { [int]((node --version) -replace "^v(\d+).*", '$1') } else { 0 } }
# Windows Installer holds this mutex while any install runs (Windows Update, another app, or an
# earlier attempt that never finished). A second install then waits forever or fails with 1618.
function Installer-Busy {
  try { [Threading.Mutex]::OpenExisting("Global\_MSIExecute").Dispose(); return $true }
  catch [Threading.WaitHandleCannotBeOpenedException] { return $false }
  catch { return $true } # it exists, we just may not open it
}
$BusyMessage = "Windows is busy installing something else (maybe Windows Update, or an earlier attempt that got stuck). Restart the laptop, then run this again."
function Winget-Install($id, $name) {
  if (Installer-Busy) { Fail $BusyMessage }
  Say "Installing $name (a window may ask for permission: click Yes)..."
  # winget exits non-zero when the package is already installed; the checks afterwards decide.
  # Give up rather than spin forever if the installer gets stuck waiting on something.
  $p = Start-Process winget -NoNewWindow -PassThru -ArgumentList "install --id $id --exact --silent --accept-source-agreements --accept-package-agreements"
  if (-not $p.WaitForExit(20 * 60 * 1000)) {
    Fail "Installing $name is taking too long, so it may be stuck. Restart the laptop and run this again. If it sticks again, install $name yourself from its website, then run this again."
  }
  Refresh-Path
}
# Is something answering at this address? Uses curl.exe (built into Windows 10/11) rather than
# Invoke-WebRequest, which VPN/security software can block from reaching localhost, and skips
# any proxy for the same reason.
function Test-Url($url) {
  curl.exe --silent --fail --output NUL --max-time 2 --noproxy "*" $url
  return ($LASTEXITCODE -eq 0)
}
# Node's .env reader: UTF-8 without a byte-order mark (a BOM would corrupt the first name).
function Write-EnvFile($file, $values) {
  $lines = @(Get-Content (Join-Path $Root ".env.example")) | ForEach-Object {
    if ($_ -match "^\s*([A-Z_]+)\s*=" -and $values.ContainsKey($Matches[1])) { "$($Matches[1])=`"$($values[$Matches[1]])`"" } else { $_ }
  }
  [IO.File]::WriteAllText($file, ($lines -join "`n") + "`n", (New-Object Text.UTF8Encoding $false))
}

try {
  Write-Host "Setting up the AI Dungeon Master. This can take a while the first time." -ForegroundColor Green

  # 1. Tools
  if (-not (Has "winget")) {
    Fail "This needs the 'App Installer' from the Microsoft Store. Install it, then run this again."
  }
  if ((Node-Major) -lt 24) { Winget-Install "OpenJS.NodeJS.LTS" "Node.js" }
  if (-not (Has "git")) { Winget-Install "Git.Git" "Git" }
  if (-not (Has "ollama")) { Winget-Install "Ollama.Ollama" "Ollama" }
  foreach ($cmd in "node", "npm.cmd", "git", "ollama") {
    if (-not (Has $cmd)) { Fail "$cmd didn't install properly. Restart the laptop and run this again." }
  }
  if ((Node-Major) -lt 24) {
    if (Installer-Busy) { Fail $BusyMessage }
    Fail "An older Node.js ($(node --version)) is installed and couldn't be upgraded; the game needs version 24 or newer. Restart the laptop and run this again. If you see this again, uninstall Node.js from Settings > Apps, then run this again."
  }

  # 2. The game itself: use this copy if setup is running from inside one, else download it.
  $here = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { "" }
  if ($here -and (Test-Path (Join-Path $here "package.json"))) {
    $Root = $here
  } else {
    $Root = Join-Path $env:USERPROFILE "ai-dungeon-master"
    if (Test-Path (Join-Path $Root ".git")) {
      Say "Getting the latest version of the game..."
      Run git -C $Root pull --ff-only --quiet
    } else {
      Say "Downloading the game..."
      Run git clone --quiet $RepoUrl $Root
    }
  }
  Set-Location $Root

  Say "Installing the game's parts..."
  # --ignore-scripts: better-sqlite3 ships ready-made Windows builds, but newer npm versions
  # try to compile it anyway, which needs Python and Visual Studio. Nothing else needs scripts.
  Run npm.cmd ci --ignore-scripts --no-audit --no-fund
  Say "Building the game..."
  Run npm.cmd run build

  # 3. Settings. Bigger model only if the laptop has the memory for it.
  $ramGb = [math]::Round(((Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum).Sum) / 1GB)
  $bigModel = $ramGb -ge 32
  $envFile = Join-Path $Root ".env"
  if (-not (Test-Path $envFile)) {
    Say "Choose a password for the game (anyone joining from a phone will need it)."
    $password = ""
    while ($true) {
      $password = (Read-Host "Table password").Trim()
      if ($password -eq "") { continue }
      if ($password.Contains('"')) { Write-Host "Please leave out double quotes." -ForegroundColor Red; continue }
      break
    }
    Say "Feedback button: paste the GitHub token Daniella gave you, or just press Enter to skip."
    $token = (Read-Host "GitHub token").Trim()
    # Written only once every answer is in, so quitting halfway leaves no half-made file.
    $values = @{ TABLE_PASSWORD = $password; OLLAMA_MODEL = $(if ($bigModel) { "qwen3.6:27b" } else { "qwen3.5:9b" }) }
    if ($token -ne "") { $values.GITHUB_TOKEN = $token }
    Write-EnvFile $envFile $values
  }

  # 4. The AI model(s)
  if (-not (Test-Url "http://localhost:11434/api/tags")) {
    # No window: CreateNoWindow means no console for Windows Terminal to show (see common.ps1).
    $psi = New-Object System.Diagnostics.ProcessStartInfo (Get-Command ollama).Source, "serve"
    $psi.CreateNoWindow = $true
    $psi.UseShellExecute = $false
    [System.Diagnostics.Process]::Start($psi) | Out-Null
    for ($i = 0; $i -lt 30 -and -not (Test-Url "http://localhost:11434/api/tags"); $i++) { Start-Sleep -Seconds 1 }
  }
  Say "Downloading the Dungeon Master's brain (about 7 GB)..."
  Run ollama pull qwen3.5:9b
  if ($bigModel) {
    Say "This laptop has $ramGb GB of memory, so also downloading the bigger brain (about 17 GB)..."
    Run ollama pull qwen3.6:27b
  }

  # 5. Desktop shortcuts
  $desktop = [Environment]::GetFolderPath("Desktop")
  $shell = New-Object -ComObject WScript.Shell
  $icon = Join-Path $Root "windows\dungeon-master.ico"
  foreach ($s in @(@("Dungeon Master", "Start Dungeon Master.bat"), @("Check for Updates", "Check for Updates.bat"))) {
    $link = $shell.CreateShortcut((Join-Path $desktop "$($s[0]).lnk"))
    $link.TargetPath = Join-Path $Root "windows\$($s[1])"
    $link.WorkingDirectory = Join-Path $Root "windows"
    $link.IconLocation = $icon
    $link.Save()
  }
} catch {
  Fail $_.Exception.Message
}

Write-Host ""
Write-Host "All done! Double-click 'Dungeon Master' on the desktop to play." -ForegroundColor Green
Write-Host "The first time, Windows may ask whether to allow it on the network: click Allow." -ForegroundColor Green
Read-Host "Press Enter to close"

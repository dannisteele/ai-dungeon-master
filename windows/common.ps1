# Shared helpers for the Windows scripts. Kept ASCII-only: Windows PowerShell 5.1 reads
# scripts without a byte-order mark as the local code page.
# npm is always called as npm.cmd: npm.ps1 rebuilds its arguments from the calling line's
# source text, which breaks when it's called through a helper like Run.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

function Say($text) { Write-Host $text -ForegroundColor Yellow }

# The .bat launcher pauses after a failure, so the message stays on screen.
function Fail($text) {
  Write-Host ""
  Write-Host $text -ForegroundColor Red
  Write-Host "Something went wrong. Take a photo of this window and send it to Daniella." -ForegroundColor Red
  exit 1
}

# Run a program and stop if it fails (PowerShell doesn't on its own for programs).
function Run($exe) {
  & $exe @args
  if ($LASTEXITCODE -ne 0) { throw "$exe $($args -join ' ') failed (exit code $LASTEXITCODE)" }
}

# Run a program and return its output, ignoring its error messages and failure. (Writing
# 2>$null directly would turn any error message into a crash under ErrorActionPreference Stop.)
function Quiet($exe) {
  $ErrorActionPreference = "Continue"
  & $exe @args 2>$null
}

# A value from .env, or the fallback.
function Env-Value($name, $fallback) {
  $file = Join-Path $Root ".env"
  if (Test-Path $file) {
    foreach ($line in Get-Content $file) {
      if ($line -match "^\s*$name\s*=\s*`"?(.*?)`"?\s*$" -and $Matches[1] -ne "") { return $Matches[1] }
    }
  }
  return $fallback
}

# Is something answering at this address? Uses curl.exe (built into Windows 10/11) rather than
# Invoke-WebRequest, which VPN/security software can block from reaching localhost, and skips
# any proxy for the same reason.
function Test-Url($url) {
  curl.exe --silent --fail --output NUL --max-time 2 --noproxy "*" $url
  return ($LASTEXITCODE -eq 0)
}

# Start Ollama if it isn't answering yet. Prefer the tray app: a hidden console
# program can still pop up as a Windows Terminal tab, and closing that stops Ollama.
function Ensure-Ollama {
  $url = (Env-Value "OLLAMA_URL" "http://localhost:11434").TrimEnd("/")
  if (Test-Url "$url/api/tags") { return }
  if ($url -notmatch "localhost|127\.0\.0\.1") { Fail "Can't reach Ollama at $url. Is that computer switched on?" }
  Say "Waking up Ollama..."
  $app = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama app.exe"
  if (Test-Path $app) { Start-Process $app } else { Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden }
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Url "$url/api/tags") { return }
  }
  Fail "Ollama didn't start. Try opening the Ollama app from the Start menu, then run this again."
}

function Game-Url { "http://localhost:$(Env-Value 'PORT' '3000')" }

# Present while an update is replacing the game, so the game window knows its
# server was stopped on purpose and closes quietly.
$UpdatingMarker = Join-Path $Root ".updating"

# CI checks for the Windows player scripts, run under Windows PowerShell 5.1 after the
# game has been installed and built. Exits non-zero on the first failure.

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$failures = 0
function Check($name, [scriptblock]$test) {
  try {
    $ok = & $test
    if ($ok -eq $false) { throw "returned false" }
    Write-Host "ok   $name"
  } catch {
    Write-Host "FAIL $name : $($_.Exception.Message)"
    $script:failures++
  }
}

# 1. Every script parses, and is ASCII (5.1 reads BOM-less files in the local code page).
foreach ($file in Get-ChildItem "$repo\windows\*.ps1") {
  Check "parses: $($file.Name)" {
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$null, [ref]$errors) | Out-Null
    if ($errors) { throw ($errors | ForEach-Object { "line $($_.Extent.StartLineNumber): $($_.Message)" }) -join "; " }
  }
  Check "ascii: $($file.Name)" { -not ([IO.File]::ReadAllBytes($file.FullName) | Where-Object { $_ -gt 127 }) }
}
foreach ($file in Get-ChildItem "$repo\windows\*.bat") {
  Check "crlf: $($file.Name)" { ([IO.File]::ReadAllText($file.FullName) -replace "`r`n", "") -notmatch "`n" }
}

# 2. The shared helpers, with a .env like the one setup.ps1 writes.
$envFile = Join-Path $repo ".env"
[IO.File]::WriteAllText($envFile, "TABLE_PASSWORD=`"pa#ss word`"`nPORT=3999`n", (New-Object Text.UTF8Encoding $false))
. "$repo\windows\common.ps1"
$ErrorActionPreference = "Stop"
Check "Root is the repo" { $Root -eq $repo }
Check "Env-Value reads quoted values" { (Env-Value "TABLE_PASSWORD" "") -eq "pa#ss word" }
Check "Env-Value falls back" { (Env-Value "NOT_SET" "dflt") -eq "dflt" }
Check "Game-Url uses PORT" { (Game-Url) -eq "http://localhost:3999" }
Check "Run passes -- arguments to npm.cmd" { (Run npm.cmd --version) -match "^\d+\." }
Check "Run throws on failure" { try { Run git definitely-not-a-command 2>$null; $false } catch { $true } }
Check "Test-Url is false when nothing listens" { -not (Test-Url "http://localhost:3999/api/session") }

# 3. The game starts the way start.ps1 starts it, and Test-Url sees it.
$server = Start-Process npm.cmd -ArgumentList "start" -WorkingDirectory $repo -PassThru -WindowStyle Hidden
try {
  $up = $false
  for ($i = 0; $i -lt 60 -and -not $up; $i++) { Start-Sleep -Seconds 1; $up = Test-Url "$(Game-Url)/api/session" }
  Check "server answers on PORT from .env" { $up }
  Check "password from .env is accepted" {
    $body = '{"password":"pa#ss word"}'
    $r = Invoke-RestMethod "$(Game-Url)/api/login" -Method Post -ContentType "application/json" -Body $body
    $r.ok -eq $true
  }
} finally {
  # Stop it the way update.ps1 does: the process on the port, then anything from the repo.
  Get-NetTCPConnection -LocalPort 3999 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Get-Process | Where-Object { $_.Path -and $_.Path -like "$repo\*" } | Stop-Process -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  Remove-Item $envFile -Force
}
Check "update.ps1-style stop leaves the port free" {
  Start-Sleep -Seconds 2
  -not (Get-NetTCPConnection -LocalPort 3999 -State Listen -ErrorAction SilentlyContinue)
}

if ($failures) { Write-Host "$failures check(s) failed"; exit 1 }
Write-Host "All Windows checks passed"

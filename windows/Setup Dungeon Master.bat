@echo off
rem One-time setup. Works on its own: download just this file and double-click it.
if exist "%~dp0setup.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" || pause
  exit /b
)
set "SETUP=%TEMP%\dungeon-master-setup.ps1"
if exist "%SETUP%" del "%SETUP%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072; Invoke-WebRequest https://raw.githubusercontent.com/dannisteele/ai-dungeon-master/main/windows/setup.ps1 -UseBasicParsing -OutFile $env:TEMP\dungeon-master-setup.ps1"
if not exist "%SETUP%" (
  echo Could not download the setup from GitHub. Check the internet connection and try again.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%SETUP%" || pause

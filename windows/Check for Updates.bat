@echo off
rem Double-click to check GitHub for a newer version and install it.
rem One line, so the update rewriting this file mid-run cannot confuse cmd.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" || pause & exit /b

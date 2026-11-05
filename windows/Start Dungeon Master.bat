@echo off
rem Double-click to play. Leave the window open while you play.
rem One line, so an update rewriting this file mid-run cannot confuse cmd.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" || pause & exit /b

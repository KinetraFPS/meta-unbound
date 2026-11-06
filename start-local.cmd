@echo off
title Meta Unbound (local)
cd /d "%~dp0"
where node >NUL 2>&1
if errorlevel 1 (
  echo Node.js is needed to run the local copy. Get it from https://nodejs.org
  pause
  exit /b 1
)
node src\local.js
pause

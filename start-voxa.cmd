@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5174 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo VOXA is already running.
) else (
  echo Starting VOXA...
  start "VOXA server" /min node server.mjs
  timeout /t 2 >nul
)
start http://127.0.0.1:5174/

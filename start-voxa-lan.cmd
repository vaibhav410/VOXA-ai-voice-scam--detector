@echo off
cd /d "%~dp0"
rem Share VOXA with computers on the same network. Port 5175 matches the Windows firewall rule "VOXA-LAN-5175"
rem (inbound TCP, local subnet only). Sign-in, origin checks, consent and FREE_MODE still apply.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5175 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo VOXA network sharing is already running.
) else (
  echo Starting VOXA for your local network...
  start "VOXA network server" /min node server.mjs --lan --port=5175
  timeout /t 4 >nul
)
start http://127.0.0.1:5175/

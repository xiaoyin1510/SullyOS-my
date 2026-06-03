@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" (
  echo Node.js not found: %NODE_EXE%
  pause
  exit /b 1
)

set "APP_URL=http://127.0.0.1:4173"

powershell -NoProfile -Command "try { Invoke-WebRequest -Uri '%APP_URL%' -UseBasicParsing -TimeoutSec 2 ^| Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  start "" "%NODE_EXE%" "scripts\local-static-server.cjs" "dist"
  timeout /t 2 /nobreak >nul
)

start "" "%APP_URL%"

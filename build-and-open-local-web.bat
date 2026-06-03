@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" (
  echo Node.js not found: %NODE_EXE%
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies for the first time...
  call npm install --cache .npm-cache
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Building project...
call npm run build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

call "%~dp0open-local-web.bat"

@echo off
title XHS Skills Toolkit
chcp 65001 >nul 2>nul

set "TOOLKIT_DIR=%~dp0"
set "TOOLKIT_DIR=%TOOLKIT_DIR:~0,-1%"

REM === Kill stale processes from previous runs ===
echo [0] Cleaning up stale processes...
taskkill /F /FI "WINDOWTITLE eq XHS-Bridge" >nul 2>nul
taskkill /F /FI "WINDOWTITLE eq Cloudflared" >nul 2>nul

REM === Find xiaohongshu-skills (try multiple folder names) ===
set "SKILLS_DIR="
if exist "%TOOLKIT_DIR%\xiaohongshu-skills\scripts\cli.py" set "SKILLS_DIR=%TOOLKIT_DIR%\xiaohongshu-skills"
if not defined SKILLS_DIR if exist "%TOOLKIT_DIR%\xiaohongshu-skills-main\scripts\cli.py" set "SKILLS_DIR=%TOOLKIT_DIR%\xiaohongshu-skills-main"
REM Also try parent directory (in case bat is in scripts/ subfolder)
if not defined SKILLS_DIR if exist "%TOOLKIT_DIR%\..\xiaohongshu-skills\scripts\cli.py" set "SKILLS_DIR=%TOOLKIT_DIR%\..\xiaohongshu-skills"
if not defined SKILLS_DIR if exist "%TOOLKIT_DIR%\..\xiaohongshu-skills-main\scripts\cli.py" set "SKILLS_DIR=%TOOLKIT_DIR%\..\xiaohongshu-skills-main"
if not defined SKILLS_DIR (
    echo [ERROR] xiaohongshu-skills folder not found!
    echo Please put it in one of these locations:
    echo   %TOOLKIT_DIR%\xiaohongshu-skills\
    echo   %TOOLKIT_DIR%\xiaohongshu-skills-main\
    echo Make sure it contains scripts\cli.py
    pause
    exit /b 1
)
echo [OK] Skills dir: %SKILLS_DIR%

REM === Find xhs-bridge.mjs ===
set "BRIDGE=%TOOLKIT_DIR%\xhs-bridge.mjs"
if not exist "%BRIDGE%" (
    REM Try scripts/ subfolder (if bat is at project root)
    if exist "%TOOLKIT_DIR%\scripts\xhs-bridge.mjs" set "BRIDGE=%TOOLKIT_DIR%\scripts\xhs-bridge.mjs"
)
if not exist "%BRIDGE%" (
    echo [ERROR] xhs-bridge.mjs not found!
    echo Expected at: %TOOLKIT_DIR%\xhs-bridge.mjs
    pause
    exit /b 1
)

REM === Find cloudflared (try common names + subdirectory) ===
set "CLOUDFLARED="
if exist "%TOOLKIT_DIR%\cloudflared.exe" set "CLOUDFLARED=%TOOLKIT_DIR%\cloudflared.exe"
if not defined CLOUDFLARED if exist "%TOOLKIT_DIR%\cloudflared\cloudflared.exe" set "CLOUDFLARED=%TOOLKIT_DIR%\cloudflared\cloudflared.exe"
if not defined CLOUDFLARED if exist "%TOOLKIT_DIR%\cloudflared" if not exist "%TOOLKIT_DIR%\cloudflared\" set "CLOUDFLARED=%TOOLKIT_DIR%\cloudflared"
if not defined CLOUDFLARED if exist "%TOOLKIT_DIR%\cloudflared-windows-amd64.exe" set "CLOUDFLARED=%TOOLKIT_DIR%\cloudflared-windows-amd64.exe"
if not defined CLOUDFLARED if exist "%TOOLKIT_DIR%\cloudflared.exe.exe" set "CLOUDFLARED=%TOOLKIT_DIR%\cloudflared.exe.exe"

REM === Check and auto-install Node.js ===
where node >nul 2>nul
if errorlevel 1 (
    echo [SETUP] Node.js not found, trying to install via winget...
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements >nul 2>nul
    if errorlevel 1 (
        echo [WARN] winget install failed, trying direct download...
        powershell -NoProfile -ExecutionPolicy Bypass -Command ^
            "$url='https://nodejs.org/dist/v22.15.0/node-v22.15.0-x64.msi'; $out=\"$env:TEMP\node-install.msi\"; Invoke-WebRequest -Uri $url -OutFile $out; Start-Process msiexec.exe -ArgumentList '/i',$out,'/quiet','/norestart' -Wait -NoNewWindow; Remove-Item $out"
        if errorlevel 1 (
            echo [ERROR] Node.js auto-install failed!
            echo Please download manually from https://nodejs.org
            pause
            exit /b 1
        )
    )
    REM Refresh PATH for this session
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
    where node >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] Node.js installed but not found in PATH. Please restart this script.
        pause
        exit /b 1
    )
    echo [OK] Node.js installed successfully.
    echo.
)

REM === Check and auto-install uv ===
where uv >nul 2>nul
if errorlevel 1 (
    echo [SETUP] uv not found, installing...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
    if errorlevel 1 (
        echo [ERROR] uv install failed!
        echo Please manually run: powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
        pause
        exit /b 1
    )
    REM Refresh PATH so uv is available in this session
    set "PATH=%USERPROFILE%\.local\bin;%USERPROFILE%\.cargo\bin;%PATH%"
    where uv >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] uv installed but not found in PATH. Please restart this script.
        pause
        exit /b 1
    )
    echo [OK] uv installed successfully.
    echo.
)

REM === Check Python (via uv) ===
uv python find >nul 2>nul
if errorlevel 1 (
    echo [SETUP] Python not found, installing via uv...
    uv python install
    if errorlevel 1 (
        echo [ERROR] Python install failed!
        pause
        exit /b 1
    )
    echo [OK] Python installed successfully.
    echo.
)

REM === First run: install Python deps ===
if not exist "%SKILLS_DIR%\.venv" (
    echo [SETUP] Installing Python dependencies...
    pushd "%SKILLS_DIR%"
    uv sync
    popd
    if errorlevel 1 (
        echo [ERROR] Dependency install failed!
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed.
    echo.
)

REM === Start Chrome on port 9222 with XHS profile ===
set "CHROME_PROFILE=%USERPROFILE%\.xhs\chrome-profile"
set "CHROME_PORT=9222"

REM Priority 1: CHROME_BIN environment variable (user can set this for portable Chrome)
set "CHROME_EXE="
if defined CHROME_BIN (
    if exist "%CHROME_BIN%" (
        set "CHROME_EXE=%CHROME_BIN%"
        echo [OK] Using CHROME_BIN: %CHROME_BIN%
    ) else (
        echo [WARN] CHROME_BIN is set but file not found: %CHROME_BIN%
    )
)

REM Priority 2: Try common Chrome locations
if not defined CHROME_EXE if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
REM Try Chrome in toolkit directory (portable Chrome)
if not defined CHROME_EXE if exist "%TOOLKIT_DIR%\chrome\chrome.exe" set "CHROME_EXE=%TOOLKIT_DIR%\chrome\chrome.exe"
if not defined CHROME_EXE if exist "%TOOLKIT_DIR%\Chrome\Application\chrome.exe" set "CHROME_EXE=%TOOLKIT_DIR%\Chrome\Application\chrome.exe"
REM Try Edge as fallback
if not defined CHROME_EXE if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "CHROME_EXE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not defined CHROME_EXE if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "CHROME_EXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if not defined CHROME_EXE (
    echo [WARN] Chrome/Edge not found in common locations.
    echo        Set CHROME_BIN environment variable to your chrome.exe path.
    echo        Example: set CHROME_BIN=D:\Tools\Chrome\chrome.exe
    echo        CLI will try to start Chrome automatically.
) else (
    echo [1] Starting Chrome with XHS profile...
    echo     Path: %CHROME_EXE%
    start "" "%CHROME_EXE%" --remote-debugging-port=%CHROME_PORT% --user-data-dir="%CHROME_PROFILE%" --no-first-run --start-maximized https://www.xiaohongshu.com
    timeout /t 3 /nobreak >nul
)

REM === Step 2: Start bridge server ===
echo [2] Starting bridge server...
start "XHS-Bridge" cmd /k node "%BRIDGE%" --skills-dir "%SKILLS_DIR%" --port 18061 --chrome-port %CHROME_PORT%
timeout /t 2 /nobreak >nul

REM === Step 3: Cloudflared tunnel (optional) ===
if defined CLOUDFLARED (
    echo [3] Starting Cloudflared tunnel...
    start "Cloudflared" cmd /k "%CLOUDFLARED%" tunnel --url http://localhost:18061
) else (
    echo [3] Cloudflared not found, skipping tunnel (local only mode^).
)

echo.
echo  ============================================
echo   ALL STARTED
echo  ============================================
echo.
echo   Bridge: http://localhost:18061/api
echo.
if defined CLOUDFLARED (
    echo   Cloudflared tunnel is starting...
    echo   Look for the public URL in the Cloudflared window.
    echo   It looks like: https://xxx-xxx-xxx.trycloudflare.com
    echo   Use that URL + /api as your server URL.
) else (
    echo   Local only mode (no tunnel^).
    echo   Set server URL to: http://localhost:18061/api
)
echo.
echo   Chrome should be open at xiaohongshu.com
echo   Please login if not already logged in.
echo   Login session saved in: %USERPROFILE%\.xhs\chrome-profile\
echo.
echo   Troubleshooting:
echo     - Chrome not found? Set CHROME_BIN=path\to\chrome.exe
echo     - Chinese path issues? Save this file as ANSI encoding
echo     - Port in use? Close previous XHS windows first
echo.
echo   To stop: close the other popup windows, or press Ctrl+C here.
echo.
pause

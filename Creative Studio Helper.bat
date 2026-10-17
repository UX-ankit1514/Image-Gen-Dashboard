@echo off
rem Double-click this file (Windows). First time: paste the connect code from the website when asked.
rem After that, double-click it whenever you want the helper running. Leave the window open.
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 goto nonode
node --version >nul 2>nul
if errorlevel 1 goto nonode
if not exist node_modules (
  echo   Setting up ^(one time, a minute or two^)...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)
call npm run --silent companion -- connect
echo.
echo   The helper has stopped.
pause
exit /b 0
:nonode
echo.
echo   Node.js is missing or won't start on this PC. Get it from https://nodejs.org,
echo   then double-click this file again.
echo.
pause
exit /b 1

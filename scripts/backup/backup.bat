@echo off
cd /d "%~dp0..\.."
echo Kari Kadai - Backup
echo ===================
echo.
node scripts\backup\backup.js
echo.
echo Press any key to close this window.
pause >nul

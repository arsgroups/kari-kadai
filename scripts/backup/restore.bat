@echo off
cd /d "%~dp0..\.."
echo Kari Kadai - Restore
echo ====================
echo.
echo This restores the MOST RECENT backup in the "backups" folder.
echo To restore an older one instead, drag its folder onto this file.
echo.
node scripts\backup\restore.js %*
echo.
echo Press any key to close this window.
pause >nul

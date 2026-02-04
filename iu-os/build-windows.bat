@echo off
:: IÜ OS - Build Script for Windows
:: Creates portable .exe with obfuscated code

echo.
echo =====================================
echo    IU OS - Windows Build
echo =====================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js not found!
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo [1/4] Installing dependencies...
    call npm install
)

:: Obfuscate code
echo [2/4] Obfuscating code...
call node scripts/obfuscate.js

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Obfuscation failed!
    pause
    exit /b 1
)

:: Build portable exe
echo [3/4] Building portable .exe...
call npx electron-builder --win portable

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Build failed!
    call node scripts/restore.js
    pause
    exit /b 1
)

:: Restore original files
echo [4/4] Restoring source files...
call node scripts/restore.js

echo.
echo =====================================
echo    Build Complete!
echo =====================================
echo.
echo Output: dist\IU-1.0.0-Windows.exe
echo.
echo Next steps:
echo 1. Go to github.com/ZevCorp/IU/releases
echo 2. Click "Create a new release"
echo 3. Tag: v1.0.0
echo 4. Drag the .exe file from dist\ folder
echo 5. Publish!
echo.
pause

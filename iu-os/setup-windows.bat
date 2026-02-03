@echo off
:: IÜ OS - Windows Setup Script
:: Run this script in PowerShell or Command Prompt

echo.
echo ====================================
echo    IU OS - Windows Setup
echo ====================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js not found!
    echo Please install Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js found: 
node --version

:: Install npm dependencies
echo.
echo [1/3] Installing npm dependencies...
call npm install

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm install failed!
    pause
    exit /b 1
)

:: Install Playwright browser
echo.
echo [2/3] Installing Playwright Chromium browser...
call npx playwright install chromium

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Playwright install failed!
    pause
    exit /b 1
)

:: Success
echo.
echo ====================================
echo    Setup Complete!
echo ====================================
echo.
echo [3/3] To run the app:
echo.
echo    npm run dev
echo.
echo ====================================
pause

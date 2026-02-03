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
echo [1/4] Installing npm dependencies...
call npm install

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm install failed!
    pause
    exit /b 1
)

:: Install Playwright browser
echo.
echo [2/4] Installing Playwright Chromium browser...
call npx playwright install chromium

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Playwright install failed!
    pause
    exit /b 1
)

:: Configure OpenAI API Key
echo.
echo ====================================
echo [3/4] OpenAI API Key Configuration
echo ====================================
echo.

:: Check if .env already exists with OPENAI_API_KEY
if exist .env (
    findstr /C:"OPENAI_API_KEY" .env >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        echo [OK] .env file already contains OPENAI_API_KEY
        goto :run_app
    )
)

echo To use voice features, you need an OpenAI API key.
echo Get yours at: https://platform.openai.com/api-keys
echo.
set /p OPENAI_KEY="Enter your OpenAI API Key (or press Enter to skip): "

if not "%OPENAI_KEY%"=="" (
    :: Create or append to .env file
    echo OPENAI_API_KEY=%OPENAI_KEY%>> .env
    echo.
    echo [OK] API Key saved to .env file
) else (
    echo [SKIP] No API key provided. Voice features may not work.
)

:run_app
:: Run the app
echo.
echo ====================================
echo [4/4] Starting IU OS...
echo ====================================
echo.
echo Press Ctrl+C to stop the app.
echo.

call npm run dev

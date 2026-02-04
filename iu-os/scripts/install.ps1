# IÜ OS - Windows Installer Script
# Usage: irm https://iu.space/install | iex

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "   IU OS - Installer" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$AppName = "IU"
$Owner = "ZevCorp"
$Repo = "IU"
$InstallDir = "$env:LOCALAPPDATA\Programs\$AppName"

# Get latest release from GitHub
Write-Host "[1/4] Fetching latest release..." -ForegroundColor Yellow
try {
    $Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Owner/$Repo/releases/latest"
    $Version = $Release.tag_name
    Write-Host "      Found version: $Version" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Could not fetch release info. Check your internet connection." -ForegroundColor Red
    exit 1
}

# Find Windows portable asset
$Asset = $Release.assets | Where-Object { $_.name -like "*Windows.exe" } | Select-Object -First 1
if (-not $Asset) {
    Write-Host "[ERROR] No Windows release found." -ForegroundColor Red
    exit 1
}

$DownloadUrl = $Asset.browser_download_url
$FileName = $Asset.name

# Create install directory
Write-Host "[2/4] Creating install directory..." -ForegroundColor Yellow
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}
Write-Host "      Location: $InstallDir" -ForegroundColor Green

# Download
Write-Host "[3/4] Downloading $FileName..." -ForegroundColor Yellow
$TempFile = "$env:TEMP\$FileName"
try {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $TempFile -UseBasicParsing
    Write-Host "      Downloaded successfully" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Download failed: $_" -ForegroundColor Red
    exit 1
}

# Install (move to destination)
Write-Host "[4/4] Installing..." -ForegroundColor Yellow
$ExePath = "$InstallDir\$AppName.exe"
Move-Item -Path $TempFile -Destination $ExePath -Force
Write-Host "      Installed to: $ExePath" -ForegroundColor Green

# Create Desktop shortcut
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\$AppName.lnk")
$Shortcut.TargetPath = $ExePath
$Shortcut.Save()
Write-Host "      Desktop shortcut created" -ForegroundColor Green

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "   Installation Complete!" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Starting IU..." -ForegroundColor Yellow

# Launch
Start-Process $ExePath

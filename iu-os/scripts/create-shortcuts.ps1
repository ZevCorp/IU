# IÜ OS - Create Shortcuts Script
# For users who already have IU installed but missing shortcuts
# Usage: irm https://iu.space/shortcuts | iex

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "   IU OS - Shortcut Creator" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$AppName = "IU"
$InstallDir = "$env:LOCALAPPDATA\Programs\$AppName"
$ExePath = "$InstallDir\$AppName.exe"

# Verify IU is installed
Write-Host "[1/2] Checking installation..." -ForegroundColor Yellow
if (-not (Test-Path $ExePath)) {
    Write-Host "[ERROR] IU is not installed at: $ExePath" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install IU first:" -ForegroundColor Yellow
    Write-Host "  irm https://iu.space/install | iex" -ForegroundColor White
    Write-Host ""
    exit 1
}
Write-Host "      ✓ Found IU at: $ExePath" -ForegroundColor Green

# Create shortcuts
Write-Host ""
Write-Host "[2/2] Creating shortcuts..." -ForegroundColor Yellow

$ShortcutsCreated = 0
$ShortcutsFailed = 0

try {
    $WshShell = New-Object -ComObject WScript.Shell
    
    # Desktop shortcut
    $DesktopPath = "$env:USERPROFILE\Desktop\$AppName.lnk"
    try {
        $Shortcut = $WshShell.CreateShortcut($DesktopPath)
        $Shortcut.TargetPath = $ExePath
        $Shortcut.WorkingDirectory = $InstallDir
        $Shortcut.Description = "IU OS - Minimalist overlay interface"
        $Shortcut.Save()
        
        if (Test-Path $DesktopPath) {
            Write-Host "      ✓ Desktop shortcut created" -ForegroundColor Green
            $ShortcutsCreated++
        } else {
            Write-Host "      ✗ Desktop shortcut failed (permissions?)" -ForegroundColor Red
            $ShortcutsFailed++
        }
    } catch {
        Write-Host "      ✗ Desktop shortcut error: $_" -ForegroundColor Red
        $ShortcutsFailed++
    }
    
    # Start Menu shortcut
    $StartMenuPath = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\$AppName.lnk"
    try {
        $Shortcut = $WshShell.CreateShortcut($StartMenuPath)
        $Shortcut.TargetPath = $ExePath
        $Shortcut.WorkingDirectory = $InstallDir
        $Shortcut.Description = "IU OS - Minimalist overlay interface"
        $Shortcut.Save()
        
        if (Test-Path $StartMenuPath) {
            Write-Host "      ✓ Start Menu shortcut created" -ForegroundColor Green
            $ShortcutsCreated++
        } else {
            Write-Host "      ✗ Start Menu shortcut failed" -ForegroundColor Red
            $ShortcutsFailed++
        }
    } catch {
        Write-Host "      ✗ Start Menu shortcut error: $_" -ForegroundColor Red
        $ShortcutsFailed++
    }
    
} catch {
    Write-Host "      ✗ Shortcut creation failed: $_" -ForegroundColor Red
    $ShortcutsFailed = 2
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
if ($ShortcutsCreated -gt 0) {
    Write-Host "   Shortcuts Created: $ShortcutsCreated/2" -ForegroundColor Green
} else {
    Write-Host "   No Shortcuts Created" -ForegroundColor Red
}
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

if ($ShortcutsCreated -gt 0) {
    Write-Host "You can now open IU from:" -ForegroundColor Cyan
    if (Test-Path "$env:USERPROFILE\Desktop\$AppName.lnk") {
        Write-Host "  • Desktop shortcut" -ForegroundColor White
    }
    if (Test-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\$AppName.lnk") {
        Write-Host "  • Start Menu (search 'IU')" -ForegroundColor White
    }
    Write-Host ""
}

if ($ShortcutsFailed -gt 0) {
    Write-Host "Alternative ways to open IU:" -ForegroundColor Yellow
    Write-Host "  • Press Win+R and paste: $ExePath" -ForegroundColor White
    Write-Host "  • Navigate to: $InstallDir" -ForegroundColor White
    Write-Host ""
}

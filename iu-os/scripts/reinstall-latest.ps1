param(
    [switch]$PullFromOrigin = $false,
    [switch]$NoLaunch = $false
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Action
    )

    Write-Host "=== $Name ===" -ForegroundColor Cyan
    & $Action
    Write-Host "OK: $Name" -ForegroundColor Green
}

function Invoke-Cmd {
    param(
        [string]$Exe,
        [string[]]$CmdArgs
    )

    & $Exe @CmdArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed ($Exe $($CmdArgs -join ' ')) with exit code $LASTEXITCODE"
    }
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DistDir = Join-Path $RepoRoot "dist"
$InstalledExe = Join-Path $env:LOCALAPPDATA "Programs\\iu-os\\IU.exe"

Push-Location $RepoRoot
try {
    Write-Host "Repo root: $RepoRoot" -ForegroundColor Yellow
    Write-Host "Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Yellow

    if ($PullFromOrigin) {
        Invoke-Step "Git fetch/pull current branch" {
            $branch = (git rev-parse --abbrev-ref HEAD).Trim()
            if (-not $branch) { throw "Could not resolve current git branch." }
            Invoke-Cmd "git" @("fetch", "origin", "--prune")
            Invoke-Cmd "git" @("pull", "--ff-only", "origin", $branch)
        }
    }

    Invoke-Step "Stop running IU processes" {
        Get-Process -Name "IU" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }

    Invoke-Step "Install npm dependencies" {
        Invoke-Cmd "npm" @("install")
    }

    $obfuscated = $false
    try {
        Invoke-Step "Obfuscate source" {
            Invoke-Cmd "npm" @("run", "obfuscate")
            $obfuscated = $true
        }

        Invoke-Step "Build Windows installer (NSIS)" {
            Invoke-Cmd "npx" @("electron-builder", "--win", "nsis")
        }
    }
    finally {
        if ($obfuscated) {
            try {
                Invoke-Step "Restore source after obfuscation" {
                    Invoke-Cmd "npm" @("run", "restore")
                }
            }
            catch {
                Write-Warning "Restore failed: $($_.Exception.Message)"
            }
        }
    }

    Invoke-Step "Resolve latest installer artifact" {
        if (-not (Test-Path $DistDir)) {
            throw "Dist directory not found: $DistDir"
        }

        $script:Installer = Get-ChildItem -Path $DistDir -Filter "*Setup*.exe" -File |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1

        if (-not $script:Installer) {
            throw "No installer .exe found in $DistDir"
        }

        Write-Host "Installer: $($script:Installer.FullName)" -ForegroundColor Yellow
    }

    Invoke-Step "Install latest build (silent)" {
        $proc = Start-Process -FilePath $script:Installer.FullName -ArgumentList "/S" -PassThru -Wait
        if ($proc.ExitCode -ne 0) {
            throw "Installer exited with code $($proc.ExitCode)"
        }
    }

    if (-not $NoLaunch) {
        Invoke-Step "Launch IU" {
            if (-not (Test-Path $InstalledExe)) {
                throw "Installed IU.exe not found at: $InstalledExe"
            }
            Start-Process -FilePath $InstalledExe | Out-Null
        }
    }

    Write-Host "Done. IU reinstalled from latest local code." -ForegroundColor Green
}
finally {
    Pop-Location
}

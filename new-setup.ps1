# Pearl-OS - New Setup Wizard (TUI-ish)
# Run with:
#   powershell -ExecutionPolicy Bypass -File new-setup.ps1
#
# Non-interactive:
#   powershell -ExecutionPolicy Bypass -File new-setup.ps1 -Preset minimal -NonInteractive
#
# Dry run:
#   powershell -ExecutionPolicy Bypass -File new-setup.ps1 -Preset full -DryRun

[CmdletBinding()]
param(
  [ValidateSet("full", "minimal", "custom")]
  [string]$Preset,

  [switch]$NonInteractive,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Banner {
  Write-Host ""
  Write-Host "===============================================================" -ForegroundColor Cyan
  Write-Host "        Pearl-OS - Setup Wizard (Windows)" -ForegroundColor Cyan
  Write-Host "===============================================================" -ForegroundColor Cyan
  Write-Host ""
}

$RepoRoot = Split-Path -Parent $PSCommandPath
$SetupPath = Join-Path $RepoRoot "setup.ps1"

if (-not (Test-Path $SetupPath)) {
  Write-Host "Error: expected $SetupPath" -ForegroundColor Red
  exit 1
}

# Dot-source setup.ps1 to load its functions without running Main (guarded in setup.ps1)
. $SetupPath

# Check if Node.js TUI is available (inquirer-based)
$UseTui = $false
$TuiScript = Join-Path $RepoRoot "scripts\setup-wizard-ui.mjs"
if ((Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path $TuiScript)) {
  # Check if inquirer is available
  try {
    $null = node -e "require('inquirer')" 2>$null
    $UseTui = $true
  } catch {
    if (Test-Path (Join-Path $RepoRoot "node_modules\inquirer")) {
      $UseTui = $true
    }
  }
}

function Usage {
  Write-Host @"
new-setup.ps1 - interactive setup wizard for Pearl-OS

Usage:
  powershell -ExecutionPolicy Bypass -File new-setup.ps1

Non-interactive:
  powershell -ExecutionPolicy Bypass -File new-setup.ps1 -Preset full -NonInteractive
  powershell -ExecutionPolicy Bypass -File new-setup.ps1 -Preset minimal -NonInteractive

Dry run:
  powershell -ExecutionPolicy Bypass -File new-setup.ps1 -Preset minimal -DryRun

Options:
  -Preset full|minimal|custom
  -NonInteractive
  -DryRun
"@
}

function Is-Interactive {
  try { return [Environment]::UserInteractive } catch { return $true }
}

# Permissions + credentials helpers
function Call-TuiPreset {
  $result = & node $TuiScript preset 2>$null
  if ($LASTEXITCODE -eq 0 -and $result) {
    $result | Select-String -Pattern '"preset":"([^"]*)"' | ForEach-Object { $_.Matches[0].Groups[1].Value }
  }
}

function Call-TuiSteps {
  param([string]$Preset)
  $result = & node $TuiScript steps $Preset 2>$null
  if ($LASTEXITCODE -eq 0 -and $result) {
    $result | Select-String -Pattern '"steps":\[([^\]]*)\]' | ForEach-Object {
      $_.Matches[0].Groups[1].Value -split ',' | ForEach-Object { $_.Trim('"') }
    }
  }
}

function Call-TuiPermissions {
  $result = & node $TuiScript permissions 2>$null
  if ($LASTEXITCODE -eq 0 -and $result) {
    return ($result | Select-String -Pattern '"consent":true') -ne $null
  }
  return $false
}

function Call-TuiCredentials {
  $result = & node $TuiScript credentials 2>$null
  if ($LASTEXITCODE -eq 0 -and $result) {
    $envFile = Join-Path $RepoRoot ".env.local"
    if (-not (Test-Path $envFile)) { return $false }

    $dailyKey = ($result | Select-String -Pattern '"daily":"([^"]*)"').Matches[0].Groups[1].Value
    $openaiKey = ($result | Select-String -Pattern '"openai":"([^"]*)"').Matches[0].Groups[1].Value
    $deepgramKey = ($result | Select-String -Pattern '"deepgram":"([^"]*)"').Matches[0].Groups[1].Value

    $changed = $false
    if ($dailyKey) { Upsert-EnvVar $envFile "DAILY_API_KEY" $dailyKey; $changed = $true }
    if ($openaiKey) { Upsert-EnvVar $envFile "OPENAI_API_KEY" $openaiKey; $changed = $true }
    if ($deepgramKey) { Upsert-EnvVar $envFile "DEEPGRAM_API_KEY" $deepgramKey; $changed = $true }

    if ($changed) {
      if (Get-Command npm -ErrorAction SilentlyContinue) {
        & npm run sync:env 2>$null
      }
      if (Get-Command New-BotEnv -ErrorAction SilentlyContinue) {
        New-BotEnv
      }
    }
    return $true
  }
  return $false
}

function Wizard-Permissions {
  if ($NonInteractive) { return }

  # If TUI is handling this, skip simple prompt
  if ($UseTui -and (Is-Interactive)) {
    return
  }

  Write-Host "Permissions / consent" -ForegroundColor White
  Write-Host ""
  Write-Host "This wizard may:" -ForegroundColor White
  Write-Host "  - Install system packages (Chocolatey; may require Administrator)" -ForegroundColor White
  Write-Host "  - Run npm commands (install, sync env, seed DB)" -ForegroundColor White
  Write-Host "  - Create/modify .env files (including writing API keys you provide)" -ForegroundColor White
  Write-Host "  - Install/configure PostgreSQL and set local dev password" -ForegroundColor White
  Write-Host ""
  Write-Host "Nothing will be executed without your confirmation." -ForegroundColor Yellow
  Write-Host ""
  $ans = Read-Host "Proceed? (y/N)"
  if ($ans -notmatch '^[yY]$') {
    Write-Host "Aborted." -ForegroundColor Yellow
    exit 0
  }
}

function Upsert-EnvVar {
  param(
    [Parameter(Mandatory=$true)][string]$File,
    [Parameter(Mandatory=$true)][string]$Key,
    [Parameter(Mandatory=$true)][string]$Value
  )

  if (-not (Test-Path $File)) { throw "Missing env file: $File" }

  # Quote and escape so PowerShell + bash `source` won't expand accidental `$`/backticks
  $escaped = $Value.Replace('\', '\\').Replace('"', '\"').Replace('`', '\`').Replace('$', '\$')
  $line = "$Key=`"$escaped`""

  $content = Get-Content $File -Raw
  if ($content -match "(?m)^$([regex]::Escape($Key))=") {
    $content = [regex]::Replace($content, "(?m)^$([regex]::Escape($Key))=.*$", $line)
  } else {
    if (-not $content.EndsWith("`n")) { $content += "`n" }
    $content += "$line`n"
  }
  Set-Content $File $content -NoNewline
}

function Env-HasKey {
  param([string]$File, [string]$Key)
  if (-not (Test-Path $File)) { return $false }
  $content = Get-Content $File -Raw
  return ($content -match "(?m)^$([regex]::Escape($Key))=")
}

function SecureStringToPlain([Security.SecureString]$ss) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# Comprehensive prerequisite assessment
function Assess-Prerequisites {
  $missingTools = @()
  $missingPackageManagers = @()

  Write-Host "Assessing system prerequisites..." -ForegroundColor White
  Write-Host ""

  # Check for Chocolatey (Windows package manager)
  if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    $missingPackageManagers += "Chocolatey"
    Write-Host "  ! Chocolatey not found" -ForegroundColor Yellow
    Write-Host "    Chocolatey is recommended for installing Node.js, Python, and PostgreSQL on Windows"
  } else {
    Write-Host "  ✓ Chocolatey found" -ForegroundColor Green
  }

  # Check basic tools
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    $missingTools += "git"
    Write-Host "  ! git not found" -ForegroundColor Yellow
  } else {
    Write-Host "  ✓ git found" -ForegroundColor Green
  }

  # Check Node.js
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $missingTools += "Node.js"
    Write-Host "  ! Node.js not found" -ForegroundColor Yellow
  } else {
    $nodeVersion = node --version 2>$null
    if ($nodeVersion) {
      Write-Host "  ✓ Node.js: $nodeVersion" -ForegroundColor Green
    } else {
      Write-Host "  ✓ Node.js: installed" -ForegroundColor Green
    }
  }

  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    $missingTools += "npm"
    Write-Host "  ! npm not found" -ForegroundColor Yellow
  } else {
    $npmVersion = npm --version 2>$null
    if ($npmVersion) {
      Write-Host "  ✓ npm: $npmVersion" -ForegroundColor Green
    } else {
      Write-Host "  ✓ npm: installed" -ForegroundColor Green
    }
  }

  # Check Python
  $pythonOk = $false
  try {
    $pythonVersion = python --version 2>&1
    if ($pythonVersion -match "Python 3\.(1[1-9]|[2-9]\d)") {
      Write-Host "  ✓ Python: $pythonVersion" -ForegroundColor Green
      $pythonOk = $true
    }
  } catch {
    # Try python3
    try {
      $pythonVersion = python3 --version 2>&1
      if ($pythonVersion -match "Python 3\.(1[1-9]|[2-9]\d)") {
        Write-Host "  ✓ Python: $pythonVersion" -ForegroundColor Green
        $pythonOk = $true
      }
    } catch { }
  }
  if (-not $pythonOk) {
    $missingTools += "Python 3.11+"
    Write-Host "  ! Python 3.11+ not found" -ForegroundColor Yellow
  }

  # Check PostgreSQL
  if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    $missingTools += "PostgreSQL"
    Write-Host "  ! PostgreSQL not found" -ForegroundColor Yellow
  } else {
    $psqlVersion = psql --version 2>$null
    if ($psqlVersion) {
      Write-Host "  ✓ PostgreSQL: $psqlVersion" -ForegroundColor Green
    } else {
      Write-Host "  ✓ PostgreSQL: installed" -ForegroundColor Green
    }
  }

  # Check Poetry
  if (-not (Get-Command poetry -ErrorAction SilentlyContinue)) {
    $missingTools += "Poetry"
    Write-Host "  ! Poetry not found" -ForegroundColor Yellow
  } else {
    $poetryVersion = poetry --version 2>$null
    if ($poetryVersion) {
      Write-Host "  ✓ Poetry: $poetryVersion" -ForegroundColor Green
    } else {
      Write-Host "  ✓ Poetry: installed" -ForegroundColor Green
    }
  }

  # Check uv
  if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    $missingTools += "uv"
    Write-Host "  ! uv not found" -ForegroundColor Yellow
  } else {
    $uvVersion = uv --version 2>$null
    if ($uvVersion) {
      Write-Host "  ✓ uv: $uvVersion" -ForegroundColor Green
    } else {
      Write-Host "  ✓ uv: installed" -ForegroundColor Green
    }
  }

  Write-Host ""

  # If missing items, ask what to install
  if ($missingPackageManagers.Count -gt 0 -or $missingTools.Count -gt 0) {
    if ($NonInteractive) {
      Write-Host "  ! Missing prerequisites detected, but -NonInteractive is set." -ForegroundColor Yellow
      Write-Host "    Some setup steps may fail. Install missing items manually:" -ForegroundColor Yellow
      foreach ($item in $missingPackageManagers) {
        Write-Host "      - $item" -ForegroundColor Yellow
      }
      foreach ($item in $missingTools) {
        Write-Host "      - $item" -ForegroundColor Yellow
      }
      Write-Host ""
      return
    }

    Write-Host "Missing prerequisites detected:" -ForegroundColor White
    foreach ($item in $missingPackageManagers) {
      Write-Host "  • $item" -ForegroundColor White
    }
    foreach ($item in $missingTools) {
      Write-Host "  • $item" -ForegroundColor White
    }
    Write-Host ""
    Write-Host "Would you like to install missing items now?"
    Write-Host "  1) Install all missing items (recommended)"
    Write-Host "  2) Install package manager only (Chocolatey)"
    Write-Host "  3) Install tools only (git, Node.js, Python, etc.)"
    Write-Host "  4) Skip installation (you can install manually later)"
    Write-Host ""
    $installChoice = Read-Host "Choose option [1-4] (default: 1)"

    switch ($installChoice) {
      "1" {
        # Install package managers first, then tools
        if ($missingPackageManagers.Count -gt 0) {
          Install-PackageManagers
        }
        if ($missingTools.Count -gt 0) {
          Install-MissingTools
        }
      }
      "2" {
        if ($missingPackageManagers.Count -gt 0) {
          Install-PackageManagers
        }
      }
      "3" {
        Install-MissingTools
      }
      "4" {
        Write-Host "  Skipping installation. You may need to install items manually." -ForegroundColor Yellow
      }
      default {
        # Install package managers first, then tools
        if ($missingPackageManagers.Count -gt 0) {
          Install-PackageManagers
        }
        if ($missingTools.Count -gt 0) {
          Install-MissingTools
        }
      }
    }
  } else {
    Write-Host "  ✓ All prerequisites found" -ForegroundColor Green
  }

  Write-Host ""
  Refresh-PathAfterInstalls
}

function Install-PackageManagers {
  if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "Installing Chocolatey..." -ForegroundColor Cyan
    Write-Host "  This may require Administrator privileges." -ForegroundColor Yellow
    Write-Host ""
    
    # Check if running as Administrator
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
      Write-Host "  ! Administrator privileges required to install Chocolatey" -ForegroundColor Yellow
      Write-Host "    Please run PowerShell as Administrator and try again" -ForegroundColor Yellow
      return $false
    }

    try {
      Set-ExecutionPolicy Bypass -Scope Process -Force
      [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
      iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
      
      # Refresh PATH to include Chocolatey
      $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
      
      Write-Host "  ✓ Chocolatey installed and PATH updated" -ForegroundColor Green
      return $true
    } catch {
      Write-Host "  ✗ Failed to install Chocolatey: $_" -ForegroundColor Red
      return $false
    }
  }
  return $true
}

function Install-MissingTools {
  $toInstall = @()
  
  # Check what's still missing after package manager install
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { $toInstall += "git" }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { $toInstall += "nodejs" }
  
  $pythonOk = $false
  try {
    $pythonVersion = python --version 2>&1
    if ($pythonVersion -match "Python 3\.(1[1-9]|[2-9]\d)") { $pythonOk = $true }
  } catch {
    try {
      $pythonVersion = python3 --version 2>&1
      if ($pythonVersion -match "Python 3\.(1[1-9]|[2-9]\d)") { $pythonOk = $true }
    } catch { }
  }
  if (-not $pythonOk) { $toInstall += "python3" }
  
  if (-not (Get-Command psql -ErrorAction SilentlyContinue)) { $toInstall += "postgresql" }
  if (-not (Get-Command poetry -ErrorAction SilentlyContinue)) { $toInstall += "poetry" }
  if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { $toInstall += "uv" }

  if ($toInstall.Count -eq 0) {
    Write-Host "  ✓ All tools are available" -ForegroundColor Green
    return
  }

  if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Write-Host "  ! Chocolatey not found. Please install Chocolatey first." -ForegroundColor Yellow
    return
  }

  Write-Host ""
  Write-Host "Installing missing tools via Chocolatey..." -ForegroundColor Cyan
  Write-Host "  This may require Administrator privileges." -ForegroundColor Yellow
  Write-Host ""

  # Check if running as Administrator
  $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) {
    Write-Host "  ! Administrator privileges required to install packages" -ForegroundColor Yellow
    Write-Host "    Please run PowerShell as Administrator and try again" -ForegroundColor Yellow
    return
  }

  foreach ($tool in $toInstall) {
    switch ($tool) {
      "git" {
        Write-Host "  Installing git via Chocolatey..."
        choco install git -y
      }
      "nodejs" {
        Write-Host "  Installing Node.js via Chocolatey..."
        choco install nodejs -y
      }
      "python3" {
        Write-Host "  Installing Python 3.11+ via Chocolatey..."
        choco install python311 -y
      }
      "postgresql" {
        Write-Host "  Installing PostgreSQL via Chocolatey..."
        choco install postgresql -y
      }
      "poetry" {
        Write-Host "  Installing Poetry..."
        if (Get-Command python -ErrorAction SilentlyContinue) {
          (Invoke-WebRequest -Uri https://install.python-poetry.org -UseBasicParsing).Content | python -
        } elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
          (Invoke-WebRequest -Uri https://install.python-poetry.org -UseBasicParsing).Content | python3 -
        }
        $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
      }
      "uv" {
        Write-Host "  Installing uv..."
        if (Get-Command python -ErrorAction SilentlyContinue) {
          (Invoke-WebRequest -Uri https://astral.sh/uv/install.ps1 -UseBasicParsing).Content | powershell -
        } elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
          (Invoke-WebRequest -Uri https://astral.sh/uv/install.ps1 -UseBasicParsing).Content | powershell -
        }
        $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
      }
    }
  }

  Write-Host ""
  Refresh-PathAfterInstalls
}

function Refresh-PathAfterInstalls {
  # Refresh PATH to pick up newly installed tools
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
  
  # Add user local bins
  $userLocalBin = "$env:USERPROFILE\.local\bin"
  if (Test-Path $userLocalBin) {
    $env:Path = "$userLocalBin;$env:Path"
  }
  
  # Add cargo bin
  $cargoBin = "$env:USERPROFILE\.cargo\bin"
  if (Test-Path $cargoBin) {
    $env:Path = "$cargoBin;$env:Path"
  }
  
  # Verify PATH updates worked
  if ((Get-Command node -ErrorAction SilentlyContinue) -and (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "  ✓ PATH refreshed - Node.js and npm are available" -ForegroundColor Green
  }
}

function Wizard-Credentials {
  $envFile = Join-Path $RepoRoot ".env.local"

  if (-not (Test-Path $envFile)) {
    Write-Host "  ! .env.local not found yet; run 'Setup environment files' first, then rerun credentials." -ForegroundColor Yellow
    return
  }

  if ($NonInteractive) { return }

  # If TUI is handling this, skip simple prompt
  if ($UseTui -and (Is-Interactive)) {
    return
  }

  Write-Host "Credentials (API keys)" -ForegroundColor White
  Write-Host ""
  Write-Host "Optional but recommended now (you can edit .env.local later):" -ForegroundColor White
  Write-Host "  - DAILY_API_KEY     (Daily.co dashboard)" -ForegroundColor White
  Write-Host "  - OPENAI_API_KEY    (OpenAI API keys)" -ForegroundColor White
  Write-Host "  - DEEPGRAM_API_KEY  (Deepgram console)" -ForegroundColor White
  Write-Host ""
  Write-Host "We will never print the keys back to the terminal." -ForegroundColor Yellow
  Write-Host ""

  $changed = $false

  function Prompt-Key([string]$Key) {
    if (Env-HasKey -File $envFile -Key $Key) {
      $ow = Read-Host "$Key already exists in .env.local. Overwrite? (y/N)"
      if ($ow -notmatch '^[yY]$') { return }
    } else {
      $set = Read-Host "Set $Key now? (y/N)"
      if ($set -notmatch '^[yY]$') { return }
    }

    $ss = Read-Host "Enter $Key" -AsSecureString
    $plain = SecureStringToPlain $ss
    if ([string]::IsNullOrWhiteSpace($plain)) {
      Write-Host "  ! Empty value; skipping." -ForegroundColor Yellow
      return
    }
    Upsert-EnvVar -File $envFile -Key $Key -Value $plain
    $changed = $true
    Write-Host "  ✓ Saved $Key to .env.local" -ForegroundColor Green
  }

  Prompt-Key "DAILY_API_KEY"
  Prompt-Key "OPENAI_API_KEY"
  Prompt-Key "DEEPGRAM_API_KEY"

  if ($changed) {
    Write-Host ""
    Write-Host "Syncing env files + bot env (best effort)..." -ForegroundColor White
    if (Test-Command "npm") {
      npm run sync:env 2>&1 | Out-Null
    }
    if (Get-Command New-BotEnv -ErrorAction SilentlyContinue) {
      New-BotEnv
    }
  }
}

function Build-Project {
  Write-Host "Building Pearl-OS project..." -ForegroundColor White
  Write-Host ""

  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "  ✗ npm not found. Cannot build project." -ForegroundColor Red
    return
  }

  Set-Location $RepoRoot

  Write-Host "  Running: npm run build" -ForegroundColor Cyan
  Write-Host ""

  # Run build and capture output
  $buildLog = Join-Path $env:TEMP "pearl-os-build.log"
  try {
    npm run build *> $buildLog
    if ($LASTEXITCODE -eq 0) {
      Write-Host "  ✓ Build completed successfully" -ForegroundColor Green
      Remove-Item $buildLog -ErrorAction SilentlyContinue
      return
    } else {
      Write-Host "  ✗ Build failed with exit code $LASTEXITCODE" -ForegroundColor Red
      Write-Host ""
      Write-Host "  Build error output:" -ForegroundColor Yellow
      Write-Host "  ──────────────────────────────────────────────────────────"
      Get-Content $buildLog -Tail 50 | ForEach-Object { Write-Host "  $_" }
      Write-Host "  ──────────────────────────────────────────────────────────"
      Write-Host ""

      if ((Is-Interactive) -and (-not $NonInteractive)) {
        Write-Host "  Would you like to:" -ForegroundColor Yellow
        Write-Host "    1) Try to fix common build issues automatically"
        Write-Host "    2) Show full build log"
        Write-Host "    3) Skip build and continue"
        Write-Host "    4) Abort setup"
        Write-Host ""
        $fixChoice = Read-Host "  Choose option [1-4] (default: 3)"

        switch ($fixChoice) {
          "1" {
            Write-Host ""
            Write-Host "  Attempting to fix common issues..." -ForegroundColor Cyan
            # Try common fixes
            Write-Host "  - Clearing .next cache..."
            Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
            Write-Host "  - Clearing node_modules/.cache..."
            Remove-Item -Recurse -Force node_modules\.cache -ErrorAction SilentlyContinue
            Write-Host "  - Re-running build..."
            npm run build *> $buildLog
            if ($LASTEXITCODE -eq 0) {
              Write-Host "  ✓ Build succeeded after fixes" -ForegroundColor Green
              Remove-Item $buildLog -ErrorAction SilentlyContinue
              return
            } else {
              Write-Host "  ! Automatic fixes did not resolve the issue" -ForegroundColor Yellow
              Get-Content $buildLog -Tail 30 | ForEach-Object { Write-Host "  $_" }
            }
          }
          "2" {
            Write-Host ""
            Write-Host "  Full build log:" -ForegroundColor Cyan
            Get-Content $buildLog | ForEach-Object { Write-Host "  $_" }
          }
          "3" {
            Write-Host "  Skipping build. You can run 'npm run build' manually later." -ForegroundColor Yellow
            Remove-Item $buildLog -ErrorAction SilentlyContinue
            return
          }
          "4" {
            Write-Host "Setup aborted." -ForegroundColor Yellow
            Remove-Item $buildLog -ErrorAction SilentlyContinue
            exit 1
          }
          default {
            Write-Host "  Skipping build. You can run 'npm run build' manually later." -ForegroundColor Yellow
            Remove-Item $buildLog -ErrorAction SilentlyContinue
            return
          }
        }
      }
    }
  } catch {
    Write-Host "  ✗ Build failed: $_" -ForegroundColor Red
  } finally {
    if (Test-Path $buildLog) {
      Remove-Item $buildLog -ErrorAction SilentlyContinue
    }
  }
}

function Start-DevServer {
  Write-Host "Starting Pearl-OS development server..." -ForegroundColor White
  Write-Host ""

  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "  ✗ npm not found. Cannot start dev server." -ForegroundColor Red
    return
  }

  Set-Location $RepoRoot

  # Check if dev server is already running
  $port3000 = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
  $port4000 = Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue
  $port2000 = Get-NetTCPConnection -LocalPort 2000 -ErrorAction SilentlyContinue

  if ($port3000 -or $port4000 -or $port2000) {
    Write-Host "  ! Development server appears to already be running on port 3000, 4000, or 2000" -ForegroundColor Yellow
    Write-Host "    Skipping dev server start."
    return
  }

  Write-Host "  Starting: npm run dev" -ForegroundColor Cyan
  Write-Host "  Note: This will run in the background." -ForegroundColor Yellow
  Write-Host ""

  # Start dev server in background
  $devLog = Join-Path $env:TEMP "pearl-os-dev.log"
  $devPidFile = Join-Path $env:TEMP "pearl-os-dev.pid"
  
  Start-Process -NoNewWindow -FilePath "npm" -ArgumentList "run", "dev" -RedirectStandardOutput $devLog -RedirectStandardError $devLog
  Start-Sleep -Seconds 2
  
  # Get the process ID
  $devProcess = Get-Process | Where-Object { $_.Path -like "*node*" -and $_.StartTime -gt (Get-Date).AddSeconds(-5) } | Select-Object -First 1
  if ($devProcess) {
    $devProcess.Id | Out-File $devPidFile
    Write-Host "  Waiting for server to start..." -ForegroundColor Cyan
    Start-Sleep -Seconds 5

    # Check if process is still running
    if (Get-Process -Id $devProcess.Id -ErrorAction SilentlyContinue) {
      # Check if server is responding
      $maxAttempts = 30
      $attempt = 0
      $serverReady = $false

      while ($attempt -lt $maxAttempts) {
        try {
          $response3000 = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue
          $serverReady = $true
          break
        } catch {
          try {
            $response4000 = Invoke-WebRequest -Uri "http://localhost:4000" -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue
            $serverReady = $true
            break
          } catch {
            try {
              $response2000 = Invoke-WebRequest -Uri "http://localhost:2000/graphql" -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue
              $serverReady = $true
              break
            } catch { }
          }
        }
        $attempt++
        Start-Sleep -Seconds 1
      }

      if ($serverReady) {
        Write-Host "  ✓ Development server started successfully" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Server is running at:" -ForegroundColor Cyan
        try {
          $null = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 1 -UseBasicParsing -ErrorAction SilentlyContinue
          Write-Host "    • http://localhost:3000 (Interface)" -ForegroundColor White
        } catch { }
        try {
          $null = Invoke-WebRequest -Uri "http://localhost:4000" -TimeoutSec 1 -UseBasicParsing -ErrorAction SilentlyContinue
          Write-Host "    • http://localhost:4000 (Dashboard)" -ForegroundColor White
        } catch { }
        try {
          $null = Invoke-WebRequest -Uri "http://localhost:2000/graphql" -TimeoutSec 1 -UseBasicParsing -ErrorAction SilentlyContinue
          Write-Host "    • http://localhost:2000/graphql (Mesh GraphQL)" -ForegroundColor White
        } catch { }
        Write-Host ""
        Write-Host "  Dev server PID: $($devProcess.Id)" -ForegroundColor Yellow
        Write-Host "  Logs: $devLog" -ForegroundColor Yellow
        Write-Host "  To stop: Stop-Process -Id (Get-Content $devPidFile)" -ForegroundColor Yellow
        return
      } else {
        Write-Host "  ! Dev server started but may not be fully ready yet" -ForegroundColor Yellow
        Write-Host "    Check logs at $devLog"
        return
      }
    } else {
      Write-Host "  ✗ Dev server failed to start" -ForegroundColor Red
      Write-Host ""
      Write-Host "  Error output:" -ForegroundColor Yellow
      Get-Content $devLog -Tail 30 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
      Remove-Item $devPidFile -ErrorAction SilentlyContinue
      return
    }
  } else {
    Write-Host "  ✗ Could not start dev server process" -ForegroundColor Red
    return
  }
}

function Functional-Prompts {
  Write-Host "Functional verification prompts" -ForegroundColor White
  Write-Host ""

  if ($NonInteractive) {
    Write-Host "  Skipping functional prompts (-NonInteractive mode)" -ForegroundColor Yellow
    return
  }

  # Check if dev server is running
  $devPidFile = Join-Path $env:TEMP "pearl-os-dev.pid"
  $devPid = $null
  if (Test-Path $devPidFile) {
    $devPid = Get-Content $devPidFile -ErrorAction SilentlyContinue
  }

  if (-not $devPid -or -not (Get-Process -Id $devPid -ErrorAction SilentlyContinue)) {
    Write-Host "  ! Development server does not appear to be running" -ForegroundColor Yellow
    Write-Host "    Start it manually with: npm run dev"
    return
  }

  Write-Host "  ✓ Development server is running" -ForegroundColor Green
  Write-Host ""
  Write-Host "Let's verify the project is working correctly:"
  Write-Host ""

  # Prompt for verification
  Write-Host "Please verify the following:"
  Write-Host "  1) Open http://localhost:3000 in your browser"
  Write-Host "  2) Check if the interface loads correctly"
  Write-Host "  3) Try navigating to different pages"
  Write-Host ""
  $interfaceOk = Read-Host "Is the interface working correctly? (y/N)"

  if ($interfaceOk -match '^[yY]$') {
    Write-Host "  ✓ Interface verified" -ForegroundColor Green
  } else {
    Write-Host "  ! Interface may have issues. Check the browser console for errors." -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "Additional checks:"
  Write-Host "  4) Check http://localhost:2000/graphql (GraphQL Playground)"
  Write-Host "  5) Check http://localhost:4000 (Dashboard, if available)"
  Write-Host ""
  $servicesOk = Read-Host "Are all services working? (y/N)"

  if ($servicesOk -match '^[yY]$') {
    Write-Host "  ✓ All services verified" -ForegroundColor Green
  } else {
    Write-Host "  ! Some services may have issues. Check logs at $(Join-Path $env:TEMP "pearl-os-dev.log")" -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "  Next steps:" -ForegroundColor Cyan
  Write-Host "    • Keep the dev server running for development"
  Write-Host "    • View logs: Get-Content $(Join-Path $env:TEMP "pearl-os-dev.log") -Wait"
  Write-Host "    • Stop server: Stop-Process -Id (Get-Content $devPidFile)"
  Write-Host "    • Restart: npm run dev"
  Write-Host ""
}

# Ordered step catalog (keep in sync with setup.ps1 functions)
$Steps = @(
  @{ Id = "wizard_permissions";  Label = "Permissions / consent";                               Action = { Wizard-Permissions } },
  @{ Id = "assess_prerequisites"; Label = "Assess prerequisites (check what's missing, offer to install)"; Action = { Assess-Prerequisites } },
  @{ Id = "ensure_chocolatey";  Label = "Ensure Chocolatey is installed";                     Action = { Ensure-Chocolatey } },
  @{ Id = "ensure_system_deps"; Label = "Install system dependencies via Chocolatey";         Action = { Ensure-SystemDeps } },
  @{ Id = "test_prereqs";       Label = "Check prerequisites (node/npm/git/python/psql/etc)"; Action = { Test-Prerequisites } },
  @{ Id = "init_submodules";    Label = "Initialize git submodules (chorus-tts)";             Action = { Initialize-Submodules } },
  @{ Id = "npm_install";        Label = "Install npm dependencies";                           Action = { Install-NpmDeps } },
  @{ Id = "bot_deps";           Label = "Install bot Python dependencies (pipecat)";          Action = { Install-BotDeps } },
  @{ Id = "chorus_assets";      Label = "Download Chorus assets (Kokoro TTS)";                Action = { Download-ChorusAssets } },
  @{ Id = "setup_env";          Label = "Setup environment files (.env.local + app envs)";    Action = { Setup-Env } },
  @{ Id = "wizard_credentials"; Label = "Credentials (API keys → .env.local)";                 Action = { Wizard-Credentials } },
  @{ Id = "setup_postgres";     Label = "Setup PostgreSQL (includes seeding)";                Action = { Setup-Postgres } }
)

$Selected = @()
for ($i = 0; $i -lt $Steps.Count; $i++) { $Selected += $false }

function Set-PresetFull {
  for ($i = 0; $i -lt $Selected.Count; $i++) { $Selected[$i] = $true }
}

function Set-PresetMinimal {
  for ($i = 0; $i -lt $Selected.Count; $i++) { $Selected[$i] = $false }

  # Minimal: still ensures the platform can run; skip heavy/optional steps by default
  $Selected[0] = $true  # Permissions
  $Selected[1] = $true  # Assess-Prerequisites (NEW - check and offer to install missing basics)
  $Selected[2] = $true  # Ensure-Chocolatey
  $Selected[3] = $true  # Ensure-SystemDeps
  $Selected[4] = $true  # Test-Prerequisites
  $Selected[5] = $true  # Submodules
  $Selected[6] = $true  # npm install
  $Selected[9] = $true  # env
  $Selected[10] = $true # credentials
  $Selected[11] = $true # postgres (+ seed)
  $Selected[12] = $true # build_project
  $Selected[13] = $true # start_dev_server
  $Selected[14] = $true # functional_prompts
}

function Print-Steps {
  Write-Host ""
  Write-Host "Selected steps:" -ForegroundColor White
  for ($i = 0; $i -lt $Steps.Count; $i++) {
    $mark = if ($Selected[$i]) { "[x]" } else { "[ ]" }
    $n = $i + 1
    Write-Host ("  {0,2}) {1} {2}" -f $n, $mark, $Steps[$i].Label)
  }
  Write-Host ""
}

function Toggle-Step([int]$Index) {
  if ($Index -lt 0 -or $Index -ge $Selected.Count) { return }
  $Selected[$Index] = -not $Selected[$Index]
}

function Confirm-OrExit([string]$Prompt) {
  if ($NonInteractive) { return }
  $ans = Read-Host "$Prompt (y/N)"
  if ($ans -notmatch '^[yY]$') {
    Write-Host "Aborted." -ForegroundColor Yellow
    exit 0
  }
}

function Run-Selected {
  Print-Steps

  if ($DryRun) {
    Write-Host "Dry run only — nothing executed." -ForegroundColor Cyan
    return
  }

  Confirm-OrExit "Run the selected steps now?"

  $failures = 0

  for ($i = 0; $i -lt $Steps.Count; $i++) {
    if (-not $Selected[$i]) { continue }

    Write-Host ""
    Write-Host ("→ {0}" -f $Steps[$i].Label) -ForegroundColor Cyan
    Write-Host ""

    try {
      & $Steps[$i].Action
      Write-Host "  ✓ Step succeeded" -ForegroundColor Green
    } catch {
      $failures++
      Write-Host ("  ! Step failed: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
      if ((Is-Interactive) -and (-not $NonInteractive)) {
        $cont = Read-Host "Continue to next step? (Y/n)"
        if ($cont -match '^[nN]$') { break }
      }
    }
  }

  Write-Host ""
  if ($failures -eq 0) {
    Write-Host "All selected steps completed." -ForegroundColor Green
  } else {
    Write-Host ("Completed with {0} failure(s)." -f $failures) -ForegroundColor Yellow
    exit 1
  }
}

function Choose-PresetInteractive {
  Write-Host "Choose a setup preset:"
  Write-Host "  1) Full (everything)"
  Write-Host "  2) Minimal (recommended to start)"
  Write-Host "  3) Custom (toggle steps)"
  Write-Host "  4) Help"
  Write-Host "  5) Exit"
  Write-Host ""

  $choice = Read-Host "Select [1-5] (default: 2)"
  switch ($choice) {
    "1" { return "full" }
    "2" { return "minimal" }
    "3" { return "custom" }
    "4" { Usage; return $null }
    "5" { exit 0 }
    default { return "minimal" }
  }
}

function Custom-Menu {
  # Start from minimal, user can toggle on more
  Set-PresetMinimal

  while ($true) {
    Print-Steps
    Write-Host "Custom setup:"
    Write-Host "  - Enter a step number to toggle it"
    Write-Host "  - r = run selected steps"
    Write-Host "  - a = select all"
    Write-Host "  - n = select none"
    Write-Host "  - q = quit"
    Write-Host ""

    $cmd = Read-Host ">"
    switch -Regex ($cmd) {
      '^(r|R)$' { Run-Selected; return }
      '^(a|A)$' { Set-PresetFull; break }
      '^(n|N)$' { for ($i = 0; $i -lt $Selected.Count; $i++) { $Selected[$i] = $false }; break }
      '^(q|Q)$' { exit 0 }
      '^\d+$' {
        $idx = [int]$cmd - 1
        Toggle-Step $idx
        break
      }
      default { break }
    }
  }
}

Write-Banner

# Use TUI if available and interactive
if ($UseTui -and (Is-Interactive) -and (-not $NonInteractive)) {
  # Get preset from TUI
  if (-not $Preset) {
    $Preset = Call-TuiPreset
    if (-not $Preset) { $Preset = "minimal" }
  }

  # Get selected steps from TUI
  $tuiSteps = Call-TuiSteps $Preset
  if ($tuiSteps) {
    # Reset all to unselected
    for ($i = 0; $i -lt $Selected.Count; $i++) { $Selected[$i] = $false }
    # Map TUI step values to our indices (TUI uses bash step IDs, map to PowerShell step indices)
    foreach ($step in $tuiSteps) {
      switch ($step) {
        "permissions" { $Selected[0] = $true }
        "assess_prerequisites" { $Selected[1] = $true }
        "prerequisites" { $Selected[4] = $true }  # test_prereqs only (Choco/deps handled separately)
        "install_nodejs" { $Selected[2] = $true; $Selected[3] = $true }  # Choco + system deps
        "install_poetry" { $Selected[3] = $true }  # Part of ensure_system_deps
        "install_uv" { $Selected[3] = $true }  # Part of ensure_system_deps
        "init_submodules" { $Selected[5] = $true }
        "install_npm_deps" { $Selected[6] = $true }
        "install_bot_deps" { $Selected[7] = $true }
        "download_chorus_assets" { $Selected[8] = $true }
        "setup_env" { $Selected[9] = $true }
        "credentials" { $Selected[10] = $true }
        "setup_postgres" { $Selected[11] = $true }
        "build_project" { $Selected[12] = $true }
        "start_dev_server" { $Selected[13] = $true }
        "functional_prompts" { $Selected[14] = $true }
      }
      # If any install step is selected, ensure Chocolatey is available
      if ($step -match "install_(nodejs|poetry|uv)") {
        $Selected[2] = $true  # ensure_chocolatey
      }
    }
  }

  # Handle permissions via TUI
  if ($Selected[0]) {
    if (-not (Call-TuiPermissions)) {
      Write-Host "Setup aborted by user." -ForegroundColor Yellow
      exit 0
    }
  }

  # Handle credentials via TUI (if step is selected)
  if ($Selected[10]) {
    Call-TuiCredentials | Out-Null
  }

  # Run selected steps
  Run-Selected
  exit $LASTEXITCODE
}

# Fallback to simple prompts
if (-not $Preset) {
  if ((Is-Interactive) -and (-not $NonInteractive)) {
    $picked = Choose-PresetInteractive
    if ($null -eq $picked) { exit 0 }
    $Preset = $picked
  } else {
    $Preset = "minimal"
  }
}

if ($NonInteractive -and $Preset -eq "custom") {
  Write-Host "Error: -NonInteractive cannot be used with -Preset custom" -ForegroundColor Red
  exit 2
}

switch ($Preset) {
  "full" {
    Set-PresetFull
    Run-Selected
  }
  "minimal" {
    Set-PresetMinimal
    Run-Selected
  }
  "custom" {
    if ($NonInteractive) {
      Write-Host "Error: -NonInteractive cannot be used with -Preset custom" -ForegroundColor Red
      exit 2
    }
    Custom-Menu
  }
}



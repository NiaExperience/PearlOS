# Nia Universal - Universal Windows PowerShell Setup Script (Chocolatey-first)
# Run with: powershell -ExecutionPolicy Bypass -File setup.ps1
# Optional: setup.ps1 -SkipSystemInstall  (skip Choco installs; assume tools already present)
#
# This script sets up EVERYTHING needed to run Nia Universal locally:
# - Uses Chocolatey to install system tools (Node, Python, Git, PostgreSQL, Poetry, uv)
# - Creates all .env files with API key placeholders
# - Seeds the database with demo data
# - Configures the bot for voice features
#
# After running this, add your API keys to .env.local and run: npm run start:all

param(
    [switch]$SkipSystemInstall
)

$ErrorActionPreference = "Stop"
$script:PostgresReady = $false
$script:ChorusReady = $false

# Set NODE_ENV for Windows compatibility (PowerShell doesn't support VAR=value in npm scripts)
$env:NODE_ENV = "development"

# Choco installs: git, nodejs, python, uv, postgresql (latest). Poetry is not on Choco; we install via pip.

# Colors for output
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

function Write-Success { Write-ColorOutput Green $args }
function Write-Warning { Write-ColorOutput Yellow $args }
function Write-Error { Write-ColorOutput Red $args }
function Write-Info { Write-ColorOutput Cyan $args }

# Refresh environment variables from Registry (like Chocolatey's refreshenv)
function Refresh-Environment {
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    if ($machinePath -and $userPath) {
        $env:Path = "$machinePath;$userPath"
    } elseif ($machinePath) {
        $env:Path = $machinePath
    } elseif ($userPath) {
        $env:Path = $userPath
    }
    Write-Info "[OK] Environment refreshed. New paths are now active."
}

# Use Chocolatey's refreshenv if available; otherwise refresh PATH from Registry
# Note: refreshenv is often a *function* (no .Source); invoking .Source throws "Value cannot be null"
function Invoke-Refreshenv {
    $refreshenv = Get-Command refreshenv -ErrorAction SilentlyContinue
    if ($refreshenv) {
        try {
            if ($refreshenv.CommandType -eq 'Function' -or [string]::IsNullOrEmpty($refreshenv.Source)) {
                refreshenv 2>$null
            } else {
                & $refreshenv.Source 2>$null
            }
        } catch {
            Refresh-Environment
        }
        Write-Info "[OK] Environment refreshed."
    } else {
        Refresh-Environment
    }
}

# Generate random base64 secret
function Get-RandomBase64 {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    return [Convert]::ToBase64String($bytes)
}

function Write-Banner {
    Write-Info "==============================================================="
    Write-Info "        Nia Universal - Universal Setup (Windows)"
    Write-Info "==============================================================="
    Write-Output ""
}

function Test-Command {
    param([string]$Command)
    $null = Get-Command $Command -ErrorAction SilentlyContinue
    return $?
}

function Test-PythonVersion {
    if (Test-Command "python") {
        try {
            $pythonVersion = python --version 2>&1
            $versionMatch = $pythonVersion -match "Python (\d+)\.(\d+)"
            if ($versionMatch) {
                $major = [int]$matches[1]
                $minor = [int]$matches[2]
                if ($major -ge 3 -and $minor -ge 11) {
                    Write-Success "[OK] Python: $pythonVersion"
                    return $true
                }
                Write-Warning "[!] Python $pythonVersion found, but need 3.11+"
                return $false
            }
        } catch { }
    }
    return $false
}

# Ensure Chocolatey is installed; if not, install and ask user to re-run
function Ensure-Chocolatey {
    if (Test-Command "choco") {
        $chocoVersion = choco --version 2>$null
        Write-Success "[OK] Chocolatey: $chocoVersion"
        return $true
    }
    Write-Warning "[!] Chocolatey is not installed."
    Write-Output "   Installing Chocolatey (requires Administrator)..."
    try {
        Set-ExecutionPolicy Bypass -Scope Process -Force -ErrorAction SilentlyContinue
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
        iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    } catch {
        Write-Error "[X] Failed to install Chocolatey: $_"
        Write-Output ""
        Write-Output "   Install manually from: https://docs.chocolatey.org/en-us/choco/setup"
        Write-Output "   Then close this window, open a NEW PowerShell (as Administrator), and run setup.ps1 again."
        exit 1
    }
    Write-Success "[OK] Chocolatey installed. You must close this window, open a NEW PowerShell, and run setup.ps1 again."
    exit 0
}

# Install missing system dependencies via Chocolatey (version-agnostic: postgresql = latest)
# Poetry is NOT on Chocolatey (0 packages); we install it via pip after Choco.
function Ensure-SystemDeps {
    Write-Warning "[1/7] Ensuring system dependencies (Chocolatey)..."
    $toInstall = @()
    if (-not (Test-Command "git"))   { $toInstall += "git" }
    if (-not (Test-Command "node")) { $toInstall += "nodejs" }
    if (-not (Test-Command "python")) { $toInstall += "python" }
    # Poetry: not available on Chocolatey (community has 0 packages). Install via pip below.
    if (-not (Test-Command "uv")) { $toInstall += "uv" }
    if (-not (Test-Command "psql")) { $toInstall += "postgresql" }
    if ($toInstall.Count -gt 0) {
        Write-Warning "[*] Installing via Chocolatey: $($toInstall -join ', ')"
        & choco install $toInstall -y
        if ($LASTEXITCODE -ne 0) {
            Write-Error "[X] Chocolatey install failed. Fix errors above and re-run, or install manually."
            exit 1
        }
        Invoke-Refreshenv
    } else {
        Write-Success "[OK] Choco-managed tools already present."
        Invoke-Refreshenv
    }
    # Install Poetry via pip (Chocolatey has no poetry package)
    if (-not (Test-Command "poetry") -and (Test-Command "pip")) {
        Write-Warning "[*] Installing Poetry via pip (not on Chocolatey)..."
        # Temporarily allow errors (warnings) because pip writes to stderr
        $oldErrorAction = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            pip install --user poetry
        } catch {
            Write-Warning "Pip threw a warning, but we are ignoring it."
        }
        $ErrorActionPreference = $oldErrorAction
        if ($LASTEXITCODE -eq 0) {
            $userScripts = python -c "import site; print(site.getuserbase())" 2>$null
            if ($userScripts) {
                $scriptsPath = Join-Path $userScripts "Scripts"
                if (Test-Path (Join-Path $scriptsPath "poetry.exe")) {
                    $env:Path = "$scriptsPath;$env:Path"
                    $up = [Environment]::GetEnvironmentVariable("Path", "User")
                    if ([string]::IsNullOrWhiteSpace($up) -or $up -notlike "*$scriptsPath*") {
                        [Environment]::SetEnvironmentVariable("Path", "$scriptsPath;$up", "User")
                    }
                }
            }
            Invoke-Refreshenv
            Write-Success "[OK] Poetry installed via pip."
        }
    }
    Write-Output ""
}

# Check prerequisites; exit with one-liner if missing (unless -SkipSystemInstall)
function Test-Prerequisites {
    Write-Warning "[1/7] Checking prerequisites..."
    $missing = @()
    if (-not (Test-Command "node")) { $missing += "node (Node.js)" }
    if (-not (Test-Command "npm"))  { $missing += "npm" }
    if (-not (Test-Command "git"))  { $missing += "git" }
    if (-not (Test-PythonVersion)) { $missing += "Python 3.11+" }
    if (-not (Test-Command "psql")) { $missing += "psql (PostgreSQL)" }
    if (-not (Test-Command "poetry")) { $missing += "poetry" }
    if (-not (Test-Command "uv")) { $missing += "uv" }
    if ($missing.Count -eq 0) {
        Write-Success "[OK] node: $(node --version 2>$null); npm: $(npm --version 2>$null); git, Python 3.11+, psql, poetry, uv present."
        Write-Output ""
        return
    }
    Write-Error "[X] Missing: $($missing -join ', ')"
    Write-Output ""
    Write-Output "   Run in an elevated PowerShell (Administrator), then re-run this script:"
    Write-ColorOutput Cyan "   choco install git nodejs python postgresql uv -y"
    Write-Output "   pip install --user poetry"
    Write-Output ""
    Write-Output "   (Poetry is not on Chocolatey; install it with pip after Choco.)"
    Write-Output "   Then close and reopen PowerShell before running setup.ps1 again."
    exit 1
}

# Initialize git submodules
function Initialize-Submodules {
    Write-Warning "[2/7] Initializing git submodules..."
    $chorusDir = "apps\chorus-tts"

    if (Test-Path "$chorusDir\.git") {
        $script:ChorusReady = $true
        Write-Success "[OK] Submodules already initialized"
        Write-Output ""
        return
    }

    if (Test-Path $chorusDir) {
        $hasFiles = (Get-ChildItem $chorusDir -Force | Where-Object { $_.Name -ne ".git" }) -ne $null
        if ($hasFiles) {
            $script:ChorusReady = $false
            Write-Warning "[!] apps/chorus-tts exists but is not a git submodule."
            Write-Output "   Skipping submodule init to avoid overwriting local files."
            Write-Output ""
            return
        }
    }

    cmd /c "git submodule update --init --recursive apps/chorus-tts >nul 2>&1"
        if ($LASTEXITCODE -eq 0) {
            $script:ChorusReady = $true
            Write-Success "[OK] Submodules initialized"
        } else {
            $script:ChorusReady = $false
        Write-Warning "[!] Could not initialize chorus-tts submodule"
    }
    Write-Output ""
}

# Install npm dependencies
function Install-NpmDeps {
    Write-Warning "[3/7] Installing npm dependencies..."
    Write-Progress -Activity "Installing npm packages" -Status "Installing Node.js dependencies (this may take several minutes)..." -PercentComplete 0
    npm install
    Write-Progress -Activity "Installing npm packages" -Completed
    if ($LASTEXITCODE -eq 0) {
        Write-Success "[OK] Dependencies installed"
    } else {
        Write-Error "[X] npm install failed"
        exit 1
    }
    Write-Output ""
}

# Install bot Python dependencies
function Install-BotDeps {
    Write-Warning "[4/7] Installing bot Python dependencies..."
    
    # Try to find poetry even if not in PATH
    $poetryCmd = $null
    if (Test-Command "poetry") {
        $poetryCmd = "poetry"
    } else {
        # Try to find poetry.exe in Python user Scripts
        $userBase = python -c "import site; print(site.getuserbase())" 2>$null
        if ($userBase) {
            $poetryExe = Join-Path (Join-Path $userBase "Scripts") "poetry.exe"
            if (Test-Path $poetryExe) {
                $poetryCmd = $poetryExe
                Write-Success "[OK] Found Poetry at: $poetryExe"
            }
        }
    }
    
    if (-not $poetryCmd) {
        Write-Warning "[!] Poetry not found. Skipping bot dependencies."
        Write-Output "    Install Poetry first, then run: cd apps/pipecat-daily-bot/bot && poetry install"
        Write-Output ""
        return
    }
    
    $originalLocation = Get-Location
    Set-Location "apps\pipecat-daily-bot\bot"
    
    if (-not (Test-Path "pyproject.toml")) {
        Write-Error "[X] pyproject.toml not found in apps/pipecat-daily-bot/bot"
        Set-Location $originalLocation
        return
    }
    
    Write-Warning "[*] Installing Python dependencies via Poetry..."
    Write-Progress -Activity "Installing Python dependencies" -Status "Installing bot Python packages (this may take a few minutes)..." -PercentComplete 0
    
    # Use the poetry command (either "poetry" or full path to poetry.exe)
    # NOTE:
    #  - Poetry can emit noisy messages like "Installing ... over existing file" on stderr
    #  - PowerShell treats some of these as NativeCommandError when $ErrorActionPreference = "Stop"
    #  - To avoid aborting the whole setup on harmless warnings, we temporarily relax error handling
    $previousErrorPreference = $ErrorActionPreference
    $poetryExitCode = 0

    try {
        $ErrorActionPreference = "Continue"
        
        & $poetryCmd install --no-root --only main --no-interaction 2>&1 | Out-Null
        $poetryExitCode = $LASTEXITCODE

        Write-Progress -Activity "Installing Python dependencies" -Status "Verifying installation..." -PercentComplete 90

        if ($poetryExitCode -eq 0) {
            Write-Success "[OK] Bot Python dependencies installed"
        } else {
            Write-Warning "[!] Poetry install reported a non-zero exit code ($poetryExitCode). Retrying with full install..."
            & $poetryCmd install --no-interaction 2>&1 | Out-Null
            $poetryExitCode = $LASTEXITCODE

            if ($poetryExitCode -eq 0) {
                Write-Success "[OK] Bot Python dependencies installed on retry"
            } else {
                Write-Warning "[!] Poetry install did not complete cleanly (exit code $poetryExitCode)."
                Write-Warning "[!] This is often a benign warning (e.g., 'Installing ... over existing file')."
                Write-Output "    You can verify manually with:"
                Write-Output "      cd apps/pipecat-daily-bot/bot"
                Write-Output "      poetry run python --version"
                Write-Output "      poetry install --no-root --only main"
                Write-Warning "[!] Setup will continue, but voice features may not work until bot deps are fixed."
            }
        }
    } catch {
        Write-Warning "[!] Poetry encountered an error while installing bot dependencies."
        Write-Warning "[!] This may be a harmless NativeCommandError from stderr output."
        Write-Output "    To complete manually, run:"
        Write-Output "      cd apps/pipecat-daily-bot/bot"
        Write-Output "      poetry install --no-root --only main"
        Write-Warning "[!] Continuing setup without blocking on Poetry."
    } finally {
        $ErrorActionPreference = $previousErrorPreference
    }
    
    Write-Progress -Activity "Installing Python dependencies" -Completed
    Set-Location $originalLocation
    Write-Output ""
}

# Download Chorus assets
function Download-ChorusAssets {
    Write-Warning "[5/7] Checking Kokoro TTS model files..."

    if (-not $script:ChorusReady) {
        Write-Warning "[!] Chorus submodule not available; skipping asset download."
        Write-Output "   Fix submodule access, then run: npm run chorus:download-assets"
        Write-Output ""
        return
    }
    
    if ((Test-Path "apps\chorus-tts\kokoro-v1.0.onnx") -and (Test-Path "apps\chorus-tts\voices-v1.0.bin")) {
        Write-Success "[OK] Model files already present"
    } else {
        Write-Warning "[*] Downloading Kokoro model files (~550MB)..."
        Write-Progress -Activity "Downloading Chorus TTS Models" -Status "Downloading model files (this may take several minutes)..." -PercentComplete 0
        
        $currentDir = Get-Location
        $job = Start-Job -ScriptBlock { 
            Set-Location $using:currentDir
            npm run chorus:download-assets 2>&1 | Out-Null
        }
        
        # Show progress while downloading
        $dots = 0
        while ($job.State -eq "Running") {
            $dots = ($dots + 1) % 4
            $status = "Downloading" + ("." * $dots) + " (~550MB)"
            Write-Progress -Activity "Downloading Chorus TTS Models" -Status $status -PercentComplete -1
            Start-Sleep -Milliseconds 500
        }
        $result = Receive-Job $job
        Remove-Job $job
        Write-Progress -Activity "Downloading Chorus TTS Models" -Completed
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "[OK] Model files downloaded"
        } else {
            Write-Warning "[!] Could not download model files. Voice features may not work."
            Write-Output "    Run manually later: npm run chorus:download-assets"
        }
    }
    Write-Output ""
}

# Create bot .env file
function New-BotEnv {
    Write-Warning "[*] Creating bot .env file..."
    
    $botEnvPath = "apps\pipecat-daily-bot\.env"
    
    # Read API keys from root .env.local if it exists
    $dailyApiKey = "__DAILY_API_KEY_PLACEHOLDER__"
    $openaiApiKey = "__OPENAI_API_KEY_PLACEHOLDER__"
    $meshApiEndpoint = "http://localhost:2000/api"
    
    if (Test-Path ".env.local") {
        $envContent = Get-Content ".env.local" -Raw
        if ($envContent -match "DAILY_API_KEY=(.+)") {
            $dailyApiKey = $matches[1].Trim().Trim('"')
        }
        if ($envContent -match "OPENAI_API_KEY=(.+)") {
            $openaiApiKey = $matches[1].Trim().Trim('"')
        }
        if ($envContent -match "MESH_API_ENDPOINT=(.+)") {
            $meshApiEndpoint = $matches[1].Trim().Trim('"')
        }
    }
    
    # Create bot .env from template
    if (Test-Path "apps\pipecat-daily-bot\env.example") {
        Copy-Item "apps\pipecat-daily-bot\env.example" $botEnvPath
        
        # Update with values from root .env.local if available
        $content = Get-Content $botEnvPath -Raw
        $content = $content -replace "your_daily_api_key_here", $dailyApiKey
        $content = $content -replace "your_openai_api_key_here", $openaiApiKey
        $content = $content -replace "http://localhost:2000", $meshApiEndpoint
        Set-Content $botEnvPath $content
        
        Write-Success "[OK] Bot .env file created"
    } else {
        Write-Warning "[!] Bot env.example not found. Creating minimal .env..."
        @"
# Daily Pipecat Bot Configuration
USE_REDIS=false
DAILY_API_KEY=$dailyApiKey
DAILY_ROOM_URL=__DAILY_ROOM_URL_PLACEHOLDER__
OPENAI_API_KEY=$openaiApiKey
MESH_API_ENDPOINT=$meshApiEndpoint
KOKORO_TTS_BASE_URL=ws://127.0.0.1:8000
KOKORO_TTS_VOICE_ID=af_heart
"@ | Set-Content $botEnvPath
        Write-Success "[OK] Bot .env file created"
    }
}

# Setup environment file
function Setup-Env {
    Write-Warning "[6/7] Setting up environment files..."
    
    $rootExists = Test-Path ".env.local"
    $interfaceExists = Test-Path "apps\interface\.env.local"
    $dashboardExists = Test-Path "apps\dashboard\.env.local"
    $meshExists = Test-Path "apps\mesh\.env.local"
    $botExists = Test-Path "apps\pipecat-daily-bot\.env"
    
    # If any env files exist, ask what to do
    if ($rootExists -or $interfaceExists -or $dashboardExists -or $meshExists -or $botExists) {
        Write-Output ""
        Write-Warning "  Existing environment files detected:"
        if ($rootExists) { Write-Output "    - .env.local (root)" }
        if ($interfaceExists) { Write-Output "    - apps/interface/.env.local" }
        if ($dashboardExists) { Write-Output "    - apps/dashboard/.env.local" }
        if ($meshExists) { Write-Output "    - apps/mesh/.env.local" }
        if ($botExists) { Write-Output "    - apps/pipecat-daily-bot/.env" }
        Write-Output ""
        Write-Output "  What would you like to do?"
        Write-Output "    1) Keep all existing env files (just sync secrets)"
        Write-Output "    2) Recreate root .env.local only (recommended - apps will sync from root)"
        Write-Output "    3) Clear ALL and recreate from scratch"
        Write-Output ""
        $envChoice = Read-Host "  Choose option [1-3] (default: 1)"
        
        switch ($envChoice) {
            "1" {
                Write-Output ""
                Write-Success "[OK] Keeping existing env files"
                if ($rootExists) {
                    Write-Warning "[*] Syncing secrets to app env files..."
                    npm run sync:env 2>&1 | Out-Null
                    Write-Success "[OK] Env files synced"
                }
                if (-not $botExists) {
                    New-BotEnv
                }
                Write-Output ""
                return
            }
            "2" {
                Write-Output ""
                Write-Warning "[*] Recreating root .env.local..."
                # Continue to create root .env.local
            }
            "3" {
                Write-Output ""
                Write-Warning "[*] Clearing all env files..."
                if ($rootExists) { Remove-Item ".env.local" -ErrorAction SilentlyContinue }
                if ($interfaceExists) { Remove-Item "apps\interface\.env.local" -ErrorAction SilentlyContinue }
                if ($dashboardExists) { Remove-Item "apps\dashboard\.env.local" -ErrorAction SilentlyContinue }
                if ($meshExists) { Remove-Item "apps\mesh\.env.local" -ErrorAction SilentlyContinue }
                if ($botExists) { Remove-Item "apps\pipecat-daily-bot\.env" -ErrorAction SilentlyContinue }
                Write-Success "[OK] All env files cleared"
            }
            default {
                Write-Output ""
                Write-Success "[OK] Keeping existing env files (default)"
                npm run sync:env 2>&1 | Out-Null
                if (-not $botExists) {
                    New-BotEnv
                }
                Write-Output ""
                return
            }
        }
    }
    
    # Create root .env.local from template
    Write-Warning "[*] Creating root .env.local from template..."
        Copy-Item "config\env.minimal.example" ".env.local"
        
        # Generate secrets
    Write-Warning "[*] Generating secure secrets..."
        $nextauthSecret = Get-RandomBase64
        $meshSecret = Get-RandomBase64
        $tokenKey = Get-RandomBase64
        $botSecret = Get-RandomBase64
        
    # Update .env.local with generated secrets
    $content = Get-Content ".env.local" -Raw
    $content = $content -replace "__NEXTAUTH_SECRET_PLACEHOLDER__", $nextauthSecret
    $content = $content -replace "__MESH_SHARED_SECRET_PLACEHOLDER__", $meshSecret
    $content = $content -replace "__TOKEN_ENCRYPTION_KEY_PLACEHOLDER__", $tokenKey
    $content = $content -replace "__BOT_CONTROL_SHARED_SECRET_PLACEHOLDER__", $botSecret
    Set-Content ".env.local" $content
        
        Write-Success "[OK] Root .env.local created with generated secrets"
        
        # Sync to app-specific env files
        Write-Warning "[*] Syncing secrets to app env files..."
        npm run sync:env 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
            Write-Warning "[!] Could not auto-sync. Run 'npm run sync:env' manually after npm install."
        }
        
    # Create bot .env file
    New-BotEnv
    
    Write-Success "[OK] All env files configured"
    Write-Output ""
    Write-Info "  Next: Add your API keys to .env.local:"
    Write-Output "     - DAILY_API_KEY (get from https://dashboard.daily.co)"
    Write-Output "     - OPENAI_API_KEY (get from https://platform.openai.com/api-keys)"
    Write-Output "     - DEEPGRAM_API_KEY (get from https://console.deepgram.com/)"
    Write-Output ""
}

# Discover existing PostgreSQL bin path (e.g. user has PG 17 but not on PATH)
function Get-PostgreSQLBinPath {
    $roots = @("C:\Program Files", "C:\Program Files (x86)")
    foreach ($root in $roots) {
        $pgRoot = Join-Path $root "PostgreSQL"
        if (-not (Test-Path $pgRoot)) { continue }
        $versions = Get-ChildItem -Path $pgRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
        foreach ($ver in $versions) {
            $binPath = Join-Path $ver.FullName "bin"
            if (Test-Path (Join-Path $binPath "psql.exe")) { return $binPath }
        }
    }
    return $null
}

# Setup PostgreSQL (version-agnostic: use existing psql or Choco postgresql = latest)
function Setup-Postgres {
    Write-Warning "[7/7] Setting up PostgreSQL..."
    
    $psqlCmd = $null
    
    # 1. Already in PATH (any version: 16, 17, 18, etc.)
    if (Test-Command "psql") {
        $psqlCmd = "psql"
        Write-Success "[OK] PostgreSQL is already in PATH: $(psql --version 2>&1 | Select-Object -First 1)"
    }
    
    # 2. Not in PATH: discover existing install (e.g. PG 17 installed but PATH not set)
    if (-not $psqlCmd) {
        $pgBinPath = Get-PostgreSQLBinPath
        if ($pgBinPath) {
            $psqlCmd = Join-Path $pgBinPath "psql.exe"
            $env:Path = "$pgBinPath;$env:Path"
            Set-Alias -Name psql -Value $psqlCmd -Scope Global -Force
            if (Test-Path "$pgBinPath\createdb.exe") {
                Set-Alias -Name createdb -Value "$pgBinPath\createdb.exe" -Scope Global -Force
            }
            $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
            if ($userPath -notlike "*$pgBinPath*") {
                [Environment]::SetEnvironmentVariable("Path", "$pgBinPath;$userPath", "User")
                Invoke-Refreshenv
            }
            Write-Success "[OK] Found existing PostgreSQL at: $pgBinPath"
        }
    }
    
    # 3. Install via Chocolatey (postgresql = latest; do not hardcode postgresql16)
    if (-not $psqlCmd -and (Test-Command "choco")) {
        Write-Warning "[!] PostgreSQL not found. Installing via Chocolatey (postgresql = latest)..."
        choco install postgresql -y
        if ($LASTEXITCODE -eq 0) {
            Start-Sleep -Seconds 15
            Invoke-Refreshenv
            if (Test-Command "psql") {
                $psqlCmd = "psql"
                Write-Success "[OK] PostgreSQL installed and available."
            }
        }
    }
    
    # 4. Retry discovery after Choco (PATH may not have refreshed yet)
    if (-not $psqlCmd) {
        Invoke-Refreshenv
        if (Test-Command "psql") {
            $psqlCmd = "psql"
        } else {
            $pgBinPath = Get-PostgreSQLBinPath
            if ($pgBinPath) {
                $psqlCmd = Join-Path $pgBinPath "psql.exe"
                $env:Path = "$pgBinPath;$env:Path"
                Set-Alias -Name psql -Value $psqlCmd -Scope Global -Force
                if (Test-Path "$pgBinPath\createdb.exe") {
                    Set-Alias -Name createdb -Value "$pgBinPath\createdb.exe" -Scope Global -Force
                }
                Write-Success "[OK] Found PostgreSQL after install: $pgBinPath"
            }
        }
    }
    
    if (-not $psqlCmd) {
        Write-Error "[X] PostgreSQL not found. Install manually, then re-run setup.ps1:"
        Write-Output "   choco install postgresql -y"
        Write-Output "   Or: https://www.postgresql.org/download/windows/"
        return
    }

    # ----------------------------------------------------------------
    # STEP 3: CONFIGURE DATABASE
    # ----------------------------------------------------------------
    Write-Success "[OK] Using PostgreSQL: $psqlCmd"

    # Start Service
    $pgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pgService -and $pgService.Status -ne "Running") {
        Write-Warning "[*] Starting service..."
        try { 
            Start-Service -Name $pgService.Name -ErrorAction Stop
            Write-Success "[OK] PostgreSQL service started"
        } catch {
            Write-Warning "[!] Could not start PostgreSQL service automatically"
        }
    } elseif ($pgService) {
        Write-Success "[OK] PostgreSQL service is running"
    }

    Write-Warning "[*] Configuring database..."
    $POSTGRES_PASSWORD = "password"
    $env:PGPASSWORD = $POSTGRES_PASSWORD
    
    # Set Password (try/catch to avoid red text if connection fails initially)
    $passwordSet = $false
    try {
        if ($psqlCmd -eq "psql") {
            psql -U postgres -c "ALTER USER postgres WITH PASSWORD '$POSTGRES_PASSWORD';" 2>$null | Out-Null
        } else {
            & $psqlCmd -U postgres -c "ALTER USER postgres WITH PASSWORD '$POSTGRES_PASSWORD';" 2>&1 | Out-Null
        }
        if ($LASTEXITCODE -eq 0) {
            $passwordSet = $true
            Write-Success "[OK] PostgreSQL password set to: $POSTGRES_PASSWORD"
        }
    } catch {
        # Retry with 'postgres' as password if 'password' failed
        $env:PGPASSWORD = "postgres"
        if ($psqlCmd -eq "psql") {
            psql -U postgres -c "ALTER USER postgres WITH PASSWORD '$POSTGRES_PASSWORD';" 2>$null | Out-Null
        } else {
            & $psqlCmd -U postgres -c "ALTER USER postgres WITH PASSWORD '$POSTGRES_PASSWORD';" 2>&1 | Out-Null
        }
        if ($LASTEXITCODE -eq 0) {
            $passwordSet = $true
            Write-Success "[OK] PostgreSQL password set to: $POSTGRES_PASSWORD"
        }
        $env:PGPASSWORD = $POSTGRES_PASSWORD
    }
    
    # Verify password is correct
    if ($psqlCmd -eq "psql") {
        $testConn = psql -h localhost -U postgres -d postgres -c "SELECT 1;" 2>&1
    } else {
        $testConn = & $psqlCmd -h localhost -U postgres -d postgres -c "SELECT 1;" 2>&1
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "[!] Could not verify PostgreSQL connection. Continuing anyway..."
    }

    # Create Database
    $dbCheck = if ($psqlCmd -eq "psql") {
        psql -U postgres -lqt 2>&1 | Select-String "testdb"
    } else {
        & $psqlCmd -U postgres -lqt 2>&1 | Select-String "testdb"
    }
    
    if (-not $dbCheck) {
        $createdbCmd = if ($psqlCmd -eq "psql") { "createdb" } else { Join-Path (Split-Path $psqlCmd) "createdb.exe" }
        if ($createdbCmd -eq "createdb") {
            createdb -U postgres testdb 2>&1 | Out-Null
        } else {
            & $createdbCmd -U postgres testdb 2>&1 | Out-Null
        }
        if ($LASTEXITCODE -eq 0) {
            Write-Success "[OK] Database 'testdb' created"
        } else {
            Write-Warning "[!] Could not create database. It may already exist."
        }
    } else {
        Write-Success "[OK] Database 'testdb' exists"
    }
    
    # Verify database is accessible
    if ($psqlCmd -eq "psql") {
        $testDb = psql -h localhost -U postgres -d testdb -c "SELECT 1;" 2>&1
    } else {
        $testDb = & $psqlCmd -h localhost -U postgres -d testdb -c "SELECT 1;" 2>&1
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "[!] Database 'testdb' exists but connection test failed. Continuing anyway..."
    }

    # Update .env.local
    if (Test-Path ".env.local") {
        $envContent = Get-Content ".env.local" -Raw
        # Smart regex replace to avoid duplicating keys
        if ($envContent -match "POSTGRES_PASSWORD=") {
            $envContent = $envContent -replace "POSTGRES_PASSWORD=.*", "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
        } else {
            $envContent += "`nPOSTGRES_PASSWORD=$POSTGRES_PASSWORD"
        }
        
        if ($envContent -match "POSTGRES_DB=") {
            $envContent = $envContent -replace "POSTGRES_DB=.*", "POSTGRES_DB=testdb"
        } else {
            $envContent += "`nPOSTGRES_DB=testdb"
        }
        
        Set-Content ".env.local" $envContent -NoNewline
        Write-Success "[OK] Updated .env.local with DB credentials"
        
        # Sync to app env files
        if (Test-Command "npm") {
            Write-Warning "[*] Syncing PostgreSQL credentials to all app env files..."
            npm run sync:env 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Success "[OK] Credentials synced to all app env files"
            } else {
                Write-Warning "[!] Could not sync (run 'npm run sync:env' manually)"
            }
        }
    }

    # Seed
    if (Test-Command "npm") {
        Write-Output ""
        Write-Warning "[*] Seeding database with initial data..."
        Write-Output "  This will create:"
        Write-Output "    • Pearl assistant (configured for local development)"
        Write-Output "    • Demo user for Interface (demo@local.dev / password123)"
        Write-Output "    • Admin user for Dashboard (admin@local.dev / admin123)"
        Write-Output "    • Sample notes and content"
        Write-Output ""
        
        $env:NODE_ENV = "development"
        npm run pg:seed 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "[OK] Database seeded successfully"
        } else {
            Write-Warning "[!] Database seeding failed or data already exists"
            Write-Output "   You can run manually later: npm run pg:seed"
        }
        
        # Seed functional prompts
        Write-Output ""
        Write-Warning "[*] Seeding functional prompts..."
        Write-Output "  This will create functional prompt definitions for bot tools"
        Write-Output ""
        
        npm run pg:seed-prompts 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "[OK] Functional prompts seeded successfully"
        } else {
            Write-Warning "[!] Functional prompt seeding failed or prompts already exist"
            Write-Output "   You can run manually later: npm run pg:seed-prompts"
        }
    }
    
    Write-Success "[OK] PostgreSQL ready and seeded"
    Write-Output ""
}

# Main setup function
function Main {
    Write-Banner
    if (-not $SkipSystemInstall) {
        if (-not (Test-Command "choco")) {
            Ensure-Chocolatey
        }
        Ensure-SystemDeps
        Invoke-Refreshenv
    }
    Test-Prerequisites
    
    Initialize-Submodules
    Install-NpmDeps
    Install-BotDeps
    Download-ChorusAssets
    Setup-Env
    Setup-Postgres
    
    Write-Success "==============================================================="
    Write-Success "  [OK] SETUP COMPLETE!"
    Write-Success "==============================================================="
    Write-Output ""
    
    # Final instructions
    Write-Info "==============================================================="
    Write-Info "  NEXT STEPS"
    Write-Info "==============================================================="
    Write-Output ""
    Write-Warning "1. Add your API keys to .env.local:"
    Write-Output "   - DAILY_API_KEY (get from https://dashboard.daily.co)"
    Write-Output "   - OPENAI_API_KEY (get from https://platform.openai.com/api-keys)"
    Write-Output "   - DEEPGRAM_API_KEY (get from https://console.deepgram.com/)"
    Write-Output ""
    Write-Warning "2. Start the platform:"
    Write-Output "   npm run start:all"
    Write-Output ""
    Write-Warning "3. Access the apps:"
    Write-Output "   - Interface:   http://localhost:3000/pearlos"
    Write-Output "   - Dashboard:   http://localhost:4000"
    Write-Output "   - GraphQL:     http://localhost:2000/graphql"
    Write-Output ""
    Write-Warning "4. Login credentials:"
    Write-Output "   Interface:  demo@local.dev / password123"
    Write-Output "   Dashboard:  admin@local.dev / admin123"
    Write-Output ""
    Write-Warning "5. For voice features:"
    Write-Output "   - Start TTS:  npm run chorus:start (in separate terminal)"
    Write-Output "   - Bot will auto-start when you join a voice call"
    Write-Output ""
    Write-Info "==============================================================="
    Write-Output ""
}

# Run main only when executed directly (not when dot-sourced)
if ($MyInvocation.InvocationName -ne '.') {
    Main
}

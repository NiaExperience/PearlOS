param(
    [switch]$Yes
)

$ErrorActionPreference = "Stop"

function Write-Info { Write-Host $args -ForegroundColor Cyan }
function Write-Warn { Write-Host $args -ForegroundColor Yellow }
function Write-Err { Write-Host $args -ForegroundColor Red }
function Write-Ok { Write-Host $args -ForegroundColor Green }

function Test-Command {
    param([string]$Command)
    $null = Get-Command $Command -ErrorAction SilentlyContinue
    return $?
}

function Confirm-Or-Exit {
    if ($Yes) { return }
    Write-Warn "This will remove project dependencies AND uninstall system tools."
    Write-Warn "Tools targeted: Node/npm, Python, Poetry, uv, Docker."
    $answer = Read-Host "Type YES to continue"
    if ($answer -ne "YES") {
        Write-Info "Cancelled."
        exit 1
    }
}

function Remove-PathSafe {
    param([string]$Path)
    if (Test-Path $Path) {
        Remove-Item -Path $Path -Recurse -Force -ErrorAction SilentlyContinue
        Write-Info "Removed: $Path"
    }
}

function Remove-Project-Dependencies {
    Write-Info "Removing project dependencies and build outputs..."

    # node_modules anywhere
    Get-ChildItem -Path . -Recurse -Directory -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq "node_modules" } |
        ForEach-Object { Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }

    # Common build/cache dirs
    $paths = @(
        ".turbo", ".next", "dist", "coverage", ".clinic", ".jest-cache",
        "apps\pipecat-daily-bot\ui\dist",
        "apps\pipecat-daily-bot\bot\__pycache__",
        "apps\pipecat-daily-bot\bot\.pytest_cache",
        "apps\pipecat-daily-bot\bot\.ruff_cache",
        "packages\events\python\build",
        "packages\events\python\dist",
        "packages\events\python\.pytest_cache"
    )
    foreach ($p in $paths) { Remove-PathSafe $p }

    # Python virtualenvs
    Get-ChildItem -Path . -Recurse -Directory -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in @(".venv", "venv") } |
        ForEach-Object { Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }

    Write-Ok "Project cleanup complete."
}

function Uninstall-Python-Tools {
    Write-Info "Uninstalling Poetry and uv..."
    if (Test-Command "pipx") {
        pipx uninstall poetry | Out-Null
        pipx uninstall uv | Out-Null
    }
    if (Test-Command "python") {
        python -m pip uninstall -y poetry | Out-Null
        python -m pip uninstall -y uv | Out-Null
    }
}

function Uninstall-With-Winget {
    param([string[]]$Ids)
    if (-not (Test-Command "winget")) { return }
    foreach ($id in $Ids) {
        winget uninstall --id $id --silent --accept-source-agreements --accept-package-agreements | Out-Null
    }
}

function Uninstall-With-Choco {
    param([string[]]$Ids)
    if (-not (Test-Command "choco")) { return }
    foreach ($id in $Ids) {
        choco uninstall $id -y | Out-Null
    }
}

function Uninstall-With-Scoop {
    param([string[]]$Ids)
    if (-not (Test-Command "scoop")) { return }
    foreach ($id in $Ids) {
        scoop uninstall $id | Out-Null
    }
}

function Uninstall-System-Tools {
    Write-Info "Uninstalling system tools (Node, Python, Docker)..."

    Uninstall-With-Winget @(
        "OpenJS.NodeJS",
        "Python.Python.3.13",
        "Python.Python.3.12",
        "Python.Python.3.11",
        "Docker.DockerDesktop"
    )

    Uninstall-With-Choco @(
        "nodejs", "python", "python3", "docker-desktop"
    )

    Uninstall-With-Scoop @(
        "nodejs", "python", "python310", "python311", "python312", "python313", "docker"
    )
}

Confirm-Or-Exit
Remove-Project-Dependencies
Uninstall-Python-Tools
Uninstall-System-Tools

Write-Ok "Done. You may need to reboot for PATH changes."

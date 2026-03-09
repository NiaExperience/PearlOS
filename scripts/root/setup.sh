#!/usr/bin/env bash
# ============================================================
# Nia Universal - Universal Cross-Platform Setup Script
# ============================================================
# Supports: Linux, macOS, Windows (via Git Bash/WSL)
# 
# This script sets up EVERYTHING needed to run Nia Universal locally:
# - Installs all dependencies (Node, Python, Poetry, uv, etc.)
# - Creates all .env files with API key placeholders
# - Seeds the database with demo data
# - Configures the bot for voice features
# 
# After running this, just add your API keys to .env.local and run: npm run start:all
# ============================================================

# NOTE:
# - When executed directly, this script runs in strict mode.
# - When sourced (e.g., by `new-setup.sh`), it must NOT mutate the caller shell options.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    set -euo pipefail
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Linux*)     echo "linux" ;;
        Darwin*)    echo "macos" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *)          echo "unknown" ;;
    esac
}

OS=$(detect_os)

print_banner() {
    echo ""
    echo -e "${BLUE}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}${BOLD}        Nia Universal - Universal Setup${NC}"
    echo -e "${BLUE}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${CYAN}Detected OS: ${OS}${NC}"
    echo ""
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Generate a random secret
generate_secret() {
    if command_exists openssl; then
        openssl rand -base64 32
    elif command_exists python3; then
        python3 -c "import secrets; print(secrets.token_urlsafe(32))"
    else
        # Fallback - less secure but works
        head -c 32 /dev/urandom | base64 | tr -d '\n'
    fi
}

# Spinner function for showing progress
spinner() {
    local pid=$1
    local message=$2
    local spin='-\|/'
    local i=0
    while kill -0 $pid 2>/dev/null; do
        i=$(( (i+1) %4 ))
        printf "\r${YELLOW}  ${message} ${spin:$i:1}${NC}"
        sleep 0.1
    done
    printf "\r"
}

# Show progress with dots
show_progress() {
    local pid=$1
    local message=$2
    local dots=0
    while kill -0 $pid 2>/dev/null; do
        dots=$(( (dots + 1) % 4 ))
        printf "\r${YELLOW}  ${message}$(printf '.%.0s' $(seq 1 $dots))$(printf ' %.0s' $(seq 1 $((3 - dots))))${NC}"
        sleep 0.5
    done
    printf "\r"
}

# Check Python version
check_python_version() {
    if command_exists python3; then
        PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
        PYTHON_MAJOR=$(echo "$PYTHON_VERSION" | cut -d. -f1)
        PYTHON_MINOR=$(echo "$PYTHON_VERSION" | cut -d. -f2)
        
        if [ "$PYTHON_MAJOR" -ge 3 ] && [ "$PYTHON_MINOR" -ge 11 ]; then
            echo -e "${GREEN}  ✓ Python: ${PYTHON_VERSION}${NC}"
            return 0
        else
            echo -e "${YELLOW}  ! Python ${PYTHON_VERSION} found, but need 3.11+${NC}"
            return 1
        fi
    else
        return 1
    fi
}

# ============================================================
# STEP 1: Check Prerequisites
# ============================================================
check_prerequisites() {
    echo -e "${YELLOW}[1/9] Checking prerequisites...${NC}"
    local missing=0

    if ! command_exists node; then
        echo -e "${RED}  ✗ Node.js not found${NC}"
        echo "    Install from: https://nodejs.org/"
        missing=1
    else
        NODE_VERSION=$(node --version)
        echo -e "${GREEN}  ✓ Node.js: ${NODE_VERSION}${NC}"
    fi

    if ! command_exists npm; then
        echo -e "${RED}  ✗ npm not found${NC}"
        missing=1
    else
        NPM_VERSION=$(npm --version)
        echo -e "${GREEN}  ✓ npm: ${NPM_VERSION}${NC}"
    fi

    if ! command_exists git; then
        echo -e "${RED}  ✗ git not found${NC}"
        missing=1
    else
        echo -e "${GREEN}  ✓ git installed${NC}"
    fi

    # Check Python
    if ! check_python_version; then
        echo -e "${YELLOW}  ! Python 3.11+ not found${NC}"
        echo "    Install Python 3.11+ from: https://www.python.org/downloads/"
        echo "    Or use:"
        case "$OS" in
            linux)
                echo "    Ubuntu/Debian: sudo apt install python3.11 python3.11-venv python3-pip"
                ;;
            macos)
                echo "    macOS: brew install python@3.11"
                ;;
            windows)
                echo "    Windows: Download from https://www.python.org/downloads/"
                ;;
        esac
        missing=1
    fi

    # Check PostgreSQL (required - local installation only)
    if ! command_exists psql; then
        echo -e "${YELLOW}  ! PostgreSQL not found - will attempt to install...${NC}"
        missing=1
    else
        PSQL_VERSION=$(psql --version 2>/dev/null | head -n1 || echo "installed")
        echo -e "${GREEN}  ✓ PostgreSQL found: ${PSQL_VERSION}${NC}"
    fi

    if [ $missing -eq 1 ]; then
        echo -e "${YELLOW}  ! Some prerequisites are missing, but setup will attempt to install them automatically.${NC}"
        echo ""
    fi
    echo ""
}

# ============================================================
# STEP 2: Install Poetry (Python dependency manager)
# ============================================================
install_poetry() {
    echo -e "${YELLOW}[2/9] Checking Poetry (Python dependency manager)...${NC}"
    
    if command_exists poetry; then
        POETRY_VERSION=$(poetry --version 2>/dev/null || echo "installed")
        echo -e "${GREEN}  ✓ Poetry already installed: ${POETRY_VERSION}${NC}"
        echo ""
        return 0
    fi

    echo "  Installing Poetry..."
    
    case "$OS" in
        linux|macos)
            if curl -sSL https://install.python-poetry.org | python3 - 2>/dev/null; then
                # Add Poetry to PATH
                export PATH="$HOME/.local/bin:$PATH"
                if [ -f "$HOME/.local/bin/poetry" ]; then
                    echo -e "${GREEN}  ✓ Poetry installed${NC}"
                    # Try to add to shell profile
                    if [ -f "$HOME/.bashrc" ] && ! grep -q "$HOME/.local/bin" "$HOME/.bashrc"; then
                        echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
                    fi
                    if [ -f "$HOME/.zshrc" ] && ! grep -q "$HOME/.local/bin" "$HOME/.zshrc"; then
                        echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
                    fi
                else
                    echo -e "${YELLOW}  ! Poetry installed but not in PATH. Add ~/.local/bin to PATH${NC}"
                fi
                else
                    echo -e "${YELLOW}  ! Trying pip install...${NC}"
                    echo -e "${CYAN}  [Progress] Installing Poetry via pip...${NC}"
                    pip3 install --user poetry >/dev/null 2>&1 &
                    PIP_PID=$!
                    show_progress $PIP_PID "Installing Poetry via pip"
                    wait $PIP_PID
                    
                    if [ $? -ne 0 ]; then
                        pip install --user poetry >/dev/null 2>&1 &
                        PIP_PID=$!
                        show_progress $PIP_PID "Installing Poetry via pip (fallback)"
                        wait $PIP_PID
                    fi
                    
                    if [ $? -eq 0 ]; then
                        # Add Python user Scripts to PATH (where pip installs Poetry)
                        export PATH="$HOME/.local/bin:$PATH"
                        
                        # Verify Poetry is now available
                        if command_exists poetry; then
                            echo -e "${GREEN}  ✓ Poetry installed and available${NC}"
                            # Try to add to shell profile
                            if [ -f "$HOME/.bashrc" ] && ! grep -q "$HOME/.local/bin" "$HOME/.bashrc"; then
                                echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
                            fi
                            if [ -f "$HOME/.zshrc" ] && ! grep -q "$HOME/.local/bin" "$HOME/.zshrc"; then
                                echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
                            fi
                        else
                            echo -e "${YELLOW}  ! Poetry installed but not on PATH yet${NC}"
                            echo "    Add to PATH: export PATH=\"\$HOME/.local/bin:\$PATH\""
                        fi
                    else
                        echo -e "${YELLOW}  ! Could not install Poetry. Bot features may not work.${NC}"
                        echo "    Install manually: curl -sSL https://install.python-poetry.org | python3 -"
                    fi
                fi
            ;;
        windows)
            echo -e "${YELLOW}  ! Windows: Install Poetry manually with:${NC}"
            echo "    (Invoke-WebRequest -Uri https://install.python-poetry.org -UseBasicParsing).Content | python -"
            echo "    Or: pip install poetry"
            ;;
    esac
    echo ""
}

# ============================================================
# STEP 3: Install uv (Python package manager for Chorus)
# ============================================================
install_uv() {
    echo -e "${YELLOW}[3/9] Checking uv (Python package manager)...${NC}"
    
    if command_exists uv; then
        UV_VERSION=$(uv --version 2>/dev/null || echo "installed")
        echo -e "${GREEN}  ✓ uv already installed: ${UV_VERSION}${NC}"
        echo ""
        return 0
    fi

    echo -e "${CYAN}  [Progress] Installing uv...${NC}"
    
    case "$OS" in
        linux|macos)
            echo -e "${CYAN}  [Progress] Installing via official installer...${NC}"
            curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 &
            UV_INSTALL_PID=$!
            show_progress $UV_INSTALL_PID "Installing uv"
            wait $UV_INSTALL_PID
            
            if [ $? -eq 0 ]; then
                export PATH="$HOME/.cargo/bin:$PATH"
                [ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
                
                # Verify uv is now available
                if command_exists uv; then
                    echo -e "${GREEN}  ✓ uv installed and available${NC}"
                else
                    echo -e "${YELLOW}  ! uv installed but not on PATH yet${NC}"
                    echo "    Add to PATH: export PATH=\"\$HOME/.cargo/bin:\$PATH\""
                fi
            else
                echo -e "${YELLOW}  ! Trying pip install...${NC}"
                echo -e "${CYAN}  [Progress] Installing uv via pip...${NC}"
                pip3 install uv >/dev/null 2>&1 &
                PIP_PID=$!
                show_progress $PIP_PID "Installing uv via pip"
                wait $PIP_PID
                
                if [ $? -ne 0 ]; then
                    pip install uv >/dev/null 2>&1 &
                    PIP_PID=$!
                    show_progress $PIP_PID "Installing uv via pip (fallback)"
                    wait $PIP_PID
                fi
                
                if [ $? -eq 0 ]; then
                    # Add Python user Scripts to PATH (where pip installs uv)
                    export PATH="$HOME/.local/bin:$PATH"
                    
                    # Verify uv is now available
                    if command_exists uv; then
                        echo -e "${GREEN}  ✓ uv installed and available${NC}"
                    else
                        echo -e "${YELLOW}  ! uv installed but not on PATH yet${NC}"
                        echo "    Add to PATH: export PATH=\"\$HOME/.local/bin:\$PATH\""
                    fi
                else
                    echo -e "${YELLOW}  ! Could not install uv. Chorus TTS may not work.${NC}"
                fi
            fi
            ;;
        windows)
            echo -e "${YELLOW}  ! Windows: Install uv manually with: pip install uv${NC}"
            ;;
    esac
    echo ""
}

# ============================================================
# Install Node.js (OS-specific)
# ============================================================
install_nodejs() {
    echo -e "${YELLOW}[1.5/9] Installing Node.js...${NC}"
    
    # Check if already installed
    if command_exists node && command_exists npm; then
        NODE_VERSION=$(node --version)
        NPM_VERSION=$(npm --version)
        echo -e "${GREEN}  ✓ Node.js already installed: ${NODE_VERSION} (npm: ${NPM_VERSION})${NC}"
        echo ""
        return 0
    fi
    
    case "$OS" in
        macos)
            # Check for Homebrew first
            if ! command_exists brew; then
                echo -e "${YELLOW}  ! Homebrew not found. Installing Homebrew...${NC}"
                echo -e "${CYAN}  [Progress] Installing Homebrew (this may take a few minutes)...${NC}"
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" >/dev/null 2>&1 &
                BREW_PID=$!
                show_progress $BREW_PID "Installing Homebrew"
                wait $BREW_PID
                
                if [ $? -eq 0 ]; then
                    # Add Homebrew to PATH
                    if [ -f "/opt/homebrew/bin/brew" ]; then
                        eval "$(/opt/homebrew/bin/brew shellenv)"
                    elif [ -f "/usr/local/bin/brew" ]; then
                        eval "$(/usr/local/bin/brew shellenv)"
                    fi
                    echo -e "${GREEN}  ✓ Homebrew installed${NC}"
                else
                    echo -e "${RED}  ✗ Failed to install Homebrew${NC}"
                    echo "    Please install manually: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
                    return 1
                fi
            fi
            
            # Install Node.js via Homebrew
            echo -e "${CYAN}  [Progress] Installing Node.js via Homebrew (this may take a few minutes)...${NC}"
            brew install node >/dev/null 2>&1 &
            NODE_PID=$!
            show_progress $NODE_PID "Installing Node.js"
            wait $NODE_PID
            
            if [ $? -eq 0 ]; then
                # Refresh PATH to ensure node/npm are available
                if [ -f "/opt/homebrew/bin/brew" ]; then
                    eval "$(/opt/homebrew/bin/brew shellenv)"
                elif [ -f "/usr/local/bin/brew" ]; then
                    eval "$(/usr/local/bin/brew shellenv)"
                fi
                
                # Verify installation
                if command_exists node && command_exists npm; then
                    NODE_VERSION=$(node --version)
                    NPM_VERSION=$(npm --version)
                    echo -e "${GREEN}  ✓ Node.js installed: ${NODE_VERSION} (npm: ${NPM_VERSION})${NC}"
                else
                    echo -e "${YELLOW}  ! Node.js installed but not on PATH yet${NC}"
                    echo "    Try: export PATH=\"/opt/homebrew/bin:\$PATH\" or \"/usr/local/bin:\$PATH\""
                    echo "    Or restart your terminal"
                    return 1
                fi
            else
                echo -e "${RED}  ✗ Failed to install Node.js via Homebrew${NC}"
                echo "    Please install manually: brew install node"
                return 1
            fi
            ;;
        linux)
            # Detect Linux package manager and install Node.js
            if command_exists apt-get; then
                echo "  Detected apt package manager (Ubuntu/Debian)"
                echo -e "${CYAN}  [Progress] Installing Node.js via apt (this may require sudo password)...${NC}"
                echo -e "${YELLOW}  Note: This will install Node.js from NodeSource repository${NC}"
                
                # Install Node.js from NodeSource (provides latest LTS)
                curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - >/dev/null 2>&1 &
                SETUP_PID=$!
                show_progress $SETUP_PID "Setting up NodeSource repository"
                wait $SETUP_PID
                
                if [ $? -eq 0 ]; then
                    sudo apt-get install -y nodejs >/dev/null 2>&1 &
                    NODE_PID=$!
                    show_progress $NODE_PID "Installing Node.js"
                    wait $NODE_PID
                    
                    if [ $? -eq 0 ]; then
                        if command_exists node && command_exists npm; then
                            NODE_VERSION=$(node --version)
                            NPM_VERSION=$(npm --version)
                            echo -e "${GREEN}  ✓ Node.js installed: ${NODE_VERSION} (npm: ${NPM_VERSION})${NC}"
                        else
                            echo -e "${YELLOW}  ! Node.js installed but not on PATH yet${NC}"
                            echo "    Try restarting your terminal or run: source ~/.bashrc"
                            return 1
                        fi
                    else
                        echo -e "${RED}  ✗ Failed to install Node.js via apt${NC}"
                        echo "    Please install manually:"
                        echo "      curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -"
                        echo "      sudo apt-get install -y nodejs"
                        return 1
                    fi
                else
                    echo -e "${YELLOW}  ! Failed to setup NodeSource repository. Trying default apt package...${NC}"
                    sudo apt-get update >/dev/null 2>&1
                    sudo apt-get install -y nodejs npm >/dev/null 2>&1 &
                    NODE_PID=$!
                    show_progress $NODE_PID "Installing Node.js (fallback)"
                    wait $NODE_PID
                    
                    if [ $? -eq 0 ] && command_exists node && command_exists npm; then
                        NODE_VERSION=$(node --version)
                        NPM_VERSION=$(npm --version)
                        echo -e "${GREEN}  ✓ Node.js installed: ${NODE_VERSION} (npm: ${NPM_VERSION})${NC}"
                    else
                        echo -e "${RED}  ✗ Failed to install Node.js${NC}"
                        echo "    Please install manually from: https://nodejs.org/"
                        return 1
                    fi
                fi
            elif command_exists yum; then
                echo "  Detected yum package manager (RHEL/CentOS)"
                echo -e "${CYAN}  [Progress] Installing Node.js via yum (this may require sudo password)...${NC}"
                curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash - >/dev/null 2>&1 &
                SETUP_PID=$!
                show_progress $SETUP_PID "Setting up NodeSource repository"
                wait $SETUP_PID
                
                if [ $? -eq 0 ]; then
                    sudo yum install -y nodejs >/dev/null 2>&1 &
                    NODE_PID=$!
                    show_progress $NODE_PID "Installing Node.js"
                    wait $NODE_PID
                    
                    if [ $? -eq 0 ] && command_exists node && command_exists npm; then
                        NODE_VERSION=$(node --version)
                        NPM_VERSION=$(npm --version)
                        echo -e "${GREEN}  ✓ Node.js installed: ${NODE_VERSION} (npm: ${NPM_VERSION})${NC}"
                    else
                        echo -e "${RED}  ✗ Failed to install Node.js via yum${NC}"
                        return 1
                    fi
                else
                    echo -e "${RED}  ✗ Failed to setup NodeSource repository${NC}"
                    return 1
                fi
            elif command_exists dnf; then
                echo "  Detected dnf package manager (Fedora)"
                echo -e "${CYAN}  [Progress] Installing Node.js via dnf (this may require sudo password)...${NC}"
                curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash - >/dev/null 2>&1 &
                SETUP_PID=$!
                show_progress $SETUP_PID "Setting up NodeSource repository"
                wait $SETUP_PID
                
                if [ $? -eq 0 ]; then
                    sudo dnf install -y nodejs >/dev/null 2>&1 &
                    NODE_PID=$!
                    show_progress $NODE_PID "Installing Node.js"
                    wait $NODE_PID
                    
                    if [ $? -eq 0 ] && command_exists node && command_exists npm; then
                        NODE_VERSION=$(node --version)
                        NPM_VERSION=$(npm --version)
                        echo -e "${GREEN}  ✓ Node.js installed: ${NODE_VERSION} (npm: ${NPM_VERSION})${NC}"
                    else
                        echo -e "${RED}  ✗ Failed to install Node.js via dnf${NC}"
                        return 1
                    fi
                else
                    echo -e "${RED}  ✗ Failed to setup NodeSource repository${NC}"
                    return 1
                fi
            else
                echo -e "${RED}  ✗ Could not detect package manager for Node.js installation${NC}"
                echo "    Please install Node.js manually from: https://nodejs.org/"
                return 1
            fi
            ;;
        windows)
            echo -e "${YELLOW}  ! Windows: Please install Node.js manually from: https://nodejs.org/${NC}"
            return 1
            ;;
    esac
    
    echo ""
    return 0
}

# ============================================================
# STEP 4: Initialize Git Submodules
# ============================================================
init_submodules() {
    echo -e "${YELLOW}[4/9] Initializing git submodules...${NC}"
    
    if [ -d "apps/chorus-tts/.git" ] && [ -n "$(ls -A apps/chorus-tts 2>/dev/null | grep -v '^\.git$')" ]; then
        echo -e "${GREEN}  ✓ Submodules already initialized${NC}"
    else
        echo -e "${CYAN}  [Progress] Cloning chorus-tts submodule...${NC}"
        git submodule update --init --recursive apps/chorus-tts >/dev/null 2>&1 &
        SUBMODULE_PID=$!
        show_progress $SUBMODULE_PID "Initializing git submodules"
        wait $SUBMODULE_PID
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}  ✓ Submodules initialized${NC}"
        else
            echo -e "${YELLOW}  ! Could not initialize chorus-tts submodule${NC}"
        fi
    fi
    echo ""
}

# ============================================================
# STEP 5: Install npm Dependencies
# ============================================================
install_npm_deps() {
    echo -e "${YELLOW}[5/9] Installing npm dependencies...${NC}"
    
    # Verify Node.js and npm are available
    if ! command_exists node || ! command_exists npm; then
        echo -e "${RED}  ✗ Node.js or npm not found. Cannot install dependencies.${NC}"
        echo "    Please ensure Node.js is installed and on your PATH"
        return 1
    fi
    
    echo -e "${CYAN}  [Progress] Installing Node.js packages (this may take several minutes)...${NC}"
    
    # Run npm install with output visible for errors, but show progress
    # Use a temp file to capture output so we can show it on error
    TEMP_LOG=$(mktemp)
    npm install > "$TEMP_LOG" 2>&1 &
    NPM_PID=$!
    show_progress $NPM_PID "Installing npm packages"
    wait $NPM_PID
    NPM_EXIT_CODE=$?
    
    if [ $NPM_EXIT_CODE -eq 0 ]; then
        echo -e "${GREEN}  ✓ Dependencies installed${NC}"
        rm -f "$TEMP_LOG"
    else
        echo -e "${RED}  ✗ Failed to install dependencies${NC}"
        echo ""
        echo -e "${YELLOW}  Error output:${NC}"
        echo "  ──────────────────────────────────────────────────────────"
        # Show last 30 lines of error output
        tail -n 30 "$TEMP_LOG" | sed 's/^/  /'
        echo "  ──────────────────────────────────────────────────────────"
        echo ""
        echo -e "${YELLOW}  Troubleshooting:${NC}"
        echo "    • Check your internet connection"
        echo "    • Try running manually: npm install"
        echo "    • Check Node.js version: node --version (should be v20+)"
        echo "    • Try clearing npm cache: npm cache clean --force"
        rm -f "$TEMP_LOG"
        return 1
    fi
    echo ""
}

# ============================================================
# STEP 6: Install Bot Python Dependencies
# ============================================================
install_bot_deps() {
    echo -e "${YELLOW}[6/9] Installing bot Python dependencies...${NC}"
    
    if ! command_exists poetry; then
        echo -e "${YELLOW}  ! Poetry not found. Skipping bot dependencies.${NC}"
        echo "    Install Poetry first, then run: cd apps/pipecat-daily-bot/bot && poetry install"
        echo ""
        return 0
    fi
    
    # Ensure Poetry is in PATH
    export PATH="$HOME/.local/bin:$PATH"
    
    # Check if directory exists before cd
    if [ ! -d "apps/pipecat-daily-bot/bot" ]; then
        echo -e "${YELLOW}  ! Bot directory not found: apps/pipecat-daily-bot/bot${NC}"
        echo "    Skipping bot dependencies installation"
        echo ""
        return 0
    fi
    
    # Save current directory
    ORIGINAL_DIR=$(pwd)
    
    # Change directory safely
    if ! cd apps/pipecat-daily-bot/bot 2>/dev/null; then
        echo -e "${YELLOW}  ! Could not change to apps/pipecat-daily-bot/bot directory${NC}"
        echo "    Skipping bot dependencies installation"
        echo ""
        return 0
    fi
    
    # Check if pyproject.toml exists
    if [ ! -f "pyproject.toml" ]; then
        echo -e "${YELLOW}  ! pyproject.toml not found in apps/pipecat-daily-bot/bot${NC}"
        echo "    Skipping bot dependencies installation"
        cd "$ORIGINAL_DIR"
        echo ""
        return 0
    fi
    
    echo -e "${CYAN}  [Progress] Installing Python dependencies via Poetry (this may take a few minutes)...${NC}"
    
    # Use temp file to capture output for error display
    TEMP_LOG=$(mktemp)
    poetry install --no-root --only main --no-interaction > "$TEMP_LOG" 2>&1 &
    POETRY_PID=$!
    show_progress $POETRY_PID "Installing Python packages"
    wait $POETRY_PID
    POETRY_EXIT_CODE=$?
    
    if [ $POETRY_EXIT_CODE -eq 0 ]; then
        echo -e "${GREEN}  ✓ Bot Python dependencies installed${NC}"
        rm -f "$TEMP_LOG"
    else
        echo -e "${YELLOW}  ! Poetry install failed. Trying without --only main flag...${NC}"
        rm -f "$TEMP_LOG"
        
        # Try without --only main flag
        TEMP_LOG=$(mktemp)
        poetry install --no-interaction > "$TEMP_LOG" 2>&1 &
        POETRY_PID=$!
        show_progress $POETRY_PID "Installing Python packages (retry)"
        wait $POETRY_PID
        POETRY_EXIT_CODE=$?
        
        if [ $POETRY_EXIT_CODE -eq 0 ]; then
            echo -e "${GREEN}  ✓ Bot Python dependencies installed${NC}"
            rm -f "$TEMP_LOG"
        else
            echo -e "${YELLOW}  ! Could not install bot dependencies. Voice features may not work.${NC}"
            echo ""
            echo -e "${YELLOW}  Error output:${NC}"
            echo "  ──────────────────────────────────────────────────────────"
            # Show last 30 lines of error output
            tail -n 30 "$TEMP_LOG" 2>/dev/null | sed 's/^/  /' || echo "  (No error output captured)"
            echo "  ──────────────────────────────────────────────────────────"
            echo ""
            echo -e "${YELLOW}  Troubleshooting:${NC}"
            echo "    • Check your internet connection"
            echo "    • Try running manually: cd apps/pipecat-daily-bot/bot && poetry install"
            echo "    • Check Poetry version: poetry --version"
            echo "    • Try updating Poetry: poetry self update"
            rm -f "$TEMP_LOG"
        fi
    fi
    
    # Return to original directory
    cd "$ORIGINAL_DIR"
    echo ""
}

# ============================================================
# STEP 7: Download Chorus Assets (Kokoro TTS)
# ============================================================
download_chorus_assets() {
    echo -e "${YELLOW}[7/9] Checking Kokoro TTS model files...${NC}"
    
    if [ -f "apps/chorus-tts/kokoro-v1.0.onnx" ] && [ -f "apps/chorus-tts/voices-v1.0.bin" ]; then
        echo -e "${GREEN}  ✓ Model files already present${NC}"
    else
        echo -e "${YELLOW}  ! Downloading Kokoro model files (~550MB)...${NC}"
        echo -e "${CYAN}  [Progress] Downloading model files (this may take several minutes)...${NC}"
        npm run chorus:download-assets >/dev/null 2>&1 &
        DOWNLOAD_PID=$!
        show_progress $DOWNLOAD_PID "Downloading Chorus TTS models"
        wait $DOWNLOAD_PID
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}  ✓ Model files downloaded${NC}"
        else
            echo -e "${YELLOW}  ! Could not download model files. Voice features may not work.${NC}"
            echo "    Run manually later: npm run chorus:download-assets"
        fi
    fi
    echo ""
}

# ============================================================
# STEP 8: Setup Environment Files
# ============================================================
setup_env() {
    echo -e "${YELLOW}[8/9] Setting up environment files...${NC}"
    
    # Check which env files exist
    ROOT_EXISTS=false
    INTERFACE_EXISTS=false
    DASHBOARD_EXISTS=false
    MESH_EXISTS=false
    BOT_EXISTS=false
    
    [ -f ".env.local" ] && ROOT_EXISTS=true
    [ -f "apps/interface/.env.local" ] && INTERFACE_EXISTS=true
    [ -f "apps/dashboard/.env.local" ] && DASHBOARD_EXISTS=true
    [ -f "apps/mesh/.env.local" ] && MESH_EXISTS=true
    [ -f "apps/pipecat-daily-bot/.env" ] && BOT_EXISTS=true
    
    # If any env files exist, ask what to do
    if [ "$ROOT_EXISTS" = true ] || [ "$INTERFACE_EXISTS" = true ] || [ "$DASHBOARD_EXISTS" = true ] || [ "$MESH_EXISTS" = true ] || [ "$BOT_EXISTS" = true ]; then
        echo ""
        echo -e "${YELLOW}  Existing environment files detected:${NC}"
        [ "$ROOT_EXISTS" = true ] && echo "    • .env.local (root)"
        [ "$INTERFACE_EXISTS" = true ] && echo "    • apps/interface/.env.local"
        [ "$DASHBOARD_EXISTS" = true ] && echo "    • apps/dashboard/.env.local"
        [ "$MESH_EXISTS" = true ] && echo "    • apps/mesh/.env.local"
        [ "$BOT_EXISTS" = true ] && echo "    • apps/pipecat-daily-bot/.env"
        echo ""
        
        # Use TUI if available (from new-setup.sh)
        local env_choice=""
        if [[ "${USE_TUI:-false}" == "true" ]] && command_exists node && [[ -f "${REPO_ROOT:-.}/scripts/setup-wizard-ui.mjs" ]]; then
            local tmpfile
            tmpfile=$(mktemp)
            local existing_files=""
            [ "$ROOT_EXISTS" = true ] && existing_files="${existing_files}root,"
            [ "$INTERFACE_EXISTS" = true ] && existing_files="${existing_files}interface,"
            [ "$DASHBOARD_EXISTS" = true ] && existing_files="${existing_files}dashboard,"
            [ "$MESH_EXISTS" = true ] && existing_files="${existing_files}mesh,"
            [ "$BOT_EXISTS" = true ] && existing_files="${existing_files}bot,"
            existing_files="${existing_files%,}"
            
            cd "${REPO_ROOT:-.}" && TUI_OUTPUT_FILE="$tmpfile" NODE_PATH="${REPO_ROOT:-.}/node_modules" node scripts/setup-wizard-ui.mjs env-choice "$existing_files" 2>/dev/null
            local tui_result
            tui_result=$(cat "$tmpfile" 2>/dev/null)
            rm -f "$tmpfile"
            if [[ -n "$tui_result" ]]; then
                env_choice=$(echo "$tui_result" | grep -o '"choice":"[^"]*"' | cut -d'"' -f4)
            fi
        fi
        
        # Fallback to numbered prompt if TUI didn't work
        if [[ -z "$env_choice" ]]; then
            echo "  What would you like to do?"
            echo "    1) Keep all existing env files (just sync secrets)"
            echo "    2) Recreate root .env.local only (recommended - apps will sync from root)"
            echo "    3) Clear ALL and recreate from scratch"
            echo ""
            read -p "  Choose option [1-3] (default: 1): " env_choice
        fi
        
        case "${env_choice:-keep}" in
            keep|1)
            1)
                echo ""
                echo -e "${GREEN}  ✓ Keeping existing env files${NC}"
                # Just run sync to ensure app envs have the same secrets as root
                if [ "$ROOT_EXISTS" = true ]; then
                    echo "  Syncing secrets to app env files..."
                    npm run sync:env 2>/dev/null || true
                    echo -e "${GREEN}  ✓ Env files synced${NC}"
                fi
                # Still create bot .env if missing
                if [ "$BOT_EXISTS" = false ]; then
                    create_bot_env
                fi
                echo ""
                return 0
                ;;
            recreate_root|2)
                echo ""
                echo "  Recreating root .env.local..."
                # Only recreate root, apps will sync
                ;;
            clear_all|3)
                echo ""
                echo "  Clearing all env files..."
                rm -f .env.local
                rm -f apps/interface/.env.local
                rm -f apps/dashboard/.env.local
                rm -f apps/mesh/.env.local
                rm -f apps/pipecat-daily-bot/.env
                echo -e "${GREEN}  ✓ All env files cleared${NC}"
                ;;
            *)
                echo ""
                echo -e "${GREEN}  ✓ Keeping existing env files (default)${NC}"
                npm run sync:env 2>/dev/null || true
                if [ "$BOT_EXISTS" = false ]; then
                    create_bot_env
                fi
                echo ""
                return 0
                ;;
        esac
    fi
    
    # Create root .env.local from template
    echo "  Creating root .env.local from template..."
        cp config/env.minimal.example .env.local
        
    # PostgreSQL credentials will be set during PostgreSQL setup (step 9)
    # Default: POSTGRES_USER=postgres, POSTGRES_PASSWORD=password
        
    # Generate secrets
    echo "  Generating secure secrets..."
    NEXTAUTH_SECRET=$(generate_secret)
    MESH_SECRET=$(generate_secret)
    TOKEN_KEY=$(generate_secret)
    BOT_SECRET=$(generate_secret)
            
    # Replace placeholders with generated secrets
    if [[ "$OS" == "macos" ]]; then
        sed -i '' "s|__NEXTAUTH_SECRET_PLACEHOLDER__|${NEXTAUTH_SECRET}|g" .env.local
        sed -i '' "s|__MESH_SHARED_SECRET_PLACEHOLDER__|${MESH_SECRET}|g" .env.local
        sed -i '' "s|__TOKEN_ENCRYPTION_KEY_PLACEHOLDER__|${TOKEN_KEY}|g" .env.local
        sed -i '' "s|__BOT_CONTROL_SHARED_SECRET_PLACEHOLDER__|${BOT_SECRET}|g" .env.local
    else
        sed -i "s|__NEXTAUTH_SECRET_PLACEHOLDER__|${NEXTAUTH_SECRET}|g" .env.local
        sed -i "s|__MESH_SHARED_SECRET_PLACEHOLDER__|${MESH_SECRET}|g" .env.local
        sed -i "s|__TOKEN_ENCRYPTION_KEY_PLACEHOLDER__|${TOKEN_KEY}|g" .env.local
        sed -i "s|__BOT_CONTROL_SHARED_SECRET_PLACEHOLDER__|${BOT_SECRET}|g" .env.local
            fi
            
    echo -e "${GREEN}  ✓ Root .env.local created with generated secrets${NC}"
    
    # Sync to app-specific env files
    echo "  Syncing secrets to app env files..."
    npm run sync:env 2>/dev/null || {
        echo -e "${YELLOW}  ! Could not auto-sync. Run 'npm run sync:env' manually after npm install.${NC}"
    }
    
    # Create bot .env file
    create_bot_env
    
    echo -e "${GREEN}  ✓ All env files configured${NC}"
    echo ""
    echo -e "${CYAN}  📝 Next: Add your API keys to .env.local:${NC}"
    echo "     • DAILY_API_KEY (get from https://dashboard.daily.co)"
    echo "     • OPENAI_API_KEY (get from https://platform.openai.com/api-keys)"
    echo "     • DEEPGRAM_API_KEY (get from https://console.deepgram.com/)"
    echo ""
}

# Create bot .env file
create_bot_env() {
    echo "  Creating bot .env file..."
    
    BOT_ENV_PATH="apps/pipecat-daily-bot/.env"
    
    # Read API keys from root .env.local if it exists
    if [ -f ".env.local" ]; then
        source .env.local 2>/dev/null || true
    fi
    
    # Create bot .env from template
    if [ -f "apps/pipecat-daily-bot/env.example" ]; then
        cp apps/pipecat-daily-bot/env.example "$BOT_ENV_PATH"
        
        # Update with values from root .env.local if available
        if [ -f ".env.local" ]; then
            # Extract values from root .env.local
            DAILY_API_KEY_VAL=$(grep "^DAILY_API_KEY=" .env.local 2>/dev/null | cut -d'=' -f2- | tr -d '"' || echo "__DAILY_API_KEY_PLACEHOLDER__")
            OPENAI_API_KEY_VAL=$(grep "^OPENAI_API_KEY=" .env.local 2>/dev/null | cut -d'=' -f2- | tr -d '"' || echo "__OPENAI_API_KEY_PLACEHOLDER__")
            MESH_API_ENDPOINT_VAL=$(grep "^MESH_API_ENDPOINT=" .env.local 2>/dev/null | cut -d'=' -f2- | tr -d '"' || echo "http://localhost:2000/api")
            
            # Update bot .env
            # Escape special characters in replacement strings for sed (escape |, /, &, and \)
            DAILY_API_KEY_VAL_ESC=$(printf '%s\n' "$DAILY_API_KEY_VAL" | sed 's/[[\.*^$()+?{|&\\]/\\&/g')
            OPENAI_API_KEY_VAL_ESC=$(printf '%s\n' "$OPENAI_API_KEY_VAL" | sed 's/[[\.*^$()+?{|&\\]/\\&/g')
            MESH_API_ENDPOINT_VAL_ESC=$(printf '%s\n' "$MESH_API_ENDPOINT_VAL" | sed 's/[[\.*^$()+?{|&\\]/\\&/g')
            
            if [[ "$OS" == "macos" ]]; then
                sed -i '' "s@your_daily_api_key_here@${DAILY_API_KEY_VAL_ESC}@g" "$BOT_ENV_PATH"
                sed -i '' "s@your_openai_api_key_here@${OPENAI_API_KEY_VAL_ESC}@g" "$BOT_ENV_PATH"
                sed -i '' "s@http://localhost:2000@${MESH_API_ENDPOINT_VAL_ESC}@g" "$BOT_ENV_PATH"
            else
                sed -i "s@your_daily_api_key_here@${DAILY_API_KEY_VAL_ESC}@g" "$BOT_ENV_PATH"
                sed -i "s@your_openai_api_key_here@${OPENAI_API_KEY_VAL_ESC}@g" "$BOT_ENV_PATH"
                sed -i "s@http://localhost:2000@${MESH_API_ENDPOINT_VAL_ESC}@g" "$BOT_ENV_PATH"
            fi
        fi
        
        echo -e "${GREEN}  ✓ Bot .env file created${NC}"
    else
        echo -e "${YELLOW}  ! Bot env.example not found. Creating minimal .env...${NC}"
        cat > "$BOT_ENV_PATH" << 'EOF'
# Daily Pipecat Bot Configuration
USE_REDIS=false
DAILY_API_KEY=__DAILY_API_KEY_PLACEHOLDER__
DAILY_ROOM_URL=__DAILY_ROOM_URL_PLACEHOLDER__
OPENAI_API_KEY=__OPENAI_API_KEY_PLACEHOLDER__
MESH_API_ENDPOINT=http://localhost:2000/api
KOKORO_TTS_BASE_URL=ws://127.0.0.1:8000
KOKORO_TTS_VOICE_ID=af_heart
EOF
        echo -e "${GREEN}  ✓ Bot .env file created${NC}"
    fi
}

# ============================================================
# Install PostgreSQL (OS-specific)
# ============================================================
install_postgresql() {
    echo -e "${YELLOW}  Installing PostgreSQL...${NC}"
    
    case "$OS" in
        linux)
            # Detect Linux package manager
            if command_exists apt-get; then
                echo "  Detected apt package manager (Ubuntu/Debian)"
                echo -e "${YELLOW}  Installing PostgreSQL (this may require sudo password)...${NC}"
                echo -e "${CYAN}  [Progress] Updating package lists...${NC}"
                sudo apt update >/dev/null 2>&1 &
                UPDATE_PID=$!
                show_progress $UPDATE_PID "Updating package lists"
                wait $UPDATE_PID
                
                echo -e "${CYAN}  [Progress] Installing PostgreSQL packages...${NC}"
                sudo apt install -y postgresql postgresql-contrib >/dev/null 2>&1 &
                INSTALL_PID=$!
                show_progress $INSTALL_PID "Installing PostgreSQL"
                wait $INSTALL_PID
                
                if [ $? -ne 0 ]; then
                    echo -e "${RED}  ✗ Failed to install PostgreSQL via apt${NC}"
                    echo "    Please install manually: sudo apt update && sudo apt install -y postgresql postgresql-contrib"
                    return 1
                fi
                # Initialize and start PostgreSQL service
                echo "  Initializing PostgreSQL database cluster..."
                sudo -u postgres /usr/lib/postgresql/*/bin/initdb -D /var/lib/postgresql/*/main 2>/dev/null || echo "  Database cluster may already be initialized"
                echo "  Starting PostgreSQL service..."
                sudo systemctl enable postgresql 2>/dev/null
                sudo systemctl start postgresql 2>/dev/null || {
                    echo -e "${YELLOW}    ! Could not start PostgreSQL service automatically${NC}"
                    echo "    Please start it manually: sudo systemctl start postgresql"
                }
            elif command_exists yum; then
                echo "  Detected yum package manager (RHEL/CentOS)"
                echo "  Installing PostgreSQL (this may require sudo password)..."
                sudo yum install -y postgresql postgresql-server || {
                    echo -e "${RED}  ✗ Failed to install PostgreSQL via yum${NC}"
                    echo "    Please install manually: sudo yum install -y postgresql postgresql-server"
                    return 1
                }
                # Initialize and start PostgreSQL service
                echo "  Initializing PostgreSQL database cluster..."
                sudo postgresql-setup --initdb 2>/dev/null || echo "  Database cluster may already be initialized"
                echo "  Starting PostgreSQL service..."
                sudo systemctl enable postgresql 2>/dev/null
                sudo systemctl start postgresql 2>/dev/null || {
                    echo -e "${YELLOW}    ! Could not start PostgreSQL service automatically${NC}"
                    echo "    Please start it manually: sudo systemctl start postgresql"
                }
            elif command_exists dnf; then
                echo "  Detected dnf package manager (Fedora)"
                echo "  Installing PostgreSQL (this may require sudo password)..."
                sudo dnf install -y postgresql postgresql-server || {
                    echo -e "${RED}  ✗ Failed to install PostgreSQL via dnf${NC}"
                    echo "    Please install manually: sudo dnf install -y postgresql postgresql-server"
                    return 1
                }
                # Initialize and start PostgreSQL service
                echo "  Initializing PostgreSQL database cluster..."
                sudo postgresql-setup --initdb 2>/dev/null || echo "  Database cluster may already be initialized"
                echo "  Starting PostgreSQL service..."
                sudo systemctl enable postgresql 2>/dev/null
                sudo systemctl start postgresql 2>/dev/null || {
                    echo -e "${YELLOW}    ! Could not start PostgreSQL service automatically${NC}"
                    echo "    Please start it manually: sudo systemctl start postgresql"
                }
            elif command_exists pacman; then
                echo "  Detected pacman package manager (Arch Linux)"
                echo "  Installing PostgreSQL (this may require sudo password)..."
                sudo pacman -S --noconfirm postgresql || {
                    echo -e "${RED}  ✗ Failed to install PostgreSQL via pacman${NC}"
                    echo "    Please install manually: sudo pacman -S postgresql"
                    return 1
                }
                # Initialize and start PostgreSQL service
                echo "  Initializing PostgreSQL database cluster..."
                sudo -u postgres initdb -D /var/lib/postgres/data 2>/dev/null || echo "  Database cluster may already be initialized"
                echo "  Starting PostgreSQL service..."
                sudo systemctl enable postgresql 2>/dev/null
                sudo systemctl start postgresql 2>/dev/null || {
                    echo -e "${YELLOW}    ! Could not start PostgreSQL service automatically${NC}"
                    echo "    Please start it manually: sudo systemctl start postgresql"
                }
            else
                echo -e "${RED}  ✗ Could not detect package manager${NC}"
                echo "    Please install PostgreSQL manually for your Linux distribution"
                return 1
            fi
            ;;
        macos)
            if command_exists brew; then
                echo "  Installing PostgreSQL via Homebrew..."
                brew install postgresql@15 || brew install postgresql || {
                    echo -e "${RED}  ✗ Failed to install PostgreSQL via Homebrew${NC}"
                    echo "    Please install manually: brew install postgresql@15"
                    return 1
                }
                # Initialize and start PostgreSQL service
                echo "  Initializing PostgreSQL database cluster..."
                initdb /usr/local/var/postgres 2>/dev/null || echo "  Database cluster may already be initialized"
                echo "  Starting PostgreSQL service..."
                brew services start postgresql@15 2>/dev/null || brew services start postgresql 2>/dev/null || {
                    echo -e "${YELLOW}    ! Could not start PostgreSQL service automatically${NC}"
                    echo "    Please start it manually: brew services start postgresql@15"
                }
            else
                echo -e "${RED}  ✗ Homebrew not found${NC}"
                echo "    Please install Homebrew first: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
                echo "    Then install PostgreSQL: brew install postgresql@15"
                return 1
            fi
            ;;
        windows)
            echo -e "${YELLOW}  Windows: PostgreSQL installation requires manual steps${NC}"
            echo "    Option 1 (Recommended): Use winget"
            echo "      winget install PostgreSQL.PostgreSQL"
            echo ""
            echo "    Option 2: Use Chocolatey (if installed)"
            echo "      choco install postgresql16"
            echo ""
            echo "    Option 3: Download installer"
            echo "      https://www.postgresql.org/download/windows/"
            echo ""
            echo "    After installation, ensure PostgreSQL service is running and run this script again."
            return 1
            ;;
    esac
    
    echo -e "${GREEN}  ✓ PostgreSQL installed${NC}"
    
    # Set PostgreSQL password (default: 'password' - user can change later)
    echo "  Setting PostgreSQL password..."
    POSTGRES_PASSWORD="password"
    
    # Wait a moment for PostgreSQL to be fully ready
    sleep 2
    
    # Set password for postgres user
    case "$OS" in
        linux|macos)
            # Try to set password using psql
            sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD '$POSTGRES_PASSWORD';" 2>/dev/null || \
            psql -U postgres -c "ALTER USER postgres WITH PASSWORD '$POSTGRES_PASSWORD';" 2>/dev/null || \
            PGPASSWORD=postgres psql -U postgres -c "ALTER USER postgres WITH PASSWORD '$POSTGRES_PASSWORD';" 2>/dev/null || {
                echo -e "${YELLOW}    ! Could not set password automatically (may need manual setup)${NC}"
            }
            ;;
    esac
    
    echo -e "${GREEN}  ✓ PostgreSQL password set to: ${POSTGRES_PASSWORD}${NC}"
    echo -e "${YELLOW}  Note: You can change this password later if needed${NC}"
    
    return 0
}

# ============================================================
# STEP 9: Setup PostgreSQL
# ============================================================
setup_postgres() {
    echo -e "${YELLOW}[9/9] Setting up PostgreSQL...${NC}"
    
    if ! command_exists psql; then
        echo -e "${YELLOW}  PostgreSQL not found. Attempting to install...${NC}"
        if ! install_postgresql; then
            echo -e "${RED}  ✗ Could not install PostgreSQL automatically${NC}"
            echo "    Please install PostgreSQL manually and run this script again."
            return 1
        fi
    fi
    
        echo "  Using local PostgreSQL installation..."
        
        # Try to start PostgreSQL service if not running
        if command_exists systemctl; then
            if ! systemctl is-active --quiet postgresql 2>/dev/null; then
                echo "  Starting PostgreSQL service..."
            sudo systemctl start postgresql 2>/dev/null || {
                echo -e "${YELLOW}    ! Could not start PostgreSQL service automatically${NC}"
                echo "    Please start it manually: sudo systemctl start postgresql"
            }
        else
            echo -e "${GREEN}  ✓ PostgreSQL service is running${NC}"
            fi
        elif command_exists brew; then
        if ! brew services list 2>/dev/null | grep -q "postgresql.*started"; then
            echo "  Starting PostgreSQL service..."
            brew services start postgresql@15 2>/dev/null || brew services start postgresql 2>/dev/null || {
                echo -e "${YELLOW}    ! Could not start PostgreSQL service automatically${NC}"
                echo "    Please start it manually: brew services start postgresql@15"
            }
        else
            echo -e "${GREEN}  ✓ PostgreSQL service is running${NC}"
        fi
        fi
        
        # Set PostgreSQL password to default "password" (always set to ensure consistency)
        # macOS/Homebrew note: the default superuser is often your macOS username, not `postgres`.
        # To avoid confusion, we always ensure a `postgres` SUPERUSER role exists and uses password "password".
        POSTGRES_PASSWORD="password"
        if [ "$OS" = "macos" ]; then
            echo "  Ensuring postgres superuser exists with password 'password'..."
            
            ROLE_EXISTS=false
            if psql -h localhost -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='postgres'" 2>/dev/null | grep -q 1; then
                ROLE_EXISTS=true
            elif psql -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='postgres'" 2>/dev/null | grep -q 1; then
                ROLE_EXISTS=true
            fi
            
            if [ "$ROLE_EXISTS" = false ]; then
                if psql -h localhost -d postgres -c "CREATE ROLE postgres WITH LOGIN SUPERUSER PASSWORD '$POSTGRES_PASSWORD';" >/dev/null 2>&1 || \
                   psql -d postgres -c "CREATE ROLE postgres WITH LOGIN SUPERUSER PASSWORD '$POSTGRES_PASSWORD';" >/dev/null 2>&1; then
                    echo -e "${GREEN}    ✓ Created role postgres${NC}"
                fi
            fi
        fi
        
        echo "  Setting PostgreSQL password to 'password' (default for local development)..."
        
        # Try multiple methods to set the password, ensuring it's always "password"
        # This is CRITICAL - the password MUST be "password" for the setup to work
        PASSWORD_SET=false
        
        # Method 1: Using sudo (most reliable on Linux)
        if sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD '$POSTGRES_PASSWORD';" 2>/dev/null; then
            PASSWORD_SET=true
        fi
        
        # Method 2: Direct connection (if peer auth works)
        if [ "$PASSWORD_SET" = false ]; then
            if psql -U postgres -d postgres -c "ALTER USER postgres WITH PASSWORD '$POSTGRES_PASSWORD';" 2>/dev/null; then
                PASSWORD_SET=true
            fi
        fi
        
        # Method 3: Using old password (if it was previously set)
        if [ "$PASSWORD_SET" = false ]; then
            if PGPASSWORD=postgres psql -h localhost -U postgres -d postgres -c "ALTER USER postgres WITH PASSWORD '$POSTGRES_PASSWORD';" 2>/dev/null; then
                PASSWORD_SET=true
            fi
        fi
        
        # Method 4: Try with current password if it's already "password"
        if [ "$PASSWORD_SET" = false ]; then
            if PGPASSWORD="$POSTGRES_PASSWORD" psql -h localhost -U postgres -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
                # Password is already correct, verify we can set it (might already be set)
                if PGPASSWORD="$POSTGRES_PASSWORD" psql -h localhost -U postgres -d postgres -c "ALTER USER postgres WITH PASSWORD '$POSTGRES_PASSWORD';" 2>/dev/null; then
                    PASSWORD_SET=true
                else
                    # Password is already correct, just mark as set
                    PASSWORD_SET=true
                fi
            fi
        fi
        
        if [ "$PASSWORD_SET" = true ]; then
            echo -e "${GREEN}  ✓ PostgreSQL password verified/set to: password${NC}"
        else
            echo -e "${RED}  ✗ CRITICAL: Could not set PostgreSQL password${NC}"
            echo "    This will cause authentication failures!"
            echo "    Please set it manually:"
            echo "      sudo -u postgres psql -c \"ALTER USER postgres WITH PASSWORD 'password';\""
            echo "    Or if using peer auth:"
            echo "      psql -U postgres -c \"ALTER USER postgres WITH PASSWORD 'password';\""
            return 1
        fi
        
        # Create database if needed (testdb is the default for all apps)
        # CRITICAL: Database MUST exist for the mesh server to work
        echo "  Ensuring database 'testdb' exists..."
        DB_CREATED=false
        
        # Method 1: Using sudo
        if sudo -u postgres createdb testdb 2>/dev/null; then
            DB_CREATED=true
            echo -e "${GREEN}    ✓ Database 'testdb' created${NC}"
        fi
        
        # Method 2: Direct connection
        if [ "$DB_CREATED" = false ]; then
            if createdb -U postgres testdb 2>/dev/null; then
                DB_CREATED=true
                echo -e "${GREEN}    ✓ Database 'testdb' created${NC}"
            fi
        fi
        
        # Method 3: Using password
        if [ "$DB_CREATED" = false ]; then
            if PGPASSWORD="$POSTGRES_PASSWORD" createdb -h localhost -U postgres testdb 2>/dev/null; then
                DB_CREATED=true
                echo -e "${GREEN}    ✓ Database 'testdb' created${NC}"
            fi
        fi
        
        # Check if database already exists
        if [ "$DB_CREATED" = false ]; then
            if PGPASSWORD="$POSTGRES_PASSWORD" psql -h localhost -U postgres -d testdb -c "SELECT 1;" >/dev/null 2>&1; then
                echo -e "${GREEN}    ✓ Database 'testdb' already exists${NC}"
                DB_CREATED=true
        else
                echo -e "${RED}    ✗ CRITICAL: Could not create or verify database 'testdb'${NC}"
                echo "      This will cause the mesh server to fail!"
                echo "      Please create it manually:"
                echo "        sudo -u postgres createdb testdb"
                echo "      Or: PGPASSWORD=password createdb -h localhost -U postgres testdb"
                return 1
            fi
        fi
        
    # Verify connection
    POSTGRES_PASSWORD="password"
    echo "  Verifying PostgreSQL connection..."
    if psql -h localhost -U postgres -d testdb -c "SELECT 1;" >/dev/null 2>&1 || \
       PGPASSWORD="$POSTGRES_PASSWORD" psql -h localhost -U postgres -d testdb -c "SELECT 1;" >/dev/null 2>&1; then
        echo -e "${GREEN}  ✓ PostgreSQL connection verified${NC}"
        
        # Save credentials to .env.local (always update to ensure consistency)
        if [ -f ".env.local" ]; then
            echo "  Saving PostgreSQL credentials to .env.local..."
            # Always update POSTGRES_PASSWORD to "password" to ensure consistency
            if [[ "$OS" == "macos" ]]; then
                if grep -q "POSTGRES_PASSWORD=" .env.local; then
                    sed -i '' "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$POSTGRES_PASSWORD|g" .env.local
                else
                    # Add it if it doesn't exist
                    echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" >> .env.local
                fi
            else
                if grep -q "POSTGRES_PASSWORD=" .env.local; then
                    sed -i "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$POSTGRES_PASSWORD|g" .env.local
                else
                    # Add it if it doesn't exist
                    echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" >> .env.local
                fi
            fi
            echo -e "${GREEN}  ✓ PostgreSQL password saved to .env.local: password${NC}"
            
            # Ensure POSTGRES_DB is set to testdb
            if [[ "$OS" == "macos" ]]; then
                if grep -q "POSTGRES_DB=" .env.local; then
                    sed -i '' "s|POSTGRES_DB=.*|POSTGRES_DB=testdb|g" .env.local
                else
                    echo "POSTGRES_DB=testdb" >> .env.local
                fi
            else
                if grep -q "POSTGRES_DB=" .env.local; then
                    sed -i "s|POSTGRES_DB=.*|POSTGRES_DB=testdb|g" .env.local
                else
                    echo "POSTGRES_DB=testdb" >> .env.local
                fi
            fi

            # Also set POSTGRES_DATABASE for components that expect it
            if [[ "$OS" == "macos" ]]; then
                if grep -q "POSTGRES_DATABASE=" .env.local; then
                    sed -i '' "s|POSTGRES_DATABASE=.*|POSTGRES_DATABASE=testdb|g" .env.local
                else
                    echo "POSTGRES_DATABASE=testdb" >> .env.local
                fi
            else
                if grep -q "POSTGRES_DATABASE=" .env.local; then
                    sed -i "s|POSTGRES_DATABASE=.*|POSTGRES_DATABASE=testdb|g" .env.local
                else
                    echo "POSTGRES_DATABASE=testdb" >> .env.local
                fi
            fi
            
            # Sync to app env files
            if command_exists npm; then
                echo "  Syncing PostgreSQL credentials to all app env files..."
                npm run sync:env 2>/dev/null || echo -e "${YELLOW}    ! Could not sync (run 'npm run sync:env' manually)${NC}"
            fi
        fi
        
        # Automatically seed database immediately after PostgreSQL is ready
        echo ""
        echo -e "${CYAN}  Seeding database with initial data...${NC}"
        echo "  This will create:"
        echo "    • Pearl assistant (configured for local development)"
        echo "    • Demo user for Interface (demo@local.dev / password123)"
        echo "    • Admin user for Dashboard (admin@local.dev / admin123)"
        echo "    • Sample notes and content"
        echo ""
        
        # Use TUI if available (from new-setup.sh)
        local seed_action="add"
        if [[ "${USE_TUI:-false}" == "true" ]] && command_exists node && [[ -f "${REPO_ROOT:-.}/scripts/setup-wizard-ui.mjs" ]]; then
            local tmpfile
            tmpfile=$(mktemp)
            cd "${REPO_ROOT:-.}" && TUI_OUTPUT_FILE="$tmpfile" NODE_PATH="${REPO_ROOT:-.}/node_modules" node scripts/setup-wizard-ui.mjs db-seeding 2>/dev/null
            local tui_result
            tui_result=$(cat "$tmpfile" 2>/dev/null)
            rm -f "$tmpfile"
            if [[ -n "$tui_result" ]]; then
                seed_action=$(echo "$tui_result" | grep -o '"action":"[^"]*"' | cut -d'"' -f4)
            fi
        else
            # Fallback to numbered prompt
            echo "Options:"
            echo "  1. Skip (keep existing data)"
            echo "  2. Add seed data alongside existing"
            echo "  3. Clear all and reseed (destructive!)"
            echo ""
            read -p "Choose option [1-3] (default: 2): " seed_choice
            case "${seed_choice:-2}" in
                1) seed_action="skip" ;;
                2) seed_action="add" ;;
                3) seed_action="clear_reseed" ;;
            esac
        fi
        
        # Wait a moment for PostgreSQL to be fully ready
        sleep 2
        
        # Run seed script based on user choice
        case "$seed_action" in
            skip)
                echo -e "${YELLOW}  Skipping database seeding${NC}"
                ;;
            clear_reseed)
                echo -e "${YELLOW}  Clearing database and reseeding...${NC}"
                npm run pg:db-clear 2>/dev/null || true
                if npm run pg:seed 2>/dev/null; then
                    echo -e "${GREEN}  ✓ Database cleared and reseeded successfully${NC}"
                else
                    echo -e "${YELLOW}  ! Database seeding failed${NC}"
                    echo "    You can run manually later: npm run pg:seed"
                fi
                ;;
            add|*)
                # Default: add seed data
                if npm run pg:seed 2>/dev/null; then
                    echo -e "${GREEN}  ✓ Database seeded successfully${NC}"
                else
                    echo -e "${YELLOW}  ! Database seeding failed or data already exists${NC}"
                    echo "    You can run manually later: npm run pg:seed"
                fi
                ;;
        esac
        
        # Note: Functional prompts seeding is now done in functional_prompts() after dev server starts
    else
        echo -e "${YELLOW}    ! Could not verify connection${NC}"
        echo "    Please ensure PostgreSQL is running and accessible"
    fi
    
    echo -e "${GREEN}  ✓ PostgreSQL ready and seeded${NC}"
    echo ""
}

# Note: Database seeding is now done automatically in setup_postgres()
# No separate seed_database function needed

# ============================================================
# MAIN
# ============================================================
main() {
    print_banner
    check_prerequisites
    
    # Install Node.js if missing (before npm install step)
    if ! command_exists node || ! command_exists npm; then
        if ! install_nodejs; then
            echo -e "${RED}  ✗ CRITICAL: Node.js installation failed. Cannot continue.${NC}"
            echo "    Please install Node.js manually and run this script again."
            exit 1
        fi
    fi
    
    install_poetry
    install_uv
    init_submodules
    install_npm_deps
    
    # Install bot dependencies (non-critical - script continues if this fails)
    if ! install_bot_deps; then
        echo -e "${YELLOW}  ! Bot dependencies installation had issues, but continuing setup...${NC}"
        echo ""
    fi
    
    download_chorus_assets
    setup_env
    setup_postgres  # This now includes automatic database seeding
    
    # Success message
    echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}${BOLD}  ✓ SETUP COMPLETE!${NC}"
    echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    # Final instructions
    echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}${BOLD}  NEXT STEPS${NC}"
    echo -e "${CYAN}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${BOLD}1. Add your API keys to .env.local:${NC}"
    echo "   • DAILY_API_KEY (get from https://dashboard.daily.co)"
    echo "   • OPENAI_API_KEY (get from https://platform.openai.com/api-keys)"
    echo "   • DEEPGRAM_API_KEY (get from https://console.deepgram.com/)"
    echo ""
    echo -e "${BOLD}2. Start the platform:${NC}"
    echo "   npm run start:all"
    echo ""
    echo -e "${BOLD}3. Access the apps:${NC}"
    echo "   • Interface:   http://localhost:3000/pearlos"
    echo "   • Dashboard:   http://localhost:4000"
    echo "   • GraphQL:     http://localhost:2000/graphql"
    echo ""
    echo -e "${BOLD}4. Login credentials:${NC}"
    echo "   Interface:  demo@local.dev / password123"
    echo "   Dashboard:  admin@local.dev / admin123"
    echo ""
    echo -e "${BOLD}5. For voice features:${NC}"
    echo "   • Start TTS:  npm run chorus:start (in separate terminal)"
    echo "   • Bot will auto-start when you join a voice call"
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
}

# Run main only when executed directly (not when sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main
fi

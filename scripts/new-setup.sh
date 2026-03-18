#!/usr/bin/env bash
# Pearl-OS - New Setup Wizard (TUI-ish)
# - Menu-driven wrapper around `setup.sh`
# - Works before `npm install` (no Node prompt deps)

set -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
new-setup.sh - interactive setup wizard for Pearl-OS

Usage:
  bash new-setup.sh

Non-interactive:
  bash new-setup.sh --preset full --non-interactive
  bash new-setup.sh --preset minimal --non-interactive

Dry run:
  bash new-setup.sh --preset minimal --dry-run

Options:
  --preset <full|minimal|custom>   Preset selection (default: interactive prompt)
  --non-interactive               Do not prompt; requires --preset != custom
  --dry-run                       Print steps that would run, then exit 0
  -h, --help                      Show this help
EOF
}

PRESET=""
NON_INTERACTIVE=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --preset)
      PRESET="${2:-}"
      shift 2
      ;;
    --non-interactive)
      NON_INTERACTIVE=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      echo "" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! -f "${REPO_ROOT}/setup.sh" ]]; then
  echo "Error: expected ${REPO_ROOT}/setup.sh" >&2
  exit 1
fi

# Source setup.sh for the step functions + color vars + OS detection
source "${REPO_ROOT}/setup.sh"

# Check if Node.js TUI is available (inquirer-based)
USE_TUI=false
TUI_SCRIPT="${REPO_ROOT}/scripts/setup-wizard-ui.mjs"
if command_exists node && [[ -f "$TUI_SCRIPT" ]]; then
  # Check if inquirer is available (try to require it)
  if node -e "require('inquirer')" 2>/dev/null; then
    USE_TUI=true
  elif [[ -d "${REPO_ROOT}/node_modules/inquirer" ]]; then
    # Inquirer exists but might not be in require path; try with NODE_PATH
    USE_TUI=true
  fi
fi

# Export USE_TUI so setup.sh can use it when sourced
export USE_TUI
export REPO_ROOT

print_wizard_banner() {
  echo ""
  echo -e "${BLUE}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}${BOLD}        Pearl-OS - Setup Wizard${NC}"
  echo -e "${BLUE}${BOLD}═══════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "${CYAN}Detected OS: ${OS}${NC}"
  echo ""
}

# Safe env helpers (do NOT print secret values)
escape_env_value() {
  local v="$1"
  v="${v//\\/\\\\}"
  v="${v//\"/\\\"}"
  v="${v//\$/\\\$}"
  v="${v//\`/\\\`}"
  printf '"%s"' "$v"
}

upsert_env_kv() {
  local file="$1"
  local key="$2"
  local value="$3"
  local encoded
  encoded="$(escape_env_value "$value")"

  [[ -f "$file" ]] || return 1

  local tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$encoded" '
    BEGIN { found=0 }
    $0 ~ ("^" k "=") { print k "=" v; found=1; next }
    { print }
    END { if (found==0) print k "=" v }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

env_has_key() {
  local file="$1"
  local key="$2"
  [[ -f "$file" ]] || return 1
  grep -qE "^${key}=" "$file"
}

wizard_permissions() {
  if $NON_INTERACTIVE; then
    return 0
  fi

  # If TUI is handling this, skip simple prompt
  if $USE_TUI && is_interactive; then
    return 0
  fi

  echo -e "${BOLD}Permissions / consent${NC}"
  echo ""
  echo "This wizard may:"
  echo "  - Install system packages (may require sudo)"
  echo "  - Run npm commands (install, sync env, seed DB)"
  echo "  - Create/modify .env files (including writing API keys you provide)"
  echo "  - Install/configure PostgreSQL and set local dev password"
  echo ""
  echo -e "${YELLOW}Nothing will be executed without your confirmation.${NC}"
  echo ""

  read -r -p "Proceed? (y/N): " ans
  if [[ ! "$ans" =~ ^[yY]$ ]]; then
    echo "Aborted."
    exit 0
  fi
}

# Comprehensive prerequisite assessment
assess_prerequisites() {
  local missing_tools=()
  local missing_package_managers=()
  local issues=()

  echo -e "${BOLD}Assessing system prerequisites...${NC}"
  echo ""

  # Check for package managers
  case "$OS" in
    macos)
      if ! command_exists brew; then
        missing_package_managers+=("Homebrew")
        echo -e "${YELLOW}  ! Homebrew not found${NC}"
        echo "    Homebrew is recommended for installing Node.js, Python, and PostgreSQL on macOS"
      else
        echo -e "${GREEN}  ✓ Homebrew found${NC}"
        # Refresh Homebrew PATH (handles both Intel and Apple Silicon)
        if [ -f "/opt/homebrew/bin/brew" ]; then
          eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || true
        elif [ -f "/usr/local/bin/brew" ]; then
          eval "$(/usr/local/bin/brew shellenv)" 2>/dev/null || true
        fi
      fi
      ;;
    linux)
      if command_exists apt-get; then
        echo -e "${GREEN}  ✓ apt package manager found${NC}"
      elif command_exists yum; then
        echo -e "${GREEN}  ✓ yum package manager found${NC}"
      elif command_exists dnf; then
        echo -e "${GREEN}  ✓ dnf package manager found${NC}"
      elif command_exists pacman; then
        echo -e "${GREEN}  ✓ pacman package manager found${NC}"
      else
        missing_package_managers+=("Package manager (apt/yum/dnf/pacman)")
        echo -e "${YELLOW}  ! No supported package manager found${NC}"
      fi
      ;;
  esac

  # Check basic tools
  if ! command_exists git; then
    missing_tools+=("git")
    echo -e "${YELLOW}  ! git not found${NC}"
  else
    echo -e "${GREEN}  ✓ git found${NC}"
  fi

  if ! command_exists curl; then
    missing_tools+=("curl")
    echo -e "${YELLOW}  ! curl not found${NC}"
  else
    echo -e "${GREEN}  ✓ curl found${NC}"
  fi

  # Check Node.js
  if ! command_exists node; then
    missing_tools+=("Node.js")
    echo -e "${YELLOW}  ! Node.js not found${NC}"
  else
    NODE_VERSION=$(node --version 2>/dev/null || echo "unknown")
    echo -e "${GREEN}  ✓ Node.js: ${NODE_VERSION}${NC}"
  fi

  if ! command_exists npm; then
    missing_tools+=("npm")
    echo -e "${YELLOW}  ! npm not found${NC}"
  else
    NPM_VERSION=$(npm --version 2>/dev/null || echo "unknown")
    echo -e "${GREEN}  ✓ npm: ${NPM_VERSION}${NC}"
  fi

  # Check Python
  if ! check_python_version; then
    missing_tools+=("Python 3.11+")
    echo -e "${YELLOW}  ! Python 3.11+ not found${NC}"
  else
    PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
    echo -e "${GREEN}  ✓ Python: ${PYTHON_VERSION}${NC}"
  fi

  # Check PostgreSQL
  if ! command_exists psql; then
    missing_tools+=("PostgreSQL")
    echo -e "${YELLOW}  ! PostgreSQL not found${NC}"
  else
    PSQL_VERSION=$(psql --version 2>/dev/null | head -n1 || echo "installed")
    echo -e "${GREEN}  ✓ PostgreSQL: ${PSQL_VERSION}${NC}"
  fi

  # Check Poetry
  if ! command_exists poetry; then
    missing_tools+=("Poetry")
    echo -e "${YELLOW}  ! Poetry not found${NC}"
  else
    POETRY_VERSION=$(poetry --version 2>/dev/null || echo "installed")
    echo -e "${GREEN}  ✓ Poetry: ${POETRY_VERSION}${NC}"
  fi

  # Check uv
  if ! command_exists uv; then
    missing_tools+=("uv")
    echo -e "${YELLOW}  ! uv not found${NC}"
  else
    UV_VERSION=$(uv --version 2>/dev/null || echo "installed")
    echo -e "${GREEN}  ✓ uv: ${UV_VERSION}${NC}"
  fi

  echo ""

  # If missing items, ask what to install
  if [[ ${#missing_package_managers[@]} -gt 0 ]] || [[ ${#missing_tools[@]} -gt 0 ]]; then
    if $NON_INTERACTIVE; then
      echo -e "${YELLOW}  ! Missing prerequisites detected, but --non-interactive is set.${NC}"
      echo "    Some setup steps may fail. Install missing items manually:"
      [[ ${#missing_package_managers[@]} -gt 0 ]] && printf "      - %s\n" "${missing_package_managers[@]}"
      [[ ${#missing_tools[@]} -gt 0 ]] && printf "      - %s\n" "${missing_tools[@]}"
      echo ""
      return 0
    fi

    echo -e "${BOLD}Missing prerequisites detected:${NC}"
    [[ ${#missing_package_managers[@]} -gt 0 ]] && printf "  • %s\n" "${missing_package_managers[@]}"
    [[ ${#missing_tools[@]} -gt 0 ]] && printf "  • %s\n" "${missing_tools[@]}"
    echo ""
    echo "Would you like to install missing items now?"
    echo "  1) Install all missing items (recommended)"
    echo "  2) Install package manager only (Homebrew/apt/etc)"
    echo "  3) Install tools only (git, Node.js, Python, etc.)"
    echo "  4) Skip installation (you can install manually later)"
    echo ""
    read -r -p "Choose option [1-4] (default: 1): " install_choice

    case "${install_choice:-1}" in
      1)
        # Install package managers first, then tools
        if [[ ${#missing_package_managers[@]} -gt 0 ]]; then
          install_package_managers
        fi
        if [[ ${#missing_tools[@]} -gt 0 ]]; then
          install_missing_tools
        fi
        ;;
      2)
        if [[ ${#missing_package_managers[@]} -gt 0 ]]; then
          install_package_managers
        fi
        ;;
      3)
        install_missing_tools
        ;;
      4)
        echo -e "${YELLOW}  Skipping installation. You may need to install items manually.${NC}"
        ;;
    esac
  else
    echo -e "${GREEN}  ✓ All prerequisites found${NC}"
  fi

  echo ""
  refresh_path_after_installs
}

install_package_managers() {
  case "$OS" in
    macos)
      if ! command_exists brew; then
        echo ""
        echo -e "${CYAN}Installing Homebrew...${NC}"
        echo "  This may take a few minutes and may prompt for your password."
        echo ""
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        
        if [ $? -eq 0 ]; then
          # Refresh PATH immediately (handles both Intel and Apple Silicon)
          if [ -f "/opt/homebrew/bin/brew" ]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
            export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
          elif [ -f "/usr/local/bin/brew" ]; then
            eval "$(/usr/local/bin/brew shellenv)"
            export PATH="/usr/local/bin:/usr/local/sbin:$PATH"
          fi
          
          # Add to shell profile for persistence
          if [ -f "$HOME/.zshrc" ]; then
            if ! grep -q "brew shellenv" "$HOME/.zshrc"; then
              echo '' >> "$HOME/.zshrc"
              if [ -f "/opt/homebrew/bin/brew" ]; then
                echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zshrc"
              else
                echo 'eval "$(/usr/local/bin/brew shellenv)"' >> "$HOME/.zshrc"
              fi
            fi
          elif [ -f "$HOME/.bash_profile" ]; then
            if ! grep -q "brew shellenv" "$HOME/.bash_profile"; then
              echo '' >> "$HOME/.bash_profile"
              if [ -f "/opt/homebrew/bin/brew" ]; then
                echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.bash_profile"
              else
                echo 'eval "$(/usr/local/bin/brew shellenv)"' >> "$HOME/.bash_profile"
              fi
            fi
          fi
          
          echo -e "${GREEN}  ✓ Homebrew installed and PATH updated${NC}"
        else
          echo -e "${RED}  ✗ Failed to install Homebrew${NC}"
          return 1
        fi
      fi
      ;;
    linux)
      echo -e "${YELLOW}  Package managers are typically pre-installed on Linux.${NC}"
      echo "    If missing, install via your distribution's package manager."
      ;;
  esac
}

install_missing_tools() {
  local to_install=()
  
  # Check what's still missing after package manager install
  ! command_exists git && to_install+=("git")
  ! command_exists curl && to_install+=("curl")
  ! command_exists node && to_install+=("nodejs")
  ! check_python_version && to_install+=("python3.11")
  ! command_exists psql && to_install+=("postgresql")
  ! command_exists poetry && to_install+=("poetry")
  ! command_exists uv && to_install+=("uv")

  if [[ ${#to_install[@]} -eq 0 ]]; then
    echo -e "${GREEN}  ✓ All tools are available${NC}"
    return 0
  fi

  echo ""
  echo -e "${CYAN}Installing missing tools...${NC}"
  echo ""

  case "$OS" in
    macos)
      if command_exists brew; then
        # Refresh Homebrew PATH first
        if [ -f "/opt/homebrew/bin/brew" ]; then
          eval "$(/opt/homebrew/bin/brew shellenv)"
        elif [ -f "/usr/local/bin/brew" ]; then
          eval "$(/usr/local/bin/brew shellenv)"
        fi
        
        # Install via Homebrew
        for tool in "${to_install[@]}"; do
          case "$tool" in
            git|curl)
              echo "  Installing $tool via Homebrew..."
              brew install "$tool" 2>&1 | grep -v "^==>"
              refresh_path_after_installs
              ;;
            nodejs)
              echo "  Installing Node.js via Homebrew..."
              brew install node 2>&1 | grep -v "^==>"
              refresh_path_after_installs
              ;;
            python3.11)
              echo "  Installing Python 3.11+ via Homebrew..."
              brew install python@3.11 2>&1 | grep -v "^==>"
              refresh_path_after_installs
              ;;
            postgresql)
              echo "  Installing PostgreSQL via Homebrew..."
              brew install postgresql@15 2>&1 | grep -v "^==>"
              refresh_path_after_installs
              ;;
            poetry)
              echo "  Installing Poetry..."
              if command_exists python3; then
                curl -sSL https://install.python-poetry.org | python3 -
                export PATH="$HOME/.local/bin:$PATH"
                refresh_path_after_installs
              fi
              ;;
            uv)
              echo "  Installing uv..."
              curl -LsSf https://astral.sh/uv/install.sh | sh
              export PATH="$HOME/.cargo/bin:$PATH"
              [ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
              refresh_path_after_installs
              ;;
          esac
        done
      else
        echo -e "${YELLOW}  ! Homebrew not found. Please install Homebrew first.${NC}"
        return 1
      fi
      ;;
    linux)
      if command_exists apt-get; then
        echo "  Installing via apt (may require sudo password)..."
        sudo apt-get update
        for tool in "${to_install[@]}"; do
          case "$tool" in
            git|curl)
              sudo apt-get install -y "$tool"
              ;;
            nodejs)
              curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
              sudo apt-get install -y nodejs
              ;;
            python3.11)
              sudo apt-get install -y python3.11 python3.11-venv python3-pip
              ;;
            postgresql)
              sudo apt-get install -y postgresql postgresql-contrib
              ;;
            poetry)
              curl -sSL https://install.python-poetry.org | python3 -
              export PATH="$HOME/.local/bin:$PATH"
              ;;
            uv)
              curl -LsSf https://astral.sh/uv/install.sh | sh
              export PATH="$HOME/.cargo/bin:$PATH"
              [ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
              ;;
          esac
        done
      elif command_exists yum || command_exists dnf; then
        PKG_MGR="yum"
        command_exists dnf && PKG_MGR="dnf"
        echo "  Installing via $PKG_MGR (may require sudo password)..."
        for tool in "${to_install[@]}"; do
          case "$tool" in
            git|curl|postgresql)
              sudo $PKG_MGR install -y "$tool"
              ;;
            nodejs)
              curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
              sudo $PKG_MGR install -y nodejs
              ;;
            python3.11)
              sudo $PKG_MGR install -y python3 python3-pip
              ;;
            poetry)
              curl -sSL https://install.python-poetry.org | python3 -
              export PATH="$HOME/.local/bin:$PATH"
              ;;
            uv)
              curl -LsSf https://astral.sh/uv/install.sh | sh
              export PATH="$HOME/.cargo/bin:$PATH"
              [ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
              ;;
          esac
        done
      fi
      ;;
  esac

  echo ""
  refresh_path_after_installs
}

refresh_path_after_installs() {
  # Refresh PATH to pick up newly installed tools
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
  
  # macOS: Refresh Homebrew PATH
  if [[ "$OS" == "macos" ]]; then
    if [ -f "/opt/homebrew/bin/brew" ]; then
      eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || true
      export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
    elif [ -f "/usr/local/bin/brew" ]; then
      eval "$(/usr/local/bin/brew shellenv)" 2>/dev/null || true
      export PATH="/usr/local/bin:/usr/local/sbin:$PATH"
    fi
  fi
  
  # Source cargo env if available
  [ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env" 2>/dev/null || true
  
  # Verify PATH updates worked
  if command_exists node && command_exists npm; then
    echo -e "${GREEN}  ✓ PATH refreshed - Node.js and npm are available${NC}"
  fi
}

wizard_credentials() {
  local env_file="${REPO_ROOT}/.env.local"

  if [[ ! -f "$env_file" ]]; then
    echo -e "${YELLOW}  ! .env.local not found yet; run 'Setup environment files' first, then rerun credentials.${NC}"
    return 0
  fi

  if $NON_INTERACTIVE; then
    return 0
  fi

  # If TUI is handling this, skip simple prompt
  if $USE_TUI && is_interactive; then
    return 0
  fi

  echo -e "${BOLD}Credentials (API keys)${NC}"
  echo ""
  echo "Optional but recommended now (you can edit .env.local later):"
  echo "  - DAILY_API_KEY     (Daily.co dashboard)"
  echo "  - OPENAI_API_KEY    (OpenAI API keys)"
  echo "  - DEEPGRAM_API_KEY  (Deepgram console)"
  echo ""
  echo -e "${YELLOW}We will never print the keys back to the terminal.${NC}"
  echo ""

  local changed=0

  prompt_key() {
    local key="$1"
    local label="$2"
    if env_has_key "$env_file" "$key"; then
      read -r -p "$label already exists in .env.local. Overwrite? (y/N): " ow
      [[ "$ow" =~ ^[yY]$ ]] || return 0
    else
      read -r -p "Set $label now? (y/N): " setit
      [[ "$setit" =~ ^[yY]$ ]] || return 0
    fi

    local val=""
    read -r -s -p "Enter $label: " val
    echo ""
    if [[ -z "$val" ]]; then
      echo -e "${YELLOW}  ! Empty value; skipping.${NC}"
      return 0
    fi

    upsert_env_kv "$env_file" "$key" "$val"
    changed=1
    echo -e "${GREEN}  ✓ Saved ${label} to .env.local${NC}"
  }

  prompt_key "DAILY_API_KEY" "DAILY_API_KEY"
  prompt_key "OPENAI_API_KEY" "OPENAI_API_KEY"
  prompt_key "DEEPGRAM_API_KEY" "DEEPGRAM_API_KEY"

  if [[ "$changed" -eq 1 ]]; then
    echo ""
    echo "Syncing env files + bot env (best effort)..."
    if command_exists npm; then
      npm run sync:env 2>/dev/null || true
    fi
    if declare -F create_bot_env >/dev/null 2>&1; then
      create_bot_env || true
    fi
  fi
}

install_package_managers() {
  case "$OS" in
    macos)
      if ! command_exists brew; then
        echo ""
        echo -e "${CYAN}Installing Homebrew...${NC}"
        echo "  This may take a few minutes and may prompt for your password."
        echo ""
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        
        if [ $? -eq 0 ]; then
          # Refresh PATH immediately (handles both Intel and Apple Silicon)
          if [ -f "/opt/homebrew/bin/brew" ]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
            export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
          elif [ -f "/usr/local/bin/brew" ]; then
            eval "$(/usr/local/bin/brew shellenv)"
            export PATH="/usr/local/bin:/usr/local/sbin:$PATH"
          fi
          
          # Add to shell profile for persistence
          if [ -f "$HOME/.zshrc" ]; then
            if ! grep -q "brew shellenv" "$HOME/.zshrc"; then
              echo '' >> "$HOME/.zshrc"
              if [ -f "/opt/homebrew/bin/brew" ]; then
                echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zshrc"
              else
                echo 'eval "$(/usr/local/bin/brew shellenv)"' >> "$HOME/.zshrc"
              fi
            fi
          elif [ -f "$HOME/.bash_profile" ]; then
            if ! grep -q "brew shellenv" "$HOME/.bash_profile"; then
              echo '' >> "$HOME/.bash_profile"
              if [ -f "/opt/homebrew/bin/brew" ]; then
                echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.bash_profile"
              else
                echo 'eval "$(/usr/local/bin/brew shellenv)"' >> "$HOME/.bash_profile"
              fi
            fi
          fi
          
          echo -e "${GREEN}  ✓ Homebrew installed and PATH updated${NC}"
        else
          echo -e "${RED}  ✗ Failed to install Homebrew${NC}"
          return 1
        fi
      fi
      ;;
    linux)
      echo -e "${YELLOW}  Package managers are typically pre-installed on Linux.${NC}"
      echo "    If missing, install via your distribution's package manager."
      ;;
  esac
}

install_missing_tools() {
  local to_install=()
  
  # Check what's still missing after package manager install
  ! command_exists git && to_install+=("git")
  ! command_exists curl && to_install+=("curl")
  ! command_exists node && to_install+=("nodejs")
  ! check_python_version && to_install+=("python3.11")
  ! command_exists psql && to_install+=("postgresql")
  ! command_exists poetry && to_install+=("poetry")
  ! command_exists uv && to_install+=("uv")

  if [[ ${#to_install[@]} -eq 0 ]]; then
    echo -e "${GREEN}  ✓ All tools are available${NC}"
    return 0
  fi

  echo ""
  echo -e "${CYAN}Installing missing tools...${NC}"
  echo ""

  case "$OS" in
    macos)
      if command_exists brew; then
        # Refresh Homebrew PATH first
        if [ -f "/opt/homebrew/bin/brew" ]; then
          eval "$(/opt/homebrew/bin/brew shellenv)"
        elif [ -f "/usr/local/bin/brew" ]; then
          eval "$(/usr/local/bin/brew shellenv)"
        fi
        
        # Install via Homebrew
        for tool in "${to_install[@]}"; do
          case "$tool" in
            git|curl)
              echo "  Installing $tool via Homebrew..."
              brew install "$tool" 2>&1 | grep -v "^==>"
              refresh_path_after_installs
              ;;
            nodejs)
              echo "  Installing Node.js via Homebrew..."
              brew install node 2>&1 | grep -v "^==>"
              refresh_path_after_installs
              ;;
            python3.11)
              echo "  Installing Python 3.11+ via Homebrew..."
              brew install python@3.11 2>&1 | grep -v "^==>"
              refresh_path_after_installs
              ;;
            postgresql)
              echo "  Installing PostgreSQL via Homebrew..."
              brew install postgresql@15 2>&1 | grep -v "^==>"
              refresh_path_after_installs
              ;;
            poetry)
              echo "  Installing Poetry..."
              if command_exists python3; then
                curl -sSL https://install.python-poetry.org | python3 -
                export PATH="$HOME/.local/bin:$PATH"
                refresh_path_after_installs
              fi
              ;;
            uv)
              echo "  Installing uv..."
              curl -LsSf https://astral.sh/uv/install.sh | sh
              export PATH="$HOME/.cargo/bin:$PATH"
              [ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
              refresh_path_after_installs
              ;;
          esac
        done
      else
        echo -e "${YELLOW}  ! Homebrew not found. Please install Homebrew first.${NC}"
        return 1
      fi
      ;;
    linux)
      if command_exists apt-get; then
        echo "  Installing via apt (may require sudo password)..."
        sudo apt-get update
        for tool in "${to_install[@]}"; do
          case "$tool" in
            git|curl)
              sudo apt-get install -y "$tool"
              ;;
            nodejs)
              curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
              sudo apt-get install -y nodejs
              ;;
            python3.11)
              sudo apt-get install -y python3.11 python3.11-venv python3-pip
              ;;
            postgresql)
              sudo apt-get install -y postgresql postgresql-contrib
              ;;
            poetry)
              curl -sSL https://install.python-poetry.org | python3 -
              export PATH="$HOME/.local/bin:$PATH"
              ;;
            uv)
              curl -LsSf https://astral.sh/uv/install.sh | sh
              export PATH="$HOME/.cargo/bin:$PATH"
              [ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
              ;;
          esac
        done
      elif command_exists yum || command_exists dnf; then
        PKG_MGR="yum"
        command_exists dnf && PKG_MGR="dnf"
        echo "  Installing via $PKG_MGR (may require sudo password)..."
        for tool in "${to_install[@]}"; do
          case "$tool" in
            git|curl|postgresql)
              sudo $PKG_MGR install -y "$tool"
              ;;
            nodejs)
              curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
              sudo $PKG_MGR install -y nodejs
              ;;
            python3.11)
              sudo $PKG_MGR install -y python3 python3-pip
              ;;
            poetry)
              curl -sSL https://install.python-poetry.org | python3 -
              export PATH="$HOME/.local/bin:$PATH"
              ;;
            uv)
              curl -LsSf https://astral.sh/uv/install.sh | sh
              export PATH="$HOME/.cargo/bin:$PATH"
              [ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
              ;;
          esac
        done
      fi
      ;;
  esac

  echo ""
  refresh_path_after_installs
}

refresh_path_after_installs() {
  # Refresh PATH to pick up newly installed tools
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
  
  # macOS: Refresh Homebrew PATH
  if [[ "$OS" == "macos" ]]; then
    if [ -f "/opt/homebrew/bin/brew" ]; then
      eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || true
      export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
    elif [ -f "/usr/local/bin/brew" ]; then
      eval "$(/usr/local/bin/brew shellenv)" 2>/dev/null || true
      export PATH="/usr/local/bin:/usr/local/sbin:$PATH"
    fi
  fi
  
  # Source cargo env if available
  [ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env" 2>/dev/null || true
  
  # Verify PATH updates worked
  if command_exists node && command_exists npm; then
    echo -e "${GREEN}  ✓ PATH refreshed - Node.js and npm are available${NC}"
  fi
}

# Ordered step catalog (keep in sync with setup.sh functions)
STEP_IDS=(
  "wizard_permissions"
  "assess_prerequisites"
  "check_prerequisites"
  "install_nodejs"
  "install_poetry"
  "install_uv"
  "init_submodules"
  "install_npm_deps"
  "install_bot_deps"
  "download_chorus_assets"
  "setup_env"
  "wizard_credentials"
  "setup_postgres"
  "build_project"
  "start_dev_server"
  "functional_prompts"
)

STEP_LABELS=(
  "Permissions / consent"
  "Assess prerequisites (check what's missing, offer to install)"
  "Check prerequisites (verify all tools are available)"
  "Install Node.js (if missing)"
  "Install Poetry"
  "Install uv"
  "Initialize git submodules (chorus-tts)"
  "Install npm dependencies"
  "Install bot Python dependencies (pipecat)"
  "Download Chorus assets (Kokoro TTS)"
  "Setup environment files (.env.local + app envs + bot .env)"
  "Credentials (API keys → .env.local)"
  "Setup PostgreSQL (includes seeding)"
  "Build project (npm run build)"
  "Start development server (npm run dev)"
  "Functional prompts (verify project is running)"
)

STEP_FUNCS=(
  "wizard_permissions"
  "assess_prerequisites"
  "check_prerequisites"
  "install_nodejs"
  "install_poetry"
  "install_uv"
  "init_submodules"
  "install_npm_deps"
  "install_bot_deps"
  "download_chorus_assets"
  "setup_env"
  "wizard_credentials"
  "setup_postgres"
  "build_project"
  "start_dev_server"
  "functional_prompts"
)

SELECTED=()
for _ in "${STEP_IDS[@]}"; do SELECTED+=("0"); done

set_preset_full() {
  for i in "${!SELECTED[@]}"; do SELECTED[$i]="1"; done
}

set_preset_minimal() {
  for i in "${!SELECTED[@]}"; do SELECTED[$i]="0"; done
  # Minimal: enough to run the platform locally (skip bot deps + large model downloads)
  SELECTED[0]="1"  # wizard_permissions
  SELECTED[1]="1"  # assess_prerequisites (NEW - check and offer to install missing basics)
  SELECTED[2]="1"  # check_prerequisites
  SELECTED[3]="1"  # install_nodejs (if missing)
  SELECTED[4]="1"  # install_poetry (helps other scripts; safe)
  SELECTED[5]="1"  # install_uv (chorus optional but quick)
  SELECTED[6]="1"  # init_submodules
  SELECTED[7]="1"  # install_npm_deps
  SELECTED[10]="1" # setup_env
  SELECTED[11]="1" # wizard_credentials
  SELECTED[12]="1" # setup_postgres (includes seeding)
  SELECTED[13]="1" # build_project
  SELECTED[14]="1" # start_dev_server
  SELECTED[15]="1" # functional_prompts
}

set_preset_custom_interactive() {
  # start with minimal, user can toggle on more
  set_preset_minimal
}

is_interactive() {
  [[ -t 0 && -t 1 ]]
}

toggle_step() {
  local idx="$1"
  if [[ "${SELECTED[$idx]}" == "1" ]]; then
    SELECTED[$idx]="0"
  else
    SELECTED[$idx]="1"
  fi
}

print_steps() {
  echo ""
  echo -e "${BOLD}Selected steps:${NC}"
  for i in "${!STEP_IDS[@]}"; do
    local mark="[ ]"
    [[ "${SELECTED[$i]}" == "1" ]] && mark="[x]"
    printf "  %2d) %s %s\n" "$((i+1))" "$mark" "${STEP_LABELS[$i]}"
  done
  echo ""
}

confirm_or_exit() {
  local prompt="$1"
  if $NON_INTERACTIVE; then
    return 0
  fi
  read -r -p "$prompt (y/N): " ans
  if [[ ! "$ans" =~ ^[yY]$ ]]; then
    echo "Aborted."
    exit 0
  fi
}

run_selected() {
  print_steps

  if $DRY_RUN; then
    echo -e "${CYAN}Dry run only — nothing executed.${NC}"
    return 0
  fi

  confirm_or_exit "Run the selected steps now?"

  local failures=0

  for i in "${!STEP_FUNCS[@]}"; do
    if [[ "${SELECTED[$i]}" != "1" ]]; then
      continue
    fi

    local fn="${STEP_FUNCS[$i]}"
    echo ""
    echo -e "${BLUE}${BOLD}→ ${STEP_LABELS[$i]}${NC}"
    echo ""

    # Check if function exists (may be from setup.sh)
    if ! declare -F "$fn" >/dev/null 2>&1; then
      echo -e "${RED}  ✗ Function '$fn' not found${NC}"
      echo "    This function should be defined in setup.sh"
      failures=$((failures + 1))
      continue
    fi

    # Some functions may rely on strict mode when executed directly; we intentionally
    # run in a tolerant mode here so the wizard can decide how to handle failures.
    if "$fn"; then
      echo -e "${GREEN}  ✓ Step succeeded${NC}"
    else
      failures=$((failures + 1))
      echo -e "${YELLOW}  ! Step failed${NC}"
      if is_interactive && ! $NON_INTERACTIVE; then
        read -r -p "Continue to next step? (Y/n): " cont
        if [[ "$cont" =~ ^[nN]$ ]]; then
          break
        fi
      fi
    fi
  done

  echo ""
  if [[ $failures -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}All selected steps completed.${NC}"
    return 0
  fi
  echo -e "${YELLOW}${BOLD}Completed with ${failures} failure(s).${NC}"
  return 1
}

build_project() {
  echo -e "${BOLD}Building Pearl-OS project...${NC}"
  echo ""

  if ! command_exists npm; then
    echo -e "${RED}  ✗ npm not found. Cannot build project.${NC}"
    return 1
  fi

  cd "$REPO_ROOT" || return 1

  echo -e "${CYAN}  Running: npm run build${NC}"
  echo -e "${YELLOW}  [Building... This may take a few minutes]${NC}"

  # Show progress indicator while building
  local build_log
  build_log=$(mktemp)
  npm run build > "$build_log" 2>&1 &
  local build_pid=$!
  
  # Show spinner while building
  local spinner_chars=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")
  local spinner_idx=0
  while kill -0 "$build_pid" 2>/dev/null; do
    echo -ne "\r  ${spinner_chars[$spinner_idx]} Building... "
    spinner_idx=$(( (spinner_idx + 1) % ${#spinner_chars[@]} ))
    sleep 0.1
  done
  echo -ne "\r  ${GREEN}✓${NC} Build process completed\n"
  
  wait "$build_pid"
  local build_exit=$?
  
  if [ $build_exit -eq 0 ]; then
    echo -e "${GREEN}  ✓ Build completed successfully${NC}"
    rm -f "$build_log"
    return 0
  else
    echo -e "${RED}  ✗ Build failed with exit code ${build_exit}${NC}"
    echo ""
    echo -e "${YELLOW}  Build error output:${NC}"
    echo "  ──────────────────────────────────────────────────────────"
    # Show last 50 lines of error output
    tail -n 50 "$build_log" | sed 's/^/  /'
    echo "  ──────────────────────────────────────────────────────────"
    echo ""

    if is_interactive && ! $NON_INTERACTIVE; then
      echo -e "${YELLOW}  Would you like to:${NC}"
      echo "    1) Try to fix common build issues automatically"
      echo "    2) Show full build log"
      echo "    3) Skip build and continue"
      echo "    4) Abort setup"
      echo ""
      read -r -p "  Choose option [1-4] (default: 3): " fix_choice

      case "${fix_choice:-3}" in
        1)
          echo ""
          echo -e "${CYAN}  Attempting to fix common issues...${NC}"
          # Try common fixes
          echo "  - Clearing .next cache..."
          rm -rf .next 2>/dev/null || true
          echo "  - Clearing node_modules/.cache..."
          rm -rf node_modules/.cache 2>/dev/null || true
          echo "  - Re-running build..."
          if npm run build > "$build_log" 2>&1; then
            echo -e "${GREEN}  ✓ Build succeeded after fixes${NC}"
            rm -f "$build_log"
            return 0
          else
            echo -e "${YELLOW}  ! Automatic fixes did not resolve the issue${NC}"
            tail -n 30 "$build_log" | sed 's/^/  /'
          fi
          ;;
        2)
          echo ""
          echo -e "${CYAN}  Full build log:${NC}"
          cat "$build_log" | sed 's/^/  /'
          ;;
        3)
          echo -e "${YELLOW}  Skipping build. You can run 'npm run build' manually later.${NC}"
          rm -f "$build_log"
          return 0
          ;;
        4)
          echo "Setup aborted."
          rm -f "$build_log"
          exit 1
          ;;
      esac
    fi

    rm -f "$build_log"
    return 1
  fi
}

start_dev_server() {
  echo -e "${BOLD}Starting Pearl-OS development server...${NC}"
  echo ""

  if ! command_exists npm; then
    echo -e "${RED}  ✗ npm not found. Cannot start dev server.${NC}"
    return 1
  fi

  cd "$REPO_ROOT" || return 1

  # Check if dev server is already running
  if lsof -ti:3000 >/dev/null 2>&1 || lsof -ti:4000 >/dev/null 2>&1 || lsof -ti:2000 >/dev/null 2>&1; then
    echo -e "${YELLOW}  ! Development server appears to already be running on port 3000, 4000, or 2000${NC}"
    echo "    Skipping dev server start."
    return 0
  fi

  echo -e "${CYAN}  Starting: npm run dev${NC}"
  echo -e "${YELLOW}  Note: This will run in the background.${NC}"
  echo ""

  # Start dev server in background
  npm run dev > /tmp/pearl-os-dev.log 2>&1 &
  local dev_pid=$!
  echo "$dev_pid" > /tmp/pearl-os-dev.pid

  # Wait a bit for server to start
  echo -e "${CYAN}  Waiting for server to start...${NC}"
  sleep 5

  # Check if process is still running
  if ! kill -0 "$dev_pid" 2>/dev/null; then
    echo -e "${RED}  ✗ Dev server failed to start${NC}"
    echo ""
    echo -e "${YELLOW}  Error output:${NC}"
    tail -n 30 /tmp/pearl-os-dev.log | sed 's/^/  /'
    rm -f /tmp/pearl-os-dev.pid
    return 1
  fi

  # Check if server is responding
  local max_attempts=30
  local attempt=0
  local server_ready=false

  while [[ $attempt -lt $max_attempts ]]; do
    if curl -s http://localhost:3000 >/dev/null 2>&1 || \
       curl -s http://localhost:4000 >/dev/null 2>&1 || \
       curl -s http://localhost:2000/graphql >/dev/null 2>&1; then
      server_ready=true
      break
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  if [[ "$server_ready" == "true" ]]; then
    echo -e "${GREEN}  ✓ Development server started successfully${NC}"
    echo ""
    echo -e "${CYAN}  Server is running at:${NC}"
    curl -s http://localhost:3000 >/dev/null 2>&1 && echo "    • http://localhost:3000 (Interface)" || true
    curl -s http://localhost:4000 >/dev/null 2>&1 && echo "    • http://localhost:4000 (Dashboard)" || true
    curl -s http://localhost:2000/graphql >/dev/null 2>&1 && echo "    • http://localhost:2000/graphql (Mesh GraphQL)" || true
    echo ""
    echo -e "${YELLOW}  Dev server PID: ${dev_pid}${NC}"
    echo -e "${YELLOW}  Logs: /tmp/pearl-os-dev.log${NC}"
    echo -e "${YELLOW}  To stop: kill \$(cat /tmp/pearl-os-dev.pid)${NC}"
    return 0
  else
    echo -e "${YELLOW}  ! Dev server started but may not be fully ready yet${NC}"
    echo "    Check logs at /tmp/pearl-os-dev.log"
    return 0
  fi
}

functional_prompts() {
  echo -e "${BOLD}Functional verification prompts${NC}"
  echo ""

  if $NON_INTERACTIVE; then
    echo -e "${YELLOW}  Skipping functional prompts (--non-interactive mode)${NC}"
    return 0
  fi

  # Check if dev server is running
  local dev_pid=""
  if [[ -f /tmp/pearl-os-dev.pid ]]; then
    dev_pid=$(cat /tmp/pearl-os-dev.pid 2>/dev/null)
  fi

  if [[ -z "$dev_pid" ]] || ! kill -0 "$dev_pid" 2>/dev/null; then
    echo -e "${YELLOW}  ! Development server does not appear to be running${NC}"
    echo "    Start it manually with: npm run dev"
    return 0
  fi

  echo -e "${GREEN}  ✓ Development server is running${NC}"
  echo ""
  
  # Wait for server to be fully ready before seeding functional prompts
  echo -e "${CYAN}  Waiting for server to be fully ready...${NC}"
  local max_wait=60
  local waited=0
  local server_ready=false
  
  while [[ $waited -lt $max_wait ]]; do
    if curl -s http://localhost:3000 >/dev/null 2>&1 || \
       curl -s http://localhost:2000/graphql >/dev/null 2>&1; then
      server_ready=true
      break
    fi
    sleep 1
    waited=$((waited + 1))
    echo -ne "\r  Waiting... ${waited}s"
  done
  echo ""
  
  if [[ "$server_ready" == "true" ]]; then
    echo -e "${GREEN}  ✓ Server is ready${NC}"
    echo ""
    
    # Now seed functional prompts (requires running server)
    echo -e "${CYAN}  Seeding functional prompts...${NC}"
    echo "  This will create functional prompt definitions for bot tools"
    echo ""
    
    cd "$REPO_ROOT" || return 1
    
    if npm run pg:seed-prompts 2>&1; then
      echo -e "${GREEN}  ✓ Functional prompts seeded successfully${NC}"
    else
      echo -e "${YELLOW}  ! Functional prompt seeding failed or prompts already exist${NC}"
      echo "    You can run manually later: npm run pg:seed-prompts"
    fi
    echo ""
  else
    echo -e "${YELLOW}  ! Server may not be fully ready yet${NC}"
    echo "    Functional prompts will be skipped. Run manually later: npm run pg:seed-prompts"
    echo ""
  fi

  echo "Let's verify the project is working correctly:"
  echo ""

  # Prompt for verification
  echo "Please verify the following:"
  echo "  1) Open http://localhost:3000 in your browser"
  echo "  2) Check if the interface loads correctly"
  echo "  3) Try navigating to different pages"
  echo ""
  read -r -p "Is the interface working correctly? (y/N): " interface_ok

  if [[ "$interface_ok" =~ ^[yY]$ ]]; then
    echo -e "${GREEN}  ✓ Interface verified${NC}"
  else
    echo -e "${YELLOW}  ! Interface may have issues. Check the browser console for errors.${NC}"
  fi

  echo ""
  echo "Additional checks:"
  echo "  4) Check http://localhost:2000/graphql (GraphQL Playground)"
  echo "  5) Check http://localhost:4000 (Dashboard, if available)"
  echo ""
  read -r -p "Are all services working? (y/N): " services_ok

  if [[ "$services_ok" =~ ^[yY]$ ]]; then
    echo -e "${GREEN}  ✓ All services verified${NC}"
  else
    echo -e "${YELLOW}  ! Some services may have issues. Check logs at /tmp/pearl-os-dev.log${NC}"
  fi

  echo ""
  echo -e "${CYAN}  Next steps:${NC}"
  echo "    • Keep the dev server running for development"
  echo "    • View logs: tail -f /tmp/pearl-os-dev.log"
  echo "    • Stop server: kill \$(cat /tmp/pearl-os-dev.pid)"
  echo "    • Restart: npm run dev"
  echo ""
}

choose_preset_interactive() {
  echo "Choose a setup preset:"
  echo "  1) Full (everything)"
  echo "  2) Minimal (recommended to start)"
  echo "  3) Custom (toggle steps)"
  echo "  4) Exit"
  echo ""
  read -r -p "Select [1-4] (default: 2): " choice
  case "${choice:-2}" in
    1) PRESET="full" ;;
    2) PRESET="minimal" ;;
    3) PRESET="custom" ;;
    4) exit 0 ;;
    *) PRESET="minimal" ;;
  esac
}

custom_menu() {
  set_preset_custom_interactive
  while true; do
    print_steps
    echo "Custom setup:"
    echo "  - Enter a step number to toggle it"
    echo "  - r = run selected steps"
    echo "  - a = select all"
    echo "  - n = select none"
    echo "  - q = quit"
    echo ""
    read -r -p "> " cmd

    case "$cmd" in
      r|R)
        run_selected
        return $?
        ;;
      a|A)
        set_preset_full
        ;;
      n|N)
        for i in "${!SELECTED[@]}"; do SELECTED[$i]="0"; done
        ;;
      q|Q)
        exit 0
        ;;
      "")
        ;;
      *)
        if [[ "$cmd" =~ ^[0-9]+$ ]]; then
          local idx=$((cmd - 1))
          if [[ $idx -ge 0 && $idx -lt ${#SELECTED[@]} ]]; then
            toggle_step "$idx"
          else
            echo "Invalid step number."
          fi
        else
          echo "Unknown command."
        fi
        ;;
    esac
  done
}

call_tui_preset() {
  # Use temp file for JSON output (TUI writes to file, preserves TTY for interaction)
  local tmpfile
  tmpfile=$(mktemp)
  cd "$REPO_ROOT" && TUI_OUTPUT_FILE="$tmpfile" NODE_PATH="${REPO_ROOT}/node_modules" node "$TUI_SCRIPT" preset
  local result
  result=$(cat "$tmpfile" 2>/dev/null)
  rm -f "$tmpfile"
  if [[ -n "$result" ]]; then
    echo "$result" | grep -o '"preset":"[^"]*"' | cut -d'"' -f4
  fi
}

call_tui_steps() {
  local preset="$1"
  # Use temp file for JSON output (TUI writes to file, preserves TTY for interaction)
  local tmpfile
  tmpfile=$(mktemp)
  cd "$REPO_ROOT" && TUI_OUTPUT_FILE="$tmpfile" NODE_PATH="${REPO_ROOT}/node_modules" node "$TUI_SCRIPT" steps "$preset"
  local result
  result=$(cat "$tmpfile" 2>/dev/null)
  rm -f "$tmpfile"
  if [[ -n "$result" ]]; then
    echo "$result" | grep -o '"steps":\[[^]]*\]' | sed 's/"steps":\[//;s/\]//;s/"//g' | tr ',' ' '
  fi
}

call_tui_permissions() {
  # Use temp file for JSON output (TUI writes to file, preserves TTY for interaction)
  local tmpfile
  tmpfile=$(mktemp)
  cd "$REPO_ROOT" && TUI_OUTPUT_FILE="$tmpfile" NODE_PATH="${REPO_ROOT}/node_modules" node "$TUI_SCRIPT" permissions
  local result
  result=$(cat "$tmpfile" 2>/dev/null)
  rm -f "$tmpfile"
  if [[ -n "$result" ]]; then
    echo "$result" | grep -o '"consent":true' >/dev/null && return 0
  fi
  return 1
}

call_tui_credentials() {
  # Use temp file for JSON output (TUI writes to file, preserves TTY for interaction)
  local tmpfile
  tmpfile=$(mktemp)
  cd "$REPO_ROOT" && TUI_OUTPUT_FILE="$tmpfile" NODE_PATH="${REPO_ROOT}/node_modules" node "$TUI_SCRIPT" credentials
  local result
  result=$(cat "$tmpfile" 2>/dev/null)
  rm -f "$tmpfile"
  if [[ -n "$result" ]]; then
    local env_file="${REPO_ROOT}/.env.local"
    [[ -f "$env_file" ]] || return 1

    local daily_key openai_key deepgram_key
    daily_key=$(echo "$result" | grep -o '"daily":"[^"]*"' | cut -d'"' -f4)
    openai_key=$(echo "$result" | grep -o '"openai":"[^"]*"' | cut -d'"' -f4)
    deepgram_key=$(echo "$result" | grep -o '"deepgram":"[^"]*"' | cut -d'"' -f4)

    local changed=0
    [[ -n "$daily_key" ]] && upsert_env_kv "$env_file" "DAILY_API_KEY" "$daily_key" && changed=1
    [[ -n "$openai_key" ]] && upsert_env_kv "$env_file" "OPENAI_API_KEY" "$openai_key" && changed=1
    [[ -n "$deepgram_key" ]] && upsert_env_kv "$env_file" "DEEPGRAM_API_KEY" "$deepgram_key" && changed=1

    if [[ "$changed" -eq 1 ]]; then
      if command_exists npm; then
        npm run sync:env 2>/dev/null || true
      fi
      if declare -F create_bot_env >/dev/null 2>&1; then
        create_bot_env || true
      fi
    fi
    return 0
  fi
  return 1
}

main_wizard() {
  cd "$REPO_ROOT" || exit 1

  print_wizard_banner

  # Use TUI if available and interactive
  if $USE_TUI && is_interactive && ! $NON_INTERACTIVE; then
    # Get preset from TUI (call directly, not via command substitution, to preserve TTY)
    if [[ -z "$PRESET" ]]; then
      local tmpfile
      tmpfile=$(mktemp)
      cd "$REPO_ROOT" && TUI_OUTPUT_FILE="$tmpfile" NODE_PATH="${REPO_ROOT}/node_modules" node "$TUI_SCRIPT" preset
      local tui_result
      tui_result=$(cat "$tmpfile" 2>/dev/null)
      rm -f "$tmpfile"
      if [[ -n "$tui_result" ]]; then
        PRESET=$(echo "$tui_result" | grep -o '"preset":"[^"]*"' | cut -d'"' -f4)
      fi
      [[ -z "$PRESET" ]] && PRESET="minimal"
    fi

    # Get selected steps from TUI (call directly, not via command substitution, to preserve TTY)
    local tmpfile
    tmpfile=$(mktemp)
    cd "$REPO_ROOT" && TUI_OUTPUT_FILE="$tmpfile" NODE_PATH="${REPO_ROOT}/node_modules" node "$TUI_SCRIPT" steps "$PRESET"
    local tui_result
    tui_result=$(cat "$tmpfile" 2>/dev/null)
    rm -f "$tmpfile"
    local tui_steps
    if [[ -n "$tui_result" ]]; then
      tui_steps=$(echo "$tui_result" | grep -o '"steps":\[[^]]*\]' | sed 's/"steps":\[//;s/\]//;s/"//g' | tr ',' ' ')
    fi
    if [[ -n "$tui_steps" ]]; then
      # Reset all to unselected
      for i in "${!SELECTED[@]}"; do SELECTED[$i]="0"; done
      # Map TUI step values to our indices
      for step in $tui_steps; do
        case "$step" in
          permissions) SELECTED[0]="1" ;;
          assess_prerequisites) SELECTED[1]="1" ;;
          prerequisites) SELECTED[2]="1" ;;
          install_nodejs) SELECTED[3]="1" ;;
          install_poetry) SELECTED[4]="1" ;;
          install_uv) SELECTED[5]="1" ;;
          init_submodules) SELECTED[6]="1" ;;
          install_npm_deps) SELECTED[7]="1" ;;
          install_bot_deps) SELECTED[8]="1" ;;
          download_chorus_assets) SELECTED[9]="1" ;;
          setup_env) SELECTED[10]="1" ;;
          credentials) SELECTED[11]="1" ;;
          setup_postgres) SELECTED[12]="1" ;;
          build_project) SELECTED[13]="1" ;;
          start_dev_server) SELECTED[14]="1" ;;
          functional_prompts) SELECTED[15]="1" ;;
        esac
      done
    fi

    # Handle permissions via TUI (call directly, not via command substitution, to preserve TTY)
    if [[ "${SELECTED[0]}" == "1" ]]; then
      local tmpfile
      tmpfile=$(mktemp)
      cd "$REPO_ROOT" && TUI_OUTPUT_FILE="$tmpfile" NODE_PATH="${REPO_ROOT}/node_modules" node "$TUI_SCRIPT" permissions
      local tui_result
      tui_result=$(cat "$tmpfile" 2>/dev/null)
      rm -f "$tmpfile"
      if [[ -z "$tui_result" ]] || ! echo "$tui_result" | grep -q '"consent":true'; then
        echo "Setup aborted by user."
        exit 0
      fi
    fi

    # Handle credentials via TUI (if step is selected) - call directly to preserve TTY
    if [[ "${SELECTED[11]}" == "1" ]]; then
      local tmpfile
      tmpfile=$(mktemp)
      cd "$REPO_ROOT" && TUI_OUTPUT_FILE="$tmpfile" NODE_PATH="${REPO_ROOT}/node_modules" node "$TUI_SCRIPT" credentials
      local tui_result
      tui_result=$(cat "$tmpfile" 2>/dev/null)
      rm -f "$tmpfile"
      if [[ -n "$tui_result" ]]; then
        local env_file="${REPO_ROOT}/.env.local"
        if [[ -f "$env_file" ]]; then
          local daily_key openai_key deepgram_key elevenlabs_key tts_provider
          # Try new format first (DAILY_API_KEY), then fallback to old format (daily)
          daily_key=$(echo "$tui_result" | grep -o '"DAILY_API_KEY":"[^"]*"' | cut -d'"' -f4)
          [[ -z "$daily_key" ]] && daily_key=$(echo "$tui_result" | grep -o '"daily":"[^"]*"' | cut -d'"' -f4)
          
          openai_key=$(echo "$tui_result" | grep -o '"OPENAI_API_KEY":"[^"]*"' | cut -d'"' -f4)
          [[ -z "$openai_key" ]] && openai_key=$(echo "$tui_result" | grep -o '"openai":"[^"]*"' | cut -d'"' -f4)
          
          deepgram_key=$(echo "$tui_result" | grep -o '"DEEPGRAM_API_KEY":"[^"]*"' | cut -d'"' -f4)
          [[ -z "$deepgram_key" ]] && deepgram_key=$(echo "$tui_result" | grep -o '"deepgram":"[^"]*"' | cut -d'"' -f4)
          
          elevenlabs_key=$(echo "$tui_result" | grep -o '"ELEVENLABS_API_KEY":"[^"]*"' | cut -d'"' -f4)
          [[ -z "$elevenlabs_key" ]] && elevenlabs_key=$(echo "$tui_result" | grep -o '"elevenlabs":"[^"]*"' | cut -d'"' -f4)
          
          tts_provider=$(echo "$tui_result" | grep -o '"ttsProvider":"[^"]*"' | cut -d'"' -f4)

          local changed=0
          [[ -n "$daily_key" ]] && upsert_env_kv "$env_file" "DAILY_API_KEY" "$daily_key" && changed=1
          [[ -n "$openai_key" ]] && upsert_env_kv "$env_file" "OPENAI_API_KEY" "$openai_key" && changed=1
          [[ -n "$deepgram_key" ]] && upsert_env_kv "$env_file" "DEEPGRAM_API_KEY" "$deepgram_key" && changed=1
          [[ -n "$elevenlabs_key" ]] && upsert_env_kv "$env_file" "ELEVENLABS_API_KEY" "$elevenlabs_key" && changed=1
          [[ -n "$tts_provider" ]] && upsert_env_kv "$env_file" "TTS_PROVIDER" "$tts_provider" && changed=1

          if [[ "$changed" -eq 1 ]]; then
            if command_exists npm; then
              npm run sync:env 2>/dev/null || true
            fi
            if declare -F create_bot_env >/dev/null 2>&1; then
              create_bot_env || true
            fi
          fi
        fi
      fi
    fi

    # Run selected steps
    run_selected
    return $?
  fi

  # Fallback to simple prompts
  if [[ -z "$PRESET" ]]; then
    if is_interactive && ! $NON_INTERACTIVE; then
      choose_preset_interactive
    else
      PRESET="minimal"
    fi
  fi

  case "$PRESET" in
    full)
      set_preset_full
      run_selected
      ;;
    minimal)
      set_preset_minimal
      run_selected
      ;;
    custom)
      if $NON_INTERACTIVE; then
        echo "Error: --non-interactive cannot be used with --preset custom" >&2
        exit 2
      fi
      custom_menu
      ;;
    *)
      echo "Error: invalid --preset '$PRESET' (expected full|minimal|custom)" >&2
      exit 2
      ;;
  esac
}

main_wizard



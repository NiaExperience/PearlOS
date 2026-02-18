#!/usr/bin/env bash
set -euo pipefail

# Spawns each app's dev server in its own terminal window.
# Cross-platform: Works on macOS, Linux (Ubuntu/Debian), and Windows (Git Bash/WSL)
# Usage: npm run dev:terminals
#
# Platform Requirements:
# - macOS: Built-in Terminal.app (no additional requirements)
# - Linux: One of: gnome-terminal, konsole, xfce4-terminal, xterm, or x-terminal-emulator
# - Windows (Bash): Git Bash (comes with Git for Windows, no WSL needed)
# - Windows (Native): Use run-dev-in-new-terminals.ps1 instead (PowerShell)
#
# Notes:
# - On Linux/Windows, terminal windows won't auto-close on exit (close manually)
# - Logs are written to /tmp/logs/*.txt for all platforms
# - For native Windows without Git Bash, see run-dev-in-new-terminals.ps1
APP_DIR="$(dirname "$0")"
ROOT_DIR="$(cd ${APP_DIR}/.. && pwd)"
APPS=(
    "chorus-tts"
    "apps/interface"
    "apps/dashboard"
)

PID_FILE="/tmp/run-dev-pids.txt"

# Detect operating system
detect_os() {
    case "$(uname -s)" in
        Darwin*)    echo "macos";;
        Linux*)     echo "linux";;
        CYGWIN*|MINGW*|MSYS*)    echo "windows";;
        *)          echo "unknown";;
    esac
}

OS_TYPE=$(detect_os)

# macOS terminal launcher
open_terminal_macos() {
    local label="$1"
    local cmd="$2"
    local title="NIA-DEV-$(echo "$label" | tr '[:lower:]' '[:upper:]')"
    /usr/bin/osascript <<OSA
    tell application "Terminal"
        do script "cd '$ROOT_DIR' && printf '\\\\033]0;${title}\\\\007' && $cmd"
        delay 0.2
        activate
    end tell
OSA
}

# Linux terminal launcher
open_terminal_linux() {
    local label="$1"
    local cmd="$2"
    local title="NIA-DEV-$(echo "$label" | tr '[:lower:]' '[:upper:]')"
    
    # Try different terminal emulators in order of preference
    if command -v gnome-terminal >/dev/null 2>&1; then
        gnome-terminal --title="$title" -- bash -c "cd '$ROOT_DIR' && $cmd; exec bash" &
    elif command -v konsole >/dev/null 2>&1; then
        konsole --new-tab -p tabtitle="$title" -e bash -c "cd '$ROOT_DIR' && $cmd; exec bash" &
    elif command -v xfce4-terminal >/dev/null 2>&1; then
        xfce4-terminal --title="$title" --command="bash -c 'cd \"$ROOT_DIR\" && $cmd; exec bash'" &
    elif command -v xterm >/dev/null 2>&1; then
        xterm -title "$title" -e bash -c "cd '$ROOT_DIR' && $cmd; exec bash" &
    elif command -v x-terminal-emulator >/dev/null 2>&1; then
        x-terminal-emulator -e bash -c "cd '$ROOT_DIR' && $cmd; exec bash" &
    else
        echo "   ❌ No supported terminal emulator found (tried: gnome-terminal, konsole, xfce4-terminal, xterm)"
        echo "      Please install one of these terminal emulators."
        return 1
    fi
}

# Windows terminal launcher (Git Bash / WSL)
open_terminal_windows() {
    local label="$1"
    local cmd="$2"
    local title="NIA-DEV-$(echo "$label" | tr '[:lower:]' '[:upper:]')"
    
    # Convert path to Windows format if needed (for WSL)
    local win_root_dir="$ROOT_DIR"
    if command -v wslpath >/dev/null 2>&1; then
        win_root_dir=$(wslpath -w "$ROOT_DIR")
    fi
    
    # Detect if we're in Git Bash vs WSL
    local is_git_bash=false
    if [[ "$(uname -s)" =~ ^(MINGW|MSYS) ]]; then
        is_git_bash=true
    fi
    
    # Try Windows Terminal first, then fall back to other options
    if command -v wt.exe >/dev/null 2>&1 || command -v wt >/dev/null 2>&1; then
        # Windows Terminal is available
        local wt_cmd="${WT_CMD:-wt.exe}"
        [[ -z $(command -v wt.exe 2>/dev/null) ]] && wt_cmd="wt"
        
        if $is_git_bash; then
            # Git Bash: Use bash explicitly
            $wt_cmd new-tab --title "$title" bash.exe -c "cd '$ROOT_DIR' && $cmd; exec bash" &
        else
            # WSL: Use bash as-is
            $wt_cmd new-tab --title "$title" bash -c "cd '$ROOT_DIR' && $cmd; exec bash" &
        fi
    elif command -v mintty >/dev/null 2>&1; then
        # Git Bash with mintty (native Git Bash terminal)
        mintty -t "$title" /bin/bash -c "cd '$ROOT_DIR' && $cmd; exec bash" &
    elif command -v cmd.exe >/dev/null 2>&1; then
        # Fallback to cmd.exe
        if $is_git_bash; then
            # Git Bash: Start new cmd window with bash
            cmd.exe /c start "$title" bash.exe -c "cd '$ROOT_DIR' && $cmd; exec bash" &
        else
            # WSL: Use regular bash
            cmd.exe /c start "$title" bash -c "cd '$ROOT_DIR' && $cmd; exec bash" &
        fi
    else
        echo "   ❌ No supported terminal found for Windows"
        echo "      Please install Windows Terminal (recommended) or use PowerShell version:"
        echo "      npm run dev:terminals:windows"
        return 1
    fi
}

# Unified terminal launcher that delegates to OS-specific function
open_terminal_with_cmd() {
    local label="$1"
    local cmd="$2"
    
    case "$OS_TYPE" in
        macos)
            open_terminal_macos "$label" "$cmd"
            ;;
        linux)
            open_terminal_linux "$label" "$cmd"
            ;;
        windows)
            open_terminal_windows "$label" "$cmd"
            ;;
        *)
            echo "❌ Unsupported operating system: $(uname -s)"
            echo "   This script supports macOS, Linux, and Windows (Git Bash/WSL)"
            exit 1
            ;;
    esac
}

echo "ROOT_DIR=${ROOT_DIR}"
echo "Detected OS: $OS_TYPE"
echo "Launching dev servers in separate terminal windows..."

# Create logs directory
mkdir -p /tmp/logs

# Fresh PID file for this run
echo -n > "$PID_FILE"

for app in "${APPS[@]}"; do
    # Special handling for Redis service
    if [ "$app" = "redis" ]; then
        echo " → $app (Redis server)"
        label="redis"
        
        # Load Redis password from .env files if available
        REDIS_PASSWORD=""
        if [ -f "$ROOT_DIR/apps/pipecat-daily-bot/.env" ]; then
            REDIS_PASSWORD=$(grep "^REDIS_SHARED_SECRET=" "$ROOT_DIR/apps/pipecat-daily-bot/.env" | cut -d '=' -f2 | tr -d '"' | tr -d "'")
        fi
        if [ -z "$REDIS_PASSWORD" ] && [ -f "$ROOT_DIR/.env.local" ]; then
            REDIS_PASSWORD=$(grep "^REDIS_SHARED_SECRET=" "$ROOT_DIR/.env.local" | cut -d '=' -f2 | tr -d '"' | tr -d "'")
        fi
        
        # Start Redis in its own terminal for monitoring
        if command -v redis-server >/dev/null 2>&1; then
            if [ -n "$REDIS_PASSWORD" ]; then
                echo "   🔒 Starting Redis with authentication..."
                open_terminal_with_cmd "$label" "bash ./scripts/run-dev-record-pid.sh $label redis-server --port 6379 --requirepass '$REDIS_PASSWORD' --logfile /tmp/logs/redis.log 2>&1 | tee /tmp/logs/${label}.txt"
            else
                echo "   ⚠️  Starting Redis WITHOUT authentication (REDIS_SHARED_SECRET not found in .env)"
                open_terminal_with_cmd "$label" "bash ./scripts/run-dev-record-pid.sh $label redis-server --port 6379 --logfile /tmp/logs/redis.log 2>&1 | tee /tmp/logs/${label}.txt"
            fi
        elif command -v docker >/dev/null 2>&1; then
            if [ -n "$REDIS_PASSWORD" ]; then
                echo "   🔒 Starting Redis Docker with authentication..."
                open_terminal_with_cmd "$label" "bash ./scripts/run-dev-record-pid.sh $label docker run --rm --name nia-redis-dev -p 6379:6379 redis:alpine redis-server --requirepass '$REDIS_PASSWORD' 2>&1 | tee /tmp/logs/${label}.txt"
            else
                echo "   ⚠️  Starting Redis Docker WITHOUT authentication (REDIS_SHARED_SECRET not found in .env)"
                open_terminal_with_cmd "$label" "bash ./scripts/run-dev-record-pid.sh $label docker run --rm --name nia-redis-dev -p 6379:6379 redis:alpine redis-server 2>&1 | tee /tmp/logs/${label}.txt"
            fi
        else
            echo "   ❌ Neither redis-server nor docker found. Skipping Redis."
            continue
        fi
    elif [ "$app" = "chorus-tts" ]; then
        echo " → $app (Chorus TTS server)"
        label="chorus-tts"
        # Initialize log file (from staging improvements)
        echo '' > /tmp/logs/${label}.txt
        open_terminal_with_cmd "$label" "bash ./scripts/run-dev-record-pid.sh $label npm run chorus:start 2>&1 | tee /tmp/logs/${label}.txt"

    elif [ -d "$ROOT_DIR/$app" ]; then
        echo " → $app"
        # Use a compact label from the app path (e.g., apps/interface -> interface)
        label=$(basename "$app")
        
        # Initialize log file (from staging improvements)
        echo '' > /tmp/logs/${label}.txt
        
        # Special handling for pipecat-daily-bot to enable Redis
        if [ "$app" = "apps/pipecat-daily-bot" ]; then
            echo "   🔄 Enabling Redis for pipecat-daily-bot..."
            
            # Load Redis configuration from .env files
            REDIS_ENV_VARS="REDIS_URL=redis://localhost:6379"
            
            # Load REDIS_SHARED_SECRET if available
            if [ -f "$ROOT_DIR/apps/pipecat-daily-bot/.env" ]; then
                REDIS_SECRET=$(grep "^REDIS_SHARED_SECRET=" "$ROOT_DIR/apps/pipecat-daily-bot/.env" | cut -d '=' -f2 | tr -d '"' | tr -d "'")
                REDIS_AUTH=$(grep "^REDIS_AUTH_REQUIRED=" "$ROOT_DIR/apps/pipecat-daily-bot/.env" | cut -d '=' -f2 | tr -d '"' | tr -d "'")
            fi
            if [ -z "$REDIS_SECRET" ] && [ -f "$ROOT_DIR/.env.local" ]; then
                REDIS_SECRET=$(grep "^REDIS_SHARED_SECRET=" "$ROOT_DIR/.env.local" | cut -d '=' -f2 | tr -d '"' | tr -d "'")
                REDIS_AUTH=$(grep "^REDIS_AUTH_REQUIRED=" "$ROOT_DIR/.env.local" | cut -d '=' -f2 | tr -d '"' | tr -d "'")
            fi
            
            # Add authentication variables if found
            if [ -n "$REDIS_SECRET" ]; then
                REDIS_ENV_VARS="$REDIS_ENV_VARS REDIS_SHARED_SECRET='$REDIS_SECRET'"
                echo "   🔒 Redis authentication enabled"
            fi
            if [ -n "$REDIS_AUTH" ]; then
                REDIS_ENV_VARS="$REDIS_ENV_VARS REDIS_AUTH_REQUIRED='$REDIS_AUTH'"
            fi
            
            open_terminal_with_cmd "$label" "bash ./scripts/run-dev-record-pid.sh $label $REDIS_ENV_VARS npm run dev -w $app 2>&1 | tee /tmp/logs/${label}.txt"
        else
            # Spawn via PID-recording wrapper so we can cleanly kill later
            # Use bash to avoid depending on executable bit
            # Tee both stdout and stderr to log files
            open_terminal_with_cmd "$label" "bash ./scripts/run-dev-record-pid.sh $label npm run dev -w $app 2>&1 | tee /tmp/logs/${label}.txt"
        fi
    fi
done

echo "Done. Check Terminal windows for output."
for app in "${APPS[@]}"; do
    label=$(basename "$app")
    echo "📋 Server logs for $app in /tmp/logs/${label}.txt files"
done

echo
read -r -p "Press Enter to terminate the apps..." USER_INPUT || true

echo "Terminating dev app terminals using PIDs from $PID_FILE..."

# Clean up Docker Redis container if running
if command -v docker >/dev/null 2>&1; then
    if docker ps -q -f name=nia-redis-dev | grep -q .; then
        echo " → Stopping Redis Docker container..."
        docker stop nia-redis-dev >/dev/null 2>&1 || true
    fi
fi

if [ -s "$PID_FILE" ]; then
    # First try a graceful TERM
    while IFS=: read -r label ppid pid; do
        [ -z "$label" ] && continue
        echo " → Killing [$label] pid=$pid ppid=$ppid (TERM)"
        kill -TERM "$pid" 2>/dev/null || true
        kill -TERM "$ppid" 2>/dev/null || true
    done < "$PID_FILE"
    sleep 1
    # Force kill leftovers
    while IFS=: read -r label ppid pid; do
        [ -z "$label" ] && continue
        if kill -0 "$pid" 2>/dev/null; then
            echo " → Forcing [$label] pid=$pid (KILL)"
            kill -KILL "$pid" 2>/dev/null || true
        fi
        if kill -0 "$ppid" 2>/dev/null; then
            echo " → Forcing [$label] ppid=$ppid (KILL)"
            kill -KILL "$ppid" 2>/dev/null || true
        fi
    done < "$PID_FILE"

    # Attempt to close terminal tabs/windows by title (macOS only)
    if [ "$OS_TYPE" = "macos" ]; then
        /usr/bin/osascript <<'OSA'
tell application "Terminal"
    repeat with w in windows
        repeat with t in tabs of w
            set shouldClose to false
            set theCustom to ""
            try
                set theCustom to (custom title of t) as string
            end try
            if theCustom starts with "NIA-DEV-" then
                set shouldClose to true
            else
                try
                    set theName to (name of t) as string
                    if theName contains "NIA-DEV-" then set shouldClose to true
                end try
            end if
            if shouldClose then
                try
                    close t
                end try
            end if
        end repeat
    end repeat
end tell
OSA
    else
        echo "   ℹ️  Terminal windows left open (automatic closing only supported on macOS)"
        echo "      Please close the terminal windows manually if needed."
    fi
    echo "✅ Termination complete."
else
    echo "ℹ️  No PID entries found in $PID_FILE."
fi
exit 0

#!/usr/bin/env bash
set -euo pipefail

# Usage: run-dev-record-pid.sh <label> [ENV_VAR=value...] <command...>
# Records both the parent shell PID (Terminal tab shell) and this process PID
# so we can kill either to tear down the window/session later.

LABEL="${1:-unnamed}"
shift || true

# Process environment variable assignments at the start
while [[ $# -gt 0 && "$1" =~ ^[A-Z_][A-Z0-9_]*= ]]; do
    export "$1"
    echo "Set environment variable: $1"
    shift
done

PID_FILE="/tmp/run-dev-pids.txt"

# Ensure file exists
: "${PID_FILE}"
touch "${PID_FILE}"

THIS_PID=$$
PARENT_SHELL_PID=${PPID}

# Format: label:parentShellPid:thisPid
printf "%s:%s:%s\n" "$LABEL" "$PARENT_SHELL_PID" "$THIS_PID" >> "$PID_FILE"

# Set the Terminal tab/window title for easier cleanup later
TITLE="nia-dev-$LABEL"
if [ -t 1 ]; then
	# ESC ] 0 ; title BEL
	printf "\033]0;%s\007" "$TITLE" || true
fi

# Exec the target command so it inherits THIS_PID; when killed, the dev process dies.
exec "$@"

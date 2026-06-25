#!/usr/bin/env bash
set -euo pipefail

load_env_file() {
	local file="$1"
	if [ ! -f "$file" ]; then
		return 0
	fi
	if [ ! -r "$file" ]; then
		echo "Skipping unreadable env file: $file" >&2
		return 0
	fi
	set -a
	# shellcheck disable=SC1091
	. "$file"
	set +a
}

load_env_file /home/deploy/pearlos/.env.local
load_env_file /home/deploy/pearlos/.env.relay
load_env_file /workspace/nia-universal/.env.local
load_env_file /workspace/nia-universal/apps/pipecat-daily-bot/.env

export OPENCLAW_CONFIG="${OPENCLAW_CONFIG:-/home/deploy/.openclaw/openclaw.json}"
export PEARL_RELAY_STATE_DIR="${PEARL_RELAY_STATE_DIR:-/home/deploy/.openclaw/production-repair-relays}"
export PEARL_WEBCHAT_FOLLOWUP_USER_EMAIL="${PEARL_WEBCHAT_FOLLOWUP_USER_EMAIL:-${PEARL_PRIMARY_USER_EMAIL:-}}"
export PEARL_WEBCHAT_FOLLOWUP_TENANT_ID="${PEARL_WEBCHAT_FOLLOWUP_TENANT_ID:-${PEARL_PRIMARY_TENANT_ID:-${DEFAULT_TENANT_ID:-}}}"

exec /usr/bin/node --max-old-space-size=4096 /home/deploy/pearlos/scripts/production-repair-chat-relays.mjs

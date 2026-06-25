#!/usr/bin/env bash
set -euo pipefail

cd /workspace/nia-universal
exec python3 scripts/webchat-team-cycle.py --loop --interval "${WEBCHAT_TEAM_INTERVAL_SECONDS:-600}"

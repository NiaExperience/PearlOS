#!/usr/bin/env bash
# Refresh OpenRouter model radar for PearlOS Agency.
set -euo pipefail

ROOT="/workspace/nia-universal"
LOG="/tmp/agency-model-radar.log"
LOCK="/tmp/agency-model-radar.lock"

mkdir -p "$(dirname "$LOG")"

(
  flock -n 9 || exit 0
  cd "$ROOT"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] model radar refresh starting" >> "$LOG"
  python3 scripts/agency-swarm-roster-refresh.py >> "$LOG" 2>&1
  cp .agency/rosters/openrouter-models.json /home/deploy/pearlos/.agency/rosters/openrouter-models.json 2>/dev/null || true
  cp .agency/rosters/openrouter-models.previous.json /home/deploy/pearlos/.agency/rosters/openrouter-models.previous.json 2>/dev/null || true
  cp .agency/rosters/recommended-swarms.json /home/deploy/pearlos/.agency/rosters/recommended-swarms.json 2>/dev/null || true
  cp .agency/rosters/model-radar.json /home/deploy/pearlos/.agency/rosters/model-radar.json 2>/dev/null || true
  chgrp -R deploy .agency /home/deploy/pearlos/.agency /workspace/user/Documents/Agency 2>/dev/null || true
  chmod -R g+rX .agency /home/deploy/pearlos/.agency /workspace/user/Documents/Agency 2>/dev/null || true
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] model radar refresh complete" >> "$LOG"
) 9>"$LOCK"

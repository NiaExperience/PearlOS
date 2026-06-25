#!/usr/bin/env bash
set -euo pipefail

TASK_JSON="$(cat)"
CODEX_HOME="${CODEX_HOME:-/home/deploy/.codex-agency}"
CODEX_MODEL="${CODEX_MODEL:-openai/gpt-5.5}"
CODEX_REASONING_EFFORT="${CODEX_REASONING_EFFORT:-medium}"
WORKSPACE="${PEARL_CODEX_WORKSPACE:-/workspace/nia-universal}"

mkdir -p "$CODEX_HOME"

PROMPT="$(
  TASK_JSON="$TASK_JSON" python3 - <<'PY'
import json
import os

task = json.loads(os.environ["TASK_JSON"])
title = task.get("title") or ""
body = task.get("task") or title

print(f"""You are the staging PearlOS Agency worker running in Codex.

The internal task identifier is available only for queue reconciliation. Task IDs, run IDs, dispatch IDs, session IDs, hashes, and any other system-generated identifiers must NEVER be shown or spoken to the user. Describe task results in plain language only. Keep it natural and conversational, with no IDs, no hashes, and no run references.

Title: {title}

Task:
{body}

Operate on DigitalOcean staging by default. Production access is allowed only when Blair explicitly asks for production, app.pearlos.org, or the pearlos-production host in this task. If production is explicitly requested from the staging droplet, use the approved production SSH configuration available on that host. Verify the host and PM2 cwd before changing anything, keep changes scoped, and do not touch production OAuth or databases unless Blair specifically requested that exact subsystem.
Use /workspace/nia-universal as the source-of-truth working tree for PearlOS staging. If runtime pickup is needed, copy changed source files forward to /home/deploy/pearlos after editing source.
If you edit the interface, build it and restart the relevant PM2 service so staging picks it up.
Keep the change scoped to the task.

This is a non-interactive worker run. Do not stop after diagnosis. Do not use progress-only responses as your final answer.
If the task is a bug fix, you must either:
1. edit the relevant file(s), run focused verification, and restart the relevant staging PM2 service when needed, or
2. clearly explain the concrete blocker that prevented the change.

Your final response must start with one of these exact labels:
DONE:
BLOCKED:

For DONE, include changed files and verification in plain language only. For BLOCKED, include the exact missing permission, file, command, or data. Do not include task IDs, run IDs, dispatch IDs, hashes, or internal references.
""")
PY
)"

exec codex exec \
  --model "$CODEX_MODEL" \
  --config 'model_provider="openrouter"' \
  --config "model_reasoning_effort=\"$CODEX_REASONING_EFFORT\"" \
  --config 'approvals_reviewer="user"' \
  --config 'shell_environment_policy.inherit="all"' \
  --sandbox workspace-write \
  --skip-git-repo-check \
  --cd "$WORKSPACE" \
  "$PROMPT"

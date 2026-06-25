#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/prod-preflight-audit.sh [<base> <head>]

With no arguments, audits staged changes if present, otherwise working-tree
changes. With base/head, audits the diff between those refs.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -ne 0 && $# -ne 2 ]]; then
  usage >&2
  exit 2
fi

run_operational_checks() {
  node scripts/check-webchat-hardcodes.mjs

  local task_root="${PEARL_PUBLIC_TASK_ROOT:-/srv/pearl-user-workspaces}"
  if [[ "${PEARLOS_SKIP_TASK_ROOT_CHECK:-0}" == "1" ]]; then
    echo "prod-preflight: public task-root permission check skipped"
  elif [[ -d "$task_root" ]]; then
    scripts/repair-public-task-root-permissions.sh --summary
  elif [[ "${PEARLOS_TASK_ROOT_PREFLIGHT_STRICT:-0}" == "1" ]]; then
    echo "prod-preflight: public task-root missing: $task_root" >&2
    exit 1
  else
    echo "prod-preflight: public task-root permission check skipped (missing $task_root)"
  fi

  if [[ "${PEARLOS_SKIP_TERMINAL_SMOKE:-0}" == "1" ]]; then
    echo "prod-preflight: terminal sandbox smoke skipped"
  elif [[ "${PEARLOS_TERMINAL_PREFLIGHT_STRICT:-0}" == "1" ]]; then
    scripts/terminal-sandbox-smoke.sh
  else
    scripts/terminal-sandbox-smoke.sh --warn-only
  fi

  if [[ "${PEARLOS_SKIP_CONNECTOR_HEALTH:-0}" == "1" ]]; then
    echo "prod-preflight: connector health check skipped"
  elif [[ "${PEARLOS_CONNECTOR_PREFLIGHT_STRICT:-0}" == "1" ]]; then
    node scripts/connector-health-check.mjs
  else
    node scripts/connector-health-check.mjs --warn-only
  fi

  if [[ "${PEARLOS_SKIP_API_AUTH_SURFACE_CHECK:-0}" == "1" ]]; then
    echo "prod-preflight: API auth surface check skipped"
  elif [[ -n "${PEARLOS_API_AUTH_PREFLIGHT_URL:-}" ]]; then
    node scripts/api-auth-surface-check.mjs --base="${PEARLOS_API_AUTH_PREFLIGHT_URL}"
  elif [[ "${PEARLOS_API_AUTH_PREFLIGHT_STRICT:-0}" == "1" ]]; then
    node scripts/api-auth-surface-check.mjs --strict
  else
    node scripts/api-auth-surface-check.mjs
  fi
}

if [[ $# -eq 2 ]]; then
  mode="range"
  base="$1"
  head="$2"
  mapfile -t changed_files < <(git diff --name-only "$base" "$head")
  mapfile -t changed_entries < <(git diff --name-status "$base" "$head")
  diff_cmd=(git diff "$base" "$head" -- . ":(exclude)scripts/prod-preflight-audit.sh")
else
  if ! git diff --cached --quiet; then
    mode="staged"
    mapfile -t changed_files < <(git diff --cached --name-only)
    mapfile -t changed_entries < <(git diff --cached --name-status)
    diff_cmd=(git diff --cached -- . ":(exclude)scripts/prod-preflight-audit.sh")
  else
    mode="working-tree"
    mapfile -t changed_files < <(git diff --name-only)
    mapfile -t changed_entries < <(git diff --name-status)
    diff_cmd=(git diff -- . ":(exclude)scripts/prod-preflight-audit.sh")
  fi
fi

if [[ ${#changed_files[@]} -eq 0 ]]; then
  run_operational_checks
  echo "prod-preflight: no changed files to audit ($mode)"
  exit 0
fi

blocked_path_re='(^|/)(\.env($|[._-])|node_modules|\.next|dist|coverage|forensics|user-data|uploads|logs|\.tasks|\.data|\.codex/prod-audit|\.agency/runs)(/|$)|(^|/).*\.bak($|[-.])|(^|/).*\.backup($|[-.])|(^|/).*\.jsonl$|^memory/\.dreams/'
api_key='API_KEY'
bot_token='BOT_TOKEN'
shared_secret='SHARED_SECRET'
eq='='
secret_re="(BEGIN [A-Z ]*PRIVATE KEY|PRIVATE KEY-----|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}|(OPENAI_${api_key}|OPENROUTER_${api_key}|DEEPSEEK_${api_key}|DISCORD_${bot_token}|BOT_CONTROL_${shared_secret}|PASSWORD|TOKEN|SECRET|refresh_token)[A-Za-z0-9_ -]*[[:space:]]*${eq}[[:space:]]*['\"]?[^[:space:]'\"<>]{8,})"

blocked=()
for entry in "${changed_entries[@]}"; do
  IFS=$'\t' read -r status file renamed_file <<< "$entry"
  if [[ "$status" == D ]]; then
    continue
  fi
  if [[ "$status" == R* || "$status" == C* ]]; then
    file="$renamed_file"
  fi
  if [[ "$file" =~ $blocked_path_re ]]; then
    blocked+=("$file")
  fi
done

if [[ ${#blocked[@]} -gt 0 ]]; then
  echo "prod-preflight: blocked runtime/dev paths found:" >&2
  printf '  %s\n' "${blocked[@]}" >&2
  exit 1
fi

secret_hit_count="$("${diff_cmd[@]}" \
  | awk '/^\+\+\+ / { next } /^\+/ { print }' \
  | rg -n "$secret_re" \
  | rg -v 'process\.env\.|os\.getenv\(|getenv\(' \
  | wc -l \
  | tr -d ' ' || true)"
secret_hit_count="${secret_hit_count:-0}"
if [[ "$secret_hit_count" != "0" ]]; then
  echo "prod-preflight: secret-looking strings found in diff (${secret_hit_count} redacted hit(s))" >&2
  exit 1
fi

if [[ "$mode" == "range" ]]; then
  check_output="$(git diff --check "$base" "$head" || true)"
elif [[ "$mode" == "staged" ]]; then
  check_output="$(git diff --cached --check || true)"
else
  check_output="$(git diff --check || true)"
fi

if [[ -n "$check_output" ]]; then
  echo "prod-preflight: whitespace/conflict-marker check failed:" >&2
  printf '%s\n' "$check_output" >&2
  exit 1
fi

run_operational_checks

echo "prod-preflight: passed ($mode, ${#changed_files[@]} files)"

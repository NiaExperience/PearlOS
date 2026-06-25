#!/usr/bin/env bash
###############################################################################
# qa-gate.sh - PearlOS Pre-Deployment Gate
#
# Run this BEFORE every deployment. Blocks deployment if any check fails.
# Designed to be fast (no screenshots, no Discord) -- pure build/health gate.
#
# Usage:
#   bash scripts/qa-gate.sh                  # full gate check
#   bash scripts/qa-gate.sh --post-deploy    # post-deploy health verification
#
# Exit codes:
#   0 = all checks passed, safe to deploy
#   1 = one or more checks failed, DO NOT DEPLOY
###############################################################################
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
BOLD='\033[1m'; NC='\033[0m'

REPO_ROOT="/workspace/nia-universal"
DEPLOY_ROOT="/opt/pearlos"
INTERFACE_DIR="$REPO_ROOT/apps/interface"
MESH_DIR="$REPO_ROOT/apps/mesh"
FAILURES=0
MODE="pre-deploy"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --post-deploy) MODE="post-deploy"; shift ;;
    *) shift ;;
  esac
done

log()  { echo -e "${CYAN}[GATE]${NC} $*"; }
pass() { echo -e "  ${GREEN}[PASS]${NC} $*"; }
fail() { echo -e "  ${RED}[FAIL]${NC} $*"; FAILURES=$((FAILURES + 1)); }
warn() { echo -e "  ${YELLOW}[WARN]${NC} $*"; }

echo ""
log "${BOLD}PearlOS Deployment Gate -- mode: $MODE${NC}"
echo ""

###############################################################################
# SHARED: Critical env var checks
###############################################################################
log "${BOLD}Checking critical environment variables${NC}"

REQUIRED_ENV_VARS=(
  "NEXTAUTH_SECRET"
  "NEXTAUTH_URL"
  "DATABASE_URL"
  "MESH_SHARED_SECRET"
  "BOT_CONTROL_SHARED_SECRET"
)

# Check both root .env.local and interface .env.local
for envfile in "$REPO_ROOT/.env.local" "$INTERFACE_DIR/.env.local" "$MESH_DIR/.env.local"; do
  if [[ ! -f "$envfile" ]]; then
    warn "Env file not found: $envfile"
    continue
  fi
done

# Source the env files to check for presence (don't export, just grep)
for var in "${REQUIRED_ENV_VARS[@]}"; do
  FOUND=false
  for envfile in "$REPO_ROOT/.env.local" "$INTERFACE_DIR/.env.local" "$MESH_DIR/.env.local"; do
    if [[ -f "$envfile" ]] && grep -q "^${var}=" "$envfile" 2>/dev/null; then
      # Check it is not empty
      VAL=$(grep "^${var}=" "$envfile" | head -1 | cut -d= -f2-)
      if [[ -n "$VAL" ]]; then
        FOUND=true
        break
      fi
    fi
  done
  if $FOUND; then
    pass "$var is set"
  else
    fail "$var is MISSING or empty"
  fi
done

###############################################################################
# PRE-DEPLOY: Build checks
###############################################################################
if [[ "$MODE" == "pre-deploy" ]]; then

  # ── Acquire build lock (serialize Next.js builds) ──────────────────────────
  LOCK_FILE="/tmp/pearlos-build.lock"

  log "${BOLD}Checking for concurrent builds${NC}"
  if [[ -f "$LOCK_FILE" ]]; then
    LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
    if [[ -n "$LOCK_PID" ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
      fail "Another build is running (PID $LOCK_PID) -- do NOT start a concurrent build"
    else
      warn "Stale lock file found, removing"
      rm -f "$LOCK_FILE"
      pass "No concurrent build running"
    fi
  else
    pass "No concurrent build running"
  fi

  # ── TypeScript type checking ───────────────────────────────────────────────
  log "${BOLD}Running TypeScript type check (interface)${NC}"
  if [[ -f "$INTERFACE_DIR/tsconfig.json" ]]; then
    TYPE_OUTPUT=$(cd "$INTERFACE_DIR" && npx tsc --noEmit --pretty false 2>&1 | tail -20) || true
    TYPE_ERRORS=$(echo "$TYPE_OUTPUT" | grep -c 'error TS' 2>/dev/null || echo "0")
    if [[ "$TYPE_ERRORS" -gt 0 ]]; then
      warn "TypeScript found $TYPE_ERRORS type errors (non-blocking but should be reviewed)"
      echo "$TYPE_OUTPUT" | grep 'error TS' | head -5 | while read -r line; do
        echo -e "    ${YELLOW}$line${NC}"
      done
    else
      pass "TypeScript type check passed"
    fi
  else
    warn "No tsconfig.json in interface app"
  fi

  # ── Import/require sanity check ────────────────────────────────────────────
  log "${BOLD}Checking for broken imports${NC}"

  # Look for common import issues in the interface app
  BROKEN_IMPORTS=0

  # Check for imports from deleted/moved files (common Next.js breakage)
  if command -v grep &>/dev/null; then
    # Check for references to non-existent local files in key source dirs
    BAD_IMPORT_PATTERNS="$(cd "$INTERFACE_DIR/src" && grep -rn "from '\.\./\.\./\.\./\.\./\.\./\.\." --include='*.ts' --include='*.tsx' 2>/dev/null | wc -l)" || BAD_IMPORT_PATTERNS=0
    BAD_IMPORT_PATTERNS=$(echo "$BAD_IMPORT_PATTERNS" | tr -d '[:space:]')
    if [[ "$BAD_IMPORT_PATTERNS" -gt 0 ]]; then
      warn "Found $BAD_IMPORT_PATTERNS deeply nested relative imports (potential breakage)"
    fi
  fi

  # ── Next.js build test ────────────────────────────────────────────────────
  log "${BOLD}Testing Next.js build (interface)${NC}"

  # Use a quick lint/compile check rather than a full build to save time.
  # next build is too slow for a gate, so we do next lint as a proxy.
  BUILD_CHECK_EXIT=0
  if [[ -f "$INTERFACE_DIR/package.json" ]]; then
    # Check if next lint is available
    if grep -q '"lint"' "$INTERFACE_DIR/package.json" 2>/dev/null; then
      log "  Running next lint..."
      LINT_OUTPUT=$(cd "$INTERFACE_DIR" && npx next lint --quiet 2>&1 | tail -20) || BUILD_CHECK_EXIT=$?
      if [[ "$BUILD_CHECK_EXIT" -ne 0 ]]; then
        LINT_ERRORS="$(echo "$LINT_OUTPUT" | grep -ci 'error' 2>/dev/null)" || LINT_ERRORS=0
        if [[ "$LINT_ERRORS" -gt 0 ]]; then
          fail "Next.js lint found errors ($LINT_ERRORS)"
          echo "$LINT_OUTPUT" | tail -5 | while read -r line; do
            echo -e "    ${RED}$line${NC}"
          done
        else
          warn "Next lint exited with code $BUILD_CHECK_EXIT but no obvious errors"
        fi
      else
        pass "Next.js lint passed"
      fi
    else
      warn "No lint script in interface/package.json, skipping"
    fi

    # Quick syntax check: ensure the main page.tsx and layout.tsx parse
    for critical_file in "src/app/page.tsx" "src/app/layout.tsx" "src/app/login/page.tsx"; do
      FULL_PATH="$INTERFACE_DIR/$critical_file"
      if [[ -f "$FULL_PATH" ]]; then
        # Use node to parse as module
        PARSE_EXIT=0
        node -e "
          const ts = require('typescript');
          const fs = require('fs');
          const src = fs.readFileSync('$FULL_PATH', 'utf8');
          const sf = ts.createSourceFile('check.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
          const diags = [];
          // parseDiagnostics are syntax errors only
          if (sf.parseDiagnostics && sf.parseDiagnostics.length > 0) {
            sf.parseDiagnostics.forEach(d => console.error(d.messageText));
            process.exit(1);
          }
        " 2>/dev/null || PARSE_EXIT=$?
        if [[ "$PARSE_EXIT" -ne 0 ]]; then
          fail "Syntax error in $critical_file"
        else
          pass "$critical_file parses OK"
        fi
      else
        fail "Critical file missing: $critical_file"
      fi
    done
  fi

  # ── Package dependency check ───────────────────────────────────────────────
  log "${BOLD}Checking node_modules integrity${NC}"
  if [[ -d "$REPO_ROOT/node_modules" ]]; then
    # Spot-check key packages exist
    for pkg in next react playwright; do
      if [[ -d "$REPO_ROOT/node_modules/$pkg" ]]; then
        pass "Package '$pkg' installed"
      else
        fail "Package '$pkg' is missing from node_modules"
      fi
    done
  else
    fail "node_modules directory not found"
  fi

fi

###############################################################################
# POST-DEPLOY: Health verification
###############################################################################
if [[ "$MODE" == "post-deploy" ]]; then

  log "${BOLD}Post-deploy health checks${NC}"

  # ── PM2 processes ──────────────────────────────────────────────────────────
  log "${BOLD}Checking PM2 processes${NC}"
  if command -v pm2 &>/dev/null; then
    PM2_JSON=$(pm2 jlist 2>/dev/null || echo "[]")

    for proc in interface mesh; do
      STATUS=$(echo "$PM2_JSON" | python3 -c "
import sys, json
apps = json.load(sys.stdin)
for a in apps:
    if a['name'] == '$proc':
        print(a['pm2_env']['status'])
        break
else:
    print('missing')
" 2>/dev/null || echo "error")

      if [[ "$STATUS" == "online" ]]; then
        pass "PM2 '$proc' is online"
      else
        fail "PM2 '$proc' status: $STATUS"
      fi
    done

    # Check for crash loops post-deploy (restart count that jumped)
    CRASH_PROCS=$(echo "$PM2_JSON" | python3 -c "
import sys, json
apps = json.load(sys.stdin)
problems = []
for a in apps:
    restarts = a.get('pm2_env',{}).get('restart_time',0)
    uptime_ms = a.get('pm2_env',{}).get('pm_uptime',0)
    import time
    age_s = (time.time()*1000 - uptime_ms) / 1000 if uptime_ms else 0
    # If restarted many times and uptime is very short, likely crash-looping
    if restarts > 5 and age_s < 60:
        problems.append(a['name'])
print(','.join(problems))
" 2>/dev/null || echo "")

    if [[ -n "$CRASH_PROCS" ]]; then
      fail "Post-deploy crash loop detected: $CRASH_PROCS"
    else
      pass "No post-deploy crash loops"
    fi
  else
    fail "PM2 not found"
  fi

  # ── Port responsiveness ────────────────────────────────────────────────────
  log "${BOLD}Checking port responsiveness${NC}"

  # Allow a few seconds for startup
  for port_info in "3000:Interface" "4444:BotServer"; do
    port="${port_info%%:*}"
    svc="${port_info##*:}"

    RETRIES=3
    RESPONDED=false
    for i in $(seq 1 $RETRIES); do
      HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "http://localhost:$port/" 2>/dev/null || echo "000")
      if [[ "$HTTP_CODE" != "000" ]]; then
        RESPONDED=true
        break
      fi
      sleep 2
    done

    if $RESPONDED; then
      pass "Port $port ($svc) responding (HTTP $HTTP_CODE)"
    else
      fail "Port $port ($svc) not responding after $RETRIES retries"
    fi
  done

  # ── Login page sanity ──────────────────────────────────────────────────────
  log "${BOLD}Verifying login page renders${NC}"

  LOGIN_HTML=$(curl -s --connect-timeout 10 http://localhost:3000/login 2>/dev/null || echo "")
  LOGIN_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 http://localhost:3000/login 2>/dev/null || echo "000")

  if [[ "$LOGIN_CODE" == "200" ]]; then
    pass "Login page HTTP 200"

    # Quick sanity: must have form fields
    if echo "$LOGIN_HTML" | grep -qi 'email\|password'; then
      pass "Login page contains form fields"
    else
      fail "Login page returned 200 but missing email/password fields (rendering broken)"
    fi

    # Must not be an error page (match whole-word "500" to avoid false positives on e.g. setTimeout(5000))
    if echo "$LOGIN_HTML" | grep -qiP 'application error|internal server error|(?<![0-9])500(?![0-9]).*error'; then
      fail "Login page contains error indicators"
    else
      pass "Login page has no error indicators"
    fi
  else
    fail "Login page returned HTTP $LOGIN_CODE"
  fi

  # ── Auth endpoint sanity ───────────────────────────────────────────────────
  log "${BOLD}Verifying auth endpoints${NC}"

  CSRF_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 http://localhost:3000/api/auth/csrf 2>/dev/null || echo "000")
  PROVIDERS_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 http://localhost:3000/api/auth/providers 2>/dev/null || echo "000")

  if [[ "$CSRF_CODE" == "200" ]]; then
    pass "Auth CSRF endpoint responding"
  else
    fail "Auth CSRF endpoint returned HTTP $CSRF_CODE"
  fi

  if [[ "$PROVIDERS_CODE" == "200" ]]; then
    pass "Auth providers endpoint responding"
  else
    fail "Auth providers endpoint returned HTTP $PROVIDERS_CODE"
  fi

  # ── Build ID verification ──────────────────────────────────────────────────
  log "${BOLD}Verifying deployed build${NC}"

  if [[ -f "$DEPLOY_ROOT/apps/interface/.next/BUILD_ID" ]]; then
    BUILD_ID=$(cat "$DEPLOY_ROOT/apps/interface/.next/BUILD_ID")
    pass "Deployed BUILD_ID: $BUILD_ID"
  elif [[ -f "$DEPLOY_ROOT/.next/BUILD_ID" ]]; then
    BUILD_ID=$(cat "$DEPLOY_ROOT/.next/BUILD_ID")
    pass "Deployed BUILD_ID: $BUILD_ID"
  else
    warn "No BUILD_ID found in deploy target"
  fi

fi

###############################################################################
# SUMMARY
###############################################################################
echo ""
log "${BOLD}=== GATE SUMMARY ($MODE) ===${NC}"

if [[ "$FAILURES" -gt 0 ]]; then
  echo -e "  ${RED}${BOLD}BLOCKED: $FAILURES failure(s) detected${NC}"
  echo ""
  if [[ "$MODE" == "pre-deploy" ]]; then
    echo -e "  ${RED}DO NOT DEPLOY until all failures are resolved.${NC}"
  else
    echo -e "  ${RED}Deployment may be broken. Investigate immediately.${NC}"
  fi
  echo ""
  exit 1
else
  echo -e "  ${GREEN}${BOLD}ALL CHECKS PASSED${NC}"
  echo ""
  if [[ "$MODE" == "pre-deploy" ]]; then
    echo -e "  ${GREEN}Safe to deploy.${NC}"
  else
    echo -e "  ${GREEN}Deployment is healthy.${NC}"
  fi
  echo ""
  exit 0
fi

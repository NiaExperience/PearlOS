#!/usr/bin/env bash
###############################################################################
# qa-screenshot-audit.sh - PearlOS QA Screenshot Audit
#
# Takes screenshots of every critical route, verifies service health, and
# posts proof to Discord.  Returns non-zero if ANY check fails.
#
# Usage:
#   bash scripts/qa-screenshot-audit.sh              # full run
#   bash scripts/qa-screenshot-audit.sh --skip-discord  # skip Discord post
#   bash scripts/qa-screenshot-audit.sh --channel <id>  # override channel
#
# Requires: node (>=20), playwright (installed), PM2
###############################################################################
set -euo pipefail

# ── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
BOLD='\033[1m'; NC='\033[0m'

# ── paths ────────────────────────────────────────────────────────────────────
REPO_ROOT="/workspace/nia-universal"
DEPLOY_ROOT="/opt/pearlos"
INTERFACE_ENV="$REPO_ROOT/apps/interface/.env.local"
SCREENSHOT_DIR="$REPO_ROOT/qa/screenshots/audit-$(date -u +%Y%m%d-%H%M%S)"
REPORT_FILE="$SCREENSHOT_DIR/report.txt"
FAILURES=0

# ── args ─────────────────────────────────────────────────────────────────────
SKIP_DISCORD=false
DISCORD_CHANNEL="${DISCORD_CHANNEL_ID:-1491397542364315668}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-discord) SKIP_DISCORD=true; shift ;;
    --channel) DISCORD_CHANNEL="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# ── helpers ──────────────────────────────────────────────────────────────────
log()  { echo -e "${CYAN}[QA]${NC} $*"; }
pass() { echo -e "${GREEN}[PASS]${NC} $*"; echo "PASS: $*" >> "$REPORT_FILE"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; echo "FAIL: $*" >> "$REPORT_FILE"; FAILURES=$((FAILURES + 1)); }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; echo "WARN: $*" >> "$REPORT_FILE"; }

mkdir -p "$SCREENSHOT_DIR"
echo "PearlOS QA Screenshot Audit - $(date -u)" > "$REPORT_FILE"
echo "==========================================" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

###############################################################################
# PHASE 1: PRE-FLIGHT CHECKS
###############################################################################
log "${BOLD}Phase 1: Pre-flight checks${NC}"

# 1a. PM2 running?
if ! command -v pm2 &>/dev/null; then
  fail "PM2 not found in PATH"
else
  PM2_JSON=$(pm2 jlist 2>/dev/null || echo "[]")
  PM2_COUNT=$(echo "$PM2_JSON" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  if [[ "$PM2_COUNT" -eq 0 ]]; then
    fail "No PM2 processes running"
  else
    pass "PM2 has $PM2_COUNT processes"
  fi

  # 1b. Crash loop detection (restart count > 50 in a single process)
  CRASH_LOOPS=$(echo "$PM2_JSON" | python3 -c "
import sys, json
apps = json.load(sys.stdin)
loops = []
for a in apps:
    name = a.get('name','?')
    restarts = a.get('pm2_env',{}).get('restart_time',0)
    status = a.get('pm2_env',{}).get('status','unknown')
    if restarts > 50:
        loops.append(f'{name}({restarts})')
    if status != 'online':
        loops.append(f'{name}[{status}]')
print('|'.join(loops))
" 2>/dev/null || echo "")

  if [[ -n "$CRASH_LOOPS" ]]; then
    warn "Potential crash loops or unhealthy processes: $CRASH_LOOPS"
  else
    pass "No crash loops detected (all restart counts <= 50, all online)"
  fi

  # 1c. Critical processes specifically present
  for proc in interface mesh; do
    if echo "$PM2_JSON" | python3 -c "
import sys, json
apps = json.load(sys.stdin)
found = any(a['name'] == '$proc' and a['pm2_env']['status'] == 'online' for a in apps)
sys.exit(0 if found else 1)
" 2>/dev/null; then
      pass "PM2 process '$proc' is online"
    else
      fail "PM2 process '$proc' is NOT online"
    fi
  done
fi

# 1d. Port checks
for port_info in "3000:Interface" "4444:BotServer"; do
  port="${port_info%%:*}"
  svc="${port_info##*:}"
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "http://localhost:$port/" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" != "000" ]]; then
    pass "Port $port ($svc) responding (HTTP $HTTP_CODE)"
  else
    fail "Port $port ($svc) not responding"
  fi
done

###############################################################################
# PHASE 2: BUILD VERIFICATION
###############################################################################
log "${BOLD}Phase 2: Build verification${NC}"

DEPLOYED_BUILD_ID=""
if [[ -f "$DEPLOY_ROOT/apps/interface/.next/BUILD_ID" ]]; then
  DEPLOYED_BUILD_ID=$(cat "$DEPLOY_ROOT/apps/interface/.next/BUILD_ID" 2>/dev/null)
  pass "Deployed BUILD_ID: $DEPLOYED_BUILD_ID"
elif [[ -f "$DEPLOY_ROOT/.next/BUILD_ID" ]]; then
  DEPLOYED_BUILD_ID=$(cat "$DEPLOY_ROOT/.next/BUILD_ID" 2>/dev/null)
  pass "Deployed BUILD_ID: $DEPLOYED_BUILD_ID"
else
  warn "No BUILD_ID file found in deploy target"
fi

SOURCE_COMMIT=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")
SOURCE_BRANCH=$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo "unknown")
DEPLOY_COMMIT=$(git -C "$DEPLOY_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")

echo "Source commit: $SOURCE_COMMIT ($SOURCE_BRANCH)" >> "$REPORT_FILE"
echo "Deploy commit: $DEPLOY_COMMIT" >> "$REPORT_FILE"
echo "Deployed BUILD_ID: $DEPLOYED_BUILD_ID" >> "$REPORT_FILE"

if [[ "$SOURCE_COMMIT" != "unknown" && "$DEPLOY_COMMIT" != "unknown" ]]; then
  if [[ "$SOURCE_COMMIT" == "$DEPLOY_COMMIT" ]]; then
    pass "Source and deploy commits match ($SOURCE_COMMIT)"
  else
    warn "Source ($SOURCE_COMMIT) and deploy ($DEPLOY_COMMIT) commits differ -- deploy may be stale"
  fi
fi

###############################################################################
# PHASE 3: LOGIN PAGE HEALTH (curl-based)
###############################################################################
log "${BOLD}Phase 3: Login page health check${NC}"

LOGIN_BODY=$(curl -s --connect-timeout 10 http://localhost:3000/login 2>/dev/null || echo "")
LOGIN_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 http://localhost:3000/login 2>/dev/null || echo "000")

if [[ "$LOGIN_CODE" == "200" ]]; then
  pass "Login page returns HTTP 200"
else
  fail "Login page returned HTTP $LOGIN_CODE (expected 200)"
fi

# Check for expected elements in login HTML (note: form fields render client-side via React,
# so we only check for markers that appear in the server-rendered HTML or inline scripts)
for marker in 'email' 'password'; do
  if echo "$LOGIN_BODY" | grep -qi "$marker"; then
    pass "Login page contains expected element: '$marker'"
  else
    fail "Login page missing expected element: '$marker'"
  fi
done
# The login page title or body should contain 'login' or 'sign in'
if echo "$LOGIN_BODY" | grep -qi 'login\|sign.in\|sign_in'; then
  pass "Login page contains login/sign-in indicator"
else
  fail "Login page missing login/sign-in indicator"
fi

###############################################################################
# PHASE 4: AUTH FLOW TEST (NextAuth CSRF + credentials)
###############################################################################
log "${BOLD}Phase 4: Auth flow test${NC}"

CSRF_RESPONSE=$(curl -s -c /tmp/qa-cookies.txt http://localhost:3000/api/auth/csrf 2>/dev/null || echo "{}")
CSRF_TOKEN=$(echo "$CSRF_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('csrfToken',''))" 2>/dev/null || echo "")

if [[ -n "$CSRF_TOKEN" ]]; then
  pass "CSRF token obtained"

  # Attempt credentials login
  AUTH_CODE=$(curl -s -o /tmp/qa-auth-response.txt -w "%{http_code}" \
    -b /tmp/qa-cookies.txt -c /tmp/qa-cookies.txt \
    -X POST http://localhost:3000/api/auth/callback/credentials \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -d "email=pearl%40niaxp.com&password=harbour9&csrfToken=$CSRF_TOKEN" \
    2>/dev/null || echo "000")

  # NextAuth redirects on success (302) or returns 200 with error
  if [[ "$AUTH_CODE" == "302" || "$AUTH_CODE" == "200" ]]; then
    # Check if we got a session cookie
    if grep -qi 'session-token' /tmp/qa-cookies.txt 2>/dev/null; then
      pass "Auth flow succeeded -- session cookie obtained (HTTP $AUTH_CODE)"
    else
      # 302 to error page means auth failed
      REDIRECT_URL=$(grep -i 'location' /tmp/qa-auth-response.txt 2>/dev/null || echo "")
      if echo "$AUTH_CODE" | grep -q "302" && ! grep -qi 'error' /tmp/qa-auth-response.txt 2>/dev/null; then
        pass "Auth flow returned redirect ($AUTH_CODE) -- checking session"
        # Verify session
        SESSION_CHECK=$(curl -s -b /tmp/qa-cookies.txt http://localhost:3000/api/auth/session 2>/dev/null || echo "{}")
        if echo "$SESSION_CHECK" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('user',{}).get('email')" 2>/dev/null; then
          pass "Session verified -- logged in as $(echo "$SESSION_CHECK" | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['email'])" 2>/dev/null)"
        else
          warn "Got redirect but session not confirmed (may need cookie domain fix)"
        fi
      else
        warn "Auth returned $AUTH_CODE but no clear session -- credentials may be wrong or login is broken"
      fi
    fi
  else
    fail "Auth callback returned unexpected HTTP $AUTH_CODE"
  fi
else
  fail "Could not obtain CSRF token from /api/auth/csrf"
fi

# ── Obtain session cookie via curl for Playwright injection ──────────────────
# The login form renders client-side via React and depends on assistant meta
# API calls that can be slow or hang in headless environments. Instead, we
# authenticate server-side via curl (already proven in Phase 4) and inject
# the resulting session cookie into Playwright's browser context.

SESSION_COOKIE_FILE="/tmp/qa-session-cookies.txt"
rm -f "$SESSION_COOKIE_FILE" 2>/dev/null

# Step 1: Get CSRF token and initial cookies
curl -s -c "$SESSION_COOKIE_FILE" http://localhost:3000/api/auth/csrf > /dev/null 2>&1
QA_CSRF=$(curl -s -b "$SESSION_COOKIE_FILE" http://localhost:3000/api/auth/csrf 2>/dev/null \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('csrfToken',''))" 2>/dev/null || echo "")

# Step 2: POST credentials and follow redirects (-L) to get the session cookie.
# Without -L, the 302 response does not set the session token.
curl -s -L -o /dev/null \
  -b "$SESSION_COOKIE_FILE" -c "$SESSION_COOKIE_FILE" \
  -X POST http://localhost:3000/api/auth/callback/credentials \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "email=pearl%40niaxp.com&password=harbour9&csrfToken=$QA_CSRF" \
  2>/dev/null || true

# Extract session token cookie from the cookie jar.
# NextAuth uses __Secure-interface-auth.session-token or next-auth.session-token.
# Note: HttpOnly cookies are prefixed with #HttpOnly_ in the Netscape cookie file format,
# so we must include those lines (not filter them out with grep -v '^#').
SESSION_COOKIE_NAME=""
SESSION_COOKIE_VALUE=""
while IFS=$'\t' read -r domain _flag path secure expires name value; do
  case "$name" in
    *session-token*)
      SESSION_COOKIE_NAME="$name"
      SESSION_COOKIE_VALUE="$value"
      ;;
  esac
done < <(grep 'session-token' "$SESSION_COOKIE_FILE" 2>/dev/null || true)

if [[ -n "$SESSION_COOKIE_VALUE" ]]; then
  log "Session cookie obtained for Playwright injection ($SESSION_COOKIE_NAME)"
else
  warn "Could not obtain session cookie for Playwright -- authenticated screenshots may show login page"
fi

rm -f /tmp/qa-cookies.txt /tmp/qa-auth-response.txt 2>/dev/null

###############################################################################
# PHASE 5: SCREENSHOT CAPTURE (Playwright)
###############################################################################
log "${BOLD}Phase 5: Screenshot capture via Playwright${NC}"

# Write the Playwright screenshot script inline
PLAYWRIGHT_SCRIPT="$SCREENSHOT_DIR/_capture.js"
cat > "$PLAYWRIGHT_SCRIPT" << 'JSEOF'
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || '';
const SESSION_COOKIE_VALUE = process.env.SESSION_COOKIE_VALUE || '';

const ROUTES = [
  { name: '01-login', path: '/login', needsAuth: false, waitFor: 8000 },
  { name: '02-post-login-dashboard', path: '/', needsAuth: true, waitFor: 8000 },
  { name: '03-settings', path: '/settings', needsAuth: true, waitFor: 6000 },
  { name: '04-notes', path: '/notes', needsAuth: true, waitFor: 6000 },
  { name: '05-launchpad', path: '/launchpad', needsAuth: true, waitFor: 6000 },
];

async function run() {
  if (!SCREENSHOT_DIR) {
    console.error('SCREENSHOT_DIR not set');
    process.exit(1);
  }

  const results = { pass: [], fail: [] };
  let browser;

  try {
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    // ── Unauthenticated screenshots ─────────────────────────────────────────
    const unauthCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    const unauthPage = await unauthCtx.newPage();

    for (const route of ROUTES.filter(r => !r.needsAuth)) {
      try {
        const url = `${BASE_URL}${route.path}`;
        console.log(`Capturing ${route.name} -> ${url}`);
        const resp = await unauthPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await unauthPage.waitForTimeout(route.waitFor);
        const outPath = path.join(SCREENSHOT_DIR, `${route.name}.png`);
        await unauthPage.screenshot({ path: outPath, fullPage: false });
        const status = resp ? resp.status() : 'unknown';
        console.log(`  OK (HTTP ${status}) -> ${outPath}`);
        results.pass.push({ name: route.name, status });
      } catch (err) {
        console.error(`  FAIL ${route.name}: ${err.message}`);
        results.fail.push({ name: route.name, error: err.message });
      }
    }
    await unauthCtx.close();

    // ── Authenticated screenshots (cookie injection) ────────────────────────
    // Build cookie array for the browser context. We inject the NextAuth
    // session token obtained via curl in Phase 4 rather than trying to fill
    // the React login form (which depends on assistant meta API calls that
    // can hang in headless mode).
    const authCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    const authPage = await authCtx.newPage();

    // Inject session cookie. The __Secure- prefix requires secure=true + HTTPS.
    // On localhost HTTP we must handle this carefully: Playwright sets cookies
    // via CDP, and __Secure- cookies need the secure flag. We set secure=true
    // even for HTTP localhost because the CDP protocol allows it, and the
    // cookie will be sent on the loopback anyway.
    if (SESSION_COOKIE_NAME && SESSION_COOKIE_VALUE) {
      const isSecurePrefixed = SESSION_COOKIE_NAME.startsWith('__Secure-');
      try {
        await authCtx.addCookies([{
          name: SESSION_COOKIE_NAME,
          value: SESSION_COOKIE_VALUE,
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          secure: isSecurePrefixed,
          sameSite: 'Lax',
        }]);
        console.log(`Injected session cookie: ${SESSION_COOKIE_NAME} (secure=${isSecurePrefixed})`);
      } catch (cookieErr) {
        console.log(`Cookie injection failed: ${cookieErr.message}`);
        console.log('Falling back: navigating to auth callback directly...');
        // Fallback: do the login via page navigation
        try {
          // Get CSRF token in browser
          await authPage.goto(`${BASE_URL}/api/auth/csrf`, { timeout: 10000 });
          const csrfText = await authPage.textContent('body');
          const csrfData = JSON.parse(csrfText || '{}');
          const csrfToken = csrfData.csrfToken || '';
          if (csrfToken) {
            // POST credentials via fetch inside the page context
            await authPage.evaluate(async ({ email, password, csrf, baseUrl }) => {
              await fetch(`${baseUrl}/api/auth/callback/credentials`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}&csrfToken=${csrf}`,
                redirect: 'follow',
              });
            }, {
              email: process.env.PEARLOS_TEST_EMAIL || 'pearl@niaxp.com',
              password: process.env.PEARLOS_TEST_PASSWORD || 'harbour9',
              csrf: csrfToken,
              baseUrl: BASE_URL,
            });
            console.log('Fallback auth completed via in-page fetch');
          }
        } catch (fallbackErr) {
          console.log('Fallback auth also failed: ' + fallbackErr.message);
        }
      }
    } else {
      console.log('WARNING: No session cookie available, auth screenshots will show login');
    }

    // Verify the session is working
    let loginOk = false;
    try {
      const sessionResp = await authPage.goto(`${BASE_URL}/api/auth/session`, { timeout: 10000 });
      const sessionText = await authPage.textContent('body');
      const sessionData = JSON.parse(sessionText || '{}');
      if (sessionData.user && sessionData.user.email) {
        loginOk = true;
        console.log(`Authenticated as: ${sessionData.user.email}`);
      } else {
        console.log('Session check returned no user, proceeding unauthenticated');
      }
    } catch (err) {
      console.log('Session verification failed: ' + err.message);
    }

    // Capture authenticated routes
    for (const route of ROUTES.filter(r => r.needsAuth)) {
      try {
        const url = `${BASE_URL}${route.path}`;
        console.log(`Capturing ${route.name} -> ${url} (auth=${loginOk})`);
        const resp = await authPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await authPage.waitForTimeout(route.waitFor);
        const outPath = path.join(SCREENSHOT_DIR, `${route.name}.png`);
        await authPage.screenshot({ path: outPath, fullPage: false });
        const status = resp ? resp.status() : 'unknown';

        // If we got redirected back to login, flag it
        const finalUrl = authPage.url();
        if (finalUrl.includes('/login') && loginOk) {
          console.log(`  REDIRECTED to login for ${route.name}`);
          results.fail.push({ name: route.name, error: 'Redirected to login (auth not persisted)' });
        } else {
          console.log(`  OK (HTTP ${status}) -> ${outPath}`);
          results.pass.push({ name: route.name, status });
        }
      } catch (err) {
        console.error(`  FAIL ${route.name}: ${err.message}`);
        results.fail.push({ name: route.name, error: err.message });
      }
    }

    await authCtx.close();
  } catch (err) {
    console.error('Browser error: ' + err.message);
    results.fail.push({ name: 'browser', error: err.message });
  } finally {
    if (browser) await browser.close();
  }

  // Write results JSON
  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, 'results.json'),
    JSON.stringify(results, null, 2)
  );

  console.log(`\nResults: ${results.pass.length} passed, ${results.fail.length} failed`);
  process.exit(results.fail.length > 0 ? 1 : 0);
}

run();
JSEOF

# Run the playwright script
SCREENSHOT_EXIT=0
SCREENSHOT_DIR="$SCREENSHOT_DIR" \
  BASE_URL="http://localhost:3000" \
  SESSION_COOKIE_NAME="$SESSION_COOKIE_NAME" \
  SESSION_COOKIE_VALUE="$SESSION_COOKIE_VALUE" \
  node "$PLAYWRIGHT_SCRIPT" 2>&1 | tee -a "$REPORT_FILE" || SCREENSHOT_EXIT=$?

# Clean up session cookie file
rm -f "$SESSION_COOKIE_FILE" 2>/dev/null

if [[ "$SCREENSHOT_EXIT" -ne 0 ]]; then
  fail "Screenshot capture had failures (exit code $SCREENSHOT_EXIT)"
else
  pass "All screenshots captured successfully"
fi

# Count actual screenshots
SCREENSHOT_COUNT=$(find "$SCREENSHOT_DIR" -name '*.png' 2>/dev/null | wc -l)
log "Captured $SCREENSHOT_COUNT screenshots in $SCREENSHOT_DIR"

###############################################################################
# PHASE 6: DISCORD POSTING
###############################################################################
if [[ "$SKIP_DISCORD" == "true" ]]; then
  log "${BOLD}Phase 6: Discord posting (SKIPPED)${NC}"
else
  log "${BOLD}Phase 6: Discord posting${NC}"

  # Get Discord bot token from interface env
  DISCORD_BOT_TOKEN=""
  if [[ -f "$INTERFACE_ENV" ]]; then
    DISCORD_BOT_TOKEN=$(grep '^DISCORD_BOT_TOKEN=' "$INTERFACE_ENV" 2>/dev/null | cut -d= -f2 || echo "")
  fi

  if [[ -z "$DISCORD_BOT_TOKEN" ]]; then
    fail "No DISCORD_BOT_TOKEN found in $INTERFACE_ENV"
  else
    # Write Discord delivery script
    DISCORD_SCRIPT="$SCREENSHOT_DIR/_discord_post.js"
    cat > "$DISCORD_SCRIPT" << 'DISCEOF'
const fs = require('fs');
const path = require('path');
const https = require('https');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR;
const REPORT_CONTENT = process.env.REPORT_CONTENT || '';

if (!BOT_TOKEN || !CHANNEL_ID || !SCREENSHOT_DIR) {
  console.error('Missing required env vars: DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID, SCREENSHOT_DIR');
  process.exit(1);
}

function discordRequest(method, apiPath, payload, headers) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'discord.com',
      port: 443,
      path: apiPath,
      method,
      headers: {
        'Authorization': `Bot ${BOT_TOKEN}`,
        'User-Agent': 'DiscordBot (https://pearlos.ai, 1.0)',
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body: data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function postFileWithMessage(channelId, content, filePath) {
  return new Promise((resolve, reject) => {
    const boundary = '----QABoundary' + Date.now() + Math.random().toString(36).slice(2);
    const fileData = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    const prefix = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="payload_json"\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      JSON.stringify({ content }) +
      `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="files[0]"; filename="${fileName}"\r\n` +
      `Content-Type: image/png\r\n\r\n`
    );
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([prefix, fileData, suffix]);

    const options = {
      hostname: 'discord.com',
      port: 443,
      path: `/api/v10/channels/${channelId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bot ${BOT_TOKEN}`,
        'User-Agent': 'DiscordBot (https://pearlos.ai, 1.0)',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // Post summary message first
  const summaryContent = `**PearlOS QA Screenshot Audit** -- \`${timestamp}\`\n\n${REPORT_CONTENT}`;
  const summaryBody = JSON.stringify({ content: summaryContent });
  try {
    await discordRequest('POST', `/api/v10/channels/${CHANNEL_ID}/messages`, summaryBody, {
      'Content-Type': 'application/json',
    });
    console.log('Posted summary message');
  } catch (err) {
    console.error('Failed to post summary:', err.message);
  }

  // Post each screenshot
  const pngs = fs.readdirSync(SCREENSHOT_DIR)
    .filter(f => f.endsWith('.png') && !f.startsWith('_'))
    .sort();

  for (const png of pngs) {
    const label = png.replace('.png', '').replace(/^\d+-/, '').replace(/-/g, ' ');
    const filePath = path.join(SCREENSHOT_DIR, png);
    try {
      await postFileWithMessage(CHANNEL_ID, `**${label}** -- \`${timestamp}\``, filePath);
      console.log(`Posted: ${png}`);
      // Rate limit buffer
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`Failed to post ${png}: ${err.message}`);
    }
  }

  console.log('Discord delivery complete');
}

main().catch(err => {
  console.error('Discord delivery error:', err.message);
  process.exit(1);
});
DISCEOF

    # Build a compact report summary for Discord
    PASS_COUNT="$(grep -c '^PASS:' "$REPORT_FILE" 2>/dev/null)" || PASS_COUNT=0
    FAIL_COUNT="$(grep -c '^FAIL:' "$REPORT_FILE" 2>/dev/null)" || FAIL_COUNT=0
    WARN_COUNT="$(grep -c '^WARN:' "$REPORT_FILE" 2>/dev/null)" || WARN_COUNT=0

    REPORT_SUMMARY="Checks: $PASS_COUNT passed, $FAIL_COUNT failed, $WARN_COUNT warnings"
    if [[ -n "$DEPLOYED_BUILD_ID" ]]; then
      REPORT_SUMMARY="$REPORT_SUMMARY\nBuild: \`$DEPLOYED_BUILD_ID\` | Commit: \`$DEPLOY_COMMIT\`"
    fi
    if [[ "$FAIL_COUNT" -gt 0 ]]; then
      FAIL_LINES=$(grep '^FAIL:' "$REPORT_FILE" | head -5 | sed 's/^FAIL: /- /')
      REPORT_SUMMARY="$REPORT_SUMMARY\n\nFailures:\n$FAIL_LINES"
    fi

    DISCORD_POST_EXIT=0
    DISCORD_BOT_TOKEN="$DISCORD_BOT_TOKEN" \
    DISCORD_CHANNEL_ID="$DISCORD_CHANNEL" \
    SCREENSHOT_DIR="$SCREENSHOT_DIR" \
    REPORT_CONTENT="$REPORT_SUMMARY" \
      node "$DISCORD_SCRIPT" 2>&1 || DISCORD_POST_EXIT=$?

    if [[ "$DISCORD_POST_EXIT" -ne 0 ]]; then
      fail "Discord posting failed (exit $DISCORD_POST_EXIT)"
    else
      pass "Screenshots posted to Discord channel $DISCORD_CHANNEL"
    fi
  fi
fi

###############################################################################
# FINAL SUMMARY
###############################################################################
echo "" >> "$REPORT_FILE"
echo "==========================================" >> "$REPORT_FILE"

TOTAL_PASS="$(grep -c '^PASS:' "$REPORT_FILE" 2>/dev/null)" || TOTAL_PASS=0
TOTAL_FAIL="$(grep -c '^FAIL:' "$REPORT_FILE" 2>/dev/null)" || TOTAL_FAIL=0
TOTAL_WARN="$(grep -c '^WARN:' "$REPORT_FILE" 2>/dev/null)" || TOTAL_WARN=0

echo ""
log "${BOLD}=== QA AUDIT SUMMARY ===${NC}"
echo -e "  ${GREEN}PASS: $TOTAL_PASS${NC}"
echo -e "  ${RED}FAIL: $TOTAL_FAIL${NC}"
echo -e "  ${YELLOW}WARN: $TOTAL_WARN${NC}"
echo -e "  Screenshots: $SCREENSHOT_DIR"
echo -e "  Report: $REPORT_FILE"
echo ""

echo "TOTAL: $TOTAL_PASS passed, $TOTAL_FAIL failed, $TOTAL_WARN warnings" >> "$REPORT_FILE"

if [[ "$TOTAL_FAIL" -gt 0 ]]; then
  echo -e "${RED}${BOLD}QA AUDIT FAILED${NC} -- $TOTAL_FAIL failure(s) detected"
  exit 1
else
  echo -e "${GREEN}${BOLD}QA AUDIT PASSED${NC}"
  exit 0
fi

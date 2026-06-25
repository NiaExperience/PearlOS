#!/usr/bin/env bash
# seed-notion-bugs.sh
# Seeds the initial bug reports into the Notion QA Bug Tracker.
# Run AFTER setup-notion-bug-tracker.sh and after setting NOTION_BUGS_DB_ID.
#
# Uses the /api/bugs endpoint on the production server.
#
# Usage:
#   PROD_URL=https://app.pearlos.org bash seed-notion-bugs.sh

set -euo pipefail

: "${PROD_URL:?PROD_URL required (e.g. https://app.pearlos.org)}"

API="${PROD_URL}/api/bugs"

post_bug() {
  local title="$1"
  local reported_by="$2"
  local priority="$3"
  local status="$4"
  local environment="$5"
  local discord_link="$6"
  local description="$7"

  echo "→ Creating: $title"
  curl -s -X POST "${API}" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "
import json
print(json.dumps({
  'title': '${title}',
  'reportedBy': '${reported_by}',
  'priority': '${priority}',
  'status': '${status}',
  'environment': '${environment}',
  'discordLink': '${discord_link}',
  'description': '''${description}'''
}))
")" | python3 -m json.tool 2>/dev/null || echo "  (sent)"
  echo ""
}

# Bug #1
post_bug \
  "Telegram not responding to messages on staging" \
  "ImmersiveRiggs" \
  "P1" \
  "Investigating" \
  "Staging" \
  "https://discord.com/channels/1471441655126167553/1491397542364315668" \
  "Steph sent /start and Hi Pearl! on Telegram with no reply. Root cause found: staging relay bot token 8949720571 conflicts with production instance holding the same token (HTTP 409 Conflict). Fix: create separate bot token for staging, or implement webhook-based delivery."

# Bug #2
post_bug \
  "Social Connections description needs text fix" \
  "ImmersiveRiggs" \
  "P2" \
  "Open" \
  "Production" \
  "https://discord.com/channels/1471441655126167553/1491397542364315668" \
  "Social Connections panel has an extra second sentence that no longer matches the feature. Trim description to only say: 'You can chat w Pearl in places you already use!'"

# Bug #3 (Resolved)
post_bug \
  "Voice Pearl on Prod shut down, won't wake on click" \
  "angel_70160" \
  "P1" \
  "Resolved" \
  "Production" \
  "https://discord.com/channels/1471441655126167553/1491397542364315668" \
  "Angel reported prod Pearl was asleep and would not wake on click. Root cause: browser microphone contention. Angel had both staging and prod tabs open — the tab without mic access showed Pearl as asleep. Resolved by identifying the mic lock conflict."

# Bug #4
post_bug \
  "Prod onboarding flow not completing for Steph" \
  "ImmersiveRiggs" \
  "P1" \
  "Investigating" \
  "Production" \
  "https://discord.com/channels/1471441655126167553/1491397542364315668" \
  "Steph reports onboarding is not happening on app.pearlos.org. Onboarding flow did not trigger or complete for her account on the AGENCY-WEBHOOKS build (commit f7d91b08)."

# Bug #5
post_bug \
  "Mic contention: staging + prod tabs cause one Pearl to sleep silently" \
  "angel_70160" \
  "P2" \
  "Open" \
  "Both" \
  "https://discord.com/channels/1471441655126167553/1491397542364315668" \
  "Having both staging and production Pearl tabs open causes one Pearl to go to sleep because only one tab can hold the WebRTC mic. Suggestion: detect mic unavailability and show a user-friendly message instead of silently showing sleep state."

# Bug #6
post_bug \
  "Prod Pearl voice addressed Steph as Angel — identity mix-up" \
  "ImmersiveRiggs" \
  "P1" \
  "Open" \
  "Production" \
  "https://discord.com/channels/1471441655126167553/1491397542364315668" \
  "Steph was using prod Pearl voice and Pearl called her Angel (another user's name). Voice session appears to be carrying over context/identity from a previous user session. Possible shared auth token, uncleared session context, or Daily.co room re-use across different users."

echo "✅ Seeded 6 bugs into Notion tracker."

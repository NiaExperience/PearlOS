#!/usr/bin/env bash
# setup-notion-bug-tracker.sh
# Run this ONCE on the production server to create the PearlOS QA Bug Tracker in Notion.
# Requires: NOTION_API_KEY and a Notion parent page ID.
#
# Usage:
#   NOTION_API_KEY=secret_... NOTION_PARENT_PAGE_ID=... bash setup-notion-bug-tracker.sh
#
# The NOTION_PARENT_PAGE_ID is the UUID of the Notion page where the database lives.
# You can get it from the page URL: https://notion.so/WorkspaceName/PageTitle-UUID
# The UUID is the last part without hyphens, or with hyphens (both work).

set -euo pipefail

: "${NOTION_API_KEY:?NOTION_API_KEY required}"
: "${NOTION_PARENT_PAGE_ID:?NOTION_PARENT_PAGE_ID required (the UUID of the parent Notion page)}"

NOTION_API="https://api.notion.com/v1"

# Create the database with the proper schema
response=$(curl -s -w "\n%{http_code}" -X POST "${NOTION_API}/databases" \
  -H "Authorization: Bearer ${NOTION_API_KEY}" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": {
      "type": "page_id",
      "page_id": "'"${NOTION_PARENT_PAGE_ID}"'"
    },
    "title": [
      {
        "type": "text",
        "text": { "content": "🐛 PearlOS QA Bug Tracker" }
      }
    ],
    "properties": {
      "Title": {
        "title": {}
      },
      "Reported By": {
        "rich_text": {}
      },
      "Status": {
        "select": {
          "options": [
            { "name": "Open", "color": "red" },
            { "name": "Investigating", "color": "orange" },
            { "name": "Fix In Progress", "color": "yellow" },
            { "name": "Resolved", "color": "green" },
            { "name": "Won'"'"'t Fix", "color": "gray" }
          ]
        }
      },
      "Priority": {
        "select": {
          "options": [
            { "name": "P0", "color": "red" },
            { "name": "P1", "color": "orange" },
            { "name": "P2", "color": "yellow" },
            { "name": "P3", "color": "blue" }
          ]
        }
      },
      "Environment": {
        "select": {
          "options": [
            { "name": "Staging", "color": "purple" },
            { "name": "Production", "color": "pink" },
            { "name": "Both", "color": "brown" }
          ]
        }
      },
      "Date": {
        "date": {}
      },
      "Discord Link": {
        "url": {}
      },
      "Description": {
        "rich_text": {}
      }
    },
    "is_inline": false
  }')

http_code=$(echo "$response" | tail -1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" != "200" ]; then
  echo "❌ Failed to create database (HTTP $http_code):"
  echo "$body"
  exit 1
fi

db_id=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
db_url=$(echo "$body" | python3 -c "import sys,json; print(json.load(sys.stdin)['url'])")

echo ""
echo "✅ Bug tracker database created!"
echo "   Database ID: ${db_id}"
echo "   URL: ${db_url}"
echo ""
echo "Add this to your production .env:"
echo "   NOTION_BUGS_DB_ID=${db_id}"
echo ""
echo "Replace NOTION_BUGS_DB_ID with the ID above and restart the interface."
echo "The API will be available at: POST /api/bugs"

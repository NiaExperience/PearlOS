#!/bin/bash
cd "$(dirname "$0")/.."
# Load .env.local if present
if [ -f .env.local ]; then
  set -a
  source .env.local
  set +a
fi
exec npx next start -p 3000

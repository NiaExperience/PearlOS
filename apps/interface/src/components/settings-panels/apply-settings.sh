#!/bin/bash
# apply-settings.sh - Apply Pearl Mind settings to openclaw.json
# Usage: ./apply-settings.sh <key> <value>
# Examples:
#   ./apply-settings.sh primary-model "openrouter/anthropic/claude-opus-4.6"
#   ./apply-settings.sh cache-retention "long"

CONFIG="$HOME/.openclaw/openclaw.json"

case "$1" in
  primary-model)
    python3 -c "
import json
with open('$CONFIG') as f: c = json.load(f)
c['agents']['defaults']['model']['primary'] = '$2'
with open('$CONFIG', 'w') as f: json.dump(c, f, indent=2)
print('✅ Primary model set to: $2')
print('⚠️  Run: openclaw gateway restart')
"
    ;;
  cache-retention)
    python3 -c "
import json
with open('$CONFIG') as f: c = json.load(f)
for m in c.get('agents',{}).get('defaults',{}).get('models',{}):
  if 'anthropic' in m:
    c['agents']['defaults']['models'][m].setdefault('params',{})['cacheRetention'] = '$2'
with open('$CONFIG', 'w') as f: json.dump(c, f, indent=2)
print('✅ Cache retention set to: $2')
"
    ;;
  *)
    echo "Unknown setting: $1"
    echo "Available: primary-model, cache-retention"
    exit 1
    ;;
esac

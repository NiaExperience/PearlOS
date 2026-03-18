#!/bin/bash
# dev-watch.sh — Auto-restart Next.js dev server on file changes
# Needed because RunPod's FUSE filesystem doesn't support inotify
# Usage: bash dev-watch.sh

echo "🔄 Starting Next.js with manual file polling..."
echo "   Press Ctrl+C to stop"
echo "   Files are checked every 3 seconds for changes"

cd /workspace/nia-universal/apps/interface

# Get checksum of src files
get_checksum() {
  find src/ -name "*.tsx" -o -name "*.ts" -o -name "*.css" -o -name "*.mjs" | \
    xargs stat -c '%Y %n' 2>/dev/null | md5sum | cut -d' ' -f1
}

LAST_CHECKSUM=$(get_checksum)

# Start Next.js
rm -rf .next
npx next dev -p 3000 &
NEXT_PID=$!

cleanup() {
  echo "Stopping..."
  kill $NEXT_PID 2>/dev/null
  wait $NEXT_PID 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

# Poll for changes every 3 seconds
while true; do
  sleep 3
  NEW_CHECKSUM=$(get_checksum)
  if [ "$NEW_CHECKSUM" != "$LAST_CHECKSUM" ]; then
    echo ""
    echo "📝 =========================================="
    echo "📝 File change detected! Restarting Next.js..."
    echo "📝 =========================================="
    echo ""
    kill $NEXT_PID 2>/dev/null
    wait $NEXT_PID 2>/dev/null
    rm -rf .next
    npx next dev -p 3000 &
    NEXT_PID=$!
    LAST_CHECKSUM=$(get_checksum)
  fi
done

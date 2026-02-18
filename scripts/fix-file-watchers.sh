#!/usr/bin/env bash
# Fix ENOSPC: System limit for number of file watchers reached
# This script increases the inotify file watcher limit on Linux

set -euo pipefail

# Only run on Linux
if [ "$(uname)" != "Linux" ]; then
    echo "ℹ️  File watcher limit fix is only needed on Linux"
    exit 0
fi

# Check if /proc/sys/fs/inotify/max_user_watches exists (Linux only)
if [ ! -f /proc/sys/fs/inotify/max_user_watches ]; then
    echo "ℹ️  inotify not available on this system"
    exit 0
fi

echo "🔧 Checking file watcher limit (ENOSPC error fix)..."
echo ""

# Check current limit
CURRENT_LIMIT=$(cat /proc/sys/fs/inotify/max_user_watches 2>/dev/null || echo "unknown")
echo "Current limit: $CURRENT_LIMIT"

# Recommended limit for large projects (512K)
RECOMMENDED_LIMIT=524288

# Check if limit is too low (less than 256K is definitely too low for monorepos)
if [ "$CURRENT_LIMIT" != "unknown" ] && [ "$CURRENT_LIMIT" -lt 262144 ]; then
    # Check if --auto flag is passed (non-interactive mode)
    if [ "${1:-}" = "--auto" ]; then
        # Try to increase automatically (non-interactive)
        if sudo -n sysctl fs.inotify.max_user_watches=$RECOMMENDED_LIMIT >/dev/null 2>&1; then
            echo "✅ File watcher limit increased to $RECOMMENDED_LIMIT"
        else
            echo "⚠️  File watcher limit ($CURRENT_LIMIT) is low. If you see ENOSPC errors, run:"
            echo "   sudo sysctl fs.inotify.max_user_watches=$RECOMMENDED_LIMIT"
            echo "   Or: npm run fix:file-watchers"
        fi
    else
        echo ""
        echo "⚠️  Current limit ($CURRENT_LIMIT) may be too low for large monorepos."
        echo "   Recommended limit: $RECOMMENDED_LIMIT"
        echo ""
        echo "To fix permanently, run:"
        echo "  sudo bash -c 'echo fs.inotify.max_user_watches=$RECOMMENDED_LIMIT >> /etc/sysctl.conf'"
        echo "  sudo sysctl -p"
        echo ""
        echo "Or temporarily (until reboot):"
        echo "  sudo sysctl fs.inotify.max_user_watches=$RECOMMENDED_LIMIT"
        echo ""
        read -p "Would you like to apply the temporary fix now? (y/N) " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            if sudo sysctl fs.inotify.max_user_watches=$RECOMMENDED_LIMIT; then
                echo "✅ File watcher limit increased to $RECOMMENDED_LIMIT"
                echo "   Note: This change will be lost after reboot."
                echo "   Run this script again or apply the permanent fix above."
            else
                echo "❌ Failed to increase limit. You may need to run with sudo."
            fi
        fi
    fi
else
    if [ "${1:-}" != "--auto" ]; then
        echo "✅ Current limit ($CURRENT_LIMIT) should be sufficient"
    fi
fi

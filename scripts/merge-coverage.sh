#!/bin/bash

# Merge coverage reports from different parts of the monorepo into a single file
# for unified visualization in VS Code (Koverage/Coverage Gutters).

set -e

# Ensure we are at the root
cd "$(dirname "$0")/.."

OUTPUT_FILE="coverage/lcov.merged.info"
mkdir -p coverage

# Clear output file
echo "" > "$OUTPUT_FILE"

# 1. Jest Coverage (Root)
# Jest outputs to coverage/lcov.info by default.
if [ -f "coverage/lcov.info" ]; then
    echo "Found Jest coverage at coverage/lcov.info"
    cat "coverage/lcov.info" >> "$OUTPUT_FILE"
else
    echo "No Jest coverage found at coverage/lcov.info"
fi

# 2. Python Bot Coverage
# Located in apps/pipecat-daily-bot/bot/coverage/lcov.info
# Paths are relative to apps/pipecat-daily-bot/bot/, so we need to prepend that.
PYTHON_BOT_LCOV="apps/pipecat-daily-bot/bot/coverage/lcov.info"
PYTHON_BOT_PREFIX="apps/pipecat-daily-bot/bot/"

if [ -f "$PYTHON_BOT_LCOV" ]; then
    echo "Found Python Bot coverage at $PYTHON_BOT_LCOV"
    # Use sed to prepend the prefix to lines starting with SF:
    # We use | as delimiter to avoid issues with slashes in path
    sed "s|^SF:|SF:$PYTHON_BOT_PREFIX|" "$PYTHON_BOT_LCOV" >> "$OUTPUT_FILE"
else
    echo "No Python Bot coverage found at $PYTHON_BOT_LCOV"
fi

echo "Merged coverage report generated at $OUTPUT_FILE"

#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "🐚 PearlOS Visual Regression Test Harness"
echo "==========================================="
echo ""

# Check if services are running
echo "Checking services..."
if curl -s http://localhost:3000 > /dev/null 2>&1; then
  echo "  ✅ Frontend (localhost:3000)"
else
  echo "  ⚠️  Frontend not running at localhost:3000"
fi

if curl -s http://localhost:4444/api/tools/list > /dev/null 2>&1; then
  echo "  ✅ Gateway (localhost:4444)"
else
  echo "  ⚠️  Gateway not running at localhost:4444"
fi

echo ""
echo "Running Playwright tests..."
npx playwright test --config=playwright.config.ts --reporter=list "$@"

echo ""
echo "📊 Report generated at: $DIR/report.html"
echo "📸 Screenshots saved to: $DIR/screenshots/"

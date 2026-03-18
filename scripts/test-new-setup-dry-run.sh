#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Running bash dry-run smoke tests..."
bash "${REPO_ROOT}/new-setup.sh" --preset minimal --dry-run --non-interactive >/dev/null
bash "${REPO_ROOT}/new-setup.sh" --preset full --dry-run --non-interactive >/dev/null

echo "Bash dry-run OK."

if command -v pwsh >/dev/null 2>&1; then
  echo "Running PowerShell dry-run smoke tests (pwsh)..."
  pwsh -NoProfile -ExecutionPolicy Bypass -File "${REPO_ROOT}/new-setup.ps1" -Preset minimal -NonInteractive -DryRun | Out-Null
  pwsh -NoProfile -ExecutionPolicy Bypass -File "${REPO_ROOT}/new-setup.ps1" -Preset full -NonInteractive -DryRun | Out-Null
  echo "PowerShell dry-run OK."
else
  echo "pwsh not found; skipping PowerShell smoke test."
fi

echo "All dry-run smoke tests passed."



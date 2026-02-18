#!/bin/bash

# Script to copy Personality, Assistant, and GlobalSettings records for the 'pearlos' tenant from Staging to Prod.
# Tenant ID for 'pearlos': 7bd902a4-9534-4fc4-b745-f23368590946
#
# Usage:
#   ./scripts/copy-assistant-data.sh [--global-settings] [other args...]
#
# Options:
#   --global-settings  Only copy the GlobalSettings singleton (skip Personality and Assistant)

TENANT_ID="7bd902a4-9534-4fc4-b745-f23368590946"

# Check for --global-settings flag
GLOBAL_SETTINGS_ONLY=false
REMAINING_ARGS=()
for arg in "$@"; do
  case $arg in
    --global-settings)
      GLOBAL_SETTINGS_ONLY=true
      ;;
    *)
      REMAINING_ARGS+=("$arg")
      ;;
  esac
done

echo "========================================================"
echo "Copying GlobalSettings record from Staging to Prod..."
echo "(Singleton - no tenant filter)"
echo "========================================================"
./scripts/copy-local-data-to-aws.sh --type GlobalSettings --staging-to-prod "${REMAINING_ARGS[@]}"

if [ "$GLOBAL_SETTINGS_ONLY" = true ]; then
  echo ""
  echo "Done. (--global-settings mode: skipped Personality and Assistant)"
  exit 0
fi

echo ""
echo "========================================================"
echo "Copying Personality records from Staging to Prod..."
echo "Tenant: $TENANT_ID"
echo "========================================================"
./scripts/copy-local-data-to-aws.sh --type Personality --tenant "$TENANT_ID" --staging-to-prod "${REMAINING_ARGS[@]}"

echo ""
echo "========================================================"
echo "Copying Assistant records from Staging to Prod..."
echo "Tenant: $TENANT_ID"
echo "========================================================"
./scripts/copy-local-data-to-aws.sh --type Assistant --tenant "$TENANT_ID" --staging-to-prod "${REMAINING_ARGS[@]}"

echo ""
echo "Done."

#!/usr/bin/env bash
# Simple Postgres backup script for PearlOS development DB
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
mkdir -p "$BACKUP_DIR"

# Resolve connection settings from env or fall back to local defaults
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${POSTGRES_DB:-testdb}"
PGUSER="${POSTGRES_USER:-postgres}"
PGPASSWORD_VALUE="${POSTGRES_PASSWORD:-password}"
export PGPASSWORD="$PGPASSWORD_VALUE"

STAMP=$(date -u +"%Y%m%d-%H%M%S")
OUTFILE="$BACKUP_DIR/pearlos-db-$STAMP.sql"

echo "📦 Creating database backup: $OUTFILE"
pg_dump \
  --no-owner \
  --format=plain \
  --host="$PGHOST" \
  --port="$PGPORT" \
  --username="$PGUSER" \
  "$PGDATABASE" > "$OUTFILE"

echo "✅ Backup complete"
echo "   File: $OUTFILE"

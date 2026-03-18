#!/usr/bin/env bash
set -e
export PATH="$HOME/.local/bin:$PATH"

# 1. Start Postgres
su - postgres -c "/usr/lib/postgresql/14/bin/pg_ctl -D /var/lib/postgresql/14/main -o '-c config_file=/etc/postgresql/14/main/postgresql.conf' -l /tmp/pg.log start" 2>/dev/null || true
sleep 2

# 2. Ensure password and DB (idempotent)
su - postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'password';\"" 2>/dev/null || true
su - postgres -c "psql -c \"CREATE DATABASE testdb;\"" 2>/dev/null || true

echo "✅ Postgres ready. Run: cd /workspace/nia-universal && npm run start:all"

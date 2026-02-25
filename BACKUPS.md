# Backup & Snapshot Guide

## Database backups

Use the built-in script to snapshot the local Postgres database:

```bash
npm run backup:db
```

This command:

- Reads host/port/user/password from `PGHOST`, `PGPORT`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` (falls back to `localhost:5432`, `postgres` / `password`).
- Dumps the current database (`POSTGRES_DB`, default `testdb`) into `./backups/pearlos-db-<timestamp>.sql`.
- Requires `pg_dump` to be available on your PATH.

To restore a backup:

```bash
PGPASSWORD=password psql -h localhost -U postgres -d testdb < backups/pearlos-db-YYYYMMDD-HHMMSS.sql
```
(adjust credentials/path to match your environment.)

## Git snapshots

Before making risky changes, capture the working tree:

```bash
git add -A
git commit -m "snapshot: <description>"
```

or use lightweight tags:

```bash
git tag snapshot-$(date +%Y%m%d-%H%M%S)
```

Combining a git snapshot with `npm run backup:db` gives you both code and data rollbacks in seconds.

# Database Migrations

This directory contains database migration scripts for the Mesh application.

## Automatic Migration on Startup

**The JSONB migration runs automatically** when the Mesh server starts. The migration:

- ✅ Checks if content/indexer columns need migration
- ✅ Performs migration if needed (transactional, all-or-nothing)
- ✅ Skips if already migrated (idempotent)
- ✅ Logs errors but allows server to start if migration fails

This means you typically **don't need to run the migration script manually**. The server handles it automatically.

## Manual Migration (Optional)

If you prefer to run the migration manually before starting the server, or if the automatic migration fails, you can use:

```bash
npx tsx apps/mesh/scripts/migrations/001-content-to-jsonb.ts
```

## Migration 001: Content Column to JSONB

This migration converts the `content` and `indexer` columns in the `notion_blocks` table from TEXT to JSONB to enable efficient JSON querying.

**What it does:**

1. Checks if the content column is already JSONB (idempotent)
2. Converts content column from TEXT to JSONB
3. Converts indexer column from TEXT to JSONB  
4. Creates GIN indexes on both columns for fast JSON queries
5. All operations run in a transaction (rolls back on error)

**Prerequisites:**

- PostgreSQL database must be running
- `.env.local` file must have correct database credentials:
  - `POSTGRES_HOST`
  - `POSTGRES_PORT`
  - `POSTGRES_DATABASE`
  - `POSTGRES_USER`
  - `POSTGRES_PASSWORD`

**Benefits:**

- Enables dot-notation queries like `'data.score': { gt: 100 }`
- Faster JSON querying with GIN indexes
- PostgreSQL validates JSON on insert
- More efficient storage for large JSON objects

## Notes

- **For new databases**: The schema is automatically correct (model uses JSONB), no migration needed
- **For existing databases**: Migration runs automatically on Mesh server startup
- **Manual execution**: Available via the standalone script if needed
- **Idempotent**: Safe to run multiple times (checks current state first)
- **Transactional**: All-or-nothing, rolls back on error

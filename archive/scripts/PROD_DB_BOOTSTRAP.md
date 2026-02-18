# Production Database Bootstrap

Script: `scripts/bootstrap-prod-db-from-dev.ts`  
Command: `npm run pg:db-bootstrap-prod`

## Purpose
Copy the current development database into production during an approved bootstrap window. The script:

- Creates a `pg_dump` backup of production before any writes.
- Dumps the development database (`POSTGRES_*`) into a temporary file.
- Restores the dump into production (`PROD_POSTGRES_*`) and fixes key sequences.
- Optionally refreshes platform content definitions via Prism.

## ⚠️ Warnings
- **Destructive:** Existing production data will be dropped. Coordinate with the SRE/on-call owner before running.
- **Credentials:** Provide production connection details via environment variables; never hard-code secrets.
- **Connectivity:** Requires direct `psql` access to both dev and prod Postgres instances.

## Required Environment

| Source (Dev) | Notes |
|--------------|-------|
| `POSTGRES_HOST` | Typically `localhost` (loaded from `.env.local`). |
| `POSTGRES_PORT` | Usually `5432`. |
| `POSTGRES_DB` | Local database name (e.g., `testdb`). |
| `POSTGRES_USER` | Local user (e.g., `postgres`). |
| `POSTGRES_PASSWORD` | Local password. |

| Target (Prod) | How to obtain |
|---------------|---------------|
| `PROD_POSTGRES_HOST` | `kubectl -n mesh-pearl get deploy mesh-pearl -o yaml` |
| `PROD_POSTGRES_PORT` | From deployment (defaults to `5432`). |
| `PROD_POSTGRES_DB` | From deployment (e.g., `niaprod`). |
| `PROD_POSTGRES_USER` | From `mesh-pearl-secret`. |
| `PROD_POSTGRES_PASSWORD` | Base64-decode `POSTGRES_PASSWORD` in `mesh-pearl-secret`. |

Optionally set `MESH_ENDPOINT` and `MESH_SHARED_SECRET` if you want `createPlatformContentDefinitions()` to run against the live Mesh API; otherwise the script attempts it and logs a warning on failure.

## Usage

```bash
# Inspect prod deployment/secrets to populate env vars
kubectl -n mesh-pearl get deploy mesh-pearl -o yaml
kubectl -n mesh-pearl get secret mesh-pearl-secret -o yaml

# Export prod credentials (example values omitted)
export PROD_POSTGRES_HOST=...
export PROD_POSTGRES_PORT=5432
export PROD_POSTGRES_DB=niaprod
export PROD_POSTGRES_USER=postgres
export PROD_POSTGRES_PASSWORD='<secure>'

# Optional: point Prism at prod Mesh for definition refresh
export MESH_ENDPOINT=https://mesh.example.com/graphql
export MESH_SHARED_SECRET='<secure>'

# Always dry-run first to review commands
npm run pg:db-bootstrap-prod -- --dry-run

# Real run (prompts for confirmation)
npm run pg:db-bootstrap-prod
```

## Flags
- `--dry-run` – print the commands that would execute (no changes).
- `--skip-backup` – skip creating a production dump (not recommended).
- `--skip-definitions` – skip Prism definition refresh.
- `--force` – bypass interactive confirmations (use only in automation with extreme caution).

## Verification & Rollback
1. Verify row counts: `psql -h $PROD_POSTGRES_HOST ... -c "SELECT COUNT(*) FROM notion_blocks;"`.
2. Confirm key workflows in the production Mesh/API/UI.
3. Rollback (if needed): restore using the backup file path printed by the script (`psql < backup.sql>`).

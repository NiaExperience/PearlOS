# Migration Scripts

This directory contains scripts for migrating data between MongoDB and PostgreSQL in the NIA Universal application.

## Available Scripts

### `npm run pg:migrate`
Runs the main migration script that transfers data from MongoDB to PostgreSQL via the Prism data layer.

**Prerequisites:**
- MongoDB instance with legacy data
- PostgreSQL instance (via `npm run pg:db-start`)
- Environment variables configured in `.env.local`

**What it does:**
- Connects to both MongoDB and PostgreSQL
- Creates platform content definitions (User, Tool, Tenant)
- Creates legacy content definitions for each assistant
- Migrates users, tools, assistants, and feedback data
- Transforms ObjectIDs to UUIDs
- Validates data against JSON schemas

### `npm run pg:migrate:check-files`
Verifies that all required migration files are present and accessible.

**Files checked:**
- `apps/interface/src/migration/config/connect-DB.ts`
- `apps/interface/src/migration/models/assistant-feedback.model.ts`
- `apps/interface/src/migration/models/assistant.model.ts`
- `apps/interface/src/migration/models/user-model.ts`

## Migration Files Structure

```
apps/interface/src/migration/
├── config/
│   └── connect-DB.ts              # MongoDB connection configuration
├── models/
│   ├── assistant-feedback.model.ts # Assistant feedback schema
│   ├── assistant.model.ts          # Main assistant schema
│   ├── user-model.ts              # User schema with interactions
│   └── dish.model.ts              # Menu/dish schema
└── types/
    ├── assistant.types.ts         # TypeScript interfaces for assistants
    ├── tools.types.ts            # TypeScript interfaces for tools
    └── ...                       # Other type definitions
```

## Usage Examples

```bash
# Check that migration files exist
npm run pg:migrate:check-files

# Start PostgreSQL database
npm run pg:db-start-clear

# Run the full migration
npm run pg:migrate

# Stop the database when done
npm run pg:db-stop
```

## Environment Variables Required

The migration script requires these environment variables in `.env.local`:

```env
# MongoDB connection
DATABASE_URL=mongodb://your-mongo-connection-string

# PostgreSQL connection (handled by mesh server)
POSTGRES_CONNECTION_STRING=postgresql://your-postgres-connection

# Admin user credentials for seeding
NEXT_PUBLIC_DEFAULT_ADMIN_EMAIL=admin@example.com
NEXT_PUBLIC_DEFAULT_ADMIN_PASSWORD=your-admin-password
```

## Troubleshooting

### Missing Files Error
If you see import errors about missing migration files, run:
```bash
npm run pg:migrate:check-files
```
If files are missing, they may need to be restored from git history.

### TypeScript Compilation Errors
The migration script uses `ts-node` and may encounter compilation errors due to type mismatches in the broader codebase. These are generally non-blocking for the migration functionality.

### Database Connection Issues
Ensure both MongoDB and PostgreSQL are running and accessible with the configured connection strings.

## Related Scripts

- `scripts/check-mongo-food.ts` - Also uses the migration models for food/menu data
- `apps/dashboard/src/migration/models/` - Contains additional models used by the dashboard migration

## Notes

- The migration script processes all assistants by default
- Data is validated against JSON schemas before insertion
- Failed migrations are logged with detailed error information
- The script creates an admin user and default tool as part of the setup process

# Environment Configuration

This document outlines the environment setup for the Nia Universal GraphQL-native platform.

## Quick Setup

1. **Create Environment File**
   ```bash
   cp config/env.minimal.example .env.local
   ```

2. **Configure Variables**
   Edit `.env.local` with your database and service credentials.

3. **Start Services**
   ```bash
   npm run start:all
   ```

## Environment Variables

### GraphQL & Database
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` - Local PostgreSQL configuration
- `GRAPHQL_MESH_PORT` - GraphQL Mesh server port (default: 2000, 5001 in tests)

### Optional: AWS Database (for cloning staging/production data to a local instance)
- `AWS_POSTGRES_HOST`, `AWS_POSTGRES_PORT`, `AWS_POSTGRES_DB`, `AWS_POSTGRES_USER`, `AWS_POSTGRES_PASSWORD` (only if you use the clone scripts)

### Authentication & Services
- `NEXTAUTH_SECRET` - NextAuth.js secret for session encryption
- `NEXTAUTH_URL` - Base URL for authentication callbacks
- `VAPI_API_URL`, `VAPI_WEB_TOKEN` - VAPI service integration
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` - Twilio configuration
- `TOKEN_ENCRYPTION_KEY` - for encrypting/decrypting Account content

### Optional: AWS Services (disabled in minimal local setup)
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (only if you use AWS integrations)
- `AWS_S3_BUCKET_NAME` (only if you use S3-backed uploads)

## Application-Specific Loading

The centralized `.env.local` file is loaded by all applications:

- **Interface App** (`apps/interface`) - via `next.config.mjs`
- **Dashboard App** (`apps/dashboard`) - via `next.config.mjs`
- **Prism Package** (`packages/prism`) - via environment configuration
- **Test Suite** - via `jest.config.mjs` for all 104 tests

## Database Management

### Local Development Database

For local-only development (no AWS), run PostgreSQL and point Mesh at it:

```bash
# Example: run local Postgres via Docker
docker run -d --name nia-postgres -p 5432:5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=testdb postgres:15
```

Then start the apps:

```bash
npm run start:all
```

### Optional: AWS Clone Workflows

This repo includes scripts for cloning staging/production databases from AWS, but they are **not required** to run locally.

## GraphQL Mesh Configuration

The GraphQL Mesh server (`localhost:2000`, `localhost:5001` in tests) automatically:
- Connects to your configured PostgreSQL database
- Provides unified GraphQL endpoint for all data operations
- Supports multi-tenant queries with tenant isolation
- Enables complex filtering with JSONFilter syntax

## Verification

Verify your setup by running the test suite:

```bash
npm test
```

All 104 tests should pass, confirming:
- Database connectivity
- GraphQL Mesh integration
- Application functionality
- Multi-tenant operations
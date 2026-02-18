# Nia Mesh Server

A standalone GraphQL Mesh server for the Nia Universal platform. This server isolates the GraphQL Mesh integration from Next.js applications to avoid module resolution conflicts.

## Why a Standalone Server?

GraphQL Mesh's module resolution strategy is fundamentally incompatible with Next.js/TypeScript module resolution in server-side builds. This standalone server resolves these issues by:

1. Running in a clean Node.js environment
2. Avoiding TypeScript compilation conflicts
3. Providing a clean API boundary

## Features

- GraphQL endpoint with unified schema (running on port 2000 by default, 5001 for tests)
- PostgreSQL integration for content
- Custom resolvers and transforms for Notion data model
- Advanced selective caching with type-specific TTLs
- Compatible with existing Prism architecture

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm run start
```

## Architecture

### Components

1. **Express Server**: Hosts the GraphQL endpoint
2. **GraphQL Mesh**: Integrates data sources with a unified schema
3. **Custom Resolvers**: Implements the NotionModel transformations
4. **PostgreSQL Adapter**: Connects to the Postgres database

### Integration with Nia Universal

The Mesh server is designed to work with the Nia Universal platform. The `PrismDataBridgeClient` class connects to this server to execute GraphQL operations.

To run both the Mesh server and Next.js applications together, use the provided script:

```bash
# From the project root
./scripts/run-with-mesh.sh
```

## Docker Support

A Docker Compose configuration is provided for running the Mesh server alongside a PostgreSQL database:

```bash
# Start the stack
docker-compose up

# Run in detached mode
docker-compose up -d

# Stop the stack
docker-compose down
```

## API Documentation

The GraphQL playground is available at `http://localhost:2000/graphql` when running in development mode.

## Testing with In-Memory Database

For unit testing, the server supports an in-memory PostgreSQL database using `pg-mem`. This allows tests to run without requiring a real database connection:

```bash
# Run tests with in-memory database
NODE_ENV=test npm test
```

You can also force the use of an in-memory database via a header:

```javascript
// In your GraphQL client
const response = await fetch('http://localhost:2000/graphql', {
  headers: {
    'X-Use-In-Memory': 'true'
  },
  // ...other request options
});
```

For complete testing documentation:

- [In-Memory Database Guide](./docs/in-memory-database.md) - Details on the pg-mem implementation
- [Testing Guide](./README.testing.md) - Comprehensive testing guide with examples

## Custom Resolvers

The server includes custom resolvers for the NotionModel type:

- `parentData`: Fetches the parent record for a given block


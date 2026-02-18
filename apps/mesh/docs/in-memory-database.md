# In-Memory Database for GraphQL Testing

This document explains how to use the in-memory PostgreSQL database for testing the GraphQL server without needing a real database connection.

## Overview

The GraphQL server has been configured to support both real PostgreSQL connections and in-memory databases for testing. This allows for:

- Fast unit tests without external dependencies
- Reliable test execution in CI/CD pipelines
- Isolated test runs that don't affect real data

## How It Works

The system uses [pg-mem](https://github.com/oguimbal/pg-mem), a PostgreSQL emulator that runs entirely in-memory. It provides a compatible API with the real PostgreSQL database, allowing most operations to work seamlessly.

## Implementation

The in-memory database is implemented in the resolvers directory:

- `/apps/mesh/src/resolvers/database/in-memory.ts` - In-memory database implementation
- `/apps/mesh/src/resolvers/database/postgres.ts` - Real PostgreSQL database implementation
- `/apps/mesh/src/resolvers/db.ts` - Database connection logic that decides which to use

This structure keeps the database connection logic within the resolvers layer, making it easier to maintain and extend.

## Usage Options

### 1. Automatic Testing Mode

When `NODE_ENV=test`, the system automatically uses the in-memory database:

```bash
NODE_ENV=test npm test
```

### 2. Manual Override with Header

You can force the use of an in-memory database by setting the `X-Use-In-Memory: true` header in your GraphQL requests:

```javascript
const response = await fetch('http://localhost:5000/graphql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Use-In-Memory': 'true'
  },
  body: JSON.stringify({
    query: `
      query {
        notionModel {
          block_id
          page_id
          type
        }
      }
    `,
  }),
});
```

### 3. Direct Usage in Tests

For unit tests, you can use the test utilities:

```typescript
import { createTestServer, seedTestDatabase } from '../testing/test-utils';

describe('My GraphQL Test', () => {
  let testServer;
  
  beforeAll(async () => {
    testServer = await createTestServer();
  });
  
  afterAll(async () => {
    await testServer.cleanup();
  });
  
  beforeEach(async () => {
    await seedTestDatabase(testServer.sequelize);
  });
  
  it('should query data from in-memory database', async () => {
    // Your test here
  });
});
```

## Limitations

The in-memory database has a few limitations compared to a real PostgreSQL database:

1. Some advanced PostgreSQL features like certain GIN index operations may not work exactly the same
2. Performance characteristics will be different
3. Some complex queries might behave differently

## Best Practices

1. Use the in-memory database for unit tests focused on business logic
2. Use a real PostgreSQL database for integration tests that need exact PostgreSQL behavior
3. Keep test data minimal to improve performance
4. Create isolated tests that don't depend on previous test state

# Testing Guide for Mesh GraphQL Server

This guide explains how to write and run tests for the Mesh GraphQL server using the in-memory database feature.

## Overview

The Mesh GraphQL server includes an in-memory PostgreSQL database adapter powered by [pg-mem](https://github.com/oguimbal/pg-mem). This allows you to write and run tests without needing a real database connection, making tests faster and more reliable.

## Running Tests

To run tests with the in-memory database:

```bash
# Run all tests with in-memory database
NODE_ENV=test npm test

# Run a specific test file
NODE_ENV=test npx jest path/to/test-file.test.ts

# Run tests with coverage
NODE_ENV=test npm test -- --coverage
```

## Writing Tests

### Basic Test Structure

Here's a basic structure for writing tests using the in-memory database:

```typescript
import { createTestServer, seedTestDatabase, clearTestDatabase } from '../testing/test-utils';

describe('My GraphQL Feature', () => {
  let testServer;
  
  beforeAll(async () => {
    // Create test server with in-memory database
    testServer = await createTestServer();
  });
  
  afterAll(async () => {
    // Clean up resources
    await testServer.cleanup();
  });
  
  beforeEach(async () => {
    // Seed database with test data before each test
    await seedTestDatabase(testServer.sequelize);
  });
  
  afterEach(async () => {
    // Clear database after each test
    await clearTestDatabase(testServer.sequelize);
  });
  
  it('should query data successfully', async () => {
    // Your test here using testServer.yoga for GraphQL operations
    // or testServer.NotionModel for direct database access
  });
});
```

### Custom Seed Data

You can provide custom seed data to the `seedTestDatabase` function:

```typescript
beforeEach(async () => {
  await seedTestDatabase(testServer.sequelize, [
    {
      block_id: 'custom-id-1',
      page_id: 'page-1',
      type: 'custom-block',
      content: JSON.stringify({ title: 'Custom Block', body: 'Test content' }),
      indexer: { title: 'Custom Block' }
    },
    // Add more test records as needed
  ]);
});
```

### Testing GraphQL Queries

To test GraphQL queries against the in-memory database:

```typescript
it('should return specific data from a GraphQL query', async () => {
  // Directly execute a GraphQL query
  const response = await fetch('http://localhost:4000/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        query {
          notionModel {
            block_id
            page_id
            type
            content
          }
        }
      `,
    }),
  });

  const result = await response.json();
  expect(result.errors).toBeUndefined();
  expect(result.data.notionModel).toBeInstanceOf(Array);
});
```

### Testing Mutations

```typescript
it('should create data via GraphQL mutation', async () => {
  const response = await fetch('http://localhost:4000/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        mutation {
          createNotionModel(input: {
            page_id: "test-page-id",
            type: "test-type",
            content: { title: "Test Title", body: "Test Body" }
          }) {
            block_id
            type
            content
          }
        }
      `,
    }),
  });

  const result = await response.json();
  expect(result.errors).toBeUndefined();
  expect(result.data.createNotionModel.type).toBe("test-type");
  
  // Verify data was saved to database
  const savedRecord = await testServer.NotionModel.findOne({
    where: { type: 'test-type' }
  });
  expect(savedRecord).not.toBeNull();
});
```

### Direct Database Access

You can access the database directly for tests that need more specific setup or verification:

```typescript
it('should handle complex database operations', async () => {
  // Create test data directly
  const model = await testServer.NotionModel.create({
    page_id: 'direct-page-id',
    type: 'direct-type',
    content: JSON.stringify({ title: 'Direct Access', body: 'Test content' }),
    indexer: { title: 'Direct Access' }
  });
  
  // Verify data
  expect(model.block_id).toBeDefined();
  expect(model.type).toBe('direct-type');
  
  // Query with complex conditions
  const results = await testServer.NotionModel.findAll({
    where: {
      page_id: 'direct-page-id'
    }
  });
  expect(results.length).toBe(1);
});
```

## Best Practices

1. **Keep Tests Isolated**: Each test should be independent and not rely on state from other tests.

2. **Use Small, Focused Tests**: Test one feature or edge case per test for better readability and maintainability.

3. **Clean Up After Tests**: Make sure to clear test data between tests to avoid interference.

4. **Use the Testing Utilities**: The provided utilities handle setup and teardown for you.

5. **Mock External Dependencies**: For services that interact with external APIs, use mocking tools to isolate tests.

## Limitations

The in-memory database has a few limitations compared to a real PostgreSQL database:

1. Some advanced PostgreSQL features like certain GIN index operations may not work exactly the same.
2. Performance characteristics will differ from a real database.
3. Some complex queries might behave differently.

For integration tests that require exact PostgreSQL behavior, consider using a real database.

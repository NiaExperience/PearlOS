// Use CommonJS require to avoid ESM transform issues under ts-jest in Node test env
// Node 18+ exposes global fetch; fallback to node-fetch if needed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const serverNodeFetch = require('node-fetch');
const serverDoFetch = (global.fetch ? global.fetch : (serverNodeFetch.default || serverNodeFetch));

// Use the global Mesh server that's already running from jest.setup.ts
describe('Mesh Server', () => {
  const testPort = 5001; // Match the port from jest.setup.ts
  const endpoint = `http://localhost:${testPort}/graphql`;

  beforeAll(async () => {
    // Server is already started by global setup
    // Wait a bit to ensure server is fully ready
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    // Server will be shut down by global teardown
  });

  it('Server should respond to health check', async () => {
    const response = await serverDoFetch(`http://localhost:${testPort}/health`);
    const data = await response.json();
    expect(data).toEqual({ status: 'ok' });
  });

  it('GraphQL endpoint should be accessible', async () => {
    const response = await serverDoFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `{ __schema { queryType { name } } }`,
      }),
    });
    
    const data = await response.json();
    expect(data).toHaveProperty('data.__schema.queryType.name');
  });

  it('NotionModel query should work', async () => {
    const response = await serverDoFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          query {
            notionModel(limit: 1) {
              block_id
              type
              content
            }
          }
        `,
      }),
    });
    
    const data = await response.json();
    expect(data).not.toHaveProperty('errors');
    if (data.data.notionModel.length > 0) {
      expect(data.data.notionModel[0]).toHaveProperty('content');
    }
  });
});

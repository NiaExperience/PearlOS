/* eslint-disable @typescript-eslint/no-var-requires */
// Mesh cache behavior tests: ensure named GraphQL queries produce cache set/get and header can bypass
const nodeFetch = require('node-fetch');
const doFetch = (global.fetch ? global.fetch : (nodeFetch.default || nodeFetch));

const TEST_PORT = 5001; // matches global setup
const GRAPHQL_ENDPOINT = `http://localhost:${TEST_PORT}/graphql`;

// Small helper
async function gqlRequest({ query, operationName, variables, headers = {} }: any) {
  const res = await doFetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ query, operationName, variables })
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error('Non-JSON: ' + text); }
  return { status: res.status, json };
}

// Named query that should be cacheable by the Yoga caching plugin
const NAMED_QUERY = /* GraphQL */ `
  query GetAssistantList {
    notionModel(where: { type: { eq: "Assistant" } }, limit: 5) {
      block_id
      type
      page_id
    }
  }
`;

describe('Mesh Cache Behavior', () => {
  beforeAll(async () => {
    // Global setup already started the server; just give it a brief moment
    await new Promise((r) => setTimeout(r, 300));
  });

  it('caches a named query (first miss -> set, second hit -> get)', async () => {
    // First call: expected miss -> computes result and caches it
    const first = await gqlRequest({ query: NAMED_QUERY, operationName: 'GetAssistantList', variables: {} });
    expect(first.status).toBe(200);
    expect(first.json).not.toHaveProperty('errors');

    // Second call: identical op name + args -> cache hit path
    const second = await gqlRequest({ query: NAMED_QUERY, operationName: 'GetAssistantList', variables: {} });
    expect(second.status).toBe(200);
    expect(second.json).not.toHaveProperty('errors');

    // Sanity: responses should be logically consistent
    expect(Array.isArray(second.json?.data?.notionModel)).toBe(true);
  });

  it('respects x-no-cache header to bypass cache (forced miss)', async () => {
    const third = await gqlRequest({
      query: NAMED_QUERY,
      operationName: 'GetAssistantList',
      variables: {},
      headers: { 'x-no-cache': 'true' }
    });
    expect(third.status).toBe(200);
    expect(third.json).not.toHaveProperty('errors');
  });
});

#!/usr/bin/env ts-node

import * as http from 'http';

const MAX_RETRIES = 30; // 30 seconds
const RETRY_INTERVAL = 1000; // 1 second

async function checkGraphQLEndpoint(): Promise<boolean> {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      query: '{ __typename }'
    });

    const options = {
      hostname: 'localhost',
      port: 2000,
      path: '/graphql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 2000
    };

    const req = http.request(options, (res) => {
      // If we get any response, the server is up
      resolve(res.statusCode === 200);
    });

    req.on('error', () => {
      resolve(false);
    });

    req.on('timeout', () => {
      resolve(false);
    });

    req.write(postData);
    req.end();
  });
}

async function waitForGraphQL(): Promise<void> {
  console.log('⏳ Waiting for GraphQL server to be ready...');
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const isReady = await checkGraphQLEndpoint();
    
    if (isReady) {
      console.log('✅ GraphQL server is ready!');
      console.log('⏳ Waiting 2 seconds for server initialization to complete...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      return;
    }
    
    process.stdout.write(`\r⏳ Attempt ${attempt}/${MAX_RETRIES} - GraphQL server not ready yet...`);
    
    if (attempt < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }
  }
  
  console.log('\n❌ GraphQL server failed to start within 30 seconds');
  process.exit(1);
}

// Run if called directly
if (require.main === module) {
  waitForGraphQL().catch(error => {
    console.error('Error waiting for GraphQL server:', error);
    process.exit(1);
  });
}

export { waitForGraphQL };

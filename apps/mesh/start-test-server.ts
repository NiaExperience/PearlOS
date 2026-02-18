#!/usr/bin/env ts-node
/**
 * Start Mesh server for testing with explicit port
 * Usage: ts-node start-test-server.ts [port]
 */

import { startServer } from './src/server';

const port = process.argv[2] ? Number(process.argv[2]) : 5002;

console.log(`\n🚀 (start-test-server) Starting Mesh test server on port ${port}...`);
// console.log('\n📋 Environment Variables:');
// Object.entries(process.env)
//   .sort(([a], [b]) => a.localeCompare(b))
//   .forEach(([key, value]) => {
//     // Redact sensitive values
//     const isSensitive = /SECRET|PASSWORD|TOKEN|KEY/i.test(key);
//     console.log(`  ${key}=${isSensitive ? '<redacted>' : value}`);
//   });
// console.log();

startServer(port, true)
  .then(() => {
    console.log(`✅ Test server started successfully on port ${port}`);
  })
  .catch((error) => {
    console.error('Failed to start test server:', error);
    process.exit(1);
  });

// Keep the process running
process.on('SIGINT', () => {
  console.log('\nShutting down test server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down test server...');
  process.exit(0);
});

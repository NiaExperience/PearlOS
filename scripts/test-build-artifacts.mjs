#!/usr/bin/env node

/**
 * Minimal Build Artifact Verification Script
 * 
 * This script quickly verifies that all apps have the expected build artifacts
 * in the correct locations, which helps catch the deployment issues like the
 * "Cannot find module /app/dist/server.js" error.
 * 
 * Usage:
 *   npm run test:build-artifacts
 */

import { existsSync } from 'fs';
import { join } from 'path';

// Expected build artifacts for each app
const buildArtifacts = [
  {
    app: 'mesh',
    path: 'apps/mesh/dist/server.js',
    description: 'Mesh GraphQL server'
  },
  {
    app: 'interface',
    path: 'apps/interface/.next/BUILD_ID',
    description: 'Interface Next.js app'
  },
  {
    app: 'dashboard',
    path: 'apps/dashboard/.next/BUILD_ID',
    description: 'Dashboard Next.js app'
  }
];

function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const suffix = level === 'ERROR' ? '❌' : level === 'SUCCESS' ? '✅' : level === 'WARN' ? '⚠️' : 'ℹ️';
  console.log(`[${timestamp}] ${message} ${suffix}`);
}

function main() {
  log('🔍 Verifying Build Artifacts for Deployment');
  console.log('='.repeat(50));
  
  let allGood = true;
  
  for (const artifact of buildArtifacts) {
    const fullPath = join(process.cwd(), artifact.path);
    const exists = existsSync(fullPath);
    
    if (exists) {
      log(`✅ ${artifact.app}: ${artifact.path}`, 'SUCCESS');
    } else {
      log(`❌ ${artifact.app}: Missing ${artifact.path}`, 'ERROR');
      allGood = false;
    }
  }
  
  console.log('\n' + '='.repeat(50));
  
  if (allGood) {
    log('🎉 All build artifacts present! Apps should deploy successfully.', 'SUCCESS');
    console.log('\n💡 To run a full deployment test: npm run test:build-deployment');
  } else {
    log('⚠️ Missing build artifacts detected!', 'WARN');
    console.log('\n🔧 To fix:');
    console.log('  1. Run: npm run build');
    console.log('  2. Or build individual apps: npm run build -w <workspace-name>');
    console.log('  3. Then re-run this check: npm run test:build-artifacts');
    process.exit(1);
  }
}

main();

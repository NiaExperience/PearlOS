#!/usr/bin/env node

/**
 * Multi-App Health Check Smoke Tests
 * 
 * This script tests the health endpoints across all Nia Universal applications:
 * - Interface (Next.js on port 3000)
 * - Dashboard (Next.js on port 4000) 
 * - Mesh (Express/GraphQL on port 2000)
 * - Pipecat Daily Bot (FastAPI on port 7860)
 * 
 * It can test against running local instances or Docker containers.
 * 
 * Usage:
 *   npm run test:apps:health                 # Test against local instances
 *   npm run test:apps:health:docker          # Build and test Docker containers
 *   npm run test:apps:health -- --app=interface  # Test specific app only
 *   npm run test:apps:health:docker -- --reuse-images  # Use existing CI images
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const APP_CONFIGS = {
  interface: {
    name: 'Interface',
    baseUrl: 'http://localhost:3000',
    dockerPort: 3000,
    containerPort: 3000, // Interface runs on port 3000 inside container
    dockerImage: 'nia-interface:health-test',
    dockerFile: 'apps/interface/Dockerfile',
    healthChecks: [
      {
        name: 'Basic Health Check',
        path: '/health',
        expectedStatus: 200,
        expectedFields: ['status', 'timestamp', 'service'],
        expectedValues: { status: 'healthy', service: 'interface' }
      },
      {
        name: 'Deep Health Check',
        path: '/health/deep', 
        expectedStatus: [200, 503], // 503 acceptable if dependencies are down
        expectedFields: ['status', 'timestamp', 'service', 'checks'],
        expectedValues: { service: 'interface' }
      }
    ]
  },
  dashboard: {
    name: 'Dashboard',
    baseUrl: 'http://localhost:4001',
    dockerPort: 4001,
    containerPort: 4000, // Dashboard runs on port 4000 inside container
    dockerImage: 'nia-dashboard:health-test',
    dockerFile: 'apps/dashboard/Dockerfile',
    healthChecks: [
      {
        name: 'Basic Health Check',
        path: '/health',
        expectedStatus: 200,
        expectedFields: ['status', 'timestamp', 'service'],
        expectedValues: { status: 'healthy', service: 'dashboard' }
      },
      {
        name: 'Deep Health Check',
        path: '/health/deep',
        expectedStatus: [200, 503],
        expectedFields: ['status', 'timestamp', 'service', 'checks'],
        expectedValues: { service: 'dashboard' }
      }
    ]
  },
  mesh: {
    name: 'Mesh',
    baseUrl: 'http://localhost:2000',
    dockerPort: 2000,
    dockerImage: 'nia-mesh:health-test',
    dockerFile: 'apps/mesh/Dockerfile',
    healthChecks: [
      {
        name: 'Basic Health Check',
        path: '/health',
        expectedStatus: 200,
        expectedFields: ['status'],
        expectedValues: { status: 'ok' }
      }
    ]
  },
  'pipecat-daily-bot': {
    name: 'Pipecat Daily Bot',
    baseUrl: 'http://localhost:4444',
    dockerPort: 4444,
    containerPort: 4444, // Server mode (default) runs on port 4444
    dockerImage: 'pipecat-daily-bot:health-test',
    dockerFile: 'apps/pipecat-daily-bot/Dockerfile',
    healthChecks: [
      {
        name: 'Basic Health Check',
        path: '/health',
        expectedStatus: 200,
        expectedFields: ['status'],
        expectedValues: {}
      }
    ]
  }
};

const args = process.argv.slice(2);
const testDocker = args.includes('--docker');
const reuseImages = args.includes('--reuse-images');
const specificApp = args.find(arg => arg.startsWith('--app='))?.split('=')[1];
const baseUrl = args.find(arg => arg.startsWith('--url='))?.split('=')[1];
const verbose = args.includes('--verbose');

// Determine which apps to test
const appsToTest = specificApp 
  ? (APP_CONFIGS[specificApp] ? [specificApp] : [])
  : Object.keys(APP_CONFIGS);

// Get the appropriate Docker image name
function getDockerImage(appKey) {
  if (reuseImages) {
    // Use CI image names that match what's built in CI workflow
    const ciImageMap = {
      'interface': 'nia-interface:ci',
      'dashboard': 'nia-dashboard:ci', 
      'mesh': 'nia-mesh:ci',
      'pipecat-daily-bot': 'pipecat-daily-bot:ci'
    };
    return ciImageMap[appKey] || APP_CONFIGS[appKey].dockerImage;
  }
  return APP_CONFIGS[appKey].dockerImage;
}

function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const prefix = level === 'ERROR' ? '❌' : level === 'SUCCESS' ? '✅' : level === 'WARN' ? '⚠️' : 'ℹ️';
  // eslint-disable-next-line no-console
  console.log(`[${timestamp}] ${prefix} ${message}`);
}

function logVerbose(message) {
  if (verbose) {
    log(message, 'DEBUG');
  }
}

async function runCommand(command, options = {}) {
  logVerbose(`Running: ${command}`);
  try {
    const { stdout, stderr } = await execAsync(command, options);
    if (stderr && verbose) {
      logVerbose(`stderr: ${stderr}`);
    }
    return stdout.trim();
  } catch (error) {
    throw new Error(`Command failed: ${command} - ${error.message}`);
  }
}

async function waitForService(url, maxAttempts = 30, interval = 1000) {
  log(`⏳ Waiting for service at ${url}...`);
  
  // Reduce attempts in CI environments for faster failure
  if (process.env.CI === 'true') {
    maxAttempts = Math.min(maxAttempts, 10); // Max 10 seconds in CI for faster feedback
    log(`⚡ CI environment detected, reducing timeout to ${maxAttempts} seconds`);
  }
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, { 
        method: 'GET',
        timeout: 5000  // 5 second timeout per request
      });
      if (response.status < 500) {
        log(`✅ Service is responding at ${url}`, 'SUCCESS');
        return true;
      }
      log(`⚠️ Service responded with status ${response.status}, retrying...`, 'WARN');
    } catch (error) {
      logVerbose(`Attempt ${attempt}/${maxAttempts}: ${error.message}`);
      
      // In CI, provide more verbose error info
      if (process.env.CI === 'true') {
        log(`🔍 CI Debug - Attempt ${attempt}: ${error.message}`, 'WARN');
      }
    }
    
    if (attempt < maxAttempts) {
      process.stdout.write(`${attempt}s `);
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }
  
  const errorMsg = `❌ Service did not become available at ${url} after ${maxAttempts} attempts (${maxAttempts} seconds)`;
  log(errorMsg, 'ERROR');
  
  // In CI, force immediate failure
  if (process.env.CI === 'true') {
    log(`💥 CI FAILURE: Health check timeout - exiting immediately`, 'ERROR');
    process.exit(1);
  }
  
  throw new Error(errorMsg);
}

async function testHealthEndpoint(baseUrl, healthCheck, timeout = 5000) {
  const url = `${baseUrl}${healthCheck.path}`;
  
  try {
    log(`🩺 Testing: ${healthCheck.name}`);
    logVerbose(`URL: ${url}`);
    
    // Make the request
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'app-health-test/1.0'
      }
    });
    
    clearTimeout(timeoutId);
    
    // Check status code
    const expectedStatuses = Array.isArray(healthCheck.expectedStatus) 
      ? healthCheck.expectedStatus 
      : [healthCheck.expectedStatus];
    
    if (!expectedStatuses.includes(response.status)) {
      throw new Error(`Unexpected status ${response.status}, expected ${expectedStatuses.join(' or ')}`);
    }
    
    logVerbose(`Status: ${response.status} ✓`);
    
    // Parse and validate response
    const responseText = await response.text();
    let responseData;
    
    try {
      responseData = JSON.parse(responseText);
      logVerbose(`Response: ${JSON.stringify(responseData, null, 2)}`);
    } catch (e) {
      throw new Error(`Response is not valid JSON: ${responseText.substring(0, 100)}...`);
    }
    
    // Check required fields
    for (const field of healthCheck.expectedFields) {
      if (!(field in responseData)) {
        throw new Error(`Missing required field: ${field}`);
      }
      logVerbose(`Field "${field}": present ✓`);
    }
    
    // Check expected values
    for (const [key, expectedValue] of Object.entries(healthCheck.expectedValues)) {
      if (responseData[key] !== expectedValue) {
        throw new Error(`Field "${key}" has value "${responseData[key]}", expected "${expectedValue}"`);
      }
      logVerbose(`Field "${key}": ${responseData[key]} ✓`);
    }
    
    // Additional validations based on the endpoint
    if (healthCheck.path === '/health/deep' && responseData.checks) {
      logVerbose(`Dependency checks: ${JSON.stringify(responseData.checks)}`);
    }
    
    log(`✅ ${healthCheck.name} passed`, 'SUCCESS');
    return { success: true, status: response.status, data: responseData };
    
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    throw error;
  }
}

async function buildAndTestDocker() {
  if (reuseImages) {
    log('🐳 Using existing Docker images for testing...');
  } else {
    log('🐳 Building Docker containers for testing...');
  }
  
  const activeContainers = [];
  
  try {
    // Build and start containers for each app
    for (const appKey of appsToTest) {
      const appConfig = APP_CONFIGS[appKey];
      const containerName = `${appKey}-health-test-${Date.now()}`;
      const dockerImage = getDockerImage(appKey);
      
      if (!reuseImages) {
        log(`📦 Building Docker image for ${appConfig.name}...`);
        await runCommand(`docker build -f ${appConfig.dockerFile} -t ${appConfig.dockerImage} .`);
      } else {
        log(`📦 Using existing Docker image: ${dockerImage}`);
      }
      
      log(`🚀 Starting ${appConfig.name} container...`);
      const containerPort = appConfig.containerPort || appConfig.baseUrl.split(':')[2];
      
      // Build environment variables for container
      let envVars = '';
      if (appKey === 'pipecat-daily-bot') {
        // Pipecat bot needs CI_SKIP_PREFETCH to avoid DB connection requirements
        envVars = '-e CI_SKIP_PREFETCH=true -e MODE=gateway -e PORT=4444';
      }
      
      await runCommand(`docker run -d --name ${containerName} -p ${appConfig.dockerPort}:${containerPort} ${envVars} ${dockerImage}`);
      
      // Verify container is running
      try {
        const containerStatus = await runCommand(`docker ps --filter name=${containerName} --format "{{.Status}}"`);
        log(`📊 Container ${containerName} status: ${containerStatus.trim()}`);
        
        // Show container logs for debugging
        const logs = await runCommand(`docker logs ${containerName}`);
        if (logs.trim()) {
          log(`📝 Container logs:\n${logs.trim()}`);
        }
      } catch (e) {
        log(`⚠️ Could not get container status: ${e.message}`, 'WARN');
      }
      
      activeContainers.push({ appKey, containerName, port: appConfig.dockerPort });
      
      // Wait for container to be ready
      const dockerUrl = `http://localhost:${appConfig.dockerPort}`;
      const healthPath = appConfig.healthChecks[0].path;
      
      // In CI environment, add immediate container health check
      if (process.env.CI === 'true') {
        log(`🔍 CI Debug: Checking container health immediately...`);
        try {
          // Wait a moment for container to initialize
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Check if container is still running
          const containerCheck = await runCommand(`docker ps --filter name=${containerName} --format "{{.Status}}"`);
          log(`🔍 Container status after 2s: ${containerCheck.trim()}`);
          
          // Get fresh logs
          const freshLogs = await runCommand(`docker logs ${containerName}`);
          log(`🔍 Container logs after 2s:\n${freshLogs.trim()}`);
          
          // Try immediate curl test
          try {
            const testResponse = await fetch(`${dockerUrl}${healthPath}`, { 
              method: 'GET',
              timeout: 3000 
            });
            log(`🔍 Immediate curl test: ${testResponse.status}`);
          } catch (e) {
            log(`🔍 Immediate curl test failed: ${e.message}`);
          }
        } catch (e) {
          log(`🔍 CI debug failed: ${e.message}`, 'WARN');
        }
      }
      
      try {
        await waitForService(`${dockerUrl}${healthPath}`);
        log(`✅ ${appConfig.name} container is ready and responding`);
      } catch (error) {
        // Log container details before failing
        log(`💥 Health check failed for ${appConfig.name}. Diagnosing...`, 'ERROR');
        try {
          const containerLogs = await runCommand(`docker logs ${containerName}`);
          log(`📋 Final container logs:\n${containerLogs}`);
          
          // Also check if container is still running
          const stillRunning = await runCommand(`docker ps --filter name=${containerName} --format "{{.Status}}"`);
          log(`📋 Container status at failure: ${stillRunning.trim()}`);
        } catch (e) {
          log(`Could not retrieve logs: ${e.message}`, 'ERROR');
        }
        throw error;
      }
    }
    
    // Run tests against all containers
    const allResults = {};
    for (const { appKey, port } of activeContainers) {
      const dockerUrl = `http://localhost:${port}`;
      allResults[appKey] = await runHealthTests(appKey, dockerUrl);
    }
    
    return allResults;
    
  } finally {
    // Cleanup all containers
    for (const { containerName } of activeContainers) {
      try {
        log(`🧹 Cleaning up container ${containerName}...`);
        await runCommand(`docker rm -f ${containerName}`);
      } catch (e) {
        log(`Warning: Failed to cleanup container: ${e.message}`, 'WARN');
      }
    }
  }
}

async function runHealthTests(appKey, baseUrl) {
  const appConfig = APP_CONFIGS[appKey];
  log(`🏥 Running health check tests for ${appConfig.name} at ${baseUrl}...`);
  
  const results = [];
  
  for (const healthCheck of appConfig.healthChecks) {
    try {
      const result = await testHealthEndpoint(baseUrl, healthCheck);
      results.push({ ...result, name: healthCheck.name });
    } catch (error) {
      log(`❌ ${healthCheck.name} failed: ${error.message}`, 'ERROR');
      results.push({ success: false, name: healthCheck.name, error: error.message });
    }
  }
  
  return results;
}

async function main() {
  log('🩺 Multi-App Health Check Smoke Tests');
  
  if (appsToTest.length === 0) {
    log('❌ No valid apps specified', 'ERROR');
    log('Available apps: ' + Object.keys(APP_CONFIGS).join(', '));
    process.exit(1);
  }
  
  log(`📱 Testing apps: ${appsToTest.map(app => APP_CONFIGS[app].name).join(', ')}`);
  
  if (testDocker) {
    log('🐳 Docker testing mode enabled');
  } else {
    if (baseUrl) {
      log(`🌐 Testing against custom URL: ${baseUrl}`);
    } else {
      log('🌐 Testing against default local URLs');
    }
  }
  
  try {
    let allResults;
    
    if (testDocker) {
      allResults = await buildAndTestDocker();
    } else {
      allResults = {};
      
      for (const appKey of appsToTest) {
        const appConfig = APP_CONFIGS[appKey];
        const testUrl = baseUrl || appConfig.baseUrl;
        
        // Wait for service to be available
        const healthPath = appConfig.healthChecks[0].path;
        await waitForService(`${testUrl}${healthPath}`);
        
        allResults[appKey] = await runHealthTests(appKey, testUrl);
      }
    }
    
    // Summary
    let totalPassed = 0;
    let totalTests = 0;
    
    log(`\n📊 Test Summary:`);
    
    for (const [appKey, results] of Object.entries(allResults)) {
      const appConfig = APP_CONFIGS[appKey];
      const passed = results.filter(r => r.success).length;
      const total = results.length;
      
      totalPassed += passed;
      totalTests += total;
      
      log(`  ${appConfig.name}: ✅ ${passed}/${total} passed`);
      
      if (passed !== total) {
        const failed = results.filter(r => !r.success);
        for (const failure of failed) {
          log(`    ❌ ${failure.name}: ${failure.error}`, 'ERROR');
        }
      }
    }
    
    log(`\n🎯 Overall: ✅ ${totalPassed}/${totalTests} tests passed`);
    
    if (totalPassed === totalTests) {
      log('🎉 All health check tests passed!', 'SUCCESS');
      process.exit(0);
    } else {
      log(`❌ ${totalTests - totalPassed} test(s) failed`, 'ERROR');
      process.exit(1);
    }
    
  } catch (error) {
    log(`💥 Test suite failed: ${error.message}`, 'ERROR');
    log(`📍 Error stack: ${error.stack}`, 'ERROR');
    
    // Ensure we exit with proper error code
    process.exitCode = 1;
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  log(`Uncaught exception: ${error.message}`, 'ERROR');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log(`Unhandled rejection: ${reason}`, 'ERROR');
  process.exit(1);
});

main().catch((error) => {
  log(`Test failed: ${error.message}`, 'ERROR');
  process.exit(1);
});
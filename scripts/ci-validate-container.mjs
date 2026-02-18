#!/usr/bin/env node

/**
 * Fast CI Container Validation
 * 
 * This script quickly validates that Docker containers can start without crashing.
 * It's optimized for CI environments where we just need to verify the basic
 * deployment structure is correct (no missing files, basic startup & health checks).
 * 
 * Usage:
 *   node scripts/ci-validate-container.mjs [app-name]
 */

import { spawn } from 'child_process';

const apps = {
  mesh: {
    name: 'mesh',
    image: 'nia-mesh:ci',
    port: 2000,
    timeout: 10000,
    expectedInLogs: ['server running', 'prism mesh server', '🚀', 'loaded platform schema', 'cache modules loaded'],
    env: { 
      NODE_ENV: 'production', 
      PORT: '2000',
      MESH_ENDPOINT: 'http://localhost:2000/graphql'
    },
    healthChecks: [
      {
        path: '/health',
        expectedStatus: 200,
        timeout: 5000
      }
    ]
  },
  interface: {
    name: 'interface', 
    image: 'nia-interface:ci',
    port: 3000,
    timeout: 15000, // Increased timeout for Next.js startup
    expectedInLogs: ['ready', 'started', 'listening', 'next'],
    env: { 
      NODE_ENV: 'production', 
      PORT: '3000',
      NEXTAUTH_URL: 'http://localhost:3000',
      NEXTAUTH_SECRET: 'ci-test-secret-interface'
    },
    healthChecks: [
      {
        path: '/health',
        expectedStatus: 200,
        expectedBody: { status: 'healthy' },
        timeout: 5000
      },
      {
        path: '/health/deep', 
        expectedStatus: [200, 503], // Allow 503 if mesh is down in CI
        timeout: 5000
      }
    ]
  },
  dashboard: {
    name: 'dashboard',
    image: 'nia-dashboard:ci', 
    port: 4000,
    timeout: 10000,
    expectedInLogs: ['ready', 'started', 'listening', 'next'],
    env: { 
      NODE_ENV: 'production', 
      PORT: '4000',
      NEXTAUTH_URL: 'http://localhost:4000',
      NEXTAUTH_SECRET: 'ci-test-secret-dashboard'
    },
    healthChecks: [
      {
        path: '/health',
        expectedStatus: 200,
        expectedBody: { status: 'healthy' },
        timeout: 5000
      },
      {
        path: '/health/deep', 
        expectedStatus: [200, 503], // Allow 503 if mesh is down in CI
        timeout: 5000
      }
    ]
  },
  'pipecat-daily-bot': {
    name: 'pipecat-daily-bot',
    image: 'nia-pipecat-daily-bot:ci',
    port: 4444,
    timeout: 15000, // Python FastAPI startup can be slower
    expectedInLogs: ['uvicorn', 'fastapi', 'server', 'started', 'listening'],
    env: { 
      MODE: 'gateway', 
      PORT: '4444',
      CI_SKIP_PREFETCH: 'true' // Skip DB pre-fetch for CI validation
    },
    healthChecks: [
      {
        path: '/health',
        expectedStatus: 200,
        timeout: 5000
      }
    ]
  },
  'kokoro-tts': {
    name: 'kokoro-tts',
    image: 'kokoro-tts:ci',
    port: 8000,
    timeout: 20000,
    expectedInLogs: ['application startup complete', 'uvicorn'],
    env: {
      KOKORO_MODEL_PATH: '/app/assets/kokoro-v1.0.onnx',
      KOKORO_VOICES_PATH: '/app/assets/voices-v1.0.bin',
      API_KEYS: 'ci-test-key',
      SERVER_HOST: '0.0.0.0',
      SERVER_PORT: '8000',
      LOG_LEVEL: 'info'
    },
    healthChecks: [
      {
        path: '/healthz',
        expectedStatus: 200,
        expectedBody: { status: 'ok' },
        timeout: 7000
      }
    ]
  }
};

const targetApp = process.argv[2] || 'all';

function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const prefix = level === 'ERROR' ? '❌' : level === 'SUCCESS' ? '✅' : level === 'DEBUG' ? '🔍' : 'ℹ️';
  // eslint-disable-next-line no-console
  console.log(`[${timestamp}] ${prefix} ${message}`);
}

async function runCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', command], { stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => stdout += data.toString());
    child.stderr.on('data', (data) => stderr += data.toString());
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed (${code}): ${stderr || stdout}`));
      }
    });
  });
}

async function checkHealthEndpoint(containerName, config, healthCheck) {
  const url = `http://localhost:${config.port}${healthCheck.path}`;
  
  try {
    log(`🩺 Checking health endpoint: ${healthCheck.path}`);
    
    // Use curl inside container network or external port
    const curlCommand = `curl -f -s --max-time ${healthCheck.timeout/1000} "${url}" || echo "CURL_FAILED"`;
    log(`🔍 Debug: Running curl command: ${curlCommand}`, 'DEBUG');
    const { stdout } = await runCommand(curlCommand);
    log(`🔍 Debug: Curl stdout: "${stdout}"`, 'DEBUG');
    
    if (stdout.includes('CURL_FAILED')) {
      // Try a simple connectivity test
      const testCommand = `curl -s --max-time 2 -I "${url}" || echo "CONNECTION_FAILED"`;
      const { stdout: testResult } = await runCommand(testCommand);
      log(`🔍 Debug: Connection test result: "${testResult}"`, 'DEBUG');
      throw new Error(`Health check failed - endpoint not reachable: ${url}`);
    }
    
    // Check status code if curl succeeded
    const statusCommand = `curl -s -o /dev/null -w "%{http_code}" --max-time ${healthCheck.timeout/1000} "${url}"`;
    const { stdout: statusCode } = await runCommand(statusCommand);
    const status = parseInt(statusCode.trim());
    
    // Check if status is expected
    const expectedStatuses = Array.isArray(healthCheck.expectedStatus) 
      ? healthCheck.expectedStatus 
      : [healthCheck.expectedStatus];
    
    if (!expectedStatuses.includes(status)) {
      throw new Error(`Health check failed - unexpected status ${status}, expected ${expectedStatuses.join(' or ')}`);
    }
    
    // Check response body if specified
    if (healthCheck.expectedBody) {
      try {
        const response = JSON.parse(stdout);
        for (const [key, value] of Object.entries(healthCheck.expectedBody)) {
          if (response[key] !== value) {
            throw new Error(`Health check failed - expected ${key}="${value}", got "${response[key]}"`);
          }
        }
      } catch (e) {
        if (e instanceof SyntaxError) {
          log(`⚠️ Could not parse health response as JSON, but status check passed`, 'WARN');
        } else {
          throw e;
        }
      }
    }
    
    log(`✅ Health check passed: ${healthCheck.path} (${status})`, 'SUCCESS');
    return true;
    
  } catch (error) {
    log(`❌ Health check failed: ${healthCheck.path} - ${error.message}`, 'ERROR');
    throw error;
  }
}

async function validateContainer(app) {
  const config = apps[app];
  log(`🐳 Validating ${config.name} container...`);
  
  const containerName = `ci-validate-${config.name}-${Date.now()}`;
  const envArgs = Object.entries(config.env)
    .map(([k, v]) => `-e ${k}="${v}"`)
    .join(' ');
  
  try {
    // Start container with port mapping
    await runCommand(`docker run -d --name ${containerName} -p ${config.port}:${config.port} ${envArgs} ${config.image}`);
    
    // Wait a bit for startup
    await new Promise(resolve => setTimeout(resolve, config.timeout));
    
    // Check if container is still running (didn't crash immediately)
    const { stdout: status } = await runCommand(`docker ps --filter name=${containerName} --format "{{.Status}}"`);
    
    if (!status.includes('Up')) {
      throw new Error('Container is not running (likely crashed on startup)');
    }
    
    // Get logs and check for startup indicators
    const { stdout: logs } = await runCommand(`docker logs ${containerName}`);
    
    // Look for any critical startup errors (focus on module/build issues)
    const criticalErrors = [
      'module_not_found',
      'cannot find module',
      'enoent', 
      'no such file or directory',
      'error loading module',
      'syntaxerror',
      'referenceerror'
    ];
    
    const hasCriticalError = criticalErrors.some(error => 
      logs.toLowerCase().includes(error)
    );
    
    // Ignore database connection errors as they're expected in CI
    const hasIgnorableDbError = logs.toLowerCase().includes('unable to connect to the database') ||
                               logs.toLowerCase().includes('connection refused') ||
                               logs.toLowerCase().includes('econnrefused');
    
    if (hasCriticalError && !hasIgnorableDbError) {
      throw new Error(`Critical startup error detected in logs: ${logs.substring(0, 200)}...`);
    }
    
    // Check for expected startup indicators (optional - warn if missing)
    const hasExpectedLogs = config.expectedInLogs.some(expected => 
      logs.toLowerCase().includes(expected.toLowerCase())
    );
    
    if (!hasExpectedLogs) {
      log(`⚠️ No expected startup indicators found, but container is running`, 'WARN');
    }
    
    // Run health checks if configured
    if (config.healthChecks && config.healthChecks.length > 0) {
      log(`🩺 Running health checks for ${config.name}...`);
      
      for (const healthCheck of config.healthChecks) {
        await checkHealthEndpoint(containerName, config, healthCheck);
      }
      
      log(`✅ All health checks passed for ${config.name}`, 'SUCCESS');
    }
    
    log(`✅ ${config.name} container validation passed`, 'SUCCESS');
    return true;
    
  } catch (error) {
    log(`❌ ${config.name} validation failed: ${error.message}`, 'ERROR');
    
    // Try to get logs for debugging
    try {
      const { stdout: logs } = await runCommand(`docker logs ${containerName}`);
      // eslint-disable-next-line no-console
      console.log(`\nContainer logs for debugging:\n${logs}\n`);
    } catch (e) {
      log(`Could not retrieve logs: ${e.message}`, 'ERROR');
    }
    
    throw error;
  } finally {
    // Cleanup
    try {
      await runCommand(`docker rm -f ${containerName}`);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

async function main() {
  log('🚀 Fast CI Container Validation');
  
  const appsToTest = targetApp === 'all' ? Object.keys(apps) : [targetApp];
  
  if (!appsToTest.every(app => apps[app])) {
    log(`❌ Invalid app. Available: ${Object.keys(apps).join(', ')}`, 'ERROR');
    process.exit(1);
  }
  
  let allPassed = true;
  const results = [];
  
  for (const app of appsToTest) {
    try {
      await validateContainer(app);
      results.push({ app, success: true });
    } catch (error) {
      allPassed = false;
      log(`💥 ${app} validation failed`, 'ERROR');
      results.push({ app, success: false, error: error.message });
    }
  }
  
  // Generate JSON report for CI
  const report = {
    timestamp: new Date().toISOString(),
    environment: 'CI',
    totalTests: results.length,
    passed: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results: results
  };
  
  // Write report file for CI artifact upload
  try {
    const { writeFileSync } = await import('fs');
    writeFileSync('deployment-validation-report.json', JSON.stringify(report, null, 2));
    log(`📄 Report saved to deployment-validation-report.json`);
  } catch (error) {
    log(`⚠️ Failed to write report file: ${error.message}`, 'WARN');
  }
  
  if (allPassed) {
    log('🎉 All container validations passed!', 'SUCCESS');
  } else {
    log('❌ Some container validations failed', 'ERROR');
    process.exit(1);
  }
}

main().catch(error => {
  log(`💥 Validation failed: ${error.message}`, 'ERROR');
  process.exit(1);
});

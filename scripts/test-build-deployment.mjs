#!/usr/bin/env node

/**
 * Build Deployment Test Script
 * 
 * This script verifies that all apps can be built and started successfully,
 * helping catch deployment issues early in the development process.
 * 
 * Usage:
 *   npm run test:build-deployment           # Test built apps only
 *   npm run test:build-deployment -- --docker  # Test Docker builds too
 *   npm run test:build-deployment -- --quick   # Skip lengthy builds, test existing
 */

import { spawn, exec } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Configuration for each app
const apps = [
  {
    name: 'mesh',
    workspace: '@nia/mesh-server',
    dir: 'apps/mesh',
    buildScript: 'build',
    startScript: 'start',
    startFile: 'dist/server.js',
    port: 2000,
    healthCheck: 'http://localhost:2000/graphql',
    startupTime: 8000, // ms to wait for startup
    dockerImage: 'nia-mesh:local',
    dockerFile: 'apps/mesh/Dockerfile'
  },
  {
    name: 'interface',
    workspace: 'interface',
    dir: 'apps/interface',
    buildScript: 'build',
    startScript: 'start',
    startFile: '.next/BUILD_ID', // Next.js build indicator
    port: 3000,
    healthCheck: 'http://localhost:3000',
    startupTime: 6000,
    dockerImage: 'nia-interface:local',
    dockerFile: 'apps/interface/Dockerfile'
  },
  {
    name: 'dashboard',
    workspace: 'dashboard', 
    dir: 'apps/dashboard',
    buildScript: 'build',
    startScript: 'start',
    startFile: '.next/BUILD_ID', // Next.js build indicator
    port: 4000,
    healthCheck: 'http://localhost:4000',
    startupTime: 6000,
    dockerImage: 'nia-dashboard:local',
    dockerFile: 'apps/dashboard/Dockerfile'
  }
];

// Test results tracking
const results = {
  builds: {},
  starts: {},
  docker: {},
  overall: 'PASS'
};

// CLI arguments
const args = process.argv.slice(2);
const testDocker = args.includes('--docker');
const quickTest = args.includes('--quick');
const verbose = args.includes('--verbose');

// Utility functions
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const suffix = level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : level === 'SUCCESS' ? '✅' : 'ℹ️';
  console.log(`[${timestamp}] ${message} ${suffix}`);
}

function logVerbose(message) {
  if (verbose) {
    log(message, 'DEBUG');
  }
}

async function runCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    logVerbose(`Running: ${command}`);
    
    const child = spawn('bash', ['-c', command], {
      stdio: verbose ? 'inherit' : 'pipe',
      ...options
    });

    let stdout = '';
    let stderr = '';

    if (!verbose) {
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
    }

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
      }
    });
  });
}

async function checkBuildArtifacts(app) {
  const artifactPath = join(app.dir, app.startFile);
  if (!existsSync(artifactPath)) {
    throw new Error(`Build artifact not found: ${artifactPath}`);
  }
  log(`✓ Build artifact exists: ${artifactPath}`);
}

async function testAppStart(app) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    
    log(`Starting ${app.name} on port ${app.port}...`);
    
    const child = spawn('npm', ['run', app.startScript], {
      cwd: app.dir,
      stdio: 'pipe',
      env: { ...process.env, PORT: app.port.toString() }
    });

    let stdout = '';
    let stderr = '';
    let startupSuccess = false;

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      logVerbose(`${app.name} stdout: ${data}`);
      
      // Look for success indicators
      if (stdout.includes('ready') || 
          stdout.includes('listening') || 
          stdout.includes('running') ||
          stdout.includes('started') ||
          stdout.includes(`localhost:${app.port}`)) {
        startupSuccess = true;
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      logVerbose(`${app.name} stderr: ${data}`);
      
      // Check for critical errors
      if (data.toString().includes('Error:') || 
          data.toString().includes('MODULE_NOT_FOUND') ||
          data.toString().includes('EADDRINUSE')) {
        if (!resolved) {
          resolved = true;
          child.kill();
          reject(new Error(`${app.name} startup failed: ${data}`));
        }
      }
    });

    child.on('error', (error) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`${app.name} process error: ${error.message}`));
      }
    });

    // Wait for startup time, then check if it started successfully
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill();
        
        if (startupSuccess) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`${app.name} failed to show startup success indicators within ${app.startupTime}ms`));
        }
      }
    }, app.startupTime);
  });
}

async function buildApp(app) {
  try {
    if (quickTest) {
      log(`⏭️ Skipping build for ${app.name} (quick test mode)`);
      await checkBuildArtifacts(app);
      results.builds[app.name] = 'SKIPPED';
      return;
    }

    log(`🔨 Building ${app.name}...`);
    
    // Clean first
    await runCommand(`npm run clean`, { cwd: app.dir });
    
    // Build the workspace
    await runCommand(`npm run build -w ${app.workspace}`);
    
    // Verify build artifacts exist
    await checkBuildArtifacts(app);
    
    results.builds[app.name] = 'PASS';
    log(`✅ Build successful: ${app.name}`, 'SUCCESS');
    
  } catch (error) {
    results.builds[app.name] = 'FAIL';
    results.overall = 'FAIL';
    log(`❌ Build failed: ${app.name} - ${error.message}`, 'ERROR');
    throw error;
  }
}

async function testAppStartup(app) {
  try {
    log(`🚀 Testing startup: ${app.name}`);
    
    await testAppStart(app);
    
    results.starts[app.name] = 'PASS';
    log(`✅ Startup successful: ${app.name}`, 'SUCCESS');
    
  } catch (error) {
    results.starts[app.name] = 'FAIL';
    results.overall = 'FAIL';
    log(`❌ Startup failed: ${app.name} - ${error.message}`, 'ERROR');
    throw error;
  }
}

async function testDockerBuild(app) {
  if (!testDocker) return;
  
  try {
    log(`🐳 Testing Docker build: ${app.name}`);
    
    if (!existsSync(app.dockerFile)) {
      log(`⏭️ Skipping Docker test for ${app.name} - no Dockerfile`);
      results.docker[app.name] = 'SKIPPED';
      return;
    }
    
    // Build Docker image
    await runCommand(`docker build -f ${app.dockerFile} -t ${app.dockerImage} .`);
    
    // Test container startup (brief test)
    await runCommand(`timeout 10 docker run --rm -p ${app.port}:${app.port} ${app.dockerImage} || true`);
    
    results.docker[app.name] = 'PASS';
    log(`✅ Docker build successful: ${app.name}`, 'SUCCESS');
    
  } catch (error) {
    results.docker[app.name] = 'FAIL';
    results.overall = 'FAIL';
    log(`❌ Docker build failed: ${app.name} - ${error.message}`, 'ERROR');
  }
}

async function killProcessOnPort(port) {
  try {
    await runCommand(`lsof -ti:${port} | xargs kill -9 || true`);
  } catch (error) {
    // Ignore errors - port might not be in use
  }
}

async function main() {
  log('🧪 Starting Build Deployment Test');
  log(`Testing ${apps.length} applications...`);
  
  if (testDocker) {
    log('🐳 Docker testing enabled');
  }
  
  if (quickTest) {
    log('⏭️ Quick test mode - skipping builds');
  }

  // Clean up any processes on our test ports
  for (const app of apps) {
    await killProcessOnPort(app.port);
  }

  // Test each app
  for (const app of apps) {
    log(`📦 Testing ${app.name.toUpperCase()}`);
    
    try {
      // 1. Build the app
      await buildApp(app);
      
      // 2. Test startup
      await testAppStartup(app);
      
      // 3. Test Docker if requested
      await testDockerBuild(app);
      
      // Clean up
      await killProcessOnPort(app.port);
      
    } catch (error) {
      log(`💥 ${app.name} failed: ${error.message}`, 'ERROR');
      // Continue testing other apps
      continue;
    }
  }

  // Print summary
  console.log('\n📊 TEST SUMMARY');
  console.log('===============');
  
  console.log('\n🔨 Build Results:');
  for (const [app, result] of Object.entries(results.builds)) {
    const icon = result === 'PASS' ? '✅' : result === 'FAIL' ? '❌' : '⏭️';
    console.log(`  ${icon} ${app}: ${result}`);
  }
  
  console.log('\n🚀 Startup Results:');
  for (const [app, result] of Object.entries(results.starts)) {
    const icon = result === 'PASS' ? '✅' : result === 'FAIL' ? '❌' : '⏭️';
    console.log(`  ${icon} ${app}: ${result}`);
  }
  
  if (testDocker) {
    console.log('\n🐳 Docker Results:');
    for (const [app, result] of Object.entries(results.docker)) {
      const icon = result === 'PASS' ? '✅' : result === 'FAIL' ? '❌' : '⏭️';
      console.log(`  ${icon} ${app}: ${result}`);
    }
  }
  
  console.log(`\n🎯 Overall Result: ${results.overall === 'PASS' ? '✅ PASS' : '❌ FAIL'}`);
  
  if (results.overall === 'FAIL') {
    console.log('\n💡 Recommendations:');
    console.log('  • Check build scripts and TypeScript configuration');
    console.log('  • Ensure all dependencies are properly installed');
    console.log('  • Review Dockerfile configurations if Docker tests failed');
    console.log('  • Run with --verbose flag for detailed output');
    process.exit(1);
  }
  
  log('🎉 All tests passed! Apps are ready for deployment.', 'SUCCESS');
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

// Run the test
main().catch((error) => {
  log(`Test failed: ${error.message}`, 'ERROR');
  process.exit(1);
});

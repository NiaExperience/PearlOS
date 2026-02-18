import { exec } from 'child_process';

import 'reflect-metadata';

// Track if cleanup has already occurred
let hasCleanedUp = false;

async function isMeshRunning(): Promise<boolean> {
  const mesh_endpoint = process.env.MESH_ENDPOINT || 'http://localhost:5001/graphql';
  try {
    const response = await fetch(mesh_endpoint);
    return response.ok;
  } catch (error) {
    return false;
  }
};

const stopMesh = async () => {
  const isRunning = await isMeshRunning();

  // Only stop if we're in a CI environment or if the container was started by us
  if (!isRunning && !process.env.CI) {
    console.log('✅ Mesh server is not running');
    return true;
  }

  console.log('🛑 Stopping Mesh server and cleaning up resources...');

  // Try graceful shutdown first if we have the server instance
  const meshServer = (global as any).__meshServer;
  if (meshServer) {
    try {
      const { stopServer } = require('../apps/mesh/src/server');
      await stopServer(meshServer);
      console.log('✅ Mesh server stopped gracefully');

      // Clear the global reference
      (global as any).__meshServer = null;

      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify it's actually stopped
      const stillRunning = await isMeshRunning();
      if (!stillRunning) {
        console.log('✅ Confirmed mesh server is stopped');
        return true;
      } else {
        console.warn('⚠️ Mesh server still running after graceful shutdown, falling back to process cleanup');
      }
    } catch (error) {
      console.error('❌ Error during graceful shutdown:', error);
    }
  }

  // Run coverage merge script
  try {
    // eslint-disable-next-line no-console
    console.log('📊 Merging coverage reports...');
    await new Promise((resolve) => {
      exec('npm run coverage:merge', (error, _stdout, stderr) => {
        if (error) {
          // eslint-disable-next-line no-console
          console.warn('⚠️ Failed to merge coverage reports:', stderr);
          // Don't reject, just warn - we don't want to fail teardown
          resolve(null);
        } else {
          // eslint-disable-next-line no-console
          console.log('✅ Coverage reports merged successfully');
          resolve(null);
        }
      });
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('⚠️ Error running coverage merge:', error);
  }

  // Force kill any remaining processes on port 5001
  return new Promise((resolve) => {
    // Simplified cleanup focused on the mesh server port
    exec(`
      # Function to cleanup processes on a port
      cleanup_port() {
        local port=$1
        local pids=$(lsof -ti:$port 2>/dev/null)
        
        if [ ! -z "$pids" ]; then
          echo "🔄 Found processes on port $port: $pids"
          
          # First try graceful shutdown (SIGTERM)
          echo "$pids" | xargs kill -TERM 2>/dev/null
          sleep 2
          
          # Check if processes are still running
          local remaining=$(lsof -ti:$port 2>/dev/null)
          if [ ! -z "$remaining" ]; then
            echo "💥 Force killing remaining processes: $remaining"
            echo "$remaining" | xargs kill -9 2>/dev/null
            sleep 1
          fi
          
          echo "✅ Cleaned up port $port"
        else
          echo "✅ No processes found on port $port"
        fi
      }
      
      # Cleanup test server port
      cleanup_port 5001
      
      echo "🧹 Process cleanup completed"
    `, (error, stdout, stderr) => {
      if (error) {
        console.warn('⚠️ Error during process cleanup:', error.message);
      }

      if (stdout) {
        console.log(stdout.trim());
      }

      if (stderr && stderr.trim()) {
        console.warn('Cleanup warnings:', stderr.trim());
      }

      // Always resolve - we don't want cleanup failures to break tests
      resolve(true);
    });
  });
};

/**
 * Cleanup function to close all Prism resources and stop Mesh server
 */
async function cleanupResources() {
  // Only perform cleanup once
  if (hasCleanedUp) {
    return;
  }

  console.log('🧹 Performing global cleanup...');
  hasCleanedUp = true;

  try {
    // Clean up performance monitoring first
    if ((global as any).__cleanupPerformanceMonitoring) {
      (global as any).__cleanupPerformanceMonitoring();
    }

    // Clean up Prism instance to prevent TCP connection leaks
    try {
      // Prefer packaged import; fallback to source only if needed
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Prism } = require('@nia/prism');
      if (Prism.clearInstances) {
        await Prism.clearInstances();
        console.log('✅ Disconnected and cleared Prism instances');
      } else {
        const prism = await Prism.getInstance();
        await prism.disconnect();
        console.log('✅ Disconnected Prism client');
      }

      // Set the instance to undefined to help GC
      // @ts-ignore - We're deliberately setting to undefined for cleanup
      Prism.instance = undefined;
    } catch (err: unknown) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Prism } = require('../packages/prism/src/prism');
        const prism = await Prism.getInstance();
        await prism.disconnect();
        console.log('✅ Disconnected Prism client (source fallback)');
        // @ts-ignore
        Prism.instance = undefined;
      } catch (innerErr) {
      // If Prism (and its dependencies) cannot be resolved in teardown, skip gracefully
        const msg = (err && typeof err === 'object' && 'message' in err) ? (err as any).message : String(err);
        console.warn('⚠️ Skipping Prism disconnect during teardown:', msg);
      }
    }

    // Force garbage collection if available
    if (global.gc) {
      try {
        global.gc();
        console.log('✅ Forced garbage collection');
      } catch (e) {
        // Ignore if gc is not available
      }
    }
  } catch (error) {
    console.error('❌ Error disconnecting Prism client:', error);
  }

  // Stop the Mesh server (best-effort)
  try {
    await stopMesh();
  } catch (error) {
    console.warn('⚠️ Mesh teardown encountered an error (continuing):', error);
  }

  console.log('✅ Global teardown completed');
}

// Register process termination handlers to ensure cleanup
process.on('SIGINT', async () => {
  console.log('🛑 SIGINT detected, cleaning up resources...');
  await cleanupResources();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM detected, cleaning up resources...');
  await cleanupResources();
  process.exit(0);
});

// Handle normal exit
process.on('exit', () => {
  // Any other cleanup here
});

// Handle uncaught exceptions to ensure cleanup
process.on('uncaughtException', async (error) => {
  console.error('💥 Uncaught exception:', error);
  await cleanupResources();
  // Do not fail the run on teardown/cleanup errors
  process.exit(0);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason) => {
  console.error('💥 Unhandled promise rejection:', reason);
  await cleanupResources();
  // Do not fail the run on teardown/cleanup errors
  process.exit(0);
});

// Main teardown function
module.exports = async () => {
  try {
    // Clean up resources
    await cleanupResources();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('⚠️ Global teardown encountered an error but will not fail the run:', error);
  }
};
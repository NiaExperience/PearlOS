#!/usr/bin/env ts-node
/**
 * @ts-check
 */
/**
 * Ensure PostgreSQL is running - Auto-start if needed
 * 
 * This script attempts to start PostgreSQL automatically if it's not running.
 * Works on Linux (systemctl), macOS (brew services), and Windows (service).
 */

import { execSync } from 'child_process';
import { platform } from 'os';

const isWindows = platform() === 'win32';
const isMacOS = platform() === 'darwin';
const isLinux = platform() === 'linux';

interface PostgresStatus {
  running: boolean;
  method: 'systemctl' | 'brew' | 'service' | 'docker' | 'unknown';
}

/**
 * Check if PostgreSQL is running
 */
function checkPostgresRunning(): boolean {
  try {
    // Try to connect to PostgreSQL
    execSync('pg_isready -h localhost -p 5432 -U postgres', {
      stdio: 'ignore',
      timeout: 2000
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect how PostgreSQL is installed/running
 */
function detectPostgresMethod(): PostgresStatus['method'] {
  // Check for Docker container first
  try {
    const containers = execSync('docker ps -a --format "{{.Names}}"', {
      encoding: 'utf-8',
      stdio: 'pipe'
    });
    if (containers.includes('nia-postgres')) {
      return 'docker';
    }
  } catch {
    // Docker not available or not running
  }

  // Check for systemd (Linux)
  if (isLinux) {
    try {
      execSync('systemctl is-active --quiet postgresql', { stdio: 'ignore' });
      return 'systemctl';
    } catch {
      // Try alternative service names
      try {
        execSync('systemctl is-active --quiet postgresql@15-main', { stdio: 'ignore' });
        return 'systemctl';
      } catch {
        try {
          execSync('systemctl is-active --quiet postgresql@14-main', { stdio: 'ignore' });
          return 'systemctl';
        } catch {
          // Not systemd
        }
      }
    }
  }

  // Check for Homebrew (macOS)
  if (isMacOS) {
    try {
      execSync('brew services list | grep -q postgresql', { stdio: 'ignore' });
      return 'brew';
    } catch {
      // Not Homebrew
    }
  }

  // Check for Windows service
  if (isWindows) {
    try {
      execSync('sc query postgresql', { stdio: 'ignore' });
      return 'service';
    } catch {
      // Not Windows service
    }
  }

  return 'unknown';
}

/**
 * Start PostgreSQL using the detected method
 */
function startPostgres(method: PostgresStatus['method']): boolean {
  console.log(`[postgres] Attempting to start PostgreSQL using ${method}...`);

  try {
    switch (method) {
      case 'docker':
        // Start Docker container
        execSync('docker start nia-postgres', { stdio: 'inherit' });
        console.log('[postgres] ✅ Docker container started');
        return true;

      case 'systemctl':
        // Start systemd service (may require sudo)
        try {
          execSync('systemctl start postgresql', { stdio: 'inherit' });
          console.log('[postgres] ✅ PostgreSQL service started');
          return true;
        } catch {
          // Try alternative service names
          try {
            execSync('systemctl start postgresql@15-main', { stdio: 'inherit' });
            console.log('[postgres] ✅ PostgreSQL service started');
            return true;
          } catch {
            try {
              execSync('systemctl start postgresql@14-main', { stdio: 'inherit' });
              console.log('[postgres] ✅ PostgreSQL service started');
              return true;
            } catch {
              console.log('[postgres] ⚠️  Could not start PostgreSQL service automatically');
              console.log('[postgres]    Please run: sudo systemctl start postgresql');
              return false;
            }
          }
        }

      case 'brew':
        // Start Homebrew service
        try {
          execSync('brew services start postgresql@15', { stdio: 'inherit' });
          console.log('[postgres] ✅ PostgreSQL service started');
          return true;
        } catch {
          try {
            execSync('brew services start postgresql', { stdio: 'inherit' });
            console.log('[postgres] ✅ PostgreSQL service started');
            return true;
          } catch {
            console.log('[postgres] ⚠️  Could not start PostgreSQL service automatically');
            console.log('[postgres]    Please run: brew services start postgresql@15');
            return false;
          }
        }

      case 'service':
        // Windows service
        try {
          execSync('net start postgresql', { stdio: 'inherit' });
          console.log('[postgres] ✅ PostgreSQL service started');
          return true;
        } catch {
          console.log('[postgres] ⚠️  Could not start PostgreSQL service automatically');
          console.log('[postgres]    Please start it from Services (services.msc)');
          return false;
        }

      default:
        console.log('[postgres] ⚠️  Could not detect PostgreSQL installation method');
        console.log('[postgres]    Please start PostgreSQL manually');
        return false;
    }
  } catch (error) {
    console.error('[postgres] ❌ Failed to start PostgreSQL:', error);
    return false;
  }
}

/**
 * Wait for PostgreSQL to be ready
 */
function waitForPostgres(maxAttempts = 30, delayMs = 1000): boolean {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (checkPostgresRunning()) {
      return true;
    }
    if (attempt < maxAttempts - 1) {
      // Wait before next attempt
      const start = Date.now();
      while (Date.now() - start < delayMs) {
        // Busy wait
      }
    }
  }
  return false;
}

/**
 * Main function to ensure PostgreSQL is running
 */
export function ensurePostgresRunning(): boolean {
  // Check if already running
  if (checkPostgresRunning()) {
    return true;
  }

  console.log('[postgres] ⚠️  PostgreSQL is not running');

  // Detect installation method
  const method = detectPostgresMethod();
  console.log(`[postgres] Detected PostgreSQL method: ${method}`);

  // Try to start
  if (method === 'unknown') {
    console.log('[postgres] ❌ Could not detect PostgreSQL installation');
    console.log('[postgres]    Please install and start PostgreSQL manually');
    return false;
  }

  const started = startPostgres(method);
  if (!started) {
    return false;
  }

  // Wait for PostgreSQL to be ready
  console.log('[postgres] ⏳ Waiting for PostgreSQL to be ready...');
  const ready = waitForPostgres(30, 1000);

  if (ready) {
    console.log('[postgres] ✅ PostgreSQL is ready');
    return true;
  } else {
    console.log('[postgres] ⚠️  PostgreSQL started but not ready yet');
    return false;
  }
}

// Run if called directly
if (require.main === module) {
  const success = ensurePostgresRunning();
  process.exit(success ? 0 : 1);
}


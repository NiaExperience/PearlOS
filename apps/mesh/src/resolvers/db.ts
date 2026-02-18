/**
 * Database Connection and Model Initialization
 * 
 * Supports both real PostgreSQL connections and in-memory database for testing
 */
import path from 'path';

import dotenv from 'dotenv';
import { Sequelize } from 'sequelize';

import { migrateToJsonb } from '../migrations/jsonb-migration';

import { createGinIndex, createInMemoryDatabase, createPostgresDatabase } from './database';
import { createNotionModel } from './models/notion-model';

// Auto-start PostgreSQL utility (only in development)
async function ensurePostgresRunning(): Promise<boolean> {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') {
    return false;
  }

  try {
    const { execSync } = require('child_process');
    const os = require('os');
    const isWindows = os.platform() === 'win32';
    const isMacOS = os.platform() === 'darwin';
    const isLinux = os.platform() === 'linux';

    // Check if PostgreSQL is already running
    try {
      execSync('pg_isready -h localhost -p 5432 -U postgres', { stdio: 'ignore', timeout: 2000 });
      return true; // Already running
    } catch {
      // Not running, try to start
    }

    console.log('[postgres] Attempting to start PostgreSQL...');

    // Try Docker first
    try {
      const containers = execSync('docker ps -a --format "{{.Names}}"', { encoding: 'utf-8', stdio: 'pipe' });
      if (containers.includes('nia-postgres')) {
        execSync('docker start nia-postgres', { stdio: 'inherit' });
        console.log('[postgres] ✅ Docker container started');
        // Wait for it to be ready
        for (let i = 0; i < 30; i++) {
          try {
            execSync('pg_isready -h localhost -p 5432 -U postgres', { stdio: 'ignore', timeout: 1000 });
            return true;
          } catch {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        return false;
      }
    } catch {
      // Docker not available or container doesn't exist
    }

    // Try systemd (Linux)
    if (isLinux) {
      try {
        execSync('systemctl start postgresql', { stdio: 'inherit' });
        console.log('[postgres] ✅ PostgreSQL service started');
        // Wait for it to be ready
        for (let i = 0; i < 30; i++) {
          try {
            execSync('pg_isready -h localhost -p 5432 -U postgres', { stdio: 'ignore', timeout: 1000 });
            return true;
          } catch {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        return false;
      } catch {
        // May require sudo, skip
      }
    }

    // Try Homebrew (macOS)
    if (isMacOS) {
      try {
        execSync('brew services start postgresql@15', { stdio: 'inherit' });
        console.log('[postgres] ✅ PostgreSQL service started');
        // Wait for it to be ready
        for (let i = 0; i < 30; i++) {
          try {
            execSync('pg_isready -h localhost -p 5432 -U postgres', { stdio: 'ignore', timeout: 1000 });
            return true;
          } catch {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        return false;
      } catch {
        try {
          execSync('brew services start postgresql', { stdio: 'inherit' });
          console.log('[postgres] ✅ PostgreSQL service started');
          // Wait for it to be ready
          for (let i = 0; i < 30; i++) {
            try {
              execSync('pg_isready -h localhost -p 5432 -U postgres', { stdio: 'ignore', timeout: 1000 });
              return true;
            } catch {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
          return false;
        } catch {
          // Homebrew service not available
        }
      }
    }

    // Try Windows service
    if (isWindows) {
      try {
        execSync('net start postgresql', { stdio: 'inherit' });
        console.log('[postgres] ✅ PostgreSQL service started');
        // Wait for it to be ready
        for (let i = 0; i < 30; i++) {
          try {
            execSync('pg_isready -h localhost -p 5432 -U postgres', { stdio: 'ignore', timeout: 1000 });
            return true;
          } catch {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        return false;
      } catch {
        // Service not available or requires admin
      }
    }

    console.log('[postgres] ⚠️  Could not start PostgreSQL automatically');
    console.log('[postgres]    Please start it manually');
    return false;
  } catch (error) {
    console.error('[postgres] Error attempting to start PostgreSQL:', error);
    return false;
  }
}

// Environment variables are already loaded in server.ts from root .env.local
// Do NOT load apps/mesh/.env here as it would override the correct values

// Database instance - will be initialized in initDatabase()
let sequelize: Sequelize;

// NotionModel will be initialized in initDatabase()
export let NotionModel: ReturnType<typeof createNotionModel>;

/**
 * Test the database connection
 */
export async function testConnection(): Promise<boolean> {
  if (!sequelize) {
    return false;
  }
  
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully');
    return true;
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error);
    
    // Try to auto-start PostgreSQL in development
    if (process.env.NODE_ENV === 'development') {
      console.log('🔄 Attempting to start PostgreSQL automatically...');
      const started = await ensurePostgresRunning();
      
      if (started) {
        // Wait a moment for PostgreSQL to fully initialize
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Retry connection
        try {
          await sequelize.authenticate();
          console.log('✅ Database connection established after auto-start');
          return true;
        } catch (retryError) {
          console.error('❌ Still unable to connect after auto-start:', retryError);
        }
      }
    }
    
    return false;
  }
}

/**
 * Initialize the database connection
 * @param useInMemory Force using in-memory database (useful for tests)
 * @param headers Request headers (can be used to set in-memory mode via X-Use-In-Memory header)
 */
export async function initDatabase(useInMemory?: boolean, headers?: Record<string, string>): Promise<void> {
  // Determine if we should use the in-memory database
  const useInMemoryDb = 
    useInMemory || 
    process.env.NODE_ENV === 'test' ||
    headers?.['x-use-in-memory'] === 'true';
  
  // Set logging
  const shouldLog = false;
  
  // Initialize the appropriate database
  if (useInMemoryDb) {
    console.log('🔬 Using in-memory PostgreSQL database for testing');
    sequelize = await createInMemoryDatabase({ shouldLog });
  } else {
    // Initialize real PostgreSQL connection
    const host = process.env.POSTGRES_HOST || 'localhost';
    const port = parseInt(process.env.POSTGRES_PORT || '5432');
    const dbName = process.env.POSTGRES_DB || 'testdb';
    console.log('🔬 Using real PostgreSQL database @ %s:%d/%s', host, port, dbName);
    sequelize = await createPostgresDatabase(
      host,
      port,
      dbName,
      process.env.POSTGRES_USER || 'postgres',
      process.env.POSTGRES_PASSWORD || 'password',
      { shouldLog }
    );
    
    // Test the connection
    await testConnection();
    
    // Run JSONB migration if needed (automatic migration on startup)
    try {
      const migrated = await migrateToJsonb(sequelize, false);
      if (migrated) {
        // eslint-disable-next-line no-console
        console.log('🎉 Database migrated to JSONB successfully');
      }
    } catch (migrationError) {
      // eslint-disable-next-line no-console
      console.error('⚠️  JSONB migration failed:', migrationError);
      // eslint-disable-next-line no-console
      console.error('⚠️  Server will continue but queries may fail. Run migration manually:');
      // eslint-disable-next-line no-console
      console.error('   npx tsx apps/mesh/scripts/migrations/001-content-to-jsonb.ts');
    }
    
    // Sync models with the database - don't force recreation in production
    const shouldForce = process.env.NODE_ENV === 'test' && process.env.DB_FORCE_SYNC === 'true';
    
    if (process.env.NODE_ENV !== 'production') {
      await sequelize.sync({ force: shouldForce });
      console.log('🔄 Database synchronized (force: %s)', shouldForce);
    }
  
    // Create GIN index on the indexer column if it doesn't exist
    await createGinIndex(sequelize, shouldLog);
  }
  
  // Initialize models
  NotionModel = createNotionModel(sequelize);
}

/**
 * Get the Sequelize instance (for testing purposes)
 */
export function getSequelize(): Sequelize {
  return sequelize;
}

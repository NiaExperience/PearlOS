/**
 * In-Memory PostgreSQL Database Provider
 * 
 * This module provides an in-memory PostgreSQL database
 * for testing without requiring a real database connection.
 */

import { newDb, DataType } from 'pg-mem';
import { Sequelize } from 'sequelize';

import { createNotionModel } from '../models/notion-model';

export interface InMemoryDatabaseOptions {
  shouldLog?: boolean;
}

/**
 * Create and return an in-memory PostgreSQL database connection
 */
export async function createInMemoryDatabase(options: InMemoryDatabaseOptions = {}): Promise<Sequelize> {
  const { shouldLog = false } = options;
  
  // Create in-memory PostgreSQL database
  const memoryDb = newDb();
  
  // Register missing PostgreSQL JSONB functions for pg-mem compatibility
  // jsonb_typeof: returns the type of a JSONB value ('object', 'array', 'string', 'number', 'boolean', 'null')
  memoryDb.public.registerFunction({
    name: 'jsonb_typeof',
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: (val: unknown) => {
      if (val === null || val === undefined) return 'null';
      if (Array.isArray(val)) return 'array';
      if (typeof val === 'object') return 'object';
      if (typeof val === 'string') return 'string';
      if (typeof val === 'number') return 'number';
      if (typeof val === 'boolean') return 'boolean';
      return 'null';
    }
  });

  // jsonb_exists: checks if a key exists in a JSONB object or array
  memoryDb.public.registerFunction({
    name: 'jsonb_exists',
    args: [DataType.jsonb, DataType.text],
    returns: DataType.bool,
    implementation: (val: unknown, key: string) => {
      if (val === null || val === undefined) return false;
      if (Array.isArray(val)) return (val as unknown[]).includes(key);
      if (typeof val === 'object') return Object.prototype.hasOwnProperty.call(val, key);
      return false;
    }
  });
  
  // Configure pg-mem to suppress moment.js deprecation warnings
  memoryDb.public.many(`
    -- Configure timestamp handling to avoid moment.js deprecation warnings
    SET timezone = 'UTC';
  `);
  
  // Suppress moment.js deprecation warnings globally for tests
  if (!shouldLog) {
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      const message = args[0];
      if (typeof message === 'string' && message.includes('moment construction falls back to js Date()')) {
        // Suppress moment.js deprecation warnings
        return;
      }
      originalWarn.apply(console, args);
    };
  }
  
  // Set environment variable to disable native bindings
  process.env.PG_NATIVE = 'false';
  
  // Get the postgres adapter from the in-memory database
  const pg = memoryDb.adapters.createPg();
  
  // Create Sequelize connection to the in-memory database
  const sequelize = new Sequelize('test', 'test', 'test', {
    dialect: 'postgres',
    dialectModule: pg, // Use the pg-mem adapter
    logging: shouldLog ? console.log : false,
    // Configure Sequelize to use ISO format for timestamps
    timezone: '+00:00',
    dialectOptions: {
      // Ensure timestamps are handled consistently
      dateStrings: true,
      typeCast: true,
    },
  });
  
  // Initialize models
  createNotionModel(sequelize);

  // Sync the database (create tables)
  try {
    await sequelize.sync({ force: true });
    
    // Create GIN index on the indexer column
    try {
      await sequelize.query(`
        CREATE INDEX gin_idx_notion_blocks_indexer ON notion_blocks USING GIN (indexer);
      `);
      if (shouldLog) {
        // eslint-disable-next-line no-console
        console.log('🍾 Created GIN index on indexer column');
      }
      
      // Create GIN index on the content column for JSON queries
      await sequelize.query(`
        CREATE INDEX gin_idx_notion_blocks_content ON notion_blocks USING GIN (content);
      `);
      if (shouldLog) {
        // eslint-disable-next-line no-console
        console.log('🍾 Created GIN index on content column');
      }
    } catch (error) {
      // Ignore specific pg-mem limitations with GIN indexes
      if (error instanceof Error && 
          !error.message.includes('GIN indexes not fully supported in pg-mem')) {
        console.error('Failed to create GIN index:', error);
      }
    }
    
  } catch (error) {
    if (
      error instanceof Error &&
      error.message &&
      error.message.includes('already exists') &&
      error.message.includes('idx_notion_blocks_page_type')
    ) {
      // Ignore index already exists error in pg-mem
    } else {
      console.error('Failed to sync in-memory database:', error);
      throw error;
    }
  }

  if (shouldLog) {
    console.log('✅ In-memory database initialized successfully');
  }
  
  return sequelize;
}
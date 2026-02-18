/**
 * PostgreSQL Database Provider
 * 
 * This module provides connection to a real PostgreSQL database.
 */

import { Sequelize } from 'sequelize';

/**
 * Create and return a PostgreSQL database connection
 */
export async function createPostgresDatabase(
  host: string = process.env.POSTGRES_HOST || 'localhost',
  port: number = parseInt(process.env.POSTGRES_PORT || '5432'),
  database: string = process.env.POSTGRES_DB || process.env.POSTGRES_DATABASE || 'testdb',
  username: string = process.env.POSTGRES_USER || 'postgres',
  password: string = process.env.POSTGRES_PASSWORD || 'password',
  options: { shouldLog?: boolean } = {}
): Promise<Sequelize> {
  const { shouldLog = process.env.NODE_ENV === 'development' } = options;
  
  // Initialize Sequelize connection
  const sequelize = new Sequelize(database, username, password, {
    host: host,
    port: port,
    dialect: 'postgres',
    // eslint-disable-next-line no-console
    logging: shouldLog ? console.log : false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  });
  
  return sequelize;
}

/**
 * Create GIN index for faster text search
 */
export async function createGinIndex(sequelize: Sequelize, shouldLog: boolean = false): Promise<void> {
  try {
    // Note: We use raw query for this because Sequelize doesn't fully support GIN indexes
    
    // GIN index on indexer column for fast JSON queries on indexed fields
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS gin_idx_notion_blocks_indexer ON notion_blocks USING GIN (indexer);
    `);
    
    // GIN index on content column for fast JSON queries on arbitrary nested fields
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS gin_idx_notion_blocks_content ON notion_blocks USING GIN (content);
    `);
    
    if (shouldLog) {
      // eslint-disable-next-line no-console
      console.log('GIN indexes on indexer and content columns verified');
    }
  } catch (error) {
    console.error('Failed to create GIN indexes:', error);
  }
}

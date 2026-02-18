#!/usr/bin/env node
/**
 * Migration: Convert content column from TEXT to JSONB
 * 
 * This migration changes the `content` column in the `notion_blocks` table
 * from TEXT to JSONB to enable efficient JSON querying with PostgreSQL's
 * native JSONB operators and GIN indexes.
 * 
 * Run with: npx tsx apps/mesh/scripts/migrations/001-content-to-jsonb.ts
 * 
 * NOTE: This migration is also run automatically on Mesh server startup.
 * This standalone script is provided for manual execution if needed.
 */

import * as path from 'path';

import * as dotenv from 'dotenv';
import { Sequelize } from 'sequelize';

import { migrateToJsonb } from '../../src/migrations/jsonb-migration';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function runMigration() {
  const host = process.env.POSTGRES_HOST || 'localhost';
  const port = parseInt(process.env.POSTGRES_PORT || '5432');
  const database = process.env.POSTGRES_DATABASE || 'testdb';
  const username = process.env.POSTGRES_USER || 'postgres';
  const password = process.env.POSTGRES_PASSWORD || 'password';

  // eslint-disable-next-line no-console
  console.log('🔄 Manual JSONB Migration Script');
  // eslint-disable-next-line no-console
  console.log(`📍 Database: ${database} on ${host}:${port}`);

  const sequelize = new Sequelize(database, username, password, {
    host,
    port,
    dialect: 'postgres',
    // eslint-disable-next-line no-console
    logging: console.log
  });

  try {
    // Test connection
    await sequelize.authenticate();
    // eslint-disable-next-line no-console
    console.log('✅ Database connection established');

    // Run the migration using the shared module
    const migrated = await migrateToJsonb(sequelize, false);

    if (migrated) {
      // eslint-disable-next-line no-console
      console.log('🎉 Migration completed successfully!');
      process.exit(0);
    } else {
      // eslint-disable-next-line no-console
      console.log('ℹ️  No migration needed (already up to date)');
      process.exit(0);
    }

  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('❌ Migration error:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Run migration
runMigration().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error:', error);
  process.exit(1);
});

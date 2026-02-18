/**
 * JSONB Migration Module
 * 
 * Provides a reusable function to migrate content and indexer columns
 * from TEXT to JSONB in the notion_blocks table.
 * 
 * Can be called during server startup or run standalone via the script.
 */

import { Sequelize } from 'sequelize';

/**
 * Check if the content column needs migration and perform it if necessary
 * @param sequelize Sequelize instance (already connected)
 * @param silent Whether to suppress console output (for testing)
 * @returns true if migration was performed, false if already migrated
 */
export async function migrateToJsonb(
  sequelize: Sequelize,
  silent = false
): Promise<boolean> {
  // eslint-disable-next-line no-console
  const log = silent ? () => {} : console.log;
  // eslint-disable-next-line no-console
  const error = silent ? () => {} : console.error;

  try {
    // Check current column type
    const [results] = await sequelize.query(`
      SELECT data_type, column_name
      FROM information_schema.columns
      WHERE table_name = 'notion_blocks' AND column_name = 'content';
    `) as [Array<{ data_type: string; column_name: string }>, unknown];

    if (results.length === 0) {
      // Table doesn't exist yet - probably a new database
      log('ℹ️  Table notion_blocks not found yet (will be created with JSONB columns)');
      return false;
    }

    const currentType = results[0].data_type;
    log(`📊 Content column type: ${currentType}`);

    if (currentType === 'jsonb') {
      log('✅ Content column is already JSONB, no migration needed');
      return false;
    }

    // Need to migrate
    log('🔄 Starting JSONB migration for content and indexer columns...');
    
    // Begin transaction
    const transaction = await sequelize.transaction();

    try {
      // Step 1: Convert content column to JSONB
      log('🔧 Converting content column to JSONB...');
      await sequelize.query(`
        ALTER TABLE notion_blocks 
        ALTER COLUMN content TYPE JSONB 
        USING CASE 
          WHEN content IS NULL THEN NULL
          WHEN content = '' THEN NULL
          ELSE content::jsonb 
        END;
      `, { transaction });

      log('✅ Content column converted to JSONB');

      // Step 2: Convert indexer column to JSONB (if it exists and isn't already JSONB)
      const [indexerResults] = await sequelize.query(`
        SELECT data_type, column_name
        FROM information_schema.columns
        WHERE table_name = 'notion_blocks' AND column_name = 'indexer';
      `, { transaction }) as [Array<{ data_type: string; column_name: string }>, unknown];

      if (indexerResults.length > 0 && indexerResults[0].data_type !== 'jsonb') {
        log('🔧 Converting indexer column to JSONB...');
        await sequelize.query(`
          ALTER TABLE notion_blocks 
          ALTER COLUMN indexer TYPE JSONB 
          USING CASE 
            WHEN indexer IS NULL THEN '{}'::jsonb
            WHEN indexer = '' THEN '{}'::jsonb
            ELSE indexer::jsonb 
          END;
        `, { transaction });
        log('✅ Indexer column converted to JSONB');
      }

      // Step 3: Create GIN indexes for efficient JSON queries
      log('🔧 Creating GIN indexes...');
      
      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS gin_idx_notion_blocks_content 
        ON notion_blocks USING GIN (content);
      `, { transaction });

      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS gin_idx_notion_blocks_indexer 
        ON notion_blocks USING GIN (indexer);
      `, { transaction });

      log('✅ GIN indexes created');

      // Commit transaction
      await transaction.commit();
      log('✅ JSONB migration completed successfully!');

      return true;

    } catch (migrationError) {
      await transaction.rollback();
      error('❌ Migration failed, rolled back:', migrationError);
      throw migrationError;
    }

  } catch (err) {
    error('❌ Migration error:', err);
    throw err;
  }
}

/**
 * Check if migration is needed without performing it
 * @param sequelize Sequelize instance (already connected)
 * @returns true if migration is needed, false otherwise
 */
export async function needsJsonbMigration(
  sequelize: Sequelize
): Promise<boolean> {
  try {
    const [results] = await sequelize.query(`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_name = 'notion_blocks' AND column_name = 'content';
    `) as [Array<{ data_type: string }>, unknown];

    if (results.length === 0) {
      return false; // Table doesn't exist yet
    }

    return results[0].data_type !== 'jsonb';
  } catch (err) {
    console.error('Error checking migration status:', err);
    return false;
  }
}

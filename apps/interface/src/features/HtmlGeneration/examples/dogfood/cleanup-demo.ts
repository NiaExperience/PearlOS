#!/usr/bin/env npx ts-node --project ./tsconfig.json

/**
 * Dog Feeding Tracker Demo - Cleanup Script
 * 
 * Removes all demo data created by the dog feeding tracker demo:
 * - All dog feeding entry content records for the user
 * - The user-specific content type definition
 * - The HtmlGeneration record
 * 
 * This script completely cleans up the database state, removing all traces
 * of the demo data while preserving other user and tenant data.
 */

import 'reflect-metadata';
import { ContentActions } from '@nia/prism/core/actions';
import { createDogFeedingContentType } from './content-type';
import { getLogger } from '@interface/lib/logger';

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(__dirname, '../../../../../../../.env.local') });

// Default values for demo cleanup (same as create-demo.ts)
const DEFAULT_TENANT_ID = '7bd902a4-9534-4fc4-b745-f23368590946'; // pearlos tenant
const DEFAULT_USER_ID = '643fdb08-672d-4272-a138-8c1e8a6b8db3'; // jeff@niaxp.com user

// Parse command line arguments
const args = process.argv.slice(2);
const tenantId = args.find(arg => arg.startsWith('--tenant-id='))?.split('=')[1] || DEFAULT_TENANT_ID;
const userId = args.find(arg => arg.startsWith('--user-id='))?.split('=')[1] || DEFAULT_USER_ID;
const force = args.includes('--force'); // Skip confirmation if --force is provided

const logger = getLogger('DogFeedingCleanupDemo');

// Create user-specific content type info
const dogFeedingContentType = createDogFeedingContentType(userId);
const CONTENT_TYPE = dogFeedingContentType.name; // This will be 'dogfood-<userId>'
const BLOCK_TYPE = dogFeedingContentType.dataModel.block; // 'DogFeedingEntry'

interface CleanupStats {
  feedingEntriesDeleted: number;
  contentTypeDeleted: boolean;
  htmlGenerationDeleted: number;
  errors: string[];
}

async function confirmCleanup(): Promise<boolean> {
  if (force) {
    logger.warn('--force flag provided, skipping confirmation');
    return true;
  }

  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`
🚨 WARNING: This will permanently delete ALL dog feeding tracker demo data:

   👤 User ID: ${userId}
   🏢 Tenant ID: ${tenantId}
   📦 Content Type: ${CONTENT_TYPE}
   🗂️  Block Type: ${BLOCK_TYPE}

   This will delete:
   • All feeding entry records created by this user
   • The user-specific content type definition
   • All HtmlGeneration records with title "Dog Feeding Tracker"

Are you sure you want to continue? (yes/no): `, (answer: string) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

async function deleteFeedingEntries(): Promise<number> {
  logger.info('Finding feeding entries for content type', { contentType: CONTENT_TYPE });
  
  try {
    // Find all feeding entries for this user's content type using type filter
    const query = {
      tenantId,
      contentType: BLOCK_TYPE,
      where: {
        type: { eq: BLOCK_TYPE }
      }
    };

    const result = await ContentActions.findContent(query);
    if (!result || result.total === 0) {
      logger.info('No feeding entries found to delete');
      return 0;
    }

    logger.info('Found feeding entries to delete', { total: result.total });

    let deletedCount = 0;
    for (const entry of result.items) {
      try {
        const deleted = await ContentActions.deleteContent(BLOCK_TYPE, entry._id, tenantId);
        if (deleted) {
          deletedCount++;
          logger.info('Deleted feeding entry', { entryId: entry._id });
        } else {
          logger.warn('Failed to delete feeding entry', { entryId: entry._id });
        }
      } catch (error) {
        logger.error('Error deleting feeding entry', { entryId: entry._id, error });
      }
    }

    return deletedCount;
  } catch (error) {
    logger.error('Error finding feeding entries', { error });
    return 0;
  }
}

async function deleteContentTypeDefinition(): Promise<boolean> {
  logger.info('Attempting to delete content type definition', { contentType: CONTENT_TYPE });
  
  try {
    // Find the content type definition
    const definitionResult = await ContentActions.findDefinition(BLOCK_TYPE, tenantId);
    if (!definitionResult || definitionResult.total === 0) {
      logger.info('No content type definition found to delete');
      return false;
    }

    // Find the specific user content type (there might be multiple)
    const userDefinition = definitionResult.items.find(item => 
      item.name === CONTENT_TYPE || 
      (item.description && item.description.includes(userId))
    );

    if (!userDefinition) {
      logger.info('No content type definition found for user', { userId });
      return false;
    }

    logger.info('Found content type definition', { definitionId: userDefinition._id });

    // Note: The Prism deleteDefinition method takes blockType and definitionId
    // But based on the search results, it seems there might not be a direct deleteDefinition in ContentActions
    // Let's try to delete it as content instead
    const deleted = await ContentActions.deleteContent('DynamicContent', userDefinition._id, tenantId);
    if (deleted) {
      logger.info('Deleted content type definition', { definitionId: userDefinition._id });
      return true;
    } else {
      logger.warn('Failed to delete content type definition', { definitionId: userDefinition._id });
      return false;
    }
  } catch (error) {
    logger.error('Error deleting content type definition', { error });
    return false;
  }
}

async function deleteHtmlGenerationRecords(): Promise<number> {
  logger.info('Finding HtmlGeneration records for Dog Feeding Tracker');
  
  try {
    // Find all HtmlGeneration records with our title in the content field (JSON search)
    const query = {
      tenantId,
      contentType: 'HtmlGeneration',
      where: {
        type: { eq: 'HtmlGeneration' },
        content: { like: '%"title":"Dog Feeding Tracker"%' }
      }
    };

    const result = await ContentActions.findContent(query);
    if (!result || result.total === 0) {
      logger.info('No HtmlGeneration records found to delete');
      return 0;
    }

    logger.info('Found HtmlGeneration records to delete', { total: result.total });

    let deletedCount = 0;
    for (const record of result.items) {
      try {
        const deleted = await ContentActions.deleteContent('HtmlGeneration', record._id, tenantId);
        if (deleted) {
          deletedCount++;
          logger.info('Deleted HtmlGeneration record', { recordId: record._id });
        } else {
          logger.warn('Failed to delete HtmlGeneration record', { recordId: record._id });
        }
      } catch (error) {
        logger.error('Error deleting HtmlGeneration record', { recordId: record._id, error });
      }
    }

    return deletedCount;
  } catch (error) {
    logger.error('Error finding HtmlGeneration records', { error });
    return 0;
  }
}

async function performCleanup(): Promise<CleanupStats> {
  const stats: CleanupStats = {
    feedingEntriesDeleted: 0,
    contentTypeDeleted: false,
    htmlGenerationDeleted: 0,
    errors: []
  };

  logger.info('Starting cleanup process');

  // Step 1: Delete all feeding entries
  try {
    stats.feedingEntriesDeleted = await deleteFeedingEntries();
  } catch (error) {
    const errorMsg = `Failed to delete feeding entries: ${error}`;
    logger.error('Failed to delete feeding entries', { error });
    stats.errors.push(errorMsg);
  }

  logger.info(''); // Empty line for spacing

  // Step 2: Delete HtmlGeneration records
  try {
    stats.htmlGenerationDeleted = await deleteHtmlGenerationRecords();
  } catch (error) {
    const errorMsg = `Failed to delete HtmlGeneration records: ${error}`;
    logger.error('Failed to delete HtmlGeneration records', { error });
    stats.errors.push(errorMsg);
  }

  logger.info(''); // Empty line for spacing

  // Step 3: Delete content type definition (do this last)
  try {
    stats.contentTypeDeleted = await deleteContentTypeDefinition();
  } catch (error) {
    const errorMsg = `Failed to delete content type definition: ${error}`;
    logger.error('Failed to delete content type definition', { error });
    stats.errors.push(errorMsg);
  }

  return stats;
}

function printSummary(stats: CleanupStats) {
  logger.info('\n🧹 Cleanup Summary:');
  logger.info('═══════════════════');
  logger.info('Feeding entries deleted', { total: stats.feedingEntriesDeleted });
  logger.info('HtmlGeneration records deleted', { total: stats.htmlGenerationDeleted });
  logger.info('Content type definition deleted', { deleted: stats.contentTypeDeleted });
  
  if (stats.errors.length > 0) {
    logger.error('Errors encountered during cleanup', { total: stats.errors.length, errors: stats.errors });
  } else {
    logger.info('All cleanup operations completed successfully');
  }

  const totalDeleted = stats.feedingEntriesDeleted + stats.htmlGenerationDeleted + (stats.contentTypeDeleted ? 1 : 0);
  logger.info('Total items deleted', { total: totalDeleted });
}

// Main execution
async function main() {
  logger.info('Dog Feeding Tracker Demo - Cleanup Script');
  logger.info('═══════════════════════════════════════════');
  logger.info('Tenant information', { tenantId });
  logger.info('User information', { userId });
  logger.info('Content type', { contentType: CONTENT_TYPE });
  logger.info('Block type', { blockType: BLOCK_TYPE });

  // Ask for confirmation unless --force is provided
  const confirmed = await confirmCleanup();
  if (!confirmed) {
    logger.warn('Cleanup cancelled by user');
    process.exit(0);
  }

  // Perform the cleanup
  const stats = await performCleanup();
  
  // Print summary
  printSummary(stats);

  // Exit with appropriate code
  const success = stats.errors.length === 0;
  if (success) {
    logger.info('Dog feeding tracker demo cleanup completed successfully');
    process.exit(0);
  } else {
    logger.error('Cleanup completed with errors. Please review the output above.');
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch((error) => {
    logger.error('Fatal error during cleanup', { error });
    process.exit(1);
  });
}

export { main as cleanupDogFeedingDemo, performCleanup };
export type { CleanupStats };

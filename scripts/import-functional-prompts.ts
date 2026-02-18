#!/usr/bin/env tsx
/**
 * Import Functional Prompts Script
 * 
 * Reads functional-prompts-refactored.txt and creates FunctionalPrompt
 * records in the database, using tool names as featureKeys.
 * 
 * Usage:
 *   npm run pg:import-prompts [--dry-run] [--update-existing]
 * 
 * Options:
 *   --dry-run          Show what would be created without making changes
 *   --update-existing  Update existing records instead of skipping them
 */

// Load environment variables from .env.local
import fs from 'fs';
import path from 'path';

import { FunctionalPromptActions } from '@nia/prism';
import dotenv from 'dotenv';

// Load .env.local to get database connection details
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

// ============================================================================
// Types
// ============================================================================

interface ParsedPrompt {
  toolName: string;
  promptContent: string;
  source: '✅' | '🆕' | '📝'; // From legend in file
}

// ============================================================================
// Parser
// ============================================================================

function parsePromptsFile(filePath: string): ParsedPrompt[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const prompts: ParsedPrompt[] = [];

  // Regex to match: --- BEGIN TOOL <name> ---\n<content>\n--- END <name> ---
  const toolRegex = /--- BEGIN TOOL (\w+) ---\n((?:✅|🆕|📝)[\s\S]*?)--- END \1 ---/g;

  let match;
  while ((match = toolRegex.exec(content)) !== null) {
    const toolName = match[1];
    const content = match[2];

    // Extract source marker (✅, 🆕, or 📝)
    const sourceMatch = content.match(/^(✅|🆕|📝)/);
    const source = (sourceMatch?.[1] || '📝') as '✅' | '🆕' | '📝';

    // Remove the source marker and trim
    const promptContent = content.replace(/^(✅|🆕|📝)\s*/, '').trim();

    prompts.push({
      toolName,
      promptContent,
      source,
    });
  }

  return prompts;
}

// ============================================================================
// Database Operations
// ============================================================================

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

async function checkExistingPrompt(featureKey: string): Promise<boolean> {
  try {
    const existing = await FunctionalPromptActions.findByFeatureKey(featureKey);
    return !!existing;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`  [DB ERROR] Failed to check if featureKey="${featureKey}" exists:`, error);
    throw error;
  }
}

async function createPrompt(featureKey: string, promptContent: string): Promise<void> {
  try {
    await FunctionalPromptActions.createOrUpdate(featureKey, promptContent, SYSTEM_USER_ID);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`  [DB ERROR] Failed to create FunctionalPrompt for "${featureKey}":`, error);
    throw error;
  }
}

async function updatePrompt(featureKey: string, promptContent: string): Promise<void> {
  try {
    await FunctionalPromptActions.createOrUpdate(featureKey, promptContent, SYSTEM_USER_ID);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`  [DB ERROR] Failed to update FunctionalPrompt for "${featureKey}":`, error);
    throw error;
  }
}

// ============================================================================
// Main Script
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const updateExisting = args.includes('--update-existing');

  console.log('================================================================================');
  console.log('FUNCTIONAL PROMPTS IMPORT SCRIPT');
  console.log('================================================================================');
  console.log(`Mode: ${isDryRun ? '🔍 DRY RUN (no changes will be made)' : '💾 LIVE (will modify database)'}`);
  console.log(`Update existing: ${updateExisting ? '✅ Yes' : '❌ No (skip existing)'}`);
  console.log('');

  // Parse the prompts file
  const promptsFile = path.join(__dirname, 'functional-prompts-refactored.txt');
  console.log(`📖 Reading prompts from: ${promptsFile}`);
  
  if (!fs.existsSync(promptsFile)) {
    console.error(`❌ Error: File not found: ${promptsFile}`);
    process.exit(1);
  }

  const prompts = parsePromptsFile(promptsFile);
  console.log(`✅ Parsed ${prompts.length} tool prompts\n`);

  // Statistics
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  // Process each prompt
  for (const prompt of prompts) {
    const { toolName, promptContent, source } = prompt;
    
    console.log(`\n[${source}] Processing tool: ${toolName}`);
    console.log(`  Prompt length: ${promptContent.length} characters`);

    try {
      if (isDryRun) {
        console.log(`  [DRY RUN] Would create/update featureKey="${toolName}"`);
        console.log(`  [DRY RUN] Content preview: ${promptContent.substring(0, 80)}...`);
        created++;
      } else {
        // Check if prompt already exists
        const exists = await checkExistingPrompt(toolName);

        if (exists) {
          if (updateExisting) {
            await updatePrompt(toolName, promptContent);
            console.log(`  ✅ Updated existing prompt`);
            updated++;
          } else {
            console.log(`  ⏭️  Skipped (already exists, use --update-existing to update)`);
            skipped++;
          }
        } else {
          await createPrompt(toolName, promptContent);
          console.log(`  ✅ Created new prompt`);
          created++;
        }
      }
    } catch (error) {
      console.error(`  ❌ Error processing ${toolName}:`, error);
      errors++;
    }
  }

  // Print summary
  console.log('\n');
  console.log('================================================================================');
  console.log('SUMMARY');
  console.log('================================================================================');
  console.log(`Total prompts processed: ${prompts.length}`);
  console.log(`✅ Created: ${created}`);
  console.log(`🔄 Updated: ${updated}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`❌ Errors: ${errors}`);
  console.log('');

  if (isDryRun) {
    console.log('🔍 This was a DRY RUN - no changes were made to the database.');
    console.log('   Run without --dry-run to actually create the records.');
  } else {
    console.log('💾 Import complete!');
  }

  console.log('================================================================================');
}

// Run the script
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

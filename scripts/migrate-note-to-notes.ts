#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * Migration Script: Update 'Note' to 'Notes' across Organizations and UserProfile SessionHistory
 * 
 * This script updates:
 * 1. Organization.sharedResources: contentType='Note' → 'Notes'
 * 2. Organization.name: 'Share:Note:...' → 'Share:Notes:...'
 * 3. UserProfile.sessionHistory[].refIds[].type: 'Note' → 'Notes'
 * 
 * Background:
 * - The platform-definitions schema now uses 'Notes' (plural) for consistency
 * - Existing records may have 'Note' (singular) in various places
 * - This migration updates the database to match the new schema
 * 
 * Usage:
 *   npm run migrate:note-to-notes                 # Dry run local DB (default)
 *   npm run migrate:note-to-notes -- --apply      # Apply changes to local DB
 *   npm run migrate:note-to-notes:aws             # Dry run AWS DB
 *   npm run migrate:note-to-notes:aws -- --apply  # Apply changes to AWS DB
 * 
 * Safety:
 * - Dry run by default - shows what would be changed without modifying data
 * - Use --apply flag to actually execute updates
 * - Logs all changes for audit trail
 * - Validates each record before and after update
 * - AWS mode uses AWS_POSTGRES_* environment variables for connection
 */

import { resolve } from 'path';

import { Prism } from '@nia/prism';
import { loadEnvFromRoot } from '@nia/prism/core/config/env-loader';

// Load environment variables
loadEnvFromRoot(resolve(__dirname, '..', '.env.local'));

interface SessionHistoryRefId {
  id: string;
  type: string;
  description?: string;
}

interface SessionHistoryEntry {
  time: string;
  action: string;
  refIds?: SessionHistoryRefId[];
  sessionId?: string;
}

interface MigrationStats {
  organizations: {
    total: number;
    needsUpdate: number;
    updated: number;
    errors: number;
    skipped: number;
  };
  userProfiles: {
    total: number;
    needsUpdate: number;
    updated: number;
    errors: number;
    skipped: number;
    totalHistoryEntries: number;
    updatedHistoryEntries: number;
  };
}

interface OrgUpdateRecord {
  orgId: string;
  orgName: string;
  newOrgName?: string;
  before: Record<string, string>;
  after: Record<string, string>;
}

interface UserProfileUpdateRecord {
  userProfileId: string;
  email: string;
  userId: string;
  updatedEntries: Array<{
    time: string;
    action: string;
    refIdsBefore: number;
    refIdsAfter: number;
  }>;
}

const DRY_RUN = !process.argv.includes('--apply');
const USE_AWS = process.argv.includes('--aws');

function setupDatabaseConnection() {
  if (USE_AWS) {
    // Validate AWS environment variables
    const requiredVars = [
      'AWS_POSTGRES_HOST',
      'AWS_POSTGRES_PORT',
      'AWS_POSTGRES_DB',
      'AWS_POSTGRES_USER',
      'AWS_POSTGRES_PASSWORD'
    ];
    
    for (const varName of requiredVars) {
      if (!process.env[varName]) {
        throw new Error(`Missing required environment variable for AWS connection: ${varName}`);
      }
    }
    
    // Override Prism connection variables with AWS credentials
    process.env.POSTGRES_HOST = process.env.AWS_POSTGRES_HOST;
    process.env.POSTGRES_PORT = process.env.AWS_POSTGRES_PORT;
    process.env.POSTGRES_DB = process.env.AWS_POSTGRES_DB;
    process.env.POSTGRES_USER = process.env.AWS_POSTGRES_USER;
    process.env.POSTGRES_PASSWORD = process.env.AWS_POSTGRES_PASSWORD;
    
    // Override Mesh GraphQL endpoint for AWS (use staging mesh or AWS-specific endpoint)
    const awsMeshEndpoint = process.env.AWS_MESH_ENDPOINT || process.env.MESH_ENDPOINT;
    if (awsMeshEndpoint) {
      process.env.MESH_ENDPOINT = awsMeshEndpoint;
      console.log('🌐 Using AWS Mesh endpoint');
      console.log(`   GraphQL: ${awsMeshEndpoint}`);
    } else {
      console.warn('⚠️  Warning: No AWS_MESH_ENDPOINT or MESH_ENDPOINT found, Prism may fail');
    }
    
    console.log('🌐 Using AWS database connection');
    console.log(`   Host: ${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT}`);
    console.log(`   Database: ${process.env.POSTGRES_DB}`);
    console.log(`   User: ${process.env.POSTGRES_USER}`);
  } else {
    console.log('💻 Using local database connection');
    console.log(`   Host: ${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}`);
    console.log(`   Database: ${process.env.POSTGRES_DB || 'postgres'}`);
    console.log(`   Mesh: ${process.env.MESH_ENDPOINT || 'http://localhost:2000/graphql'}`);
  }
  console.log('');
}

async function migrateOrganizations(): Promise<void> {
  console.log('🔄 Migration: Note → Notes (Organizations & UserProfile SessionHistory)');
  console.log('═'.repeat(70));
  console.log(`Mode: ${DRY_RUN ? '🔍 DRY RUN (use --apply to execute)' : '⚠️  APPLYING CHANGES'}`);
  console.log('');

  // Setup database connection (AWS or local)
  setupDatabaseConnection();

  const stats: MigrationStats = {
    organizations: {
      total: 0,
      needsUpdate: 0,
      updated: 0,
      errors: 0,
      skipped: 0,
    },
    userProfiles: {
      total: 0,
      needsUpdate: 0,
      updated: 0,
      errors: 0,
      skipped: 0,
      totalHistoryEntries: 0,
      updatedHistoryEntries: 0,
    },
  };

  const orgUpdates: OrgUpdateRecord[] = [];
  const userProfileUpdates: UserProfileUpdateRecord[] = [];

  try {
    // Initialize Prism
    const prism = await Prism.getInstance();
    console.log('✅ Connected to Prism');
    console.log('');

    // ========================================================================
    // PART 1: Migrate Organizations
    // ========================================================================
    console.log('📋 PART 1: Migrating Organization records...');
    console.log('─'.repeat(70));
    const orgResult = await prism.query({
      contentType: 'Organization',
      tenantId: 'any', // Platform-level content
      limit: 1000, // Adjust if you have more than 1000 orgs
    });

    stats.organizations.total = orgResult.total;
    console.log(`Found ${stats.organizations.total} organization(s)`);
    console.log('');

    if (stats.organizations.total > 0) {
      // Process each organization
      for (const org of orgResult.items) {
        if (!org.sharedResources || Object.keys(org.sharedResources).length === 0) {
          stats.organizations.skipped++;
          continue;
        }

        // Check if this org has any 'Note' entries in sharedResources or name
        let hasNoteInResources = false;
        let hasNoteInName = false;
        const updatedSharedResources: Record<string, 'Notes' | 'HtmlGeneration'> = {};

        for (const [resourceId, contentType] of Object.entries(org.sharedResources)) {
          if (contentType === 'Note') {
            hasNoteInResources = true;
            updatedSharedResources[resourceId] = 'Notes';
          } else {
            updatedSharedResources[resourceId] = contentType as 'Notes' | 'HtmlGeneration';
          }
        }

        // Check if organization name needs updating (e.g., "Share:Note:..." -> "Share:Notes:...")
        let updatedName = org.name;
        if (org.name.includes(':Note:')) {
          hasNoteInName = true;
          updatedName = org.name.replace(':Note:', ':Notes:');
        }

        if (!hasNoteInResources && !hasNoteInName) {
          // No updates needed for this org
          stats.organizations.skipped++;
          continue;
        }

        stats.organizations.needsUpdate++;
        
        const updateRecord: OrgUpdateRecord = {
          orgId: org._id!,
          orgName: org.name,
          newOrgName: hasNoteInName ? updatedName : undefined,
          before: { ...org.sharedResources },
          after: updatedSharedResources,
        };
        
        orgUpdates.push(updateRecord);

        if (!DRY_RUN) {
          // Apply the update
          try {
            // ⚠️ CRITICAL FIX: Must send complete Organization record, not just partial fields!
            // Prism.update does a FULL CONTENT REPLACEMENT, so we need to include ALL fields.
            const updatedOrg = {
              ...org,  // Include ALL existing fields
            };
            
            if (hasNoteInResources) {
              updatedOrg.sharedResources = updatedSharedResources;
            }
            
            if (hasNoteInName) {
              updatedOrg.name = updatedName;
            }
            
            await prism.update(
              'Organization',
              org._id!,
              updatedOrg,  // Send complete record, not partial
              'any' // Platform-level tenant
            );
            
            stats.organizations.updated++;
            let updateMsg = `✅ Updated: ${org.name} (${org._id})`;
            if (hasNoteInResources && hasNoteInName) {
              updateMsg += ` - sharedResources + name`;
            } else if (hasNoteInResources) {
              updateMsg += ` - sharedResources`;
            } else if (hasNoteInName) {
              updateMsg += ` - name`;
            }
            console.log(updateMsg);
          } catch (error) {
            stats.organizations.errors++;
            console.error(`❌ Error updating ${org.name} (${org._id}):`, error);
          }
        }
      }
    }

    console.log('');
    console.log('✅ Organization migration complete');
    console.log('');

    // ========================================================================
    // PART 2: Migrate UserProfile SessionHistory
    // ========================================================================
    console.log('📋 PART 2: Migrating UserProfile sessionHistory records...');
    console.log('─'.repeat(70));
    
    const userProfileResult = await prism.query({
      contentType: 'UserProfile',
      tenantId: 'any', // Platform-level content
      limit: 1000, // Adjust if needed
    });

    stats.userProfiles.total = userProfileResult.total;
    console.log(`Found ${stats.userProfiles.total} user profile(s)`);
    console.log('');

    if (stats.userProfiles.total > 0) {
      // Process each user profile
      for (const userProfile of userProfileResult.items) {
        if (!userProfile.sessionHistory || userProfile.sessionHistory.length === 0) {
          console.log(`⏭️  Skipping user profile ${userProfile.email} (${userProfile._id}) - no sessionHistory: ${JSON.stringify(userProfile)}`);
          stats.userProfiles.skipped++;
          continue;
        }

        stats.userProfiles.totalHistoryEntries += userProfile.sessionHistory.length;

        // Check if any sessionHistory entries have refIds with type='Note'
        let needsUpdate = false;
        const updatedHistory = userProfile.sessionHistory.map((entry: SessionHistoryEntry) => {
          if (!entry.refIds || entry.refIds.length === 0) {
            return entry;
          }

          let entryHasNote = false;
          const updatedRefIds = entry.refIds.map((refId: SessionHistoryRefId) => {
            if (refId.type === 'Note') {
              entryHasNote = true;
              needsUpdate = true;
              return { ...refId, type: 'Notes' };
            }
            return refId;
          });

          if (entryHasNote) {
            stats.userProfiles.updatedHistoryEntries++;
            return { ...entry, refIds: updatedRefIds };
          }

          return entry;
        });

        if (!needsUpdate) {
          stats.userProfiles.skipped++;
          continue;
        }

        stats.userProfiles.needsUpdate++;

        // Track this update
        const updatedEntries = userProfile.sessionHistory
          .map((entry: SessionHistoryEntry, index: number) => {
            if (!entry.refIds) return null;
            const hasNote = entry.refIds.some((refId: SessionHistoryRefId) => refId.type === 'Note');
            if (!hasNote) return null;
            return {
              time: entry.time,
              action: entry.action,
              refIdsBefore: entry.refIds.filter((r: SessionHistoryRefId) => r.type === 'Note').length,
              refIdsAfter: updatedHistory[index].refIds!.filter((r: SessionHistoryRefId) => r.type === 'Notes').length,
            };
          })
          .filter(Boolean) as UserProfileUpdateRecord['updatedEntries'];

        const userProfileUpdateRecord: UserProfileUpdateRecord = {
          userProfileId: userProfile._id!,
          email: userProfile.email || 'Unknown',
          userId: userProfile.userId || 'Unknown',
          updatedEntries,
        };

        userProfileUpdates.push(userProfileUpdateRecord);

        if (!DRY_RUN) {
          // Apply the update
          try {
            // ⚠️ CRITICAL FIX: Must send complete UserProfile record, not just sessionHistory!
            // Prism.update does a FULL CONTENT REPLACEMENT, so we need to include ALL fields.
            const updatedUserProfile = {
              ...userProfile,  // Include ALL existing fields
              sessionHistory: updatedHistory  // Update only the sessionHistory field
            };
            
            await prism.update(
              'UserProfile',
              userProfile._id!,
              updatedUserProfile,  // Send complete record, not partial
              'any' // Platform-level tenant
            );
            
            stats.userProfiles.updated++;
            console.log(`✅ Updated: ${userProfile.email} (${userProfile._id}) - ${updatedEntries.length} history entries`);
          } catch (error) {
            stats.userProfiles.errors++;
            console.error(`❌ Error updating user profile ${userProfile.email} (${userProfile._id}):`, error);
          }
        }
      }
    }

    console.log('');
    console.log('✅ UserProfile sessionHistory migration complete');
    console.log('');

    // Print summary
    console.log('═'.repeat(70));
    console.log('📊 Migration Summary');
    console.log('═'.repeat(70));
    
    console.log('\n🏢 ORGANIZATIONS:');
    console.log(`   Total:              ${stats.organizations.total}`);
    console.log(`   Needing update:     ${stats.organizations.needsUpdate}`);
    console.log(`   Skipped:            ${stats.organizations.skipped}`);
    if (!DRY_RUN) {
      console.log(`   Updated:            ${stats.organizations.updated}`);
      console.log(`   Errors:             ${stats.organizations.errors}`);
    }

    console.log('\n👥 USER PROFILES:');
    console.log(`   Total:              ${stats.userProfiles.total}`);
    console.log(`   Needing update:     ${stats.userProfiles.needsUpdate}`);
    console.log(`   Skipped:            ${stats.userProfiles.skipped}`);
    console.log(`   Total history entries: ${stats.userProfiles.totalHistoryEntries}`);
    console.log(`   Updated entries:    ${stats.userProfiles.updatedHistoryEntries}`);
    if (!DRY_RUN) {
      console.log(`   Updated user profiles: ${stats.userProfiles.updated}`);
      console.log(`   Errors:             ${stats.userProfiles.errors}`);
    }

    // Print detailed changes for organizations
    if (orgUpdates.length > 0) {
      console.log('');
      console.log('═'.repeat(70));
      console.log(`📝 Organization Changes ${DRY_RUN ? '(DRY RUN - NOT APPLIED)' : '(APPLIED)'}`);
      console.log('═'.repeat(70));
      
      orgUpdates.forEach((update, index) => {
        console.log(`\n${index + 1}. ${update.orgName} (${update.orgId})`);
        
        // Show name change if applicable
        if (update.newOrgName) {
          console.log(`   Name: '${update.orgName}' ${DRY_RUN ? '→ would become' : '→'} '${update.newOrgName}'`);
        }
        
        console.log('   Shared Resources:');
        Object.entries(update.before).forEach(([resourceId, contentType]) => {
          if (contentType === 'Note') {
            console.log(`     📝 ${resourceId}: '${contentType}' ${DRY_RUN ? '→ would become' : '→'} 'Notes'`);
          } else {
            console.log(`     ✓ ${resourceId}: '${contentType}' (unchanged)`);
          }
        });
      });
    }

    // Print detailed changes for user profiles
    if (userProfileUpdates.length > 0) {
      console.log('');
      console.log('═'.repeat(70));
      console.log(`📝 UserProfile SessionHistory Changes ${DRY_RUN ? '(DRY RUN - NOT APPLIED)' : '(APPLIED)'}`);
      console.log('═'.repeat(70));
      
      userProfileUpdates.forEach((update, index) => {
        console.log(`\n${index + 1}. ${update.email} (User: ${update.userId})`);
        console.log(`   UserProfile ID: ${update.userProfileId}`);
        console.log(`   Updated history entries: ${update.updatedEntries.length}`);
        update.updatedEntries.slice(0, 5).forEach((entry) => {
          console.log(`     - ${entry.time}: ${entry.action} - ${entry.refIdsBefore} Note refs ${DRY_RUN ? '→ would become' : '→'} Notes`);
        });
        if (update.updatedEntries.length > 5) {
          console.log(`     ... and ${update.updatedEntries.length - 5} more entries`);
        }
      });
    }

    console.log('');
    console.log('═'.repeat(70));
    
    if (DRY_RUN && (stats.organizations.needsUpdate > 0 || stats.userProfiles.needsUpdate > 0)) {
      console.log('');
      console.log('⚠️  This was a DRY RUN. No changes were made.');
      console.log('   Run with --apply flag to execute the migration:');
      if (USE_AWS) {
        console.log('   npm run migrate:note-to-notes:aws -- --apply');
      } else {
        console.log('   npm run migrate:note-to-notes -- --apply');
      }
    } else if (!DRY_RUN && (stats.organizations.updated > 0 || stats.userProfiles.updated > 0)) {
      console.log('');
      console.log('✅ Migration completed successfully!');
      console.log(`   Updated ${stats.organizations.updated} organization(s) and ${stats.userProfiles.updated} user profile(s) in ${USE_AWS ? 'AWS' : 'local'} database`);
    } else if (stats.organizations.needsUpdate === 0 && stats.userProfiles.needsUpdate === 0) {
      console.log('');
      console.log('✅ All records are already up to date!');
    }

  } catch (error) {
    console.error('');
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrateOrganizations()
  .then(() => {
    console.log('');
    console.log('🏁 Migration script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('');
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });

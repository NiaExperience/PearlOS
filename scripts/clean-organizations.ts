#!/usr/bin/env tsx
/**
 * Script to delete all Organization and UserOrganizationRole records from the database
 * Usage: npx tsx scripts/clean-organizations.ts
 */

import * as path from 'path';

import * as dotenv from 'dotenv';

import { PrismGraphQLClient } from '../packages/prism/src/data-bridge/PrismGraphQLClient';

// Load .env.local from the project root
const envPath = path.resolve(__dirname, '../.env.local');
const result = dotenv.config({ path: envPath });

/* eslint-disable no-console */
if (result.error) {
  console.warn(`⚠️  Could not load .env.local from ${envPath}`);
  console.warn('   Falling back to process.env variables');
} else {
  console.log(`✅ Loaded environment from ${envPath}`);
}
/* eslint-enable no-console */

const ORGANIZATION_TYPE = 'Organization';
const USER_ORG_ROLE_TYPE = 'UserOrganizationRole';

async function cleanOrganizations() {
  /* eslint-disable no-console */
  console.log('🔥 Starting organization cleanup...\n');

  try {
    const client = new PrismGraphQLClient();

    // Delete all UserOrganizationRole records first (to avoid foreign key issues)
    console.log('📋 Fetching all UserOrganizationRole records...');
    const rolesResult = await client.findContent(
      USER_ORG_ROLE_TYPE,
      {},
      10000
    );

    if (rolesResult.items && rolesResult.items.length > 0) {
      console.log(`🗑️  Deleting ${rolesResult.items.length} UserOrganizationRole records...`);
      let deletedRoles = 0;
      
      for (const role of rolesResult.items) {
        if (role.page_id) {
          await client.deleteContent(role.page_id);
          deletedRoles++;
          if (deletedRoles % 10 === 0) {
            process.stdout.write(`   Deleted ${deletedRoles}/${rolesResult.items.length} roles...\r`);
          }
        }
      }
      console.log(`✅ Deleted ${deletedRoles} UserOrganizationRole records\n`);
    } else {
      console.log('ℹ️  No UserOrganizationRole records found\n');
    }

    // Delete all Organization records
    console.log('📋 Fetching all Organization records...');
    const orgsResult = await client.findContent(
      ORGANIZATION_TYPE,
      {},
      10000
    );

    if (orgsResult.items && orgsResult.items.length > 0) {
      console.log(`🗑️  Deleting ${orgsResult.items.length} Organization records...`);
      let deletedOrgs = 0;
      
      for (const org of orgsResult.items) {
        if (org.page_id) {
          await client.deleteContent(org.page_id);
          deletedOrgs++;
          if (deletedOrgs % 10 === 0) {
            process.stdout.write(`   Deleted ${deletedOrgs}/${orgsResult.items.length} organizations...\r`);
          }
        }
      }
      console.log(`✅ Deleted ${deletedOrgs} Organization records\n`);
    } else {
      console.log('ℹ️  No Organization records found\n');
    }

    console.log('🎉 Cleanup complete!');
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  }
  /* eslint-enable no-console */
}

cleanOrganizations();

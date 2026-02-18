/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * copy-content-to-aws.ts
 *
 * Selectively copy a single content record from the local Postgres-backed Mesh (source)
 * to the AWS/staging Mesh (target) using PrismGraphQLClient. Authentication mirrors
 * the approach from clone-aws-db.ts by loading env from the repo root and leveraging
 * the shared secret header.
 *
 * Usage:
 *   ts-node scripts/copy-content-to-aws.ts --type <DynamicBlockType> --page <page_id>
 *     [--tenant <tenantId|any>] [--source <sourceGraphQLEndpoint>] [--target <targetGraphQLEndpoint>]
 *     [--source-secret <secret>] [--target-secret <secret>]
 *
 * Notes:
 * - The script validates connectivity to both Prism instances and verifies that the
 *   'Assistant' definition exists in both before proceeding.
 * - It fetches the specified record from the source by page_id and type, then upserts
 *   it into the target (update if exists, otherwise create).
 */

import { resolve } from 'path';


import { Prism } from '@nia/prism';
import { ContentData } from '@nia/prism/core/content/types';
import * as dotenv from 'dotenv';

// Load environment variables from repo root (.env.local)
dotenv.config({ path: resolve(__dirname, '..', '.env.local') });

type Args = {
  type: string;
  tenant: string;
  source?: string;
  target?: string;
  sourceSecret?: string;
  targetSecret?: string;
  pageIds?: string[];
  dryRun?: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    switch (key) {
      case '--type':
      case '-t':
        args.type = val; i++; break;
      case '--tenant':
        args.tenant = val; i++; break;
      case '--source':
        args.source = val; i++; break;
      case '--target':
        args.target = val; i++; break;
      case '--source-secret':
        args.sourceSecret = val; i++; break;
      case '--target-secret':
        args.targetSecret = val; i++; break;
      case '--page':
      case '-p':
        if (!args.pageIds) args.pageIds = [];
        args.pageIds.push(val); i++; break;
      case '--page-ids':
        if (!args.pageIds) args.pageIds = [];
        args.pageIds.push(...val.split(',').map(s => s.trim())); i++; break;
      case '--dry-run':
        args.dryRun = true; break;
      default:
        // ignore unknown flags for now
        break;
    }
  }

  if (!args.type ) {
    console.error('Missing required arguments.');
    console.error('Required: --type <DynamicBlockType>');
    process.exit(1);
  }

  const source = args.source || process.env.MESH_ENDPOINT || process.env.GRAPHQL_ENDPOINT || 'http://localhost:2000/graphql';
  const target = args.target || process.env.STAGING_MESH_ENDPOINT || 'https://staging-mesh.example.com/graphql';

  // Helper to guess secret from URL if not provided
  const guessSecret = (url: string, explicit?: string) => {
    if (explicit) return explicit;
    if (url.includes('stg')) return process.env.STG_MESH_SHARED_SECRET || process.env.STAGING_MESH_SHARED_SECRET || process.env.MESH_SHARED_SECRET;
    if (url.includes('pearlos')) return process.env.PROD_MESH_SHARED_SECRET || process.env.MESH_SHARED_SECRET;
    return process.env.MESH_SHARED_SECRET;
  };

  return {
    type: args.type!,
    tenant: args.tenant || 'any',
    source,
    target,
    sourceSecret: guessSecret(source, args.sourceSecret),
    targetSecret: guessSecret(target, args.targetSecret),
    pageIds: args.pageIds,
    dryRun: args.dryRun
  };
}

async function getRecords(prism: Prism, contentType: string, tenantId: string, pageIds?: string[]): Promise<ContentData[]> {
  // Fetch records
  const query: any = {
    contentType: contentType,
    tenantId: tenantId,
    limit: 1000 // Fetch all prompts
  };

  if (pageIds && pageIds.length > 0) {
    query.where = { page_id: { in: pageIds } };
  }

  const allRecords = await prism.query(query);

  console.log(`🔎 Found ${allRecords.total} total ${contentType} records.`);

  return allRecords.items;
}

function sanitizeContent(content: any, isUpdate: boolean, targetTenantId?: string): any {
  // Remove system fields that shouldn't be written directly
  const { 
    createdAt, 
    updatedAt, 
    version, 
    lastModifiedByUserId, 
    _id, 
    tenantId,
    ...rest 
  } = content;
  
  const sanitized: any = { ...rest };

  // Only include _id if it's NOT an update (i.e. create)
  // For update, the ID is passed as the blockId argument, so we don't need it in the body.
  if (!isUpdate) {
    sanitized._id = content._id;
  }

  // Ensure tenantId matches the target tenant if provided
  if (targetTenantId && targetTenantId !== 'any') {
    sanitized.tenantId = targetTenantId;
  } else if (tenantId) {
    sanitized.tenantId = tenantId;
  }

  return sanitized;
}

async function main() {
  const args = parseArgs();
  console.log('▶️ Starting selective content copy (Prism-based)');
  console.log(`- Source (env/default): ${args.source}`);
  console.log(`- Target endpoint: ${args.target}`);
  console.log(`- Type: ${args.type}`);
  console.log(`- Tenant: ${args.tenant}`);
  if (args.pageIds?.length) {
    console.log(`- Page IDs: ${args.pageIds.join(', ')}`);
  }
  if (args.dryRun) {
    console.log('⚠️  DRY RUN MODE: No changes will be made to the target.');
  }

  // Instantiate Prism instances. We temporarily set secrets before each getInstance call
  const originalSecret = process.env.MESH_SHARED_SECRET;
  const originalEndpoint = process.env.MESH_ENDPOINT;

  // Source Prism: allow custom secret; endpoint handled implicitly (user requested no params needed).
  if (args.sourceSecret) process.env.MESH_SHARED_SECRET = args.sourceSecret;
  if (args.source) process.env.MESH_ENDPOINT = args.source; // only influences factory default
  const sourcePrism = await Prism.getInstance();

  // Target Prism: set secret then pass endpoint option explicitly
  if (args.targetSecret) process.env.MESH_SHARED_SECRET = args.targetSecret;
  const targetPrism = await Prism.getInstance({ endpoint: args.target });

  // Restore env so we don't leak modified secrets
  process.env.MESH_SHARED_SECRET = originalSecret;
  process.env.MESH_ENDPOINT = originalEndpoint;

  // Basic readiness checks
  console.log('🔎 Validating Prism readiness...');
  const [srcReady, tgtReady] = await Promise.all([
    sourcePrism.isReady(),
    targetPrism.isReady(),
  ]);
  if (!srcReady || !tgtReady) {
    console.error('One or both Prism instances are not ready.');
    process.exit(1);
  }
  // Now, we copy records from source to target:

  // 1. get the requested record
  // 2. if it's an assistant, get the content
  // 3. copy/update the target records

  // Fetch all source records
  const contentType = args.type;
  console.log(`🔎 Fetching ${contentType} records fm source...`);
  const records = await getRecords(sourcePrism, contentType, args.tenant, args.pageIds);
  // create a map of page_id to content (any)
  const contentMap: Record<string, ContentData> = {};
  contentMap[contentType] = records;

  // Check target
  for (const [contentType, contents] of Object.entries(contentMap)) {
    const contentArray = Array.isArray(contents) ? contents : [contents];
    for (const content of contentArray) {
      console.log('🔎 Checking target for existing record...');
      
      const targetResult = await targetPrism.query({
        contentType: contentType,
        tenantId: args.tenant,
        where: { page_id: { eq: content._id } },
        limit: 1
      });

      if (targetResult.total > 0) {
        console.log(`♻️  ${contentType} Record exists on target. Replacing ...`);
        if (args.dryRun) {
          console.log('⚠️  [DRY RUN] Skipping replace.');
          continue;
        }
        
        const sanitizedContent = sanitizeContent(content, true, args.tenant);
        // Use replace instead of update to avoid partial update logic (which has issues with SQL literals)
        // and to ensure target exactly matches source (removing deleted fields)
        const updateRes = await targetPrism.replace(contentType, content._id, sanitizedContent, args.tenant);
        if (updateRes.total === 0) {
          console.error('Replace operation returned no items.');
          process.exit(1);
        }
        console.log('✅ Replace complete.', updateRes.items[0]._id);
      } else {

        // We need to know if the content definition exists on the target, else we copy the 
        // one from local
        const targetContentDef = await targetPrism.findDefinition(contentType);
        if (targetContentDef.total === 0) {
          console.log(`➕ Creating ${contentType} definition record on target ...`);
          const srcContentDef = await sourcePrism.findDefinition(contentType);
          if (srcContentDef.total === 0) {
            console.error('Source content definition not found. ABORTING.');
            process.exit(1);
          }
          console.log(`✅ Source content definition found:`, srcContentDef.items[0]);
          
          if (args.dryRun) {
            console.log('⚠️  [DRY RUN] Skipping definition creation.');
          } else {
            // Create the content definition on the target
            const createDefRes = await targetPrism.createDefinition(srcContentDef.items[0]);
            if (createDefRes.total === 0) {
              console.error('Create definition operation returned no items.');
              process.exit(1);
            }
            console.log('✅ Create definition complete.');
          }
        }

        if (args.dryRun) {
          console.log(`⚠️  [DRY RUN] Skipping creation of ${contentType} record.`);
          continue;
        }

        const sanitizedContent = sanitizeContent(content, false, args.tenant);
        const createdRes = await targetPrism.create(contentType, sanitizedContent, args.tenant);
        if (createdRes.total === 0) {
          console.error('Create operation returned no items.');
          process.exit(1);
        }
        console.log('✅ Create complete.');
      }
    }
  }

  console.log('🎉 Copy finished successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});

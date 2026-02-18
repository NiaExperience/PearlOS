/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * delete-tenant-aws.ts
 *
 * Deletes ALL Tenant records in the staging (AWS) Mesh whose name exactly matches
 * the provided --name (default: "Tenant Nia"). Uses the Prism abstraction layer
 * (same pattern as other aws scripts) to query and delete content via GraphQL.
 *
 * SAFETY: Runs in dry-run mode by default. Pass --execute (or --no-dry-run) to
 * actually perform deletions.
 *
 * Usage examples:
 *   npx ts-node scripts/delete-tenant-aws.ts               # dry-run (default)
 *   npx ts-node scripts/delete-tenant-aws.ts --name "Tenant Nia" # explicit name
 *   npx ts-node scripts/delete-tenant-aws.ts --execute     # perform deletions
 *   npx ts-node scripts/delete-tenant-aws.ts --endpoint https://staging-mesh.example.com/graphql --secret <shared_secret>
 *
 * Flags:
 *   --name <string>        Tenant name to match (exact). Default: "Tenant Nia"
 *   --endpoint <url>       Override staging GraphQL endpoint (falls back to STAGING_MESH_ENDPOINT || MESH_ENDPOINT)
 *   --secret <string>      Shared secret for auth (falls back to STAGING_MESH_SHARED_SECRET || MESH_SHARED_SECRET)
 *   --execute | --no-dry-run  Actually delete the tenants (otherwise just list)
 *   --limit <n>            Optional safety cap (max tenants to operate on). Default: unlimited
 *   --json                 Output machine-readable JSON summary at end
 */

import { resolve } from 'path';

import { Prism } from '@nia/prism';
import { loadEnvFromRoot } from '@nia/prism/core/config/env-loader';

// Block type constants (avoid deep imports for safety; mirror strings in blocks)
const BLOCK_TENANT = 'Tenant';
const BLOCK_USER_TENANT_ROLE = 'UserTenantRole';
const BLOCK_ASSISTANT = 'Assistant';
const BLOCK_DYNAMIC_CONTENT = 'DynamicContent';

// Additional candidate content types that may have parent_id = tenantId (based on platform content)
const CANDIDATE_PARENT_CHILD_TYPES: string[] = [
  'Organization',
  'UserOrganizationRole',
  'Activity', 'Agenda', 'EventMap', 'Exhibitor', 'Guest', 'IframeKeyword', 'KeywordMemory',
  'MenuItem', 'Photo', 'Registration', 'Service', 'ShoreExcursion', 'Speaker'
];

// Load root env (.env.local) like other aws scripts
loadEnvFromRoot(resolve(__dirname, '..', '.env.local'));

interface Args {
  name: string;
  endpoint?: string;
  secret?: string;
  execute: boolean;
  limit?: number;
  json: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    switch (key) {
      case '--name':
        args.name = val; i++; break;
      case '--endpoint':
        args.endpoint = val; i++; break;
      case '--secret':
        args.secret = val; i++; break;
      case '--execute':
      case '--no-dry-run':
        args.execute = true; break;
      case '--limit':
        args.limit = Number(val); i++; break;
      case '--json':
        args.json = true; break;
      default:
        // ignore unknown flags so script stays forward-compatible
        break;
    }
  }
  return {
    name: args.name || 'Tenant Nia',
    endpoint: args.endpoint || process.env.STAGING_MESH_ENDPOINT || process.env.MESH_ENDPOINT,
    secret: args.secret || process.env.STAGING_MESH_SHARED_SECRET || process.env.MESH_SHARED_SECRET,
    execute: !!args.execute,
    limit: args.limit,
    json: !!args.json,
  };
}

type TenantRecord = {
  _id?: string;
  page_id?: string; // often mirrors _id
  name?: string;
  [k: string]: any;
};

async function main() {
  const args = parseArgs();
  const started = Date.now();
  console.log(`▶️ Tenant deletion script (dry-run=${!args.execute})`);
  console.log(` Target endpoint: ${args.endpoint || '(default via Prism factory)'}`);
  console.log(` Tenant name filter (exact): "${args.name}"`);
  if (args.limit !== undefined) console.log(` Limit: ${args.limit}`);

  // Prepare Prism instance like other scripts (temporarily override env secret)
  const originalSecret = process.env.MESH_SHARED_SECRET;
  if (args.secret) process.env.MESH_SHARED_SECRET = args.secret;
  const prism = await Prism.getInstance(args.endpoint ? { endpoint: args.endpoint } : {});
  process.env.MESH_SHARED_SECRET = originalSecret; // restore

  // Query Tenants matching the name. We request more than we expect just in case; if many duplicates
  // exist, the operator can use --limit for safety.
  console.log('🔎 Querying for matching tenants...');
  // NotionModelFilter doesn't expose 'name' directly; use indexer path lookup (see migrate-dynamic-data.ts for pattern)
  const where: Record<string, any> = { indexer: { path: 'name', equals: args.name } };
  const result = await prism.query({
    contentType: BLOCK_TENANT,
    tenantId: 'any',
    where,
    // If a limit (cap) provided, use that; else allow a generous upper bound.
    limit: args.limit || 200,
  });

  const items = (result.items || []) as TenantRecord[];
  const total = result.total || items.length;
  console.log(` Found ${total} matching tenant record(s).`);
  if (total === 0) {
    console.log('✅ Nothing to do.');
    if (args.json) {
      console.log(JSON.stringify({ deleted: 0, dryRun: !args.execute, matches: [] }, null, 2));
    }
    return;
  }

  // Summarize matches & (dry-run) related counts
  for (let idx = 0; idx < items.length; idx++) {
    const t = items[idx];
    const tenantId = t.page_id || t._id || '(no id)';
    console.log(`  [${idx}] id=${tenantId} name=${t.name}`);
    if (!args.execute) {
      try {
        // Roles count
        const rolesRes = await prism.query({
          contentType: BLOCK_USER_TENANT_ROLE,
            tenantId: 'any',
            where: { indexer: { path: 'tenantId', equals: tenantId } },
            limit: 1
        } as any);
        const roleCount = rolesRes.total ?? rolesRes.items?.length ?? 0;
        // Assistants count (match filter after fetch)
        const assistantsRes = await prism.query({
          contentType: BLOCK_ASSISTANT,
          tenantId: tenantId,
          where: { indexer: { path: 'tenantId', equals: tenantId } },
          limit: 200
        });
        const assistantCount = (assistantsRes.items || []).filter((a: any) => a.name === 'Nia' || a.subDomain === 'nia').length;
        // DynamicContent definitions
        const dynamicRes = await prism.query({
          contentType: BLOCK_DYNAMIC_CONTENT,
          tenantId: tenantId,
          where: { indexer: { path: 'tenantId', equals: tenantId } },
          limit: 200
        });
        const dynamicCount = dynamicRes.total ?? dynamicRes.items?.length ?? 0;
        // Parent-child generic scan (aggregate counts across types)
        let parentChildCount = 0;
        for (const ct of CANDIDATE_PARENT_CHILD_TYPES) {
          try {
            const res = await prism.query({
              contentType: ct,
              tenantId: tenantId,
              where: { parent_id: { eq: tenantId } },
              limit: 1
            });
            parentChildCount += res.total ?? res.items?.length ?? 0;
          } catch { /* ignore unknown types */ }
        }
        console.log(`     ↳ (dry-run) roles=${roleCount} assistants=${assistantCount} dynamicDefs=${dynamicCount} parentChildren=${parentChildCount}`);
      } catch (e) {
        console.log('     ↳ (dry-run) unable to gather related counts:', (e as Error).message);
      }
    }
  }

  if (!args.execute) {
    console.log('\n🧪 Dry-run complete. Pass --execute to perform deletions.');
    if (args.json) {
      console.log(JSON.stringify({
        deleted: 0,
        dryRun: true,
        matches: items.map(i => ({ id: i.page_id || i._id, name: i.name }))
      }, null, 2));
    }
    return;
  }

  console.log('\n⚠️ EXECUTION MODE: Deleting tenants (with cascading roles & assistants)...');
  let deletedTenants = 0;
  let deletedRoles = 0;
  let deletedAssistants = 0;
  let deletedDynamic = 0;
  let deletedParentChildren = 0;

  for (const t of items) {
    const tenantId = t.page_id || t._id;
    if (!tenantId) {
      console.warn('  Skipping tenant without page_id/_id:', t);
      continue;
    }
    console.log(`\n🧹 Processing tenant ${tenantId} (${t.name})`);
    try {
  // 1. Find assistants for this tenant whose name === 'Nia' OR subDomain === 'nia'
  // GraphQL filter only supports single path match (no anyOf). Fetch all for tenant via tenantId indexer then filter in memory.
  const assistantWhere: Record<string, any> = { indexer: { path: 'tenantId', equals: tenantId } };
      const assistantRes = await prism.query({
        contentType: BLOCK_ASSISTANT,
        tenantId: tenantId,
        where: assistantWhere,
        limit: 200
      });
      const assistantMatches = (assistantRes.items || []).filter((a: any) => a.name === 'Nia' || a.subDomain === 'nia');
      if (assistantMatches.length) {
        console.log(`    🔎 Found ${assistantMatches.length} assistant(s) to delete (name==='Nia' or subDomain==='nia')`);
      }
      for (const a of assistantMatches) {
        try {
          const ok = await prism.delete(BLOCK_ASSISTANT, a._id || a.page_id, tenantId);
          if (ok) {
            deletedAssistants++;
            console.log(`    🗑️  Assistant deleted: ${a._id || a.page_id}`);
          }
        } catch (e) {
          console.warn('    ⚠️ Failed deleting assistant', a._id || a.page_id, (e as Error).message);
        }
      }

      // 2. Delete user tenant roles for this tenant
      const roleQuery = {
        contentType: BLOCK_USER_TENANT_ROLE,
        tenantId: 'any',
        where: { indexer: { path: 'tenantId', equals: tenantId } },
        limit: 500
      };
      const roleRes = await prism.query(roleQuery as any);
      if (roleRes.items?.length) {
        console.log(`    🔎 Found ${roleRes.items.length} tenant role(s) to delete`);
      }
      for (const r of roleRes.items || []) {
        try {
          const ok = await prism.delete(BLOCK_USER_TENANT_ROLE, r._id || r.page_id, 'any');
          if (ok) {
            deletedRoles++;
            console.log(`    🗑️  Role deleted: ${r._id || r.page_id}`);
          }
        } catch (e) {
          console.warn('    ⚠️ Failed deleting role', r._id || r.page_id, (e as Error).message);
        }
      }

      // 2b. Delete DynamicContent definitions for this tenant
      try {
        const dynRes = await prism.query({
          contentType: BLOCK_DYNAMIC_CONTENT,
          tenantId: tenantId,
          where: { indexer: { path: 'tenantId', equals: tenantId } },
          limit: 200
        });
        if (dynRes.items?.length) {
          console.log(`    🔎 Found ${dynRes.items.length} dynamic content definition(s) to delete`);
        }
        for (const d of dynRes.items || []) {
          try {
            const ok = await prism.delete(BLOCK_DYNAMIC_CONTENT, d._id || d.page_id, tenantId);
            if (ok) {
              deletedDynamic++;
              console.log(`    🗑️  DynamicContent deleted: ${d._id || d.page_id}`);
            }
          } catch (e) {
            console.warn('    ⚠️ Failed deleting dynamic content', d._id || d.page_id, (e as Error).message);
          }
        }
      } catch (e) {
        console.warn('    ⚠️ Dynamic content query failed', (e as Error).message);
      }

      // 2c. Delete any items whose parent_id === tenantId (across candidate types)
      for (const ct of CANDIDATE_PARENT_CHILD_TYPES) {
        try {
          const pcRes = await prism.query({
            contentType: ct,
            tenantId: tenantId,
            where: { parent_id: { eq: tenantId } },
            limit: 500
          });
          for (const c of pcRes.items || []) {
            try {
              const ok = await prism.delete(ct, c._id || c.page_id, tenantId);
              if (ok) {
                deletedParentChildren++;
                if (deletedParentChildren <= 10) {
                  console.log(`    🗑️  Child(${ct}) deleted: ${c._id || c.page_id}`);
                }
              }
            } catch (e) {
              console.warn(`    ⚠️ Failed deleting child (${ct})`, c._id || c.page_id, (e as Error).message);
            }
          }
        } catch { /* ignore unknown block types */ }
      }

      // 3. Delete the tenant itself
      const success = await prism.delete(BLOCK_TENANT, tenantId, 'any');
      if (success) {
        deletedTenants++;
        console.log(`    ✅ Tenant deleted: ${tenantId}`);
      } else {
        console.warn(`    ⚠️ Delete returned false for tenant ${tenantId}`);
      }
    } catch (err) {
      console.error(`    ❌ Error processing tenant ${tenantId}:`, (err as Error).message);
    }
  }

  console.log(`\n✅ Summary: Tenants deleted=${deletedTenants}/${items.length}, Roles deleted=${deletedRoles}, Assistants deleted=${deletedAssistants}, DynamicContent deleted=${deletedDynamic}, ParentChildren deleted=${deletedParentChildren}. Elapsed=${Date.now() - started}ms.`);
  if (args.json) {
    console.log(JSON.stringify({
      deletedTenants,
      totalMatched: items.length,
      deletedRoles,
      deletedAssistants,
      deletedDynamic,
      deletedParentChildren,
      dryRun: false,
      matches: items.map(i => ({ id: i.page_id || i._id, name: i.name }))
    }, null, 2));
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appRoot = path.resolve(__dirname, '..');
const apiRoot = path.join(appRoot, 'src/app/api');

const routeScopePattern = /@pearl-route-scope\s+([a-z0-9_-]+)/i;
const validExplicitScopes = new Set([
  'public',
  'internal',
  'signed-webhook',
  'session-user',
  'prism-delegated',
]);

const tenantInputPatterns = [
  /(?:searchParams|nextUrl\.searchParams)\.get\(\s*['"`](tenantId|tenant_id|requester_tenant_id)['"`]\s*\)/,
  /\bbody\??\.(tenantId|tenant_id|requester_tenant_id)\b/,
  /\bbody\?\.\[(?:'|")(tenantId|tenant_id|requester_tenant_id)(?:'|")\]/,
  /\brequestedTenantId\b/,
  /headers\.get\(\s*['"`]x-(?:pearl-)?tenant-id['"`]\s*\)/i,
  /requestedTenantFrom(?:Body|Search)\(/,
];

const resolverPatterns = [
  /\bresolveInterfaceActorContext\b/,
  /@interface\/lib\/tenant-actor/,
  /requestedTenantFrom(?:Body|Search)\(/,
  /scopedBody\(/,
];

const signedInternalPatterns = [
  /\bvalidSignature\b/,
  /\btimingSafeEqual\b/,
  /\bverifyVonageWebhook\b/,
  /\bBOT_CONTROL_SHARED_SECRET\b/,
  /\bPEARL_TASKS_BOT_SECRET\b/,
  /\bTELEGRAM_DM_LINK_SECRET\b/,
  /\bMESH_SHARED_SECRET\b/,
  /headers\.get\(\s*['"`]x-(internal-secret|bot-secret|telegram-dm-link-secret)['"`]\s*\)/i,
];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (entry.isFile() && /^route\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function matchesAny(source, patterns) {
  return patterns.some((pattern) => pattern.test(source));
}

function classifyRoute(source) {
  const annotation = source.match(routeScopePattern)?.[1]?.toLowerCase();
  if (annotation) {
    if (!validExplicitScopes.has(annotation)) {
      return { kind: 'invalid-explicit', annotation };
    }
    return { kind: annotation, explicit: true };
  }

  const uncommented = stripComments(source);
  const readsTenantInput = matchesAny(uncommented, tenantInputPatterns);
  const usesResolver = matchesAny(uncommented, resolverPatterns);
  const signedInternal = matchesAny(uncommented, signedInternalPatterns);

  if (usesResolver) return { kind: 'tenant-resolved' };
  if (signedInternal) return { kind: 'signed-internal' };
  if (readsTenantInput) return { kind: 'unresolved-tenant-input' };
  return { kind: 'public-or-session-local' };
}

function main() {
  if (!fs.existsSync(apiRoot)) {
    throw new Error(`API route root not found: ${apiRoot}`);
  }

  const routes = walk(apiRoot).sort();
  const counts = new Map();
  const violations = [];
  for (const file of routes) {
    const source = fs.readFileSync(file, 'utf8');
    const classification = classifyRoute(source);
    counts.set(classification.kind, (counts.get(classification.kind) || 0) + 1);
    if (classification.kind === 'unresolved-tenant-input' || classification.kind === 'invalid-explicit') {
      violations.push({
        file: path.relative(appRoot, file),
        classification,
      });
    }
  }

  console.log(`Tenant route audit scanned ${routes.length} routes.`);
  for (const [kind, count] of [...counts.entries()].sort()) {
    console.log(`${kind}: ${count}`);
  }

  if (violations.length) {
    console.error('\nTenant route audit failed:');
    for (const violation of violations) {
      if (violation.classification.kind === 'invalid-explicit') {
        console.error(`- ${violation.file}: invalid @pearl-route-scope ${violation.classification.annotation}`);
      } else {
        console.error(`- ${violation.file}: reads tenant input without resolver/internal signature/explicit scope`);
      }
    }
    process.exit(1);
  }
}

main();

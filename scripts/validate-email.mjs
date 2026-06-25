#!/usr/bin/env node
import dns from 'node:dns/promises';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function usage() {
  console.log('Usage: node scripts/validate-email.mjs <email> [--json]');
}

function normalizeDomain(email) {
  return String(email).split('@')[1]?.toLowerCase().trim() || '';
}

async function resolveMailDomain(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    if (mx.length > 0) {
      return { ok: true, type: 'mx', records: mx.map((r) => r.exchange) };
    }
  } catch {
    // continue to A/AAAA fallback
  }

  try {
    const [a, aaaa] = await Promise.allSettled([
      dns.resolve4(domain),
      dns.resolve6(domain),
    ]);
    const addresses = [
      ...(a.status === 'fulfilled' ? a.value : []),
      ...(aaaa.status === 'fulfilled' ? a.value : []),
    ];
    if (addresses.length > 0) {
      return { ok: true, type: 'a_aaaa_fallback', records: addresses };
    }
  } catch {
    // fall through
  }

  return { ok: false, type: 'none', records: [] };
}

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((arg) => !arg.startsWith('--'));
  const asJson = args.includes('--json');

  if (!email) {
    usage();
    process.exitCode = 1;
    return;
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const formatValid = EMAIL_REGEX.test(normalizedEmail);
  const domain = normalizeDomain(normalizedEmail);

  const result = {
    email: normalizedEmail,
    formatValid,
    domain,
    domainResolvable: false,
    resolutionType: 'none',
    records: [],
    existsLikely: false,
    note: 'Mailbox-level existence cannot be guaranteed without provider-side verification APIs.',
  };

  if (formatValid && domain) {
    const domainResolution = await resolveMailDomain(domain);
    result.domainResolvable = domainResolution.ok;
    result.resolutionType = domainResolution.type;
    result.records = domainResolution.records;
    result.existsLikely = formatValid && domainResolution.ok;
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.existsLikely ? 0 : 2;
    return;
  }

  console.log(`Email: ${result.email}`);
  console.log(`Format valid: ${result.formatValid ? 'yes' : 'no'}`);
  console.log(`Domain: ${result.domain || '(none)'}`);
  console.log(`Domain resolvable: ${result.domainResolvable ? 'yes' : 'no'} (${result.resolutionType})`);
  if (result.records.length > 0) {
    console.log(`Records: ${result.records.join(', ')}`);
  }
  console.log(`Exists likely: ${result.existsLikely ? 'yes' : 'no'}`);
  console.log(`Note: ${result.note}`);

  process.exitCode = result.existsLikely ? 0 : 2;
}

main().catch((error) => {
  console.error('Validation failed:', error?.message || error);
  process.exitCode = 1;
});

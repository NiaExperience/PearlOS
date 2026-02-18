#!/usr/bin/env node
/**
 * Advanced autocannon harness targeting the Interface server on port 3000.
 * Enhancements:
 *  - Multiple endpoints with optional method prefixes (e.g. POST:/api/tenants)
 *  - Scenario file support (AC_SCENARIO=./tests/stress-tests/perf-scenarios/interface-hot.json)
 *  - Per-endpoint sequential runs for granular metrics (avoids single blended aggregate)
 *  - Optional warmup on first endpoint
 *  - Dynamic bodies via AC_BODIES JSON or scenario file; #RANDOM# token expansion
 *  - Optional headers (AC_HEADERS JSON) e.g. auth cookies for protected routes
 *  - Designed to be invoked directly or by Clinic (profile / flamegraph)
 *
 * NOTE: Write-heavy endpoints (tenant/user creation etc.) can bloat the DB. Prefer a
 *  disposable environment or keep concurrency low for those. Provide auth headers when required.
 */
const fs = require('fs');
const path = require('path');

const autocannon = require('autocannon');

// Hardcoded defaults (requested)
const DEFAULT_TENANT_ID = '7bd902a4-9534-4fc4-b745-f23368590946';
const DEFAULT_AGENT = 'pearlos';
const DEFAULT_CONTENT_TYPE = 'Notes';

const concurrency = parseInt(process.env.AC_CONCURRENCY || '20', 10);
const duration = parseInt(process.env.AC_DURATION || '30', 10); // seconds per endpoint
const warmup = parseInt(process.env.AC_WARMUP || '5', 10); // seconds
const base = process.env.AC_BASE || 'http://localhost:3000';
const scenarioPath = process.env.AC_SCENARIO;
const headersEnv = process.env.AC_HEADERS; // JSON string of headers
const bodiesEnv = process.env.AC_BODIES;   // JSON mapping path->body string

let commonHeaders = {};
if (headersEnv) {
  try { commonHeaders = JSON.parse(headersEnv); } catch (e) { console.warn('[autocannon-interface] Failed to parse AC_HEADERS JSON'); }
}

let bodyMap = {};
if (bodiesEnv) {
  try { bodyMap = JSON.parse(bodiesEnv); } catch (e) { console.warn('[autocannon-interface] Failed to parse AC_BODIES JSON'); }
}

function randomizeBody(body) {
  if (typeof body !== 'string') return body;
  const rnd = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  return body.replace(/#RANDOM#/g, rnd);
}

function ensureUniqueUserEmail(bodyStr) {
  // Ensure the email is unique even if caller didn't include #RANDOM#
  try {
    const rnd = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const obj = JSON.parse(bodyStr);
    if (obj && typeof obj === 'object' && typeof obj.email === 'string') {
      const at = obj.email.indexOf('@');
      if (at > 0) {
        const local = obj.email.slice(0, at);
        const domain = obj.email.slice(at + 1);
        // Add +tag if not present, else append another token
        const newLocal = local.includes('+') ? `${local}-${rnd}` : `${local}+${rnd}`;
        obj.email = `${newLocal}@${domain}`;
        if (typeof obj.name === 'string') {
          // Optionally tag the name too to avoid any name-based uniqueness rules
          obj.name = `${obj.name}-${rnd}`;
        }
        return JSON.stringify(obj);
      }
    }
  } catch (_) {
    // If parse fails, fall through and return original
  }
  return bodyStr;
}

function getFallbackBodyFor(method, pathStr) {
  if (method === 'POST') {
    if (pathStr === '/api/tenants') {
      return JSON.stringify({ name: `load-tenant-#RANDOM#` });
    }
    if (pathStr === '/api/users') {
      // Include tenantId to satisfy server-side validation and role assignment
      return JSON.stringify({
        name: 'LoadUser#RANDOM#',
        email: 'load-#RANDOM#@example.com',
        password: 'Pass1234!',
        tenantId: DEFAULT_TENANT_ID,
        role: 'member'
      });
    }
  }
  return undefined;
}

function isBlank(v) {
  if (v == null) return true;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return true;
    const low = t.toLowerCase();
    if (low === 'null' || low === 'undefined') return true;
  }
  return false;
}

function coerceJsonBodyForPath(method, pathStr, bodyCandidate) {
  // Prefer provided body if valid; otherwise, fallback for known endpoints
  let b = bodyCandidate;
  if (isBlank(b)) {
    b = getFallbackBodyFor(method, pathStr);
  }
  if (typeof b !== 'string') {
    try { b = JSON.stringify(b); } catch (_) {}
  }
  if (typeof b === 'string') {
    b = randomizeBody(b);
    if (pathStr === '/api/users') {
      b = ensureUniqueUserEmail(b);
    }
    // Validate JSON for known endpoints; if invalid, replace with fallback
    if (pathStr === '/api/tenants' || pathStr === '/api/users') {
      try { JSON.parse(b); } catch { b = getFallbackBodyFor(method, pathStr); }
    }
  }
  return b;
}

// Some autocannon versions ignore reqParams.body in the 'request' event.
// This helper writes the payload directly to the request stream when possible
// and falls back to setting headers/body params otherwise.
function buildRequestDescriptor(ep) {
  return {
    setupRequest: () => {
      const out = { method: ep.method, path: ep.path };
      if (ep.method !== 'GET') {
        const b = coerceJsonBodyForPath(ep.method, ep.path, ep.body);
        if (!isBlank(b)) {
          out.headers = { ...commonHeaders, 'content-type': 'application/json' };
          out.body = typeof b === 'string' ? b : JSON.stringify(b);
        } else {
          out.headers = { ...commonHeaders };
        }
      } else {
        out.headers = { ...commonHeaders };
      }
      return out;
    }
  };
}

// Determine endpoints list (from scenario file or AC_ENDPOINTS)
let endpointDefs = [];
if (scenarioPath) {
  try {
    const full = path.isAbsolute(scenarioPath) ? scenarioPath : path.join(process.cwd(), scenarioPath);
    endpointDefs = JSON.parse(fs.readFileSync(full, 'utf8'));
    console.log(`[autocannon-interface] Loaded scenario ${scenarioPath} with ${endpointDefs.length} entries.`);
  } catch (e) {
    console.error(`[autocannon-interface] Failed to load scenario ${scenarioPath}:`, e.message);
    process.exit(1);
  }
} else {
  // Default list derived from hotspot functions (createTenant, createUser, content, assistant)
  // Format: optionalMethod:/path
  const raw = (process.env.AC_ENDPOINTS || [
    `GET:/api/contentList?type=${DEFAULT_CONTENT_TYPE}&tenantId=${DEFAULT_TENANT_ID}&agent=${DEFAULT_AGENT}`,
    `GET:/api/dynamicContent?tenantId=${DEFAULT_TENANT_ID}&agent=${DEFAULT_AGENT}`,
    `GET:/api/assistant?agent=${DEFAULT_AGENT}`,
    // Write endpoints (require auth):
    'POST:/api/tenants',
    'POST:/api/users'
  ].join(',')).split(',').map(s => s.trim()).filter(Boolean);
  endpointDefs = raw.map(r => {
    const m = r.includes(':') ? r.split(':') : ['GET', r];
    return { method: m[0].toUpperCase(), path: m.slice(1).join(':') };
  });
}

// Attach bodies from map or scenario; scenario entries may already have body
endpointDefs = endpointDefs.map(e => ({ ...e, method: (e.method || 'GET').toUpperCase(), body: (bodyMap[e.path] !== undefined ? bodyMap[e.path] : e.body) }));

// Provide minimal default bodies for common write endpoints if none supplied and not disabled
if (process.env.AC_DISABLE_DEFAULT_WRITE_BODIES !== 'true') {
  endpointDefs = endpointDefs.map(e => {
    if (e.method === 'POST' && (isBlank(e.body))) {
      const fb = getFallbackBodyFor(e.method, e.path);
      if (fb) e.body = fb;
    }
    return e;
  });
}

(async () => {
  if (!endpointDefs.length) {
    console.error('[autocannon-interface] No endpoints specified. Set AC_ENDPOINTS or AC_SCENARIO.');
    process.exit(1);
  }

  // Preflight warnings for POST bodies
  for (const ep of endpointDefs) {
    if (ep.method === 'POST') {
      let b = ep.body;
      const hadBlank = isBlank(b);
      if (!hadBlank && typeof b === 'string' && (ep.path === '/api/tenants' || ep.path === '/api/users')) {
        try { JSON.parse(b); } catch { b = undefined; }
      }
      if (hadBlank || b === undefined) {
        console.warn(`[autocannon-interface] Note: ${ep.method} ${ep.path} has blank/invalid body; using fallback JSON.`);
      }
    }
  }

  if (warmup > 0) {
    const first = endpointDefs[0];
    console.log(`[autocannon-interface] Warmup ${warmup}s ${first.method} ${base}${first.path} (c=${Math.max(1, Math.min(5, concurrency))})`);
    try {
  const warmHeaders = { ...commonHeaders };
  const requests = [buildRequestDescriptor(first)];
  await autocannon({ url: base, connections: Math.max(1, Math.min(5, concurrency)), duration: warmup, headers: warmHeaders, requests });
    } catch (e) {
      console.warn('[autocannon-interface] Warmup failed:', e.message);
    }
  }

  const results = [];
  for (const ep of endpointDefs) {
    const label = `${ep.method} ${ep.path}`;
    console.log(`[autocannon-interface] Benchmark ${duration}s ${label} (c=${concurrency})`);
  const headers = { ...commonHeaders };
  const requests = [buildRequestDescriptor(ep)];
  const opts = { url: base, connections: concurrency, duration, headers, requests };
    try {
      const r = await autocannon(opts);
      results.push({ endpoint: ep.path, method: ep.method, latency: r.latency, throughput: r.throughput, requests: r.requests, errors: r.errors });
    } catch (e) {
      console.error(`[autocannon-interface] ERROR ${label}: ${e.message}`);
      results.push({ endpoint: ep.path, method: ep.method, error: e.message });
    }
  }

  // Summarize (only successful entries with latency)
  const summary = results.filter(r => r.latency).map(r => ({
    method: r.method,
    endpoint: r.endpoint,
    p99: r.latency.p99,
    p95: r.latency.p95,
    avgLatency: r.latency.average,
    rpsAvg: r.requests.average,
    rpsP99: r.requests.p99,
    throughputAvg: r.throughput.average,
    errors: r.errors
  }));

  const ts = new Date().toISOString().replace(/[:]/g, '-');
  const outDir = path.join(process.cwd(), 'performance-reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `autocannon-interface-${ts}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ meta: { concurrency, duration, warmup, base, scenario: scenarioPath || null }, endpoints: endpointDefs, summary, raw: results }, null, 2));
  console.log(`[autocannon-interface] Wrote ${outFile}`);

  if (summary.length) console.table(summary);
  else console.warn('[autocannon-interface] No successful samples captured. Check auth / endpoints.');
})();

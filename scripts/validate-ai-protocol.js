#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * validate-ai-protocol.js
 * Generates lightweight instruction + bootstrap docs derived from docs/ai-assistant-protocol.md.
 * Exit Codes:
 *  0 success
 *  1 canonical missing
 *  2 verify mode mismatch (stale generated files)
 *  3 unexpected error
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CANONICAL = path.join(ROOT, '/docs/ai-assistant-protocol.md');
// Outputs moved under .github/instructions/* to centralize instruction artifacts
const SUMMARY = path.join(ROOT, '.github', 'instructions', 'copilot.instructions.md');
const BOOTSTRAP = path.join(ROOT, '.github', 'instructions', 'AI_SESSION_BOOTSTRAP.instructions.md');

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function readCanonical() {
  if (!fs.existsSync(CANONICAL)) throw new Error('Canonical protocol file missing');
  return fs.readFileSync(CANONICAL, 'utf8');
}

function parseHeadings(md) {
  const lines = md.split(/\r?\n/);
  const sections = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,3})\s+(\d+\.?\s*)?(.*)$/.exec(lines[i]);
    if (m) {
      const level = m[1].length;
      const title = m[3].trim();
      if (level === 1) continue; // skip main title
      // collect first non-empty non-heading line after
      let firstLine = '';
      for (let j = i + 1; j < lines.length; j++) {
        const ln = lines[j].trim();
        if (!ln) continue;
        if (ln.startsWith('#')) break; // next heading
        if (/^---+$/.test(ln)) continue; // horizontal rule
        firstLine = ln.replace(/[`*_]/g, '');
        break;
      }
      // Derive first sentence
      let firstSentence = firstLine.split(/(?<=\.)\s/)[0];
      if (!firstSentence.endsWith('.')) firstSentence = firstSentence + '.';
      sections.push({ title, firstSentence });
    }
  }
  return sections;
}

function extractSectionByTitle(md, titleIncludes) {
  const lines = md.split(/\r?\n/);
  let start = -1;
  let startLevel = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (m) {
      const lvl = m[1].length;
      const t = m[2].trim();
      if (t.toLowerCase().includes(titleIncludes.toLowerCase())) {
        start = i + 1; // content starts after heading
        startLevel = lvl;
        break;
      }
    }
  }
  if (start === -1) return '';
  // capture until next heading of same or higher level
  const chunk = [];
  for (let j = start; j < lines.length; j++) {
    const m = /^(#{1,6})\s+/.exec(lines[j]);
    if (m && m[1].length <= startLevel) break;
    chunk.push(lines[j]);
  }
  // Trim trailing blank lines
  while (chunk.length && chunk[chunk.length - 1].trim() === '') chunk.pop();
  while (chunk.length && chunk[0].trim() === '') chunk.shift();
  return chunk.join('\n');
}

function buildSummary(canonicalContent, sections, hash) {
  // Deterministic pseudo-timestamp derived from hash to keep file stable across generations.
  // This prevents perpetual drift where --verify would fail solely due to a real time ISO timestamp.
  const now = hash.slice(0, 12); // stable fingerprint
  const tableRows = sections
    .slice(0, 25) // cap to keep file small
    .map((s, idx) => `| ${idx + 1} | ${s.title} | ${s.firstSentence.replace(/\|/g, '&#124;')} |`) // escape pipes
    .join('\n');
  let out = `# Copilot Instructions (Auto-Generated)\n\n` +
    `DO NOT EDIT. Source: docs/ai-assistant-protocol.md\n\n` +
    `Source SHA256: ${hash}\nGenerated: ${now}\n\n` +
    `## Purpose\nProvide condensed enforceable guardrails for AI sessions (plans-first, boundaries, tests, security).\n\n` +
    `## Core Principles Snapshot\n| # | Title | First Sentence |\n|---|-------|----------------|\n${tableRows}\n\n` +
    `## Usage\nAlways load this plus the canonical file at session start. If hash mismatch, run: \`npm run sync:ai-protocol\`.\n`;

  // Append project quickstart if present
  const quickstart = extractSectionByTitle(canonicalContent, 'PROJECT QUICKSTART FOR AI AGENTS');
  if (quickstart) {
    out += `\n## Project Quickstart (Nia Universal)\n\n` + quickstart + '\n';
  }
  return out;
}

function buildBootstrap(hash) {
  return `# AI Session Bootstrap\n\n` +
    `This short file primes AI context. Full rules live in \`docs/ai-assistant-protocol.md\`.\n\n` +
    `Source SHA256: ${hash}\n\n` +
    `## Load Order\n\n`+
    `1. "QUICK_REFERENCE.md" (essential quick reference)\n`+
    `2. ".github/instructions/copilot.instructions.md" (auto-generated summary)\n`+
    `3. "docs/ai-assistant-protocol.md" (canonical full spec)\n\n`+
    `**On-demand references** (load only when needed):\n\n`+
    `- \`ARCHITECTURE.reference.md\` - Platform architecture concepts\n`+
    `- \`DEVELOPMENT.reference.md\` - Testing, PRs, CI/CD workflows\n`+
    `- \`PIPECAT_BOT.reference.md\` - Voice bot development patterns\n`+
    `- \`FRONTEND_EVENTS.reference.md\` - CustomEvent system\n`+
    `- \`LOCALSTORAGE.reference.md\` - Client storage patterns\n\n`+
    `## Focus Docs\n\n`+
    `To be aware of focused feature context, read the titles (not the content) of markdown docs in\n\n`+
    `1. the root "./docs" folder\n`+
    `2. "./apps/<various>" folders\n`+
    `3. "./packages/<various>" folders\n\n` +
    `## Non-Negotiables\n\n`+
    `- Plan first (objective, scope, test strategy) before code.\n`+
    `- Explicit checklist of requirements.\n`+
    `- No event emits without descriptor & redaction paths.\n`+
    `- Add tests for new behavior (happy + edge).\n`+
    `- Do not reformat unrelated code.\n`+
    `- Avoid cross-feature deep imports.\n`+
    `- No secrets or PII in logs.\n`+
    `- If scope changes: respond with FOCUS and restated scope.\n\n` +
    `## Drift Detection\n\n`+
    `Run \`npm run sync:ai-protocol\` after modifying the canonical file.\n`+
    `CI will fail if summaries are stale.\n`;
}

function writeIfChanged(file, content) {
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8');
    if (existing === content) return false; // unchanged
  } else {
    // ensure directory
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

function main() {
  const verify = process.argv.includes('--verify');
  let canonical;
  try {
    canonical = readCanonical();
  } catch (e) {
    console.error('[ai-protocol] ERROR:', e.message);
    process.exit(1);
  }
  const hash = sha256(canonical);
  const sections = parseHeadings(canonical);
  const summary = buildSummary(canonical, sections, hash);
  const bootstrap = buildBootstrap(hash);

  if (verify) {
    let ok = true;
    try {
      const s = fs.readFileSync(SUMMARY, 'utf8');
      if (s !== summary) ok = false;
    } catch { ok = false; }
    try {
      const b = fs.readFileSync(BOOTSTRAP, 'utf8');
      if (b !== bootstrap) ok = false;
    } catch { ok = false; }
    if (!ok) {
      console.error('[ai-protocol] Stale generated files. Run: npm run sync:ai-protocol');
      process.exit(2);
    }
    console.log('[ai-protocol] Verified up-to-date.');
    return;
  }

  const changedSummary = writeIfChanged(SUMMARY, summary);
  const changedBootstrap = writeIfChanged(BOOTSTRAP, bootstrap);
  console.log(`[ai-protocol] Generated summary (${changedSummary ? 'updated' : 'unchanged'}), bootstrap (${changedBootstrap ? 'updated' : 'unchanged'}).`);
}

try {
  main();
} catch (e) {
  console.error('[ai-protocol] Unexpected error:', e);
  process.exit(3);
}

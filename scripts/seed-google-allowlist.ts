#!/usr/bin/env ts-node
/**
 * Seed Google Sign-In Allowlist — Nia Universal
 *
 * Populates the Postgres-backed Google OAuth allowlist (stored in the
 * `GlobalSettings` singleton) from any combination of three sources:
 *
 *   1. `GOOGLE_SIGNIN_ALLOWLIST` env var (comma- or newline-separated)
 *   2. All `User` records in the local DB (`notion_blocks` rows where
 *      `type = 'User'` and `indexer->>'email'` is set)
 *   3. One or more plain-text files — one email per line, blank lines and
 *      `#` comments ignored, commas also accepted as separators on a line.
 *
 * By default the seeder performs a *merge* (union) with the existing
 * allowlist. Pass `--replace` to overwrite instead. Use `--from-env`,
 * `--from-users`, or `--from-file` to restrict which sources are pulled in.
 *
 * Flags:
 *   --from-env             Include emails from GOOGLE_SIGNIN_ALLOWLIST.
 *   --from-users           Include emails from User records in the DB.
 *   --from-file <path>     Include emails from a txt file (repeatable).
 *   --replace              Replace (don't merge) the current allowlist.
 *   --domain <suffix>      Keep only emails matching this domain (repeatable).
 *   --exclude <email>      Exclude a specific email (repeatable).
 *   --dry-run              Don't write; just show what would change.
 *   --json                 Emit JSON output.
 *
 * Source selection rules:
 *   - Explicit `--from-*` flags select only those sources.
 *   - If only `--from-file <path>` is given, files are the sole source.
 *   - If NO `--from-*` flag is given, env + users are pulled (legacy default).
 *
 * Examples:
 *   npm run allowlist:seed
 *   npm run allowlist:seed   -- --from-users --domain niaxp.com
 *   npm run allowlist:seed   -- --replace --from-env
 *   npm run allowlist:seed   -- --from-file ./emails.txt
 *   npm run allowlist:import -- ./emails.txt
 *   npm run allowlist:seed   -- --dry-run
 *
 * Example file (./emails.txt):
 *   # Engineering team
 *   user-a@example.com
 *   user-b@example.com
 *   # Comma-separated is fine too:
 *   user-c@example.com, user-d@example.com
 */
/* eslint-disable no-console */

import * as fs from 'fs';
import * as path from 'path';

import * as dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

import { createPostgresDatabase } from '../apps/mesh/src/resolvers/database/postgres';
import { createNotionModel } from '../apps/mesh/src/resolvers/models/notion-model';
import {
  BlockType_GlobalSettings,
  DefaultGlobalSettings,
  GLOBAL_SETTINGS_SINGLETON_KEY,
  IGlobalSettings,
} from '../packages/prism/src/core/blocks/globalSettings.block';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

interface Flags {
  fromEnv: boolean;
  fromUsers: boolean;
  fromFiles: string[];
  replace: boolean;
  dryRun: boolean;
  json: boolean;
  domains: string[];
  exclude: string[];
}

function parseFlags(argv: string[]): Flags {
  const a = argv.slice(2);
  const flags: Flags = {
    fromEnv: false,
    fromUsers: false,
    fromFiles: [],
    replace: false,
    dryRun: false,
    json: false,
    domains: [],
    exclude: [],
  };
  const positionalFiles: string[] = [];
  let sawSourceFlag = false;

  for (let i = 0; i < a.length; i++) {
    const f = a[i];
    switch (f) {
      case '--from-env': flags.fromEnv = true; sawSourceFlag = true; break;
      case '--from-users': flags.fromUsers = true; sawSourceFlag = true; break;
      case '--from-file':
      case '--file': {
        const val = a[++i];
        if (!val) { console.error(`${f} requires a path`); process.exit(2); }
        flags.fromFiles.push(val);
        sawSourceFlag = true;
        break;
      }
      case '--replace': flags.replace = true; break;
      case '--dry-run': flags.dryRun = true; break;
      case '--json': flags.json = true; break;
      case '--domain': {
        const val = a[++i];
        if (!val) { console.error('--domain requires a value'); process.exit(2); }
        flags.domains.push(val.trim().toLowerCase().replace(/^@/, ''));
        break;
      }
      case '--exclude': {
        const val = a[++i];
        if (!val) { console.error('--exclude requires a value'); process.exit(2); }
        flags.exclude.push(val.trim().toLowerCase());
        break;
      }
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        // Treat bare positional args as file paths (convenience for the
        // `allowlist:import -- ./emails.txt` shortcut).
        if (!f.startsWith('--')) {
          positionalFiles.push(f);
          break;
        }
        console.error(`Unknown flag: ${f}`);
        printHelp();
        process.exit(2);
    }
  }

  if (positionalFiles.length > 0) {
    flags.fromFiles.push(...positionalFiles);
    sawSourceFlag = true;
  }

  // Default: if the caller didn't pick any source, pull env + users (legacy
  // friendly first-run). Files are opt-in; they never join the default set.
  if (!sawSourceFlag) {
    flags.fromEnv = true;
    flags.fromUsers = true;
  }
  return flags;
}

function printHelp() {
  console.log(`\nSeed Google sign-in allowlist into Postgres.\n`);
  console.log(`Usage:`);
  console.log(`  npm run allowlist:seed [-- flags]`);
  console.log(`  npm run allowlist:import -- <file.txt> [more.txt ...]\n`);
  console.log(`Flags:`);
  console.log(`  --from-env           Include emails from GOOGLE_SIGNIN_ALLOWLIST env var.`);
  console.log(`  --from-users         Include emails from User records in the local DB.`);
  console.log(`  --from-file <path>   Include emails from a plain-text file (repeatable).`);
  console.log(`                       Bare positional paths after "--" are also treated as files.`);
  console.log(`  --replace            Replace (don't merge) the current allowlist.`);
  console.log(`  --domain <suffix>    Keep only emails matching this domain (repeatable).`);
  console.log(`  --exclude <email>    Exclude a specific email (repeatable).`);
  console.log(`  --dry-run            Show changes without writing.`);
  console.log(`  --json               Emit JSON output.`);
  console.log(``);
  console.log(`File format (one email per line; blank lines and "#" comments ignored;`);
  console.log(`commas on a line are also accepted as separators):`);
  console.log(`  # Engineering`);
  console.log(`  user-a@example.com`);
  console.log(`  user-b@example.com, user-c@example.com`);
  console.log(``);
}

function normalize(email: string): string {
  return String(email || '').trim().toLowerCase();
}

function isLikelyEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseEnvList(value: string | undefined | null): string[] {
  if (!value) return [];
  return String(value)
    .split(/[\n,]+/u)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .filter(isLikelyEmail);
}

interface FileParseResult {
  path: string;
  emails: string[];
  invalid: { line: number; raw: string }[];
}

function parseEmailFile(filePath: string): FileParseResult {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const raw = fs.readFileSync(absolute, 'utf8');
  const seen = new Set<string>();
  const emails: string[] = [];
  const invalid: { line: number; raw: string }[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Strip inline comments: anything after an unquoted `#`.
    const stripped = line.replace(/#.*$/u, '').trim();
    if (!stripped) continue;
    // Allow comma- or whitespace-separated entries on the same line.
    for (const part of stripped.split(/[\s,;]+/u)) {
      const token = part.trim();
      if (!token) continue;
      const e = normalize(token);
      if (!isLikelyEmail(e)) {
        invalid.push({ line: i + 1, raw: token });
        continue;
      }
      if (seen.has(e)) continue;
      seen.add(e);
      emails.push(e);
    }
  }
  return { path: absolute, emails, invalid };
}

async function loadUserEmails(NotionModel: any, flags: Flags): Promise<string[]> {
  const rows: any[] = await NotionModel.findAll({ where: { type: 'User' } });
  const emails: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const content = row?.content ?? {};
    const indexer = row?.indexer ?? {};
    const raw = content?.email ?? indexer?.email;
    if (typeof raw !== 'string') continue;
    const e = normalize(raw);
    if (!e || !isLikelyEmail(e) || seen.has(e)) continue;
    if (flags.domains.length > 0 && !flags.domains.some((d) => e.endsWith('@' + d))) continue;
    seen.add(e);
    emails.push(e);
  }
  return emails;
}

interface SingletonRow {
  page_id: string;
  content: Partial<IGlobalSettings>;
}

async function loadSingleton(NotionModel: any): Promise<SingletonRow | null> {
  const rows: any[] = await NotionModel.findAll({
    where: { type: BlockType_GlobalSettings },
    limit: 5,
  });
  if (!rows || rows.length === 0) return null;
  const preferred = rows.find(
    (r: any) => (r?.content?.singletonKey ?? r?.indexer?.singletonKey) === GLOBAL_SETTINGS_SINGLETON_KEY,
  );
  const row: any = preferred || rows[0];
  return { page_id: row.page_id, content: (row?.content ?? {}) as Partial<IGlobalSettings> };
}

async function writeAllowList(NotionModel: any, emails: string[]): Promise<void> {
  const now = new Date().toISOString();
  const existing = await loadSingleton(NotionModel);

  if (existing) {
    const mergedContent: IGlobalSettings = {
      ...DefaultGlobalSettings,
      ...existing.content,
      singletonKey: GLOBAL_SETTINGS_SINGLETON_KEY,
      interfaceLogin: {
        ...DefaultGlobalSettings.interfaceLogin,
        ...(existing.content.interfaceLogin ?? {}),
      },
      denyListEmails: Array.isArray(existing.content.denyListEmails) ? existing.content.denyListEmails : [],
      allowListEmails: emails,
      updatedAt: now,
    };
    await NotionModel.update(
      {
        content: mergedContent,
        indexer: { singletonKey: GLOBAL_SETTINGS_SINGLETON_KEY },
      },
      { where: { page_id: existing.page_id } },
    );
    return;
  }

  const newId = uuidv4();
  const createContent: IGlobalSettings = {
    ...DefaultGlobalSettings,
    _id: newId,
    allowListEmails: emails,
    createdAt: now,
    updatedAt: now,
  };
  await NotionModel.create({
    page_id: newId,
    type: BlockType_GlobalSettings,
    content: createContent as any,
    indexer: { singletonKey: GLOBAL_SETTINGS_SINGLETON_KEY },
    order: 0,
  } as any);
}

async function main() {
  const flags = parseFlags(process.argv);

  const sequelize = await createPostgresDatabase(
    process.env.POSTGRES_HOST || 'localhost',
    parseInt(process.env.POSTGRES_PORT || '5432', 10),
    process.env.POSTGRES_DB || 'testdb',
    process.env.POSTGRES_USER || 'postgres',
    process.env.POSTGRES_PASSWORD || 'password',
    { shouldLog: false },
  );
  const NotionModel = createNotionModel(sequelize);

  try {
    const existing = await loadSingleton(NotionModel);
    const currentAllow = Array.isArray(existing?.content?.allowListEmails)
      ? (existing!.content!.allowListEmails as string[]).map(normalize).filter(Boolean)
      : [];

    const envEmails = flags.fromEnv ? parseEnvList(process.env.GOOGLE_SIGNIN_ALLOWLIST) : [];
    const userEmails = flags.fromUsers ? await loadUserEmails(NotionModel, flags) : [];

    // Read + parse each file up-front so we can surface parse errors early.
    const fileResults: FileParseResult[] = [];
    for (const raw of flags.fromFiles) {
      fileResults.push(parseEmailFile(raw));
    }
    // Apply --domain filter uniformly across file emails (domain filter
    // already applies inside loadUserEmails for user records).
    const fileEmails: string[] = [];
    {
      const seen = new Set<string>();
      for (const r of fileResults) {
        for (const e of r.emails) {
          if (flags.domains.length > 0 && !flags.domains.some((d) => e.endsWith('@' + d))) continue;
          if (seen.has(e)) continue;
          seen.add(e);
          fileEmails.push(e);
        }
      }
    }
    const totalFileInvalid = fileResults.reduce((acc, r) => acc + r.invalid.length, 0);

    const excludeSet = new Set(flags.exclude.map(normalize));
    const collected = new Set<string>();
    if (!flags.replace) {
      for (const e of currentAllow) collected.add(e);
    }
    for (const e of envEmails) {
      if (!excludeSet.has(e)) collected.add(e);
    }
    for (const e of userEmails) {
      if (!excludeSet.has(e)) collected.add(e);
    }
    for (const e of fileEmails) {
      if (!excludeSet.has(e)) collected.add(e);
    }

    const nextList = Array.from(collected).sort();
    const addedSet = new Set(nextList);
    const currentSet = new Set(currentAllow);
    const added = nextList.filter((e) => !currentSet.has(e));
    const removed = flags.replace ? currentAllow.filter((e) => !addedSet.has(e)) : [];

    if (flags.json) {
      console.log(JSON.stringify({
        dryRun: flags.dryRun,
        sources: {
          env: envEmails.length,
          users: userEmails.length,
          files: fileResults.map((r) => ({ path: r.path, valid: r.emails.length, invalid: r.invalid })),
          current: currentAllow.length,
        },
        added,
        removed,
        final: nextList,
      }, null, 2));
    } else {
      console.log('');
      console.log('Google sign-in allowlist seeder');
      console.log('─────────────────────────────────');
      console.log(`Current entries: ${currentAllow.length}`);
      console.log(`From env:        ${envEmails.length}${flags.fromEnv ? '' : ' (skipped)'}`);
      console.log(`From users:      ${userEmails.length}${flags.fromUsers ? '' : ' (skipped)'}`);
      if (fileResults.length > 0) {
        console.log(`From files:      ${fileEmails.length} valid from ${fileResults.length} file(s)`);
        for (const r of fileResults) {
          console.log(`   • ${r.path}: ${r.emails.length} valid${r.invalid.length ? `, ${r.invalid.length} invalid` : ''}`);
        }
        if (totalFileInvalid > 0) {
          console.log(`   ⚠ Skipped ${totalFileInvalid} invalid line(s):`);
          for (const r of fileResults) {
            for (const bad of r.invalid) {
              console.log(`     ${path.basename(r.path)}:${bad.line}  "${bad.raw}"`);
            }
          }
        }
      } else {
        console.log(`From files:      0 (none provided)`);
      }
      console.log(`Mode:            ${flags.replace ? 'replace' : 'merge'}`);
      if (flags.domains.length > 0) console.log(`Domain filter:   ${flags.domains.join(', ')}`);
      if (flags.exclude.length > 0) console.log(`Excluded:        ${flags.exclude.join(', ')}`);
      console.log('');
      console.log(`Added:   ${added.length ? added.join(', ') : '(none)'}`);
      if (flags.replace) {
        console.log(`Removed: ${removed.length ? removed.join(', ') : '(none)'}`);
      }
      console.log(`Final:   ${nextList.length} entr${nextList.length === 1 ? 'y' : 'ies'}`);
      if (nextList.length > 0) {
        for (const e of nextList) console.log(`  - ${e}`);
      }
      console.log('');
    }

    if (flags.dryRun) {
      console.log('[dry-run] No changes written.');
      return;
    }

    await writeAllowList(NotionModel, nextList);
    if (!flags.json) console.log('Allowlist saved to Postgres.');
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('seed-google-allowlist error:', err?.message || err);
    process.exit(1);
  });
}

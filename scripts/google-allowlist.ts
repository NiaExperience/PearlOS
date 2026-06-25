#!/usr/bin/env ts-node
/**
 * Google Sign-In Allowlist CLI — Nia Universal
 *
 * Manages the Postgres-backed Google OAuth allowlist stored in the
 * `GlobalSettings` singleton (`notion_blocks` row with `type = 'GlobalSettings'`).
 *
 * This CLI talks to Postgres directly (no mesh / GraphQL required) so it works
 * even when the apps are not running.
 *
 * Commands:
 *   list                          Show the current allowlist.
 *   add <email> [email ...]       Add one or more emails.
 *   remove <email> [email ...]    Remove one or more emails.
 *   edit <oldEmail> <newEmail>    Rename an allowlisted email.
 *   clear                         Remove every entry (with confirmation).
 *
 * Flags:
 *   --json                        Emit JSON instead of a human table.
 *   --yes, -y                     Skip confirmation for destructive ops.
 *
 * Examples:
 *   npm run allowlist:list
 *   npm run allowlist:add -- user@example.com
 *   npm run allowlist:remove -- user@example.com
 *   npm run allowlist:edit -- old@example.com new@example.com
 */
/* eslint-disable no-console */

import * as path from 'path';
import * as readline from 'readline';

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

type Command = 'list' | 'add' | 'remove' | 'edit' | 'clear' | 'help';

interface ParsedArgs {
  command: Command;
  positional: string[];
  json: boolean;
  assumeYes: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let command: Command = 'help';
  const positional: string[] = [];
  let json = false;
  let assumeYes = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') { json = true; continue; }
    if (a === '--yes' || a === '-y') { assumeYes = true; continue; }
    if (a === '--help' || a === '-h') { command = 'help'; continue; }
    if (!['list', 'add', 'remove', 'edit', 'clear', 'help'].includes(a)) {
      if (command === 'help') {
        console.error(`Unknown command: ${a}`);
        printHelp();
        process.exit(2);
      }
      positional.push(a);
      continue;
    }
    command = a as Command;
  }

  return { command, positional, json, assumeYes };
}

function printHelp() {
  console.log(`\nGoogle Sign-In Allowlist CLI\n`);
  console.log(`Usage:`);
  console.log(`  npm run allowlist:list`);
  console.log(`  npm run allowlist:add -- <email> [email ...]`);
  console.log(`  npm run allowlist:remove -- <email> [email ...]`);
  console.log(`  npm run allowlist:edit -- <oldEmail> <newEmail>`);
  console.log(`  npm run allowlist:clear [-- --yes]`);
  console.log(`\nFlags:`);
  console.log(`  --json       Emit JSON output.`);
  console.log(`  --yes, -y    Skip confirmation prompts (for clear).`);
  console.log(``);
}

function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

function isLikelyEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function dedupeLower(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const v = entry.trim().toLowerCase();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(`${question} (y/N) `, resolve));
    return answer.trim().toLowerCase().startsWith('y');
  } finally {
    rl.close();
  }
}

async function connect() {
  const sequelize = await createPostgresDatabase(
    process.env.POSTGRES_HOST || 'localhost',
    parseInt(process.env.POSTGRES_PORT || '5432', 10),
    process.env.POSTGRES_DB || 'testdb',
    process.env.POSTGRES_USER || 'postgres',
    process.env.POSTGRES_PASSWORD || 'password',
    { shouldLog: false },
  );
  const NotionModel = createNotionModel(sequelize);
  return { sequelize, NotionModel };
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
  const content = (row?.content ?? {}) as Partial<IGlobalSettings>;
  return { page_id: row.page_id, content };
}

async function upsertAllowList(NotionModel: any, nextAllowList: string[]): Promise<string[]> {
  const normalized = dedupeLower(nextAllowList);
  const existing = await loadSingleton(NotionModel);
  const now = new Date().toISOString();

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
      allowListEmails: normalized,
      updatedAt: now,
    };
    await NotionModel.update(
      {
        content: mergedContent,
        indexer: { singletonKey: GLOBAL_SETTINGS_SINGLETON_KEY },
      },
      { where: { page_id: existing.page_id } },
    );
    return normalized;
  }

  const newId = uuidv4();
  const createContent: IGlobalSettings = {
    ...DefaultGlobalSettings,
    _id: newId,
    allowListEmails: normalized,
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
  return normalized;
}

function renderList(emails: string[], json: boolean) {
  if (json) {
    console.log(JSON.stringify({ count: emails.length, emails }, null, 2));
    return;
  }
  if (emails.length === 0) {
    console.log('(allowlist is empty — no Google sign-in restriction from the DB)');
    return;
  }
  console.log(`\nGoogle sign-in allowlist (${emails.length} entries):`);
  for (const email of emails) {
    console.log(`  - ${email}`);
  }
  console.log('');
}

async function main() {
  const { command, positional, json, assumeYes } = parseArgs(process.argv);

  if (command === 'help') {
    printHelp();
    return;
  }

  const { sequelize, NotionModel } = await connect();
  try {
    const existing = await loadSingleton(NotionModel);
    const currentAllow = dedupeLower(existing?.content?.allowListEmails ?? []);

    switch (command) {
      case 'list': {
        renderList(currentAllow, json);
        break;
      }

      case 'add': {
        if (positional.length === 0) {
          console.error('Usage: npm run allowlist:add -- <email> [email ...]');
          process.exit(2);
        }
        const requested = positional.map(normalizeEmail);
        const invalid = requested.filter((e) => !isLikelyEmail(e));
        if (invalid.length > 0) {
          console.error(`Invalid email address(es): ${invalid.join(', ')}`);
          process.exit(2);
        }
        const before = new Set(currentAllow);
        const added: string[] = [];
        const skipped: string[] = [];
        for (const email of requested) {
          if (before.has(email)) {
            skipped.push(email);
          } else {
            added.push(email);
            before.add(email);
          }
        }
        const next = Array.from(before);
        const result = await upsertAllowList(NotionModel, next);
        if (json) {
          console.log(JSON.stringify({ added, skipped, emails: result }, null, 2));
        } else {
          if (added.length > 0) console.log(`Added: ${added.join(', ')}`);
          if (skipped.length > 0) console.log(`Already present: ${skipped.join(', ')}`);
          renderList(result, false);
        }
        break;
      }

      case 'remove': {
        if (positional.length === 0) {
          console.error('Usage: npm run allowlist:remove -- <email> [email ...]');
          process.exit(2);
        }
        const requested = positional.map(normalizeEmail);
        const removed: string[] = [];
        const missing: string[] = [];
        const currentSet = new Set(currentAllow);
        for (const email of requested) {
          if (currentSet.has(email)) {
            currentSet.delete(email);
            removed.push(email);
          } else {
            missing.push(email);
          }
        }
        const next = Array.from(currentSet);
        const result = await upsertAllowList(NotionModel, next);
        if (json) {
          console.log(JSON.stringify({ removed, missing, emails: result }, null, 2));
        } else {
          if (removed.length > 0) console.log(`Removed: ${removed.join(', ')}`);
          if (missing.length > 0) console.log(`Not present: ${missing.join(', ')}`);
          renderList(result, false);
        }
        break;
      }

      case 'edit': {
        if (positional.length !== 2) {
          console.error('Usage: npm run allowlist:edit -- <oldEmail> <newEmail>');
          process.exit(2);
        }
        const [rawOld, rawNew] = positional;
        const oldEmail = normalizeEmail(rawOld);
        const newEmail = normalizeEmail(rawNew);
        if (!isLikelyEmail(oldEmail) || !isLikelyEmail(newEmail)) {
          console.error('Both oldEmail and newEmail must be valid email addresses.');
          process.exit(2);
        }
        if (!currentAllow.includes(oldEmail)) {
          console.error(`"${oldEmail}" is not in the allowlist.`);
          process.exit(1);
        }
        if (oldEmail === newEmail) {
          renderList(currentAllow, json);
          break;
        }
        if (currentAllow.includes(newEmail)) {
          console.error(`"${newEmail}" is already in the allowlist; refusing to create a duplicate.`);
          process.exit(1);
        }
        const next = currentAllow.map((e) => (e === oldEmail ? newEmail : e));
        const result = await upsertAllowList(NotionModel, next);
        if (json) {
          console.log(JSON.stringify({ from: oldEmail, to: newEmail, emails: result }, null, 2));
        } else {
          console.log(`Renamed: ${oldEmail} -> ${newEmail}`);
          renderList(result, false);
        }
        break;
      }

      case 'clear': {
        if (currentAllow.length === 0) {
          if (json) console.log(JSON.stringify({ emails: [] }));
          else console.log('Allowlist is already empty.');
          break;
        }
        if (!assumeYes) {
          const ok = await confirm(`Clear ${currentAllow.length} allowlist entr${currentAllow.length === 1 ? 'y' : 'ies'}?`);
          if (!ok) {
            console.log('Aborted.');
            break;
          }
        }
        const result = await upsertAllowList(NotionModel, []);
        if (json) console.log(JSON.stringify({ emails: result }));
        else console.log('Allowlist cleared.');
        break;
      }

      default:
        printHelp();
        process.exit(2);
    }
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('allowlist cli error:', err?.message || err);
    process.exit(1);
  });
}

#!/usr/bin/env ts-node
/**
 * List Daily.co recordings via the REST API.
 * Pulls API credentials from env vars (or apps/pipecat-daily-bot/.env) and
 * prints recent recordings with optional download links.
 */

import { promises as fs } from 'fs';
import { createWriteStream } from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import type { IUser as PrismUser } from '../packages/prism/dist/core/blocks/user.block.js';

type RecordingStatus = 'finished' | 'in-progress' | 'canceled';

interface Recording {
  id: string;
  room_name?: string;
  start_ts?: number;
  created_at?: number;
  duration?: number;
  status?: RecordingStatus;
  size?: number;
  bytes?: number;
  max_participants?: number;
  download_link?: string;
  download_expires?: number;
  download_filename?: string;
  voice_user_id?: string;
  voice_user_name?: string;
  voice_user_email?: string;
  room_type?: 'voice' | 'social' | 'other';
  download_path?: string;
  [key: string]: unknown;
}

interface RecordingListResponse {
  total_count: number;
  data: Recording[];
  starting_after?: string;
  has_more?: boolean;
}

interface AccessLinkResponse {
  download_link?: string;
  expires?: number;
  download_filename?: string;
  [key: string]: unknown;
}

interface CliOptions {
  limit: number;
  pageSize: number;
  room?: string;
  status?: RecordingStatus;
  userName?: string;
  download: boolean;
  downloadDir: string;
  skipExisting: boolean;
  json: boolean;
  withLinks: boolean;
  linkTtl: number;
  delayMs: number;
  since?: number;
}

const LOCAL_ENV_FILE = path.join(process.cwd(), '.env.local');
const BOT_ENV_FILE = path.join(process.cwd(), 'apps', 'pipecat-daily-bot', '.env');
const DEFAULT_BASE_URL = process.env.DAILY_API_URL || 'https://api.daily.co/v1';
const DEFAULT_SOCIAL_ROOMS = ['sUdXUVtuT0HFbSQRvdsE'];

const userCache = new Map<string, PrismUser | null>();
let userLookupDisabled = false;
let userLookupErrorMessage: string | null = null;
const SOCIAL_ROOM_SET = new Set<string>(
  [
    ...(process.env.DAILY_SOCIAL_ROOM_NAMES || '').split(',').map((name) => name.trim()).filter(Boolean),
    ...(process.env.NEXT_PUBLIC_DAILY_SOCIAL_ROOM_NAMES || '').split(',').map((name) => name.trim()).filter(Boolean),
    ...DEFAULT_SOCIAL_ROOMS,
  ].filter(Boolean)
);

type GetUserByIdFn = typeof import('../packages/prism/dist/core/actions/user-actions.js').getUserById;
let getUserByIdCached: GetUserByIdFn | null = null;

async function getUserByIdLazy(): Promise<GetUserByIdFn> {
  if (!getUserByIdCached) {
    const mod = await import('../packages/prism/dist/core/actions/user-actions.js');
    getUserByIdCached = mod.getUserById;
  }
  return getUserByIdCached;
}

function printHelp(): void {
  console.log(`List Daily recordings

Requires DAILY_API_KEY (env, .env.local, or apps/pipecat-daily-bot/.env). To resolve usernames/emails,
ensure MESH_ENDPOINT (+ MESH_SHARED_SECRET if needed) points at your Mesh GraphQL service.
Set DAILY_SOCIAL_ROOM_NAMES (comma-separated) to highlight additional Social rooms.

Usage:
  npx ts-node scripts/list-daily-recordings.ts [options]

Options:
  --room <name>          Filter by room_name (server-side)
  --status <state>       Filter by status (client-side: finished|in-progress|canceled)
  --user-name <string>   Filter by user name (case-insensitive match; requires Mesh lookup)
  --download             Download each recording locally (skips existing by default)
  --download-dir <path>  Directory for downloads (default ./daily-recordings)
  --force-download       Redownload even if a matching local file already exists
  --limit <n>            Maximum number of recordings to print (default 20)
  --page-size <n>        Page size per API request (default 100, max 100)
  --since <date|rel>     Only include recordings created after this ISO date or relative window (e.g. 7d)
  --with-links           Fetch short-lived download links for each recording
  --link-ttl <secs>      Validity for download links (default 900)
  --json                 Output raw JSON instead of formatted table
  -h, --help             Show this help message

Examples:
  npx ts-node scripts/list-daily-recordings.ts --limit 10
  npx ts-node scripts/list-daily-recordings.ts --room voice-123 --with-links --link-ttl 1800`);
}

async function readEnvFile(filePath: string): Promise<Record<string, string>> {
  if (!filePath) return {};
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const env: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

function parseSinceArg(value?: string): number | undefined {
  if (!value) return undefined;
  const now = Date.now();
  if (/^\d+[smhdw]$/i.test(value)) {
    const num = parseInt(value.slice(0, -1), 10);
    const unit = value.slice(-1).toLowerCase();
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
    };
    return now - num * multipliers[unit];
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(`Invalid --since value: ${value}`);
  }
  return timestamp;
}

function mergeEnv(map: Record<string, string>) {
  for (const [key, value] of Object.entries(map)) {
    if (value && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    limit: 20,
    pageSize: 100,
    download: false,
    downloadDir: path.join(process.cwd(), 'daily-recordings'),
    skipExisting: true,
    json: false,
    withLinks: false,
    linkTtl: 900,
    delayMs: 600,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--room':
        opts.room = argv[++i];
        break;
      case '--status':
        opts.status = argv[++i] as RecordingStatus;
        break;
      case '--user-name':
      case '--username':
        opts.userName = argv[++i];
        break;
      case '--limit':
        opts.limit = Math.max(1, parseInt(argv[++i], 10));
        break;
      case '--download':
        opts.download = true;
        break;
      case '--download-dir':
        opts.downloadDir = path.resolve(argv[++i]);
        break;
      case '--force-download':
        opts.skipExisting = false;
        break;
      case '--page-size':
        opts.pageSize = Math.min(100, Math.max(1, parseInt(argv[++i], 10)));
        break;
      case '--since':
        opts.since = parseSinceArg(argv[++i]);
        break;
      case '--with-links':
        opts.withLinks = true;
        break;
      case '--link-ttl':
        opts.linkTtl = Math.min(12 * 60 * 60, Math.max(900, parseInt(argv[++i], 10)));
        break;
      case '--json':
        opts.json = true;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }

  return opts;
}

function toIso(ts?: number): string {
  if (!ts) return '';
  return new Date(ts * 1000).toISOString();
}

function formatBytes(bytes?: number): string {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIdx]}`;
}

function humanDuration(seconds?: number): string {
  if (!seconds && seconds !== 0) return '';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

async function fetchJson<T>(url: string, apiKey: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed (${response.status}) ${text}`);
  }
  return (await response.json()) as T;
}

async function fetchRecordings(baseUrl: string, apiKey: string, opts: CliOptions): Promise<Recording[]> {
  const results: Recording[] = [];
  let cursor: string | undefined;

  while (results.length < opts.limit) {
    const pageLimit = Math.min(opts.pageSize, opts.limit - results.length);
    const params = new URLSearchParams({ limit: String(pageLimit) });
    if (opts.room) params.set('room_name', opts.room);
    if (cursor) params.set('starting_after', cursor);

    const url = `${baseUrl}/recordings?${params.toString()}`;
    const data = await fetchJson<RecordingListResponse>(url, apiKey);
    const page = data.data || [];

    results.push(...page);
    if (page.length < pageLimit) break;
    cursor = page[page.length - 1]?.id;
    if (!cursor) break;

    // Respect Daily's 2 req/sec guidance for /recordings.
    await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
  }

  return results.slice(0, opts.limit);
}

async function getDownloadLink(baseUrl: string, apiKey: string, recordingId: string, ttl: number): Promise<AccessLinkResponse> {
  const url = `${baseUrl}/recordings/${recordingId}/access-link?valid_for_secs=${ttl}`;
  return fetchJson<AccessLinkResponse>(url, apiKey);
}

function extractVoiceUserId(roomName?: string): string | null {
  if (!roomName || !roomName.startsWith('voice-')) {
    return null;
  }
  const candidate = roomName.slice('voice-'.length).trim();
  return candidate.length > 0 ? candidate : null;
}

function determineRoomType(roomName?: string): 'voice' | 'social' | 'other' {
  if (!roomName) {
    return 'other';
  }
  if (roomName.startsWith('voice-')) {
    return 'voice';
  }
  if (SOCIAL_ROOM_SET.has(roomName)) {
    return 'social';
  }
  return 'other';
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeFileSegment(value?: string | null): string {
  if (!value) {
    return '';
  }
  return value
    .toLowerCase()
    .replace(/[^a-z0-9@._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 80);
}

function formatTimestampForFilename(timestampSeconds?: number): string {
  const date = timestampSeconds ? new Date(timestampSeconds * 1000) : new Date();
  return date.toISOString().replace(/[:]/g, '-').replace(/\..+/, '');
}

function inferExtension(filename?: string, contentType?: string): string {
  if (filename) {
    const match = /\.[a-z0-9]+$/i.exec(filename);
    if (match) {
      return match[0].toLowerCase();
    }
  }
  const typeMap: Record<string, string> = {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
  };
  if (contentType && typeMap[contentType]) {
    return typeMap[contentType];
  }
  if (contentType?.startsWith('video/')) {
    return '.mp4';
  }
  if (contentType?.startsWith('audio/')) {
    return '.mp3';
  }
  return '.bin';
}

async function ensureAccessLink(rec: Recording, baseUrl: string, apiKey: string, ttl: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  if (rec.download_link && rec.download_expires && rec.download_expires - 30 > now) {
    return;
  }
  const link = await getDownloadLink(baseUrl, apiKey, rec.id, ttl);
  rec.download_link = link.download_link;
  rec.download_expires = link.expires;
  if (link.download_filename) {
    rec.download_filename = link.download_filename;
  }
}

async function findExistingRecordingFile(baseName: string, dir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir);
    const regex = new RegExp(`^${escapeRegex(baseName)}(?:-\\d+)?\\.[^.]+$`, 'i');
    for (const entry of entries) {
      if (regex.test(entry)) {
        return path.join(dir, entry);
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function downloadRecordingAsset(rec: Recording, baseUrl: string, apiKey: string, opts: CliOptions): Promise<void> {
  await ensureAccessLink(rec, baseUrl, apiKey, opts.linkTtl);
  if (!rec.download_link) {
    throw new Error('No download link available');
  }
  await fs.mkdir(opts.downloadDir, { recursive: true });
  const response = await fetch(rec.download_link);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download asset (${response.status})`);
  }
  const baseSegment =
    (rec.room_type === 'social' && 'social') ||
    sanitizeFileSegment(rec.voice_user_email) ||
    sanitizeFileSegment(rec.voice_user_name) ||
    sanitizeFileSegment(rec.voice_user_id) ||
    sanitizeFileSegment(rec.room_name) ||
    sanitizeFileSegment(rec.id) ||
    'recording';
  const timestamp = formatTimestampForFilename(rec.created_at || rec.start_ts);
  const baseName = `${baseSegment}__${timestamp}`;
  if (opts.skipExisting) {
    const existing = await findExistingRecordingFile(baseName, opts.downloadDir);
    if (existing) {
      rec.download_path = existing;
      console.log(`↩️  Skipping ${rec.id}; found existing file ${existing}`);
      return;
    }
  }
  const ext = inferExtension(rec.download_filename, response.headers.get('content-type') || undefined);
  let finalName = `${baseName}${ext}`;
  let counter = 1;
  while (true) {
    try {
      await fs.access(path.join(opts.downloadDir, finalName));
      finalName = `${baseName}-${counter}${ext}`;
      counter += 1;
    } catch {
      break;
    }
  }
  const filePath = path.join(opts.downloadDir, finalName);
  const body = response.body instanceof Readable ? response.body : Readable.fromWeb(response.body as any);
  await pipeline(body, createWriteStream(filePath));
  rec.download_path = filePath;
  console.log(`📥 Downloaded ${rec.id} -> ${filePath}`);
}

async function resolveUser(userId: string): Promise<PrismUser | null> {
  if (userLookupDisabled) {
    return null;
  }
  if (userCache.has(userId)) {
    return userCache.get(userId) ?? null;
  }
  try {
    const getter = await getUserByIdLazy();
    const user = await getter(userId);
    userCache.set(userId, user);
    return user;
  } catch (error) {
    userLookupDisabled = true;
    userLookupErrorMessage = (error as Error).message;
    console.warn(`[UserLookup] Disabled after error: ${userLookupErrorMessage}`);
    return null;
  }
}

async function enrichWithUserDetails(records: Recording[]): Promise<void> {
  const neededUserIds = new Set<string>();

  for (const rec of records) {
    const userId = extractVoiceUserId(rec.room_name);
    if (userId) {
      rec.voice_user_id = userId;
      neededUserIds.add(userId);
    }
  }

  for (const userId of neededUserIds) {
    await resolveUser(userId);
  }

  for (const rec of records) {
    if (!rec.voice_user_id) continue;
    const user = userCache.get(rec.voice_user_id) ?? null;
    if (user) {
      rec.voice_user_name = user.name;
      rec.voice_user_email = user.email;
    }
  }
}

function filterRecordings(records: Recording[], opts: CliOptions): Recording[] {
  return records.filter((rec) => {
    if (opts.status && rec.status !== opts.status) return false;
    if (opts.since && rec.created_at && rec.created_at * 1000 < opts.since) return false;
    return true;
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const localEnv = await readEnvFile(LOCAL_ENV_FILE);
  const botEnv = await readEnvFile(BOT_ENV_FILE);
  mergeEnv(localEnv);
  mergeEnv(botEnv);
  const apiKey =
    process.env.DAILY_API_KEY ||
    process.env.NEXT_PUBLIC_DAILY_API_KEY ||
    localEnv.DAILY_API_KEY ||
    localEnv.NEXT_PUBLIC_DAILY_API_KEY ||
    botEnv.DAILY_API_KEY;

  if (!apiKey) {
    console.error('DAILY_API_KEY not found in env or apps/pipecat-daily-bot/.env');
    process.exit(1);
  }

  const recordings = await fetchRecordings(DEFAULT_BASE_URL, apiKey, opts);
  let filtered = filterRecordings(recordings, opts);
  filtered.forEach((rec) => {
    rec.room_type = determineRoomType(rec.room_name);
  });
  await enrichWithUserDetails(filtered);
  if (opts.userName) {
    const needle = opts.userName.toLowerCase();
    filtered = filtered.filter((rec) => {
      const name = rec.voice_user_name?.toLowerCase();
      return !!name && name.includes(needle);
    });
  }

  if (opts.withLinks) {
    for (const rec of filtered) {
      try {
        const link = await getDownloadLink(DEFAULT_BASE_URL, apiKey, rec.id, opts.linkTtl);
        rec.download_link = link.download_link;
        rec.download_expires = link.expires;
        if (link.download_filename) {
          rec.download_filename = link.download_filename;
        }
      } catch (error) {
        console.warn(`Failed to fetch link for ${rec.id}:`, (error as Error).message);
      }
      await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
    }
  }

  if (opts.download) {
    for (const rec of filtered) {
      try {
        await downloadRecordingAsset(rec, DEFAULT_BASE_URL, apiKey, opts);
      } catch (error) {
        console.warn(`[Download] Failed for ${rec.id}:`, (error as Error).message);
      }
      await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  if (!filtered.length) {
    console.log('No recordings found for the provided filters.');
    return;
  }

  const header = ['ID', 'Room', 'Type', 'User ID', 'User Name', 'User Email', 'Status', 'Created', 'Duration', 'Size', 'Participants', opts.download ? 'File' : undefined, opts.withLinks ? 'Download Link (expires)' : undefined]
    .filter(Boolean)
    .join(' | ');
  console.log(header);
  console.log('-'.repeat(header.length));

  filtered.forEach((rec) => {
    const row = [
      rec.id,
      rec.room_name || '',
      rec.room_type || '',
      rec.voice_user_id || '',
      rec.voice_user_name || '',
      rec.voice_user_email || '',
      rec.status || '',
      toIso(rec.created_at || rec.start_ts),
      humanDuration(rec.duration),
      formatBytes(rec.bytes || rec.size),
      rec.max_participants?.toString() || '',
    ];
    if (opts.download) {
      row.push(rec.download_path || '');
    }
    if (opts.withLinks) {
      const expires = rec.download_expires ? new Date(rec.download_expires * 1000).toISOString() : '';
      row.push(rec.download_link ? `${rec.download_link} (${expires})` : '');
    }
    console.log(row.join(' | '));
  });

  console.log(`\nDisplayed ${filtered.length} recording(s).`);
  if (userLookupDisabled) {
    console.log('User lookup disabled; set MESH_ENDPOINT (+ MESH_SHARED_SECRET) and rerun to resolve user names/emails.');
    if (userLookupErrorMessage) {
      console.log(`Last lookup error: ${userLookupErrorMessage}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

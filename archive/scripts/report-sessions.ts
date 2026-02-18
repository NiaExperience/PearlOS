#!/usr/bin/env ts-node
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { glob } from 'glob';

/**
 * Session log report generator.
 * Scans /tmp/kube/logs/<env>/<source> for JSON log lines, groups by sessionId,
 * and prints human-friendly timelines.
 */

type Source = 'cloudwatch' | 'kube' | 'both';
type Env = 'prod' | 'stg' | 'local';

interface Options {
  env: Env;
  source: Source;
  session?: string;
  all: boolean;
  limit: number;
  root: string;
  maxEntries: number;
  output?: string;
}

type OptionState = Omit<Options, 'root'> & { root?: string };

type LogEntry = {
  sessionId: string;
  iso: string;
  ts: number;
  app?: string;
  level?: string;
  tag?: string;
  message?: string;
  userId?: string | null;
  userName?: string | null;
  file: string;
  meta?: any;
};

type PendingEntry = {
  entry: Omit<LogEntry, 'sessionId'>;
  userId?: string;
  roomUrl?: string;
};

type Summary = {
  sessionId: string;
  count: number;
  first: string;
  last: string;
  files: Set<string>;
};

// Output paths are now dynamic based on env - set in main()
let HTML_OUTPUT_PATH = '/tmp/report.html';
let TEXT_OUTPUT_PATH = '/tmp/report.txt';
const BROWSER_LOGS_DIR = '/tmp/logs';
const ANSI_RESET = '\u001b[0m';
const ANSI_BOLD = '\u001b[1m';
// Palette pairs usable for both ANSI 256-color codes and HTML hex values.
const COLOR_PALETTE: Array<{ ansi: number; hex: string }> = [
  { ansi: 196, hex: '#ff1744' },
  { ansi: 202, hex: '#ff6d00' },
  { ansi: 208, hex: '#ff9100' },
  { ansi: 214, hex: '#ffab00' },
  { ansi: 220, hex: '#ffd600' },
  { ansi: 82, hex: '#00c853' },
  { ansi: 45, hex: '#1de9b6' },
  { ansi: 39, hex: '#00b0ff' },
  { ansi: 93, hex: '#8e24aa' },
  { ansi: 201, hex: '#d500f9' }
];

type ColorNamespace = 'app' | 'tag';
const colorCache: Record<ColorNamespace, Map<string, { ansi: number; hex: string }>> = {
  app: new Map(),
  tag: new Map(),
};

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function pickColor(key: string, namespace: ColorNamespace): { ansi: number; hex: string } {
  const cache = colorCache[namespace];
  const existing = cache.get(key);
  if (existing) return existing;
  const idx = hashString(`${namespace}:${key}`) % COLOR_PALETTE.length;
  const color = COLOR_PALETTE[idx];
  cache.set(key, color);
  return color;
}

function colorizeAnsi(text: string, key: string, namespace: ColorNamespace) {
  const { ansi } = pickColor(key, namespace);
  return `\u001b[38;5;${ansi}m${text}${ANSI_RESET}`;
}

function colorizeLevel(level: string | undefined) {
  if (!level) return '<no-level>';
  const upper = level.toUpperCase();
  if (upper.startsWith('E')) return `\u001b[31m${upper}${ANSI_RESET}`;
  if (upper.startsWith('W')) return `\u001b[33m${upper}${ANSI_RESET}`;
  if (upper.startsWith('D')) return `\u001b[36m${upper}${ANSI_RESET}`;
  return `\u001b[32m${upper}${ANSI_RESET}`;
}

function buildHtmlStyles(): string {
  // Generate CSS classes for deterministic colors; class names tie back to hashed keys for readability.
  const appStyles = Array.from(colorCache.app.entries())
    .map(([key, c]) => `.app-${hashString(key)} { color: ${c.hex}; font-weight: 600; }`)
    .join('\n');
  const tagStyles = Array.from(colorCache.tag.entries())
    .map(([key, c]) => `.tag-${hashString(key)} { color: ${c.hex}; font-weight: 600; }`)
    .join('\n');

  return `
<style>
  body { font-family: ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace; background: #0b0c0f; color: #e6edf3; margin: 0; padding: 16px; }
  h1, h2 { margin: 0 0 12px 0; }
  .summary { margin-bottom: 16px; }
  .session { margin-bottom: 28px; border: 1px solid #1f2933; border-radius: 6px; padding: 12px; background: #11151c; }
  .meta { color: #9fb3c8; font-size: 12px; }
  .table { width: 100%; border-collapse: collapse; }
  .table th, .table td { padding: 6px 8px; border-bottom: 1px solid #1f2933; }
  .table th { text-align: left; color: #9fb3c8; font-size: 12px; }
  .lvl-info { color: #4caf50; }
  .lvl-warn { color: #fbc02d; }
  .lvl-error { color: #ef5350; }
  .lvl-debug { color: #26c6da; }
  .ts { color: #9fb3c8; }
  .message { color: #e6edf3; }
  .meta-str { color: #9fb3c8; }
  ${appStyles}
  ${tagStyles}
</style>`;
}

function levelClass(level?: string) {
  if (!level) return 'lvl-info';
  const upper = level.toUpperCase();
  if (upper.startsWith('E')) return 'lvl-error';
  if (upper.startsWith('W')) return 'lvl-warn';
  if (upper.startsWith('D')) return 'lvl-debug';
  return 'lvl-info';
}

const localRoot = '/private/tmp/kube/logs';
const defaultRoot = process.env.KUBE_LOG_ROOT || '/tmp/kube/logs';
const sourceMap: Record<Source, Array<'cloudwatch' | 'kube'>> = {
  cloudwatch: ['cloudwatch'],
  kube: ['kube'],
  both: ['cloudwatch', 'kube'],
};
const sessionKeys = ['sessionId', 'session_id', 'sessionid', 'session'];
const timestampKeys = ['timestamp', 'time', 'datetime', '@timestamp', 'ts'];
const messageKeys = ['message', 'msg', 'event', 'log', 'payload'];
const userIdKeys = ['userId', 'user_id', 'user', 'sessionUserId', 'session_user_id', 'sessionUser', 'session_user'];
const userNameKeys = [
  'userName',
  'username',
  'user_name',
  'sessionUserName',
  'session_user_name',
  'sessionUserEmail',
  'session_user_email',
  'userEmail',
  'user_email',
  'name'
];
const tagKeys = [
  'tag',
  'logger',
  'category',
  'source',
  'component',
  'event',
  'event_name',
  'eventName',
  'module',
  'subsystem'
];
const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function normalizeSessionId(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  const invalidPatterns = [
    /^server:0\.0\.0\.0$/,
    /^server:127\.0\.0\.1$/,
    /^server:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
    /^0\.0\.0\.0$/,
    /^127\.0\.0\.1$/,
    /^::1$/,
    /^server$/,
    /^sessionid?$/,
    /^unknown$/,
    /^<no-session>$/,
  ];
  if (invalidPatterns.some((re) => re.test(lower))) return undefined;
  return trimmed;
}

const userSessionMap = new Map<string, string>();
const roomSessionGlobalMap = new Map<string, string>();
const sessionDedupeKeys = new Map<string, Set<string>>();

function makeEntryDedupeKey(sessionId: string, entry: Omit<LogEntry, 'sessionId'>) {
  return [
    sessionId,
    entry.iso,
    entry.app ?? '',
    entry.tag ?? '',
    entry.level ?? '',
    entry.message ?? '',
    entry.file
  ].join('|');
}

function pushSessionEntry(
  sessions: Map<string, LogEntry[]>,
  sessionId: string,
  baseEntry: Omit<LogEntry, 'sessionId'>
) {
  const dedupeKey = makeEntryDedupeKey(sessionId, baseEntry);
  if (!sessionDedupeKeys.has(sessionId)) sessionDedupeKeys.set(sessionId, new Set());
  const keySet = sessionDedupeKeys.get(sessionId)!;
  if (keySet.has(dedupeKey)) return;
  keySet.add(dedupeKey);

  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  sessions.get(sessionId)!.push({ ...baseEntry, sessionId });
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const { flags, values, positionals } = collectArgs(args);

  if (flags.has('--help') || flags.has('-h')) {
    printHelp();
    process.exit(0);
  }

  const env = resolveEnv(values.get('--env'));
  const source = resolveSource(values.get('--source'));
  const session = resolveSession(values.get('--session'), positionals);
  const all = flags.has('--all');
  const limit = resolveLimit(values.get('--limit'));
  const root = resolveRoot(values.get('--root'), env);
  const maxEntries = resolveMaxEntries(values.get('--max-entries'));
  const output = values.get('--output');

  // Set output paths based on env (can be overridden by --output)
  if (output) {
    HTML_OUTPUT_PATH = output.endsWith('.html') ? output : `${output}.html`;
    TEXT_OUTPUT_PATH = output.replace(/\.html$/, '.txt');
  } else {
    HTML_OUTPUT_PATH = `/tmp/report-${env}.html`;
    TEXT_OUTPUT_PATH = `/tmp/report-${env}.txt`;
  }

  return { env, source, session, all, limit, root, maxEntries, output };
}

function collectArgs(args: string[]) {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      values.set(arg, next);
      i += 1;
      continue;
    }
    flags.add(arg);
  }

  return { flags, values, positionals };
}

function resolveEnv(raw: string | undefined): Env {
  if (raw === 'prod' || raw === 'stg' || raw === 'local') return raw;
  return 'stg';
}

function resolveSource(raw: string | undefined): Source {
  if (raw === 'cloudwatch' || raw === 'kube' || raw === 'both') return raw;
  return 'both';
}

function resolveSession(raw: string | undefined, positionals: string[]) {
  if (raw) return raw;
  if (!positionals.length) return undefined;

  // Accept either "<sessionId>" or "session <sessionId>" for convenience.
  if (positionals[0] === 'session') return positionals[1];
  return positionals[0];
}

function resolveLimit(raw: string | undefined) {
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? 5 : parsed;
}

function resolveRoot(raw: string | undefined, env: Env) {
  if (raw) return raw;
  if (process.env.KUBE_LOG_ROOT) return process.env.KUBE_LOG_ROOT;
  return env === 'local' ? localRoot : defaultRoot;
}

function resolveMaxEntries(raw: string | undefined) {
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? 10000 : parsed;
}

function printHelp() {
  console.log(`Usage: ts-node scripts/report-sessions.ts [options]\n\n` +
    `Options:\n` +
    `  --env <prod|stg|local>        Environment (default: stg)\n` +
    `  --source <cloudwatch|kube|both> Which logs to scan (default: both)\n` +
    `  --session <id>                Focus on a single session timeline\n` +
    `  --all                         Print timelines for all sessions (may be large)\n` +
    `  --limit <n>                   Max sessions to expand when --all not set (default: 5)\n` +
    `  --root <path>                 Override log root (default: /tmp/kube/logs)\n` +
    `  --max-entries <n>             Hard cap on parsed entries (default: 10000)\n`);
}

function pickFirstString(obj: any, keys: string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const hit = keys.find((key) => {
    const val = (obj as any)[key];
    return typeof val === 'string' && Boolean(val);
  });
  return hit ? (obj as any)[hit] : undefined;
}

function getByPath(obj: any, path: string[]) {
  return path.reduce((acc, key) => (acc && typeof acc === 'object' ? (acc as any)[key] : undefined), obj);
}

function pickFirstStringPath(obj: any, paths: string[][]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const path of paths) {
    const val = getByPath(obj, path);
    if (typeof val === 'string' && val.trim()) return val;
    if (Array.isArray(val)) {
      const firstStr = val.find((v) => typeof v === 'string' && v.trim());
      if (firstStr) return firstStr;
    }
  }
  return undefined;
}

function extractLabeledUuid(text: string | undefined, labelPattern: RegExp): string | undefined {
  if (!text) return undefined;
  const labeled = text.match(new RegExp(`${labelPattern.source}[\s"':=]+(${uuidPattern.source})`, 'i'));
  return labeled ? labeled[1] : undefined;
}

function extractLabeledString(text: string | undefined, labels: string[]): string | undefined {
  if (!text) return undefined;
  const pattern = labels.map(escapeRegExp).join('|');
  const match = text.match(new RegExp(`(?:${pattern})[\s"']*[:=][\s"']*([^"'|,\n]+)`, 'i'));
  return match ? match[1].trim() : undefined;
}

function deriveApp(filePath: string): string {
  const name = path.basename(filePath).toLowerCase();
  const pairs: Array<[string, string]> = [
    ['interface', 'interface'],
    ['dashboard', 'dashboard'],
    ['mesh', 'mesh'],
    ['pipecat-daily-bot-operator', 'pipecat-operator'],
    ['pipecat-daily-bot-stg', 'pipecat-gateway'],
    ['pipecat-daily-bot-gateway', 'pipecat-gateway'],
    ['pipecat-daily-bot-runner', 'pipecat-runner'],
    ['chorus-tts', 'chorus-tts'],
    ['redis', 'redis'],
    ['postgres', 'postgres'],
    ['bot-warm-pool', 'bot-pool']
  ];

  const hit = pairs.find(([needle]) => name.includes(needle));
  if (hit) return hit[1];

  // Fallback: derive from first non-default token to keep output informative.
  const segments = name.split('-').filter(Boolean);
  const fallback = segments.find((s) => s !== 'default' && s !== 'stg' && s !== 'prod' && s !== 'local');
  return fallback || 'unknown';
}

function normalizeTag(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return undefined;
  const unwrapped = trimmed.replace(/^\[+/, '').replace(/\]+$/, '').trim();
  if (!unwrapped) return undefined;
  if (/^\d+$/.test(unwrapped)) return undefined; // discard worker ids like "1"
  if (unwrapped.toLowerCase() === '<no-tag>') return undefined;
  return unwrapped;
}

function deriveTag(existing: string | undefined, obj?: Record<string, any>): string | undefined {
  const candidates = [
    normalizeTag(existing),
    normalizeTag(obj?.event),
    normalizeTag(obj?.event_name),
    normalizeTag(obj?.eventName),
    normalizeTag(obj?.module),
    normalizeTag(obj?.subsystem),
    normalizeTag(obj?.category),
    normalizeTag(obj?.source)
  ];
  return candidates.find(Boolean);
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripLeadingTagFromMessage(message: string | undefined, tag: string | undefined): string | undefined {
  if (!message || !tag) return message;
  const pattern = new RegExp(`^\\s*\\[${escapeRegExp(tag)}\\]\\s*`, 'i');
  return message.replace(pattern, '').trim();
}

function parseMeta(obj: any): any {
  if (!obj || typeof obj !== 'object') return undefined;
  const { meta } = obj;
  return meta || extractContextMeta(obj);
}

function extractContextMeta(obj: any): Record<string, any> | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const interestingKeys = [
    'method',
    'url',
    'path',
    'route',
    'status',
    'auth',
    'params',
    'body',
    'content_preview',
    'content_length',
    'content_type',
    'error',
  ];
  const meta: Record<string, any> = {};
  interestingKeys.forEach((key) => {
    const val = (obj as any)[key];
    if (val !== undefined && val !== null) {
      meta[key] = val;
    }
  });
  return Object.keys(meta).length ? meta : undefined;
}

function parsePlainLog(line: string): any | null {
  // Matches log lines like "2025-12-24 16:07:02,490 pipecat.tools INFO Config payload {...}"
  const match = line.match(
    /^(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)[^\s]*\s+(\S+)\s+(\w+)\s+(.*)$/
  );
  if (!match) return null;
  const [, tsRaw, loggerName, level, rest] = match;
  const isoTs = tsRaw.replace(',', '.');
  const ts = Date.parse(isoTs);
  if (Number.isNaN(ts)) return null;
  return {
    timestamp: new Date(ts).toISOString(),
    time: new Date(ts).toISOString(),
    ts: new Date(ts).toISOString(),
    message: rest.trim(),
    level,
    logger: loggerName,
  };
}

async function parseFile(file: string, sessions: Map<string, LogEntry[]>, maxEntries: number) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  // Track roomUrl -> sessionId associations within this file to backfill entries that omit sessionId.
  const roomSessionMap = new Map<string, string>();
  const pendingEntries: PendingEntry[] = [];

  for await (const raw of rl) {
    if (sessions.size > maxEntries) break;
    const line = raw.trim();
    if (!line) continue;
    let obj: any;
    if (line.startsWith('{') || line.startsWith('[')) {
      try {
        obj = JSON.parse(line);
      } catch {
        // fall through to plain log parsing below
      }
    }

    // Handle CloudWatch format: "YYYY-MM-DD HH:MM:SS.mmm {...}"
    if (!obj) {
      const cwMatch = line.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[.,]\d+\s+(\{.+\})$/);
      if (cwMatch) {
        try {
          obj = JSON.parse(cwMatch[1]);
        } catch {
          // fall through to plain log parsing below
        }
      }
    }

    if (!obj) {
      obj = parsePlainLog(line);
      if (!obj) continue;
    }
    const message = pickFirstString(obj, messageKeys);
    const meta = obj.meta ?? parseMeta(obj);

    const roomUrl =
      (obj as any)?.room_url ||
      (obj as any)?.roomUrl ||
      (meta as any)?.room_url ||
      (meta as any)?.roomUrl ||
      (typeof message === 'string'
        ? (message.match(/https?:\/\/[^\s,'"}]+/i)?.[0] ||
          message.match(/room[_\s-]?url["']?[:=]\s*["']([^"']+)/i)?.[1])
        : undefined);

    const tsStr = pickFirstString(obj, timestampKeys);
    if (!tsStr || typeof tsStr !== 'string') continue;
    const ts = Date.parse(tsStr);
    if (Number.isNaN(ts)) continue;

    const userId =
      pickFirstString(obj, userIdKeys) ||
      pickFirstString(meta, userIdKeys) ||
      pickFirstString((meta as any)?.user, ['id', 'userId', 'user_id']) ||
      pickFirstStringPath(obj, [
        ['meta', 'session_metadata', 'session_user_id'],
        ['meta', 'user_profile', 'userId'],
        ['meta', 'user_profile', 'metadata', 'userId'],
        ['data', 'context', 'session_metadata', 'session_user_id'],
        ['data', 'user_profile', 'userId'],
        ['data', 'user', 'id'],
      ]) ||
      pickFirstStringPath(meta, [
        ['session_metadata', 'session_user_id'],
        ['user_profile', 'userId'],
        ['user_profile', 'metadata', 'userId'],
        ['body', 'sessionUserId'],
        ['body', 'session_user_id'],
        ['body', 'userId'],
      ]);

    const userName =
      pickFirstString(obj, userNameKeys) ||
      pickFirstString(meta, userNameKeys) ||
      pickFirstString((meta as any)?.user, ['name', 'username', 'email']) ||
      pickFirstStringPath(obj, [
        ['meta', 'session_metadata', 'session_user_name'],
        ['meta', 'session_metadata', 'name'],
        ['meta', 'user_profile', 'metadata', 'name'],
        ['meta', 'user_profile', 'name'],
        ['meta', 'user_profile', 'first_name'],
        ['data', 'context', 'session_metadata', 'session_user_name'],
        ['data', 'context', 'session_metadata', 'name'],
        ['data', 'user_profile', 'metadata', 'name'],
        ['data', 'user_profile', 'first_name'],
        ['data', 'user_profile', 'name'],
        ['data', 'user', 'name'],
      ]) ||
      pickFirstStringPath(meta, [
        ['session_metadata', 'session_user_name'],
        ['session_metadata', 'name'],
        ['user_profile', 'metadata', 'name'],
        ['user_profile', 'name'],
        ['user_profile', 'first_name'],
        ['body', 'sessionUserName'],
        ['body', 'session_user_name'],
        ['body', 'userName'],
        ['body', 'user_name'],
      ]);

    const derivedUserId =
      (typeof userId === 'string' && userId.trim()) ? userId.trim() : extractLabeledUuid(message, /(user[_\-]?id|user)/i);
    const derivedUserName =
      (typeof userName === 'string' && userName.trim())
        ? userName.trim()
        : pickFirstString(meta, ['userEmail', 'sessionUserEmail']) ||
          pickFirstString((meta as any)?.user, ['email']) ||
          pickFirstStringPath(meta, [
            ['session_metadata', 'session_user_email'],
            ['session_metadata', 'email'],
            ['user_profile', 'metadata', 'email'],
            ['user_profile', 'email'],
            ['body', 'sessionUserEmail'],
            ['body', 'session_user_email'],
            ['body', 'userEmail'],
          ]) ||
          extractLabeledString(message, ['sessionUserName', 'session_user_name', 'userName', 'user_name', 'userEmail', 'user_email', 'name']);

    const sessionFromEntry = normalizeSessionId(pickFirstString(obj, sessionKeys));
    const sessionFromMeta = normalizeSessionId(pickFirstString(meta, sessionKeys));
    let sessionId = sessionFromEntry || sessionFromMeta;
    if (!sessionId && typeof message === 'string') {
      sessionId = normalizeSessionId(extractLabeledUuid(message, /(session[_\-]?id|session)/i));
    }
    if (!sessionId && meta && typeof meta === 'object') {
      sessionId = normalizeSessionId(extractLabeledUuid(JSON.stringify(meta), /(session[_\-]?id|session)/i));
    }
    if (!sessionId && roomUrl) {
      sessionId = roomSessionMap.get(roomUrl) || roomSessionGlobalMap.get(roomUrl);
    }
    if (!sessionId && derivedUserId) {
      sessionId = userSessionMap.get(derivedUserId);
    }

    const app = deriveApp(file);
    const tag = deriveTag(pickFirstString(obj, tagKeys), obj as Record<string, any>);

    const cleanedMessage = stripLeadingTagFromMessage(message, tag);

    const baseEntry: Omit<LogEntry, 'sessionId'> = {
      iso: new Date(ts).toISOString(),
      ts,
      app,
      level: obj.level || obj.severity || obj.logLevel,
      tag,
      message: cleanedMessage,
      userId: derivedUserId,
      userName: derivedUserName,
      file: path.basename(file),
      meta
    };

    if (sessionId) {
      if (roomUrl) {
        roomSessionMap.set(roomUrl, sessionId);
        roomSessionGlobalMap.set(roomUrl, sessionId);
      }
      if (derivedUserId) {
        userSessionMap.set(derivedUserId, sessionId);
      }

        pushSessionEntry(sessions, sessionId, baseEntry);
    } else {
      pendingEntries.push({ entry: baseEntry, userId: derivedUserId, roomUrl });
    }
  }

  pendingEntries.forEach((pending) => {
    let resolvedSession = pending.userId ? userSessionMap.get(pending.userId) : undefined;
    if (!resolvedSession && pending.roomUrl) {
      resolvedSession = roomSessionMap.get(pending.roomUrl) || roomSessionGlobalMap.get(pending.roomUrl);
    }
    if (!resolvedSession) return;

    if (pending.roomUrl) {
      roomSessionMap.set(pending.roomUrl, resolvedSession);
      roomSessionGlobalMap.set(pending.roomUrl, resolvedSession);
    }
    if (pending.userId) {
      userSessionMap.set(pending.userId, resolvedSession);
    }
      pushSessionEntry(sessions, resolvedSession, pending.entry);
  });
}

/**
 * Scan /tmp/logs for browser-*.log files and parse entries that fall within a time window.
 */
async function scanBrowserLogs(startTs: number, endTs: number): Promise<LogEntry[]> {
  const browserEntries: LogEntry[] = [];

  if (!fs.existsSync(BROWSER_LOGS_DIR)) {
    return browserEntries;
  }

  const files = fs.readdirSync(BROWSER_LOGS_DIR)
    .filter((f) => f.startsWith('browser') && (f.endsWith('.log') || f.endsWith('.txt') || f.endsWith('.json')))
    .map((f) => path.join(BROWSER_LOGS_DIR, f));

  for (const file of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });

    for await (const raw of rl) {
      const line = raw.trim();
      if (!line) continue;

      // Browser logs may have prefix noise (e.g., "506-63e5009a7989d4dc.js:1 ") before JSON
      let jsonStart = line.indexOf('{');
      if (jsonStart === -1) continue;

      const jsonPart = line.slice(jsonStart);
      let obj: any;
      try {
        obj = JSON.parse(jsonPart);
      } catch {
        continue;
      }

      const tsStr = obj.timestamp || obj.time || obj.ts;
      if (!tsStr || typeof tsStr !== 'string') continue;

      const ts = Date.parse(tsStr);
      if (Number.isNaN(ts)) continue;

      // Only include entries within the target timeframe (with 5-second padding)
      const padding = 5000;
      if (ts < startTs - padding || ts > endTs + padding) continue;

      const tag = normalizeTag(obj.tag);
      const message = stripLeadingTagFromMessage(obj.message, tag);

      // Browser logs include sessionId - use it directly
      const browserSessionId = normalizeSessionId(obj.sessionId);

      const entry: LogEntry = {
        sessionId: browserSessionId || '<browser-orphan>',
        iso: new Date(ts).toISOString(),
        ts,
        app: 'browser',
        level: obj.level || 'info',
        tag,
        message,
        userId: obj.userId || null,
        userName: obj.userName || null,
        file: path.basename(file),
        meta: obj.meta,
      };

      browserEntries.push(entry);
    }
  }

  return browserEntries;
}

function summarize(sessions: Map<string, LogEntry[]>): Summary[] {
  return Array.from(sessions.entries()).map(([id, entries]) => {
    const sorted = [...entries].sort((a, b) => a.ts - b.ts);
    const files = new Set(sorted.map((e) => e.file));
    return {
      sessionId: id,
      count: entries.length,
      first: sorted[0]?.iso,
      last: sorted[sorted.length - 1]?.iso,
      files
    };
  });
}

function formatMeta(meta: any): string | undefined {
  if (!meta) return undefined;
  if (typeof meta === 'string') return meta.length > 180 ? meta.slice(0, 180) + '…' : meta;
  if (typeof meta !== 'object') return undefined;
  const pairs: string[] = [];
  Object.entries(meta).slice(0, 5).forEach(([k, v]) => {
    const val = typeof v === 'string' ? v : JSON.stringify(v);
    if (val) pairs.push(`${k}=${val.length > 80 ? val.slice(0, 80) + '…' : val}`);
  });
  if (!pairs.length) return undefined;
  return pairs.join(' | ');
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function printTimeline(sessionId: string, entries: LogEntry[]) {
  const sorted = [...entries].sort((a, b) => a.ts - b.ts);
  const firstIso = sorted[0]?.iso;
  const lastIso = sorted[sorted.length - 1]?.iso;
  const files = Array.from(new Set(sorted.map((e) => e.file))).join(', ');
  const primaryUser = sorted.find((e) => e.userName) || sorted.find((e) => e.userId);
  const userName = primaryUser?.userName || sorted.find((e) => e.userId)?.userName || 'unknown';
  const userId = primaryUser?.userId || 'unknown';
  const levelWidth = Math.max(
    7, // "WARNING" is the longest standard level we expect
    ...sorted.map((e) => ((e.level || '<no-level>').toUpperCase().length))
  );
  const appWidth = Math.max(3, ...sorted.map((e) => (e.app || '<app>').length));
  const tagWidth = Math.max(6, ...sorted.map((e) => (e.tag || '<no-tag>').length));
  console.log(`\n${ANSI_BOLD}SESSION SessionId:${ANSI_RESET} ${sessionId}  UserName: ${userName}  UserId: ${userId}`);
  console.log(`  events: ${sorted.length}`);
  if (firstIso && lastIso) console.log(`  window: ${firstIso} → ${lastIso}`);
  if (files) console.log(`  sources: ${files}`);
  sorted.forEach((e, idx) => {
    const timestamp = e.iso || '';
    const levelRaw = (e.level || '<no-level>').toUpperCase().padEnd(levelWidth, ' ');
    const appRaw = (e.app || '<app>').padEnd(appWidth, ' ');
    const tagRaw = (e.tag || '<no-tag>').padEnd(tagWidth, ' ');
    const level = colorizeLevel(levelRaw);
    const app = colorizeAnsi(appRaw, e.app || '<app>', 'app');
    const tag = colorizeAnsi(tagRaw, e.tag || '<no-tag>', 'tag');
    const message = (e.message || '<no message>').replace(/\s+/g, ' ').trim();
    const metaStr = formatMeta(e.meta);
    const line = [timestamp, level, app, tag, message].join(' ');
    console.log(`${String(idx + 1).padStart(3, '0')}. ${line}${metaStr ? ` | ${metaStr}` : ''}`);
  });
}

function renderHtmlSession(sessionId: string, entries: LogEntry[]) {
  const sorted = [...entries].sort((a, b) => a.ts - b.ts);
  const primaryUser = sorted.find((e) => e.userName) || sorted.find((e) => e.userId);
  const userName = primaryUser?.userName || sorted.find((e) => e.userId)?.userName || 'unknown';
  const userId = primaryUser?.userId || 'unknown';
  const rows = sorted.map((e, idx) => {
    const appKey = e.app || '<app>';
    const tagKey = e.tag || '<no-tag>';
    // Prime color cache for HTML styling
    pickColor(appKey, 'app');
    pickColor(tagKey, 'tag');
    const appClass = `app-${hashString(appKey)}`;
    const tagClass = `tag-${hashString(tagKey)}`;
    const metaStr = formatMeta(e.meta);
    return `<tr>
      <td class="ts">${escapeHtml(e.iso || '')}</td>
      <td class="${levelClass(e.level)}">${escapeHtml((e.level || '<no-level>').toUpperCase())}</td>
      <td class="${appClass}">${escapeHtml(appKey)}</td>
      <td class="${tagClass}">${escapeHtml(tagKey)}</td>
      <td class="message">${escapeHtml((e.message || '<no message>').replace(/\s+/g, ' ').trim())}</td>
      <td class="meta-str">${metaStr ? escapeHtml(metaStr) : ''}</td>
    </tr>`;
  }).join('\n');

  return `
  <div class="session">
    <h2>Session ${escapeHtml(sessionId)}</h2>
    <div class="meta">User: ${escapeHtml(userName)} | UserId: ${escapeHtml(userId)} | Events: ${sorted.length}</div>
    <table class="table">
      <thead><tr><th>Time</th><th>Level</th><th>App</th><th>Tag</th><th>Message</th><th>Meta</th></tr></thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>`;
}

function writeHtmlReport(targetSessions: Summary[], sessions: Map<string, LogEntry[]>) {
  const sessionBlocks = targetSessions.map((s) => renderHtmlSession(s.sessionId, sessions.get(s.sessionId) || [])).join('\n');
  const styles = buildHtmlStyles();
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Log Report</title>
  ${styles}
</head>
<body>
  <h1>Log Report</h1>
  <div class="summary">Sessions: ${targetSessions.length}</div>
  ${sessionBlocks}
</body>
</html>`;
  fs.writeFileSync(HTML_OUTPUT_PATH, html, 'utf8');
}

function writePlaintextReport(targetSessions: Summary[], sessions: Map<string, LogEntry[]>) {
  const lines: string[] = [];
  lines.push('Log Report');
  lines.push(`Sessions: ${targetSessions.length}`);
  lines.push('');

  targetSessions.forEach((s) => {
    const entries = [...(sessions.get(s.sessionId) || [])].sort((a, b) => a.ts - b.ts);
    const primaryUser = entries.find((e) => e.userName) || entries.find((e) => e.userId);
    const userName = primaryUser?.userName || entries.find((e) => e.userId)?.userName || 'unknown';
    const userId = primaryUser?.userId || 'unknown';
    const levelWidth = Math.max(
      7, // "WARNING" is the longest standard level we expect
      ...entries.map((e) => ((e.level || '<no-level>').toUpperCase().length))
    );
    const appWidth = Math.max(3, ...entries.map((e) => (e.app || '<app>').length));
    const tagWidth = Math.max(6, ...entries.map((e) => (e.tag || '<no-tag>').length));
    lines.push(`Session ${s.sessionId}`);
    lines.push(`User: ${userName} | UserId: ${userId} | Events: ${entries.length}`);
    entries.forEach((e, idx) => {
      const level = (e.level || '<no-level>').toUpperCase().padEnd(levelWidth, ' ');
      const app = (e.app || '<app>').padEnd(appWidth, ' ');
      const tag = (e.tag || '<no-tag>').padEnd(tagWidth, ' ');
      const message = (e.message || '<no message>').replace(/\s+/g, ' ').trim();
      const metaStr = formatMeta(e.meta);
      const metaPart = metaStr ? ` | ${metaStr}` : '';
      lines.push(`${String(idx + 1).padStart(3, '0')}. ${e.iso || ''} ${level} ${app} ${tag} ${message}${metaPart}`);
    });
    lines.push('');
  });

  fs.writeFileSync(TEXT_OUTPUT_PATH, lines.join('\n'), 'utf8');
}

function buildPatterns(base: string, source: Source) {
  const patterns = new Set<string>();
  const extensions = '*.{log,txt,json,jsonl}';
  const sources = sourceMap[source];

  sources.forEach((dir) => {
    const candidate = path.join(base, dir);
    if (fs.existsSync(candidate)) {
      patterns.add(path.join(candidate, '**', extensions));
    } else {
      // Some envs (local) log directly under the env folder without a kube/cloudwatch subdir.
      patterns.add(path.join(base, '**', extensions));
    }
  });

  return Array.from(patterns);
}

async function main() {
  const options = parseArgs();
  const base = path.join(options.root, options.env);
  const patterns = buildPatterns(base, options.source);
  const sessions = new Map<string, LogEntry[]>();

  const files: string[] = [];
  for (const pattern of patterns) {
    const matched = await glob(pattern, { absolute: true, nodir: true });
    files.push(...matched);
  }

  if (files.length === 0) {
    console.error(`No log files found for patterns: ${patterns.join(', ')}`);
    process.exit(1);
  }

  for (const file of files) {
    await parseFile(file, sessions, options.maxEntries);
  }

  const summaries = summarize(sessions).sort((a, b) => b.count - a.count);
  console.log(`Scanned ${files.length} files, collected ${summaries.reduce((acc, s) => acc + s.count, 0)} entries across ${summaries.length} sessions.`);
  console.log('Top sessions:');
  summaries.slice(0, options.limit).forEach((s) => {
    console.log(`- ${s.sessionId} (${s.count} entries) ${s.first} → ${s.last} [${Array.from(s.files).join(', ')}]`);
  });

  const sessionFilter = options.session;
  const targetSessions = sessionFilter
    ? summaries.filter((s) => s.sessionId.includes(sessionFilter))
    : summaries; // default: report all sessions when no filter provided

  if (targetSessions.length === 0) {
    console.log('No sessions match the requested filter.');
    writeHtmlReport([], sessions);
    writePlaintextReport([], sessions);
    const htmlFileUri = `file://${HTML_OUTPUT_PATH}`;
    console.log(`HTML report written to ${HTML_OUTPUT_PATH} (${htmlFileUri})`);
    console.log(`Plain report written to ${TEXT_OUTPUT_PATH}`);
    return;
  }

  // Calculate the overall time window across all target sessions
  let globalMinTs = Infinity;
  let globalMaxTs = -Infinity;
  targetSessions.forEach((s) => {
    const entries = sessions.get(s.sessionId) || [];
    entries.forEach((e) => {
      if (e.ts < globalMinTs) globalMinTs = e.ts;
      if (e.ts > globalMaxTs) globalMaxTs = e.ts;
    });
  });

  // Scan browser logs for entries within this time window and interleave them
  let browserEntriesCount = 0;
  if (globalMinTs !== Infinity && globalMaxTs !== -Infinity) {
    const browserEntries = await scanBrowserLogs(globalMinTs, globalMaxTs);
    browserEntriesCount = browserEntries.length;

    if (browserEntries.length > 0) {
      // Count entries with valid sessionIds vs orphans
      const withSession = browserEntries.filter((be) => be.sessionId !== '<browser-orphan>');
      const orphans = browserEntries.filter((be) => be.sessionId === '<browser-orphan>');
      console.log(`Found ${browserEntries.length} browser log entries (${withSession.length} with sessionId, ${orphans.length} orphaned).`);

      // Add browser entries to their matching sessions by sessionId
      browserEntries.forEach((be) => {
        if (be.sessionId === '<browser-orphan>') return; // Skip orphans

        // Find the session this entry belongs to
        if (sessions.has(be.sessionId)) {
          sessions.get(be.sessionId)!.push(be);
        } else {
          // Session exists in browser but not in server logs - create it
          sessions.set(be.sessionId, [be]);
        }
      });
    }
  }

  targetSessions.forEach((s) => {
    const entries = sessions.get(s.sessionId) || [];
    printTimeline(s.sessionId, entries);
  });

  writeHtmlReport(targetSessions, sessions);
  const htmlFileUri = `file://${HTML_OUTPUT_PATH}`;
  console.log(`\nHTML report written to ${HTML_OUTPUT_PATH} (${htmlFileUri})`);
  writePlaintextReport(targetSessions, sessions);
  console.log(`Plain report written to ${TEXT_OUTPUT_PATH}`);
  if (browserEntriesCount > 0) {
    console.log(`Interleaved ${browserEntriesCount} browser log entries from ${BROWSER_LOGS_DIR}/browser*.log`);
  }
}

main().catch((err) => {
  console.error('Report generation failed:', err);
  process.exit(1);
});

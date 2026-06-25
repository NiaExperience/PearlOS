import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const OPENCLAW_DISCORD_ALLOWLIST_PATH =
  process.env.OPENCLAW_DISCORD_ALLOWLIST_PATH || '/root/.openclaw/credentials/discord-default-allowFrom.json';
const OPENCLAW_DISCORD_PAIRING_PATH =
  process.env.OPENCLAW_DISCORD_PAIRING_PATH || '/root/.openclaw/credentials/discord-pairing.json';

type OpenClawAllowlistFile = {
  version?: number;
  allowFrom?: unknown[];
};

type OpenClawPairingFile = {
  version?: number;
  requests?: unknown[];
};

type OpenClawPairingRequest = Record<string, unknown>;

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(tmpPath, filePath);
}

function isDiscordUserId(value: string): boolean {
  return /^\d{17,20}$/.test(value);
}

function pairingRequestMatchesDiscordUser(request: unknown, discordUserId: string): boolean {
  if (!request || typeof request !== 'object') return false;
  const entry = request as OpenClawPairingRequest;
  if (String(entry.id || '').trim() === discordUserId) return true;
  if (String(entry.discordUserId || '').trim() === discordUserId) return true;
  return JSON.stringify(entry).includes(discordUserId);
}

function extractPairingCode(entry: OpenClawPairingRequest): string | null {
  const direct =
    (typeof entry.code === 'string' && entry.code) ||
    (typeof entry.pairingCode === 'string' && entry.pairingCode) ||
    (typeof entry.pairing_code === 'string' && entry.pairing_code) ||
    '';
  if (direct && /^[A-Z2-9]{6,12}$/i.test(direct)) return direct.toUpperCase();
  for (const value of Object.values(entry)) {
    if (typeof value === 'string' && /^[A-Z2-9]{6,12}$/i.test(value)) {
      return value.toUpperCase();
    }
  }
  return null;
}

async function findPendingDiscordPairingCode(discordUserId: string): Promise<string | null> {
  const parsed = await readJsonFile<OpenClawPairingFile>(OPENCLAW_DISCORD_PAIRING_PATH, {
    version: 1,
    requests: [],
  });
  const requests = Array.isArray(parsed.requests) ? parsed.requests : [];
  const match = requests.find((request) => pairingRequestMatchesDiscordUser(request, discordUserId));
  if (!match || typeof match !== 'object') return null;
  return extractPairingCode(match as OpenClawPairingRequest);
}

async function removePendingDiscordPairingRequest(discordUserId: string): Promise<boolean> {
  const parsed = await readJsonFile<OpenClawPairingFile>(OPENCLAW_DISCORD_PAIRING_PATH, {
    version: 1,
    requests: [],
  });
  const requests = Array.isArray(parsed.requests) ? parsed.requests : [];
  const nextRequests = requests.filter((request) => !pairingRequestMatchesDiscordUser(request, discordUserId));
  if (nextRequests.length === requests.length) return false;
  await writeJsonFile(OPENCLAW_DISCORD_PAIRING_PATH, {
    ...parsed,
    version: parsed.version ?? 1,
    requests: nextRequests,
  });
  return true;
}

export async function addDiscordUserToOpenClawAllowlist(discordUserId: string): Promise<boolean> {
  if (!isDiscordUserId(discordUserId)) return false;
  const parsed = await readJsonFile<OpenClawAllowlistFile>(OPENCLAW_DISCORD_ALLOWLIST_PATH, {
    version: 1,
    allowFrom: [],
  });
  const allowFrom = Array.isArray(parsed.allowFrom) ? parsed.allowFrom.map(String) : [];
  if (allowFrom.includes(discordUserId)) return true;
  allowFrom.push(discordUserId);
  await writeJsonFile(OPENCLAW_DISCORD_ALLOWLIST_PATH, {
    ...parsed,
    version: parsed.version ?? 1,
    allowFrom,
  });
  return true;
}

export async function approveDiscordOpenClawAccess(discordUserId: string): Promise<{
  allowlisted: boolean;
  pairingApproved: boolean;
  pendingPairingRemoved: boolean;
}> {
  if (!isDiscordUserId(discordUserId)) {
    return { allowlisted: false, pairingApproved: false, pendingPairingRemoved: false };
  }

  let pairingApproved = false;
  const pairingCode = await findPendingDiscordPairingCode(discordUserId);
  if (pairingCode) {
    try {
      await execFileAsync('openclaw', ['pairing', 'approve', 'discord', pairingCode, '--notify'], {
        timeout: 10000,
      });
      pairingApproved = true;
    } catch (error) {
      console.warn('[discord/dm-link] OpenClaw pairing approve failed; falling back to allowlist update', error);
    }
  }

  const allowlisted = await addDiscordUserToOpenClawAllowlist(discordUserId);
  const pendingPairingRemoved = await removePendingDiscordPairingRequest(discordUserId);
  return { allowlisted, pairingApproved, pendingPairingRemoved };
}

export async function removeDiscordOpenClawAccess(discordUserId: string): Promise<{
  allowlistRemoved: boolean;
  pendingPairingRemoved: boolean;
}> {
  if (!isDiscordUserId(discordUserId)) {
    return { allowlistRemoved: false, pendingPairingRemoved: false };
  }

  const parsed = await readJsonFile<OpenClawAllowlistFile>(OPENCLAW_DISCORD_ALLOWLIST_PATH, {
    version: 1,
    allowFrom: [],
  });
  const allowFrom = Array.isArray(parsed.allowFrom) ? parsed.allowFrom.map(String) : [];
  const nextAllowFrom = allowFrom.filter((entry) => entry !== discordUserId);
  const allowlistRemoved = nextAllowFrom.length !== allowFrom.length;
  if (allowlistRemoved) {
    await writeJsonFile(OPENCLAW_DISCORD_ALLOWLIST_PATH, {
      ...parsed,
      version: parsed.version ?? 1,
      allowFrom: nextAllowFrom,
    });
  }

  const pendingPairingRemoved = await removePendingDiscordPairingRequest(discordUserId);
  return { allowlistRemoved, pendingPairingRemoved };
}

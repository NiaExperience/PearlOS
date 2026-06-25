/**
 * SMS Session Manager
 *
 * Maps phone numbers to OpenClaw conversation sessions using file-based storage.
 * Each phone number gets a JSON file in the SMS_SESSIONS_DIR directory.
 *
 * Sessions expire after SESSION_TTL_MS (default 24 hours) of inactivity.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const SMS_SESSIONS_DIR =
  process.env.SMS_SESSIONS_DIR ?? join(process.cwd(), "sms-sessions");
const SESSION_TTL_MS = Number(process.env.SMS_SESSION_TTL_MS ?? 24 * 60 * 60 * 1000); // 24h

interface SessionRecord {
  sessionId: string;
  openclawSessionKey: string;
  phoneNumber: string;
  lastActivity: number; // unix ms
  messageCount: number;
  createdAt: number;
}

function ensureDir(): void {
  if (!existsSync(SMS_SESSIONS_DIR)) {
    mkdirSync(SMS_SESSIONS_DIR, { recursive: true });
  }
}

function sanitizeFilename(phone: string): string {
  // Remove non-alphanumeric chars, keep + at start
  return phone.replace(/[^a-zA-Z0-9+]/g, "_");
}

function sanitizeSessionPeer(phone: string): string {
  return (
    phone
      .trim()
      .toLowerCase()
      .replace(/^\+/, "plus")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}

export function buildSmsOpenClawSessionKey(phoneNumber: string): string {
  const agentId = process.env.SMS_OPENCLAW_AGENT_ID?.trim() || "main";
  return `agent:${agentId}:sms:direct:${sanitizeSessionPeer(phoneNumber)}`;
}

function sessionPath(phone: string): string {
  return join(SMS_SESSIONS_DIR, `${sanitizeFilename(phone)}.json`);
}

function loadSession(phone: string): SessionRecord | null {
  const path = sessionPath(phone);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const record: SessionRecord = JSON.parse(raw);
    if (!record.openclawSessionKey) {
      record.openclawSessionKey = buildSmsOpenClawSessionKey(record.phoneNumber || phone);
    }
    // Check expiry
    if (Date.now() - record.lastActivity > SESSION_TTL_MS) {
      // Session expired — clean up
      try {
        unlinkSync(path);
      } catch {
        // best-effort cleanup
      }
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

function saveSession(record: SessionRecord): void {
  ensureDir();
  writeFileSync(sessionPath(record.phoneNumber), JSON.stringify(record, null, 2), "utf-8");
}

/**
 * Get or create a session for the given phone number.
 * If an existing session has expired, a new one is created.
 */
export function getOrCreateSession(phoneNumber: string): SessionRecord {
  const existing = loadSession(phoneNumber);
  if (existing) {
    const now = Date.now();
    // Expired?
    if (now - existing.lastActivity > SESSION_TTL_MS) {
      // Fall through to create new
    } else {
      existing.lastActivity = now;
      existing.messageCount++;
      saveSession(existing);
      return existing;
    }
  }

  const record: SessionRecord = {
    sessionId: randomUUID(),
    openclawSessionKey: buildSmsOpenClawSessionKey(phoneNumber),
    phoneNumber,
    lastActivity: Date.now(),
    messageCount: 1,
    createdAt: Date.now(),
  };
  saveSession(record);
  return record;
}

/**
 * Update the last activity timestamp without incrementing message count.
 */
export function touchSession(phoneNumber: string): void {
  const existing = loadSession(phoneNumber);
  if (existing) {
    existing.lastActivity = Date.now();
    saveSession(existing);
  }
}

/**
 * End (delete) a session for the given phone number.
 */
export function endSession(phoneNumber: string): void {
  const path = sessionPath(phoneNumber);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * Clean up all expired sessions. Returns count of removed sessions.
 * Can be called periodically from a cron or admin endpoint.
 */
export function cleanupExpiredSessions(): number {
  ensureDir();
  let removed = 0;
  try {
    const files = readdirSync(SMS_SESSIONS_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const path = join(SMS_SESSIONS_DIR, file);
      try {
        const raw = readFileSync(path, "utf-8");
        const record: SessionRecord = JSON.parse(raw);
        if (Date.now() - record.lastActivity > SESSION_TTL_MS) {
          unlinkSync(path);
          removed++;
        }
      } catch {
        // Skip malformed files
      }
    }
  } catch {
    // Directory might not exist
  }
  return removed;
}

#!/usr/bin/env ts-node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * pipecat-join.ts
 *
 * Joins a Daily room via the local Pipecat control server.
 * - Reads DAILY_ROOM_URL from apps/pipecat-daily-bot/.env (fallback process.env)
 * - POSTs to /join on control server (default http://localhost:4444)
 * - Writes join response (including pid) to /tmp/pipecat-session.json for later leave
 *
 * Optional overrides:
 *   PIPECAT_CONTROL_BASE_URL  (e.g. https://bot.stg.nxops.net) default http://localhost:4444
 *   PIPECAT_PERSONALITY       (override personality)
 *   ROOM_URL                  (override room URL)
 *
 * Usage:
 *   npx ts-node scripts/pipecat-join.ts
 */

import { promises as fs } from 'fs';
import * as path from 'path';

interface JoinResponseServer {
  pid: number;
  room_url: string;
  personalityId: string;
  persona: string;
  [k: string]: any;
}

interface JoinResponseRunnerRaw {
  dailyRoom: string;
  dailyToken: string;
  sessionId?: string;
  personalityId?: string;
  persona?: string;
  [k: string]: any;
}

const SESSION_FILE = '/tmp/pipecat-session.json';
const ENV_FILE = path.join(process.cwd(), 'apps', 'pipecat-daily-bot', '.env');

async function readEnvFile(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(ENV_FILE, 'utf8');
    const map: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      map[key] = val;
    }
    return map;
  } catch {
    return {};
  }
}

async function main() {
  const fileEnv = await readEnvFile();
  const controlBase = process.env.PIPECAT_CONTROL_BASE_URL || 'http://localhost:4444';
  const explicitMode = (process.env.PIPECAT_MODE || '').toLowerCase();
  const roomUrl = process.env.ROOM_URL || fileEnv.DAILY_ROOM_URL || process.env.DAILY_ROOM_URL;
  const default_personality = (process.env.PIPECAT_PERSONALITY || process.env.BOT_PERSONALITY || '').toLowerCase();
  const default_persona = (process.env.PIPECAT_PERSONA || process.env.BOT_PERSONA || 'Pearl').toLowerCase();
  const tenantId = process.env.PIPECAT_TENANT_ID || process.env.BOT_TENANT_ID || '7bd902a4-9534-4fc4-b745-f23368590946';

  if (!roomUrl) {
    console.error('❌ DAILY_ROOM_URL not found (set env or apps/pipecat-daily-bot/.env)');
    process.exit(1);
  }

  const baseNoSlash = controlBase.replace(/\/$/, '');
  const inferredRunner = /:(7860)$/.test(baseNoSlash) || explicitMode === 'runner';

  if (inferredRunner) {
    const startUrl = baseNoSlash + '/start';
    console.log(`➡️  Starting runner session via ${startUrl}`);
    const payload: any = { default_personality, default_persona };
    // If user supplied roomUrl explicitly, pass it so runner joins existing room instead of provisioning.
    if (roomUrl) payload.room_url = roomUrl;
    let resp: Response;
    try {
      resp = await fetch(startUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch (e: any) {
      console.error('❌ Failed to reach runner:', e.message);
      process.exit(1);
    }
    if (!resp.ok) {
      const text = await resp.text();
      console.error(`❌ Runner start failed (${resp.status}): ${text}`);
      process.exit(1);
    }
    const raw = (await resp.json()) as JoinResponseRunnerRaw;
    const session = {
      mode: 'runner',
      session_id: raw.sessionId || Date.now().toString(),
      room_url: raw.dailyRoom,
      token: raw.dailyToken,
      personalityId: raw.personalityId || default_personality,
      persona: raw.persona || default_persona,
      provisioned: raw.provisioned,
      ts: Date.now()
    };
    await fs.writeFile(SESSION_FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
    console.log(`✅ Runner session started. room=${raw.dailyRoom} sessionId=${session.session_id} provisioned=${raw.provisioned}`);
    console.log(`📝 Session stored at ${SESSION_FILE}`);
    return;
  }

  // Legacy custom control server path
  const joinUrl = baseNoSlash + '/join';
  console.log(`➡️  Joining room via ${joinUrl}`);
  let resp: Response;
  try {
    resp = await fetch(joinUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_url: roomUrl, personalityId: default_personality, persona: default_persona, tenantId: tenantId })
    });
  } catch (e: any) {
    console.error('❌ Failed to reach control server:', e.message);
    process.exit(1);
  }
  if (!resp.ok) {
    const text = await resp.text();
    console.error(`❌ Join failed (${resp.status}): ${text}`);
    process.exit(1);
  }
  const data = (await resp.json()) as JoinResponseServer;
  await fs.writeFile(SESSION_FILE, JSON.stringify({ ...data, mode: 'server', ts: Date.now() }, null, 2), { mode: 0o600 });
  console.log(`✅ Joined. PID=${data.pid} room=${data.room_url} personalityId=${data.personalityId} persona=${data.persona} tenantId=${data.tenantId}`);
  console.log(`📝 Session stored at ${SESSION_FILE}`);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});

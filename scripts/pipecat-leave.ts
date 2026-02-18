#!/usr/bin/env ts-node
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * pipecat-leave.ts
 *
 * Leaves a previously joined Daily room via the Pipecat control server.
 * - Reads /tmp/pipecat-session.json written by pipecat-join.ts
 * - Calls /sessions/{pid}/leave (graceful) or DELETE /sessions/{pid} if PIPECAT_FORCE_DELETE=1
 * - Removes session file on success
 *
 * Optional env vars:
 *   PIPECAT_CONTROL_BASE_URL (default http://localhost:4444)
 *   PIPECAT_FORCE_DELETE=1   (force hard delete instead of graceful leave)
 *   PIPECAT_SESSION_FILE     (override path to session file)
 *
 * Usage:
 *   npx ts-node scripts/pipecat-leave.ts
 */

import { promises as fs } from 'fs';

const SESSION_FILE = process.env.PIPECAT_SESSION_FILE || '/tmp/pipecat-session.json';

interface SessionData {
  mode?: 'server' | 'runner';
  pid?: number; // server mode only
  room_url?: string;
  personalityId?: string;
  persona?: string;
  token?: string; // runner daily token
  session_id?: number; // synthetic for runner
  [k: string]: any;
}

async function main() {
  let raw: string;
  try {
    raw = await fs.readFile(SESSION_FILE, 'utf8');
  } catch {
    console.error(`❌ Session file not found at ${SESSION_FILE}. Run pipecat-join first.`);
    process.exit(1);
  }

  let session: SessionData;
  try {
    session = JSON.parse(raw);
  } catch {
    console.error('❌ Failed to parse session JSON.');
    process.exit(1);
  }

  if (session.mode === 'runner') {
    if (!session.session_id) {
      console.error('❌ Runner session file missing session_id.');
    } else {
      const controlBase = process.env.PIPECAT_CONTROL_BASE_URL || 'http://localhost:7860';
      const url = controlBase.replace(/\/$/, '') + `/sessions/${session.session_id}/leave`;
      console.log(`➡️  Terminating runner session ${session.session_id} via ${url}`);
      try {
        const resp = await fetch(url, { method: 'POST' });
        if (!resp.ok) {
          const text = await resp.text();
            console.error(`❌ Runner leave failed (${resp.status}): ${text}`);
        } else {
          console.log('✅ Runner session termination requested.');
        }
      } catch (e: any) {
        console.error('❌ Failed to reach runner:', e.message);
      }
    }
  } else {
    if (!session.pid) {
      console.error('❌ Session file missing pid for server mode.');
      process.exit(1);
    }
    const controlBase = process.env.PIPECAT_CONTROL_BASE_URL || 'http://localhost:4444';
    const forceDelete = !!process.env.PIPECAT_FORCE_DELETE;
    const base = controlBase.replace(/\/$/, '') + `/sessions/${session.pid}`;
    const url = forceDelete ? base : base + '/leave';
    console.log(`➡️  Leaving session PID=${session.pid} via ${url}`);
    let resp: Response;
    try {
      resp = await fetch(url, { method: forceDelete ? 'DELETE' : 'POST' });
    } catch (e: any) {
      console.error('❌ Failed to reach control server:', e.message);
      process.exit(1);
    }
    if (!resp.ok) {
      const text = await resp.text();
      console.error(`❌ Leave failed (${resp.status}): ${text}`);
      process.exit(1);
    }
    console.log('✅ Leave request accepted.');
  }
  console.log('🧹 Removing session file.');
  try { await fs.unlink(SESSION_FILE); } catch {
    // ignore unlink errors
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});

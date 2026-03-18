import { NextRequest, NextResponse } from 'next/server';
import { getSessionSafely } from '@nia/prism/core/auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';
import * as fs from 'fs';
import * as path from 'path';

const log = getLogger('[api_lab_mode]');

const BOT_ENV_PATH = process.env.PIPECAT_BOT_ENV_PATH ||
  path.join(process.cwd(), '..', 'pipecat-daily-bot', '.env');
const BACKUP_PATH = BOT_ENV_PATH + '.lab-backup';
const FLAG_PATH = path.join(path.dirname(BOT_ENV_PATH), '.lab-mode-active');

const OPENCLAW_CONFIG_PATH = '/root/.openclaw/openclaw.json';
const OPENCLAW_BACKUP_PATH = '/root/.openclaw/openclaw.json.lab-backup';

function parseEnvToObj(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      result[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
    }
  }
  return result;
}

async function signalOpenClawRestart() {
  try {
    await fetch('http://localhost:18789/api/gateway/restart', { method: 'POST' });
    log.info('Sent OpenClaw restart signal');
  } catch (err) {
    log.warn('Failed to signal OpenClaw restart (may not be running)', { error: String(err) });
  }
}

function getStatus() {
  const active = fs.existsSync(FLAG_PATH);
  let snapshot: Record<string, string> | null = null;
  let snapshotTime: string | null = null;
  let current: Record<string, string> = {};

  if (fs.existsSync(BACKUP_PATH)) {
    snapshot = parseEnvToObj(fs.readFileSync(BACKUP_PATH, 'utf-8'));
    snapshotTime = fs.statSync(BACKUP_PATH).mtime.toISOString();
  }
  if (fs.existsSync(BOT_ENV_PATH)) {
    current = parseEnvToObj(fs.readFileSync(BOT_ENV_PATH, 'utf-8'));
  }

  const openclawBackedUp = fs.existsSync(OPENCLAW_BACKUP_PATH);

  return { active, snapshot, snapshotTime, current, openclawBackedUp };
}

export async function GET() {
  return NextResponse.json(getStatus());
}

export async function POST(request: NextRequest) {
  try {
    const testMode = process.env.NEXT_PUBLIC_TEST_ANONYMOUS_USER === 'true';
    const session = await getSessionSafely(request, interfaceAuthOptions);
    if (!testMode && !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { action } = body as { action: string };

    if (action === 'status') {
      return NextResponse.json(getStatus());
    }

    if (action === 'activate') {
      if (!fs.existsSync(BOT_ENV_PATH)) {
        return NextResponse.json({ error: 'Bot .env not found' }, { status: 404 });
      }
      // Byte-perfect snapshot of bot .env
      const content = fs.readFileSync(BOT_ENV_PATH);
      fs.writeFileSync(BACKUP_PATH, content);
      // Byte-perfect snapshot of openclaw.json
      if (fs.existsSync(OPENCLAW_CONFIG_PATH)) {
        const openclawContent = fs.readFileSync(OPENCLAW_CONFIG_PATH);
        fs.writeFileSync(OPENCLAW_BACKUP_PATH, openclawContent);
        log.info('OpenClaw config backed up', { backupPath: OPENCLAW_BACKUP_PATH });
      }
      fs.writeFileSync(FLAG_PATH, new Date().toISOString(), 'utf-8');
      log.info('Lab mode activated', { backupPath: BACKUP_PATH });
      return NextResponse.json({ success: true, message: 'Lab mode activated', ...getStatus() });
    }

    if (action === 'deactivate') {
      if (!fs.existsSync(BACKUP_PATH)) {
        return NextResponse.json({ error: 'No backup found to restore' }, { status: 400 });
      }
      // Byte-perfect restore of bot .env
      const backup = fs.readFileSync(BACKUP_PATH);
      fs.writeFileSync(BOT_ENV_PATH, backup);
      // Restore openclaw.json from backup
      if (fs.existsSync(OPENCLAW_BACKUP_PATH)) {
        const openclawBackup = fs.readFileSync(OPENCLAW_BACKUP_PATH);
        fs.writeFileSync(OPENCLAW_CONFIG_PATH, openclawBackup);
        try { fs.unlinkSync(OPENCLAW_BACKUP_PATH); } catch {}
        log.info('OpenClaw config restored from backup');
        await signalOpenClawRestart();
      }
      // Clean up
      try { fs.unlinkSync(FLAG_PATH); } catch {}
      try { fs.unlinkSync(BACKUP_PATH); } catch {}
      log.info('Lab mode deactivated — config restored');
      return NextResponse.json({ success: true, message: 'Config restored', ...getStatus() });
    }

    return NextResponse.json({ error: 'Invalid action. Use: activate, deactivate, status' }, { status: 400 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error('Lab mode error', { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { execFile } from 'child_process';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import { NextRequest, NextResponse } from 'next/server';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';

import { resolveInterfaceActorContext, type InterfaceActorContext } from '@interface/lib/tenant-actor';
import { isBlairActor } from '@interface/lib/workspace-entitlements';
import {
  AGENCY_BOSS_ROSTER,
  agencyBossById,
  normalizeAgencyBossId,
  type AgencyBossId,
} from '@interface/lib/agency-roster';

const execFileAsync = promisify(execFile);

type AgencyBoss = AgencyBossId;

const DEFAULT_CONFIG_PATHS = [
  path.resolve(process.cwd(), '../../config/agency-boss.json'),
  '/opt/pearlos/config/agency-boss.json',
  '/workspace/nia-universal-pearl-prod/config/agency-boss.json',
  '/workspace/nia-universal/config/agency-boss.json',
  '/home/deploy/pearlos/config/agency-boss.json',
];
const VALID_BOSSES = new Set<AgencyBoss>(AGENCY_BOSS_ROSTER.map((boss) => boss.id));

type AgencyBossConfig = {
  boss: AgencyBoss;
  updatedAt?: string;
  updatedBy?: string;
  fallbackBoss?: AgencyBoss;
  fallbackLabel?: string;
  bossLabel?: string;
  modelId?: string;
  executor?: 'codex' | 'claude';
};

type PlatformAdminResult =
  | { ok: true; actor: InterfaceActorContext }
  | { ok: false; response: NextResponse };

async function requirePlatformAdmin(request: NextRequest): Promise<PlatformAdminResult> {
  const actorResult = await resolveInterfaceActorContext({
    request,
    minimumRole: TenantRole.ADMIN,
  });
  if (!actorResult.ok) return { ok: false, response: actorResult.response };
  if (!isBlairActor(actorResult.actor)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'platform_admin_required' }, { status: 403 }),
    };
  }
  return { ok: true, actor: actorResult.actor };
}

function normalizeBoss(value: unknown): AgencyBoss | null {
  return normalizeAgencyBossId(value);
}

function configPaths(): string[] {
  const configured = [
    process.env.PEARLOS_AGENCY_BOSS_CONFIG || '',
    ...(process.env.PEARLOS_AGENCY_BOSS_CONFIG_PATHS || '').split(':'),
    ...DEFAULT_CONFIG_PATHS,
  ];
  return Array.from(new Set(configured.map((item) => item.trim()).filter(Boolean)));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readConfig(): Promise<AgencyBossConfig> {
  for (const filePath of configPaths()) {
    try {
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AgencyBossConfig>;
      const boss = normalizeBoss(parsed.boss);
      if (boss) {
        return {
          boss,
          updatedAt: parsed.updatedAt,
          updatedBy: parsed.updatedBy,
          fallbackBoss: normalizeBoss(parsed.fallbackBoss) ?? parsed.fallbackBoss,
          fallbackLabel: parsed.fallbackLabel,
          bossLabel: parsed.bossLabel,
          modelId: parsed.modelId,
          executor: parsed.executor === 'claude' ? 'claude' : parsed.executor === 'codex' ? 'codex' : undefined,
        };
      }
    } catch {
      // Try the next location.
    }
  }
  return { boss: 'codex' };
}

async function writeConfig(config: AgencyBossConfig): Promise<{ written: string[]; warnings: string[] }> {
  const body = `${JSON.stringify(config, null, 2)}\n`;
  const written: string[] = [];
  const warnings: string[] = [];
  for (const filePath of configPaths()) {
    const fileAlreadyExists = await pathExists(filePath);
    const dirAlreadyExists = await pathExists(path.dirname(filePath));
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, body, 'utf-8');
      written.push(filePath);
    } catch (error) {
      if (fileAlreadyExists || dirAlreadyExists || filePath === process.env.PEARLOS_AGENCY_BOSS_CONFIG) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`${filePath}: ${message}`);
      }
    }
  }
  if (written.length === 0) {
    throw new Error(`Could not write agency boss config: ${warnings.join('; ') || 'no writable config path'}`);
  }
  return { written, warnings };
}

async function restartWorker(): Promise<{ ok: boolean; message: string }> {
  async function runPm2(command: string, args: string[]) {
    return execFileAsync(command, args, { timeout: 20000, maxBuffer: 1024 * 1024 });
  }

  try {
    const { stdout, stderr } = await runPm2('pm2', ['restart', 'pearl-worker', '--update-env']);
    return {
      ok: true,
      message: (stdout || stderr || 'pearl-worker restarted').trim(),
    };
  } catch (directErr) {
    try {
      const { stdout, stderr } = await runPm2('sudo', ['-n', 'pm2', 'restart', 'pearl-worker', '--update-env']);
      return {
        ok: true,
        message: (stdout || stderr || 'pearl-worker restarted via sudo').trim(),
      };
    } catch (sudoErr) {
      const directMessage = directErr instanceof Error ? directErr.message : String(directErr);
      const sudoMessage = sudoErr instanceof Error ? sudoErr.message : String(sudoErr);
      return { ok: false, message: `pm2 restart failed: ${directMessage}; sudo fallback failed: ${sudoMessage}` };
    }
  }
}

export async function GET(request: NextRequest) {
  const admin = await requirePlatformAdmin(request);
  if (!admin.ok) return admin.response;

  const config = await readConfig();
  return NextResponse.json({
    ...config,
    options: Array.from(VALID_BOSSES),
  });
}

export async function POST(request: NextRequest) {
  const admin = await requirePlatformAdmin(request);
  if (!admin.ok) return admin.response;

  let body: { boss?: unknown; apply?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const boss = normalizeBoss(body.boss);
  if (!boss) {
    return NextResponse.json({ error: 'Invalid agency boss' }, { status: 400 });
  }

  const previous: AgencyBossConfig = await readConfig().catch(() => ({ boss: 'codex' as AgencyBoss }));
  const bossProfile = agencyBossById(boss);
  const config: AgencyBossConfig = {
    ...previous,
    boss,
    updatedAt: new Date().toISOString(),
    updatedBy: admin.actor.userEmail || admin.actor.userId,
    bossLabel: bossProfile.label,
    modelId: bossProfile.modelId,
    executor: bossProfile.executor,
    fallbackBoss: previous.fallbackBoss || 'claude',
    fallbackLabel: previous.fallbackLabel || agencyBossById('claude').label,
  };
  let configWrite: { written: string[]; warnings: string[] };
  try {
    configWrite = await writeConfig(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const shouldApply = body.apply !== false;
  const restart = shouldApply
    ? await restartWorker()
    : { ok: true, message: 'saved without restart' };

  return NextResponse.json({
    ...config,
    bossProfile,
    applied: shouldApply,
    restart,
    configWrite,
  }, { status: restart.ok ? 200 : 500 });
}

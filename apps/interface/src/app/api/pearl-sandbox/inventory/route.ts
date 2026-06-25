import { NextRequest, NextResponse } from 'next/server';
import { UserProfileActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getPearlOSPreferences } from '@interface/lib/pearlos-user-preferences';
import { normalizePersonalFeaturePackages } from '@interface/lib/personal-feature-packages';
import { normalizeStudioLedger } from '@interface/lib/studio-ledger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUILT_IN_THEMES = ['pixel', 'glass', 'professional', 'calm'] as const;

function botAuthorized(req: NextRequest): boolean {
  const secret = process.env.BOT_CONTROL_SHARED_SECRET || process.env.PEARL_TASKS_BOT_SECRET || '';
  if (!secret) return false;
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return req.headers.get('x-bot-secret') === secret || bearer === secret;
}

function cleanString(value: unknown, limit = 240): string {
  return typeof value === 'string' ? value.trim().replace(/[<>]/g, '').slice(0, limit) : '';
}

function safeId(value: unknown): string {
  return cleanString(value, 100)
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
}

function normalizeSearch(value: unknown): string {
  return cleanString(value, 120)
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreMatch(query: string, fields: string[]): number {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return 0;
  const queryId = safeId(normalizedQuery);
  const queryTokens = normalizedQuery.split(' ').filter(Boolean);
  let best = 0;
  for (const field of fields) {
    const normalizedField = normalizeSearch(field);
    if (!normalizedField) continue;
    const fieldId = safeId(field);
    if (normalizedField === normalizedQuery || fieldId === queryId) best = Math.max(best, 120);
    else if (normalizedField.includes(normalizedQuery) || fieldId.includes(queryId)) best = Math.max(best, 95);
    else {
      const hits = queryTokens.filter((token) => normalizedField.includes(token)).length;
      if (hits === queryTokens.length && hits > 0) best = Math.max(best, 80);
      else if (hits > 0) best = Math.max(best, 35 + hits * 10);
    }
  }
  return best;
}

function normalizeInstalledFeatures(raw: unknown): Record<string, true> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, true> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = safeId(key);
    if (id && value === true) out[id] = true;
  }
  return out;
}

function interfaceInventory(raw: unknown, query = '') {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const theme = safeId(input.theme) || 'pixel';
  const customThemes: Array<{ id: string; label: string; prompt: string; updatedAt?: number }> = [];
  const seen = new Set<string>();
  const rawThemes = Array.isArray(input.customThemes) ? input.customThemes : [];
  for (const item of rawThemes) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = safeId(record.id);
    if (!id || seen.has(id) || (BUILT_IN_THEMES as readonly string[]).includes(id)) continue;
    seen.add(id);
    customThemes.push({
      id,
      label: cleanString(record.label, 80) || 'Custom',
      prompt: cleanString(record.prompt, 220),
      ...(typeof record.updatedAt === 'number' ? { updatedAt: record.updatedAt } : {}),
    });
  }
  const matchingCustomThemes = query
    ? customThemes
      .map((customTheme) => ({
        ...customTheme,
        matchScore: scoreMatch(query, [customTheme.id, customTheme.label, customTheme.prompt]),
      }))
      .filter((customTheme) => customTheme.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore || a.label.localeCompare(b.label))
      .slice(0, 8)
    : [];
  return {
    activeTheme: theme,
    builtInThemes: BUILT_IN_THEMES,
    customThemes,
    customThemeCount: customThemes.length,
    matchingCustomThemes,
    iconKeys: input.icons && typeof input.icons === 'object' && !Array.isArray(input.icons)
      ? Object.keys(input.icons as Record<string, unknown>).map(safeId).filter(Boolean)
      : [],
  };
}

async function profileFor(userId?: string, email?: string) {
  const found = await UserProfileActions.findByUser(userId || undefined, email || undefined);
  return found?.userProfile || null;
}

async function inventoryFor(userId: string, email: string, query = '') {
  const profile = await profileFor(userId, email);
  const prefs = getPearlOSPreferences(profile?.privateMemory);
  const now = Date.now();
  const ledger = normalizeStudioLedger(prefs.personalChangeLedger, now);
  const packages = normalizePersonalFeaturePackages(prefs.personalFeaturePackages, now);
  const installedCommunityFeatures = normalizeInstalledFeatures(prefs.installedCommunityFeatures);
  const cleanQuery = cleanString(query, 120);
  const customization = interfaceInventory(prefs.interfaceCustomization, cleanQuery);
  return {
    ok: true,
    ...(cleanQuery ? { query: cleanQuery } : {}),
    account: {
      userId: cleanString(userId, 160) || undefined,
      email: cleanString(email, 240) || undefined,
    },
    interfaceCustomization: customization,
    personalChangeLedger: ledger,
    personalFeaturePackages: packages,
    installedCommunityFeatures,
    matches: {
      customThemes: customization.matchingCustomThemes,
    },
    summary: {
      activeTheme: customization.activeTheme,
      customThemeCount: customization.customThemeCount,
      personalChangeCount: ledger.length,
      personalFeaturePackageCount: packages.length,
      installedCommunityFeatureCount: Object.keys(installedCommunityFeatures).length,
    },
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getSessionSafely(req, interfaceAuthOptions);
  const sessionUser = session?.user as { id?: unknown; email?: unknown } | undefined;
  const userId = cleanString(sessionUser?.id, 160);
  const email = cleanString(sessionUser?.email, 240);
  if (!userId && !email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const query = cleanString(req.nextUrl?.searchParams?.get('query'), 120);
  return NextResponse.json(await inventoryFor(userId, email, query), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!botAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const userId = cleanString(body.requester_user_id || body.requesterUserId, 160);
  const email = cleanString(body.requester_email || body.requesterEmail, 240);
  const query = cleanString(body.query || body.search || body.theme, 120);
  if (!userId && !email) {
    return NextResponse.json({ error: 'missing_requester' }, { status: 400 });
  }
  return NextResponse.json(await inventoryFor(userId, email, query), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

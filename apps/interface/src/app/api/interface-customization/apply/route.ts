import { NextRequest, NextResponse } from 'next/server';
import { access } from 'fs/promises';
import { UserProfileActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getPearlOSPreferences, PEARLOS_USER_PREFERENCES_KEY } from '@interface/lib/pearlos-user-preferences';
import { resolveSafePixelArtPath } from '@interface/lib/pixel-art-storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BUILT_IN_THEMES = ['pixel', 'glass', 'professional', 'calm'] as const;
const THEME_BACKGROUNDS: Record<string, { home: string; desktop: string }> = {
  pixel: { home: '/backgrounds/home-sunset.png', desktop: '/backgrounds/desktop-forest.png' },
  glass: { home: '/backgrounds/pearl-aurora.png', desktop: '/backgrounds/pearl-cosmic.png' },
  professional: { home: '/backgrounds/pearl-geometric.png', desktop: '/backgrounds/pearl-minimal.png' },
  calm: { home: '/backgrounds/pearl-ocean.png', desktop: '/backgrounds/pearl-ocean.png' },
};
const PIXEL_ART_IMAGE_PREFIX = '/api/pixel-art/image/';
const RENDERED_ICON_KEYS = new Set([
  'agency',
  'browser',
  'council',
  'discord',
  'files',
  'news',
  'notes',
  'our-pearlos',
  'pearl-vision',
  'pulse',
  'settings',
  'studio',
  'styles',
  'terminal',
  'weather',
  'youtube',
]);
const ICON_KEY_ALIASES: Record<string, string> = {
  appearance: 'styles',
  chrome: 'browser',
  creation: 'studio',
  'creation-engine': 'studio',
  creationengine: 'studio',
  'creation-lab': 'studio',
  creationlab: 'studio',
  'creation-launchpad': 'studio',
  creationlaunchpad: 'studio',
  docs: 'files',
  file: 'files',
  filespace: 'files',
  'feature-catalog': 'our-pearlos',
  featurecatalog: 'our-pearlos',
  'global-pulse': 'pulse',
  globalpulse: 'pulse',
  launchpad: 'studio',
  notepad: 'notes',
  'our-pearl': 'our-pearlos',
  ourpearl: 'our-pearlos',
  'our-pearlos': 'our-pearlos',
  ourpearlos: 'our-pearlos',
  'pearl-village': 'discord',
  pearlvillage: 'discord',
  pearlvision: 'pearl-vision',
  'pearl-vision': 'pearl-vision',
  'public-features': 'our-pearlos',
  publicfeatures: 'our-pearlos',
  'social-pulse': 'pulse',
  socialpulse: 'pulse',
  style: 'styles',
  summon: 'council',
  'summon-agent': 'council',
  summonagent: 'council',
  'the-agency': 'agency',
  theagency: 'agency',
  'the-council': 'council',
  thecouncil: 'council',
  'the-news': 'news',
  thenews: 'news',
  village: 'discord',
  web: 'browser',
  'web-browser': 'browser',
  webbrowser: 'browser',
};

const ALLOWED_CSS_VARS = new Set([
  '--pearl-ui-font',
  '--pearl-shell-bg',
  '--pearl-stage-bg',
  '--pearl-desktop-stage-bg',
  '--pearl-panel-bg',
  '--pearl-panel-muted-bg',
  '--pearl-panel-border',
  '--pearl-panel-backdrop',
  '--pearl-taskbar-bg',
  '--pearl-taskbar-button-bg',
  '--pearl-taskbar-button-border',
  '--pearl-taskbar-collapsed-bg',
  '--pearl-nav-button-bg',
  '--pearl-nav-button-hover-bg',
  '--pearl-nav-button-border',
  '--pearl-nav-button-hover-border',
  '--pearl-text',
  '--pearl-muted',
  '--pearl-soft',
  '--pearl-accent',
  '--pearl-radius',
  '--pearl-icon-label',
  '--pearl-icon-shadow',
  '--pearl-window-bg',
  '--pearl-window-content-bg',
  '--pearl-window-border',
  '--pearl-window-backdrop',
  '--pearl-window-title-bg',
  '--pearl-window-control-bg',
  '--pearl-window-control-hover-bg',
  '--pearl-window-control-border',
  '--pearl-window-control-hover-border',
  '--pearl-window-tab-bg',
  '--pearl-window-tab-active-bg',
  '--pearl-window-divider-bg',
  '--pearl-window-divider-active-bg',
  '--pearl-window-shadow',
]);

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
  return cleanString(value, 80)
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
}

function normalizeSearch(value: unknown): string {
  return cleanString(value, 180)
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function customThemeMatchScore(theme: Record<string, unknown>, queryRaw: unknown): number {
  const query = normalizeSearch(queryRaw);
  const queryId = safeId(queryRaw);
  if (!query && !queryId) return 0;
  const queryTokens = query.split(' ').filter((token) => token.length > 2);
  let best = 0;
  for (const field of [theme.id, theme.label, theme.prompt]) {
    const fieldText = normalizeSearch(field);
    const fieldId = safeId(field);
    if (!fieldText && !fieldId) continue;
    if ((query && fieldText === query) || (queryId && fieldId === queryId)) best = Math.max(best, 120);
    else if (query && fieldText.includes(query)) best = Math.max(best, 95);
    else if (queryId && fieldId.includes(queryId)) best = Math.max(best, 90);
    else if (queryTokens.length && queryTokens.every((token) => fieldText.includes(token))) best = Math.max(best, 75);
  }
  return best;
}

function resolveCustomTheme(customThemes: unknown[], queryRaw: unknown): Record<string, unknown> | null {
  const matches = customThemes
    .filter((theme): theme is Record<string, unknown> => Boolean(theme && typeof theme === 'object' && !Array.isArray(theme)))
    .map((theme) => ({ theme, score: customThemeMatchScore(theme, queryRaw) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return matches[0]?.theme || null;
}

function normalizeIconKey(value: unknown): string {
  const hyphenated = safeId(value);
  if (!hyphenated) return '';
  const compact = hyphenated.replace(/-/g, '');
  const normalized = ICON_KEY_ALIASES[hyphenated] || ICON_KEY_ALIASES[compact] || hyphenated;
  return RENDERED_ICON_KEYS.has(normalized) ? normalized : '';
}

function allowedImageUrl(value: unknown): string | null {
  const url = cleanString(value, 400);
  if (!url) return null;
  if (url.startsWith('/api/pixel-art/image/')) return url;
  if (url.startsWith('/backgrounds/')) return url;
  if (url.startsWith('/desktopicons/') || url.startsWith('/icons/') || url.startsWith('/pixel-ui/')) return url;
  return url.startsWith('/') && /\.(png|jpe?g|gif|webp|svg)$/i.test(url) ? url : null;
}

function sanitizeCssValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/[\n\r{};]/g, '');
  if (!clean || clean.length > 240) return null;
  if (/url\s*\(|expression\s*\(|javascript:/i.test(clean)) return null;
  return clean;
}

function sanitizeStyle(value: unknown): Record<string, string> {
  const style: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return style;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!ALLOWED_CSS_VARS.has(key)) continue;
    const clean = sanitizeCssValue(raw);
    if (clean) style[key] = clean;
  }
  return style;
}

function sanitizeIcons(value: unknown): Record<string, string> {
  const icons: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return icons;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const iconKey = normalizeIconKey(key);
    const url = allowedImageUrl(raw);
    if (iconKey && url) icons[iconKey] = url;
  }
  return icons;
}

function sanitizeBackgrounds(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  return {
    ...(allowedImageUrl(input.home) ? { home: allowedImageUrl(input.home)! } : {}),
    ...(allowedImageUrl(input.desktop) ? { desktop: allowedImageUrl(input.desktop)! } : {}),
  };
}

function normalizeCustomization(raw: unknown) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const customThemes = Array.isArray(input.customThemes) ? input.customThemes.filter(Boolean) : [];
  const theme = typeof input.theme === 'string' ? input.theme : 'pixel';
  return {
    theme,
    backgrounds: sanitizeBackgrounds(input.backgrounds),
    icons: sanitizeIcons(input.icons),
    customThemes,
    updatedAt: typeof input.updatedAt === 'number' ? input.updatedAt : 0,
  };
}

type NormalizedCustomization = ReturnType<typeof normalizeCustomization>;

function pixelArtFilenameFromUrl(url: string): string | null {
  const path = url.split(/[?#]/, 1)[0] || '';
  if (!path.startsWith(PIXEL_ART_IMAGE_PREFIX)) return null;
  const encoded = path.slice(PIXEL_ART_IMAGE_PREFIX.length);
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

async function imageUrlExistsForUser(url: string, userId?: string | null): Promise<boolean> {
  const filename = pixelArtFilenameFromUrl(url);
  if (!filename) return true;
  const resolved = resolveSafePixelArtPath(filename, userId || 'anonymous');
  if (!resolved) return false;
  try {
    await access(resolved);
    return true;
  } catch {
    return false;
  }
}

async function filterAvailableBackgrounds(
  raw: unknown,
  userId?: string | null,
): Promise<{ backgrounds: Record<string, string>; changed: boolean }> {
  const sanitized = sanitizeBackgrounds(raw);
  const backgrounds: Record<string, string> = {};
  let changed = false;

  for (const key of ['home', 'desktop'] as const) {
    const url = sanitized[key];
    if (!url) continue;
    if (await imageUrlExistsForUser(url, userId)) {
      backgrounds[key] = url;
    } else {
      changed = true;
    }
  }

  return { backgrounds, changed };
}

async function filterAvailableIcons(
  raw: unknown,
  userId?: string | null,
): Promise<{ icons: Record<string, string>; changed: boolean }> {
  const sanitized = sanitizeIcons(raw);
  const icons: Record<string, string> = {};
  let changed = false;

  for (const [key, url] of Object.entries(sanitized)) {
    if (await imageUrlExistsForUser(url, userId)) {
      icons[key] = url;
    } else {
      changed = true;
    }
  }

  return { icons, changed };
}

async function normalizeAvailableCustomization(
  raw: unknown,
  userId?: string | null,
): Promise<NormalizedCustomization> {
  const state = normalizeCustomization(raw);
  let changed = false;

  const topBackgrounds = await filterAvailableBackgrounds(state.backgrounds, userId);
  if (topBackgrounds.changed) changed = true;

  const topIcons = await filterAvailableIcons(state.icons, userId);
  if (topIcons.changed) changed = true;

  const customThemes: unknown[] = Array.isArray(state.customThemes) ? state.customThemes : [];
  const availableCustomThemes: any[] = [];
  const seen = new Set<string>();

  for (const item of customThemes) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      changed = true;
      continue;
    }

    const input = item as Record<string, unknown>;
    const id = safeId(input.id);
    if (!id || seen.has(id) || BUILT_IN_THEMES.includes(id as any)) {
      changed = true;
      continue;
    }

    const backgrounds = await filterAvailableBackgrounds(input.backgrounds, userId);
    const icons = await filterAvailableIcons(input.icons, userId);
    if (backgrounds.changed || icons.changed) changed = true;
    if (!backgrounds.backgrounds.home || !backgrounds.backgrounds.desktop) {
      changed = true;
      continue;
    }

    seen.add(id);
    availableCustomThemes.push({
      id,
      label: cleanString(input.label, 28) || 'Custom',
      prompt: cleanString(input.prompt, 180) || cleanString(input.label, 28) || 'custom theme',
      backgrounds: {
        home: backgrounds.backgrounds.home,
        desktop: backgrounds.backgrounds.desktop,
      },
      icons: icons.icons,
      style: sanitizeStyle(input.style),
      createdAt: typeof input.createdAt === 'number' ? input.createdAt : Date.now(),
      updatedAt: typeof input.updatedAt === 'number' ? input.updatedAt : Date.now(),
      generated: true,
    });
  }

  if (availableCustomThemes.length !== customThemes.length) changed = true;

  const hasBuiltInTheme = BUILT_IN_THEMES.includes(state.theme as any);
  const hasCustomTheme = availableCustomThemes.some((theme) => theme.id === state.theme);
  const theme = hasBuiltInTheme || hasCustomTheme ? state.theme : 'pixel';
  if (theme !== state.theme) changed = true;

  return {
    theme,
    backgrounds: topBackgrounds.backgrounds,
    icons: topIcons.icons,
    customThemes: availableCustomThemes,
    updatedAt: changed ? Date.now() : state.updatedAt,
  };
}

function effectiveBackgrounds(state: ReturnType<typeof normalizeCustomization>) {
  const defaults = THEME_BACKGROUNDS[BUILT_IN_THEMES.includes(state.theme as any) ? state.theme : 'pixel'];
  return {
    home: state.backgrounds.home || defaults.home,
    desktop: state.backgrounds.desktop || defaults.desktop,
  };
}

function mergeManifest(currentRaw: unknown, manifestRaw: unknown, titleRaw: unknown) {
  const current = normalizeCustomization(currentRaw);
  const manifest = manifestRaw && typeof manifestRaw === 'object' && !Array.isArray(manifestRaw)
    ? manifestRaw as Record<string, unknown>
    : {};
  const style = sanitizeStyle(manifest.style);
  const backgrounds = sanitizeBackgrounds(manifest.backgrounds);
  const icons = sanitizeIcons(manifest.icons);
  const requestedTheme = safeId(manifest.theme);
  const label = cleanString(manifest.label, 28) || cleanString(titleRaw, 28) || 'Custom PearlOS';
  const now = Date.now();

  const explicitCustomId = safeId(manifest.id);
  const explicitLabel = cleanString(manifest.label, 28);
  const hasCustomIntent = Boolean(Object.keys(style).length || explicitCustomId || explicitLabel);
  const hasThemeAssets = Boolean(backgrounds.home && backgrounds.desktop) || Object.keys(icons).length > 0;

  if (hasCustomIntent && hasThemeAssets) {
    const customId = explicitCustomId || safeId(label) || `custom-${now}`;
    const prior = current.customThemes.find((theme: any) => theme?.id === customId) as any;
    const baseBackgrounds = effectiveBackgrounds(current);
    const customTheme = {
      id: customId,
      label,
      prompt: cleanString(manifest.prompt || titleRaw, 180) || label,
      backgrounds: {
        home: backgrounds.home || prior?.backgrounds?.home || baseBackgrounds.home,
        desktop: backgrounds.desktop || prior?.backgrounds?.desktop || baseBackgrounds.desktop,
      },
      icons: { ...(prior?.icons || {}), ...current.icons, ...icons },
      style: { ...(prior?.style || {}), ...style },
      createdAt: typeof prior?.createdAt === 'number' ? prior.createdAt : now,
      updatedAt: now,
      generated: true,
    };
    return {
      theme: customId,
      backgrounds: customTheme.backgrounds,
      icons: customTheme.icons,
      customThemes: [...current.customThemes.filter((theme: any) => theme?.id !== customId), customTheme],
      updatedAt: now,
    };
  }

  const requestedCustomTheme = requestedTheme
    ? resolveCustomTheme(current.customThemes, manifest.theme)
    : null;
  const requestedCustomThemeId = requestedCustomTheme ? safeId(requestedCustomTheme.id) : '';
  const customThemeBackgrounds = requestedCustomTheme
    ? sanitizeBackgrounds((requestedCustomTheme as Record<string, unknown>).backgrounds)
    : {};
  const customThemeIcons = requestedCustomTheme
    ? sanitizeIcons((requestedCustomTheme as Record<string, unknown>).icons)
    : {};
  const nextTheme = BUILT_IN_THEMES.includes(requestedTheme as any) || requestedCustomTheme
    ? (requestedCustomThemeId || requestedTheme)
    : current.theme;

  return {
    ...current,
    theme: nextTheme,
    backgrounds: { ...current.backgrounds, ...customThemeBackgrounds, ...backgrounds },
    icons: { ...current.icons, ...customThemeIcons, ...icons },
    updatedAt: now,
  };
}

async function profileFor(userId?: string, email?: string) {
  const found = await UserProfileActions.findByUser(userId || undefined, email || undefined);
  return found?.userProfile || null;
}

function sessionEmail(session: Awaited<ReturnType<typeof getSessionSafely>>): string | undefined {
  const value = (session?.user as { email?: unknown } | undefined)?.email;
  return typeof value === 'string' ? value : undefined;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getSessionSafely(req, interfaceAuthOptions);
  const profile = await profileFor(session?.user?.id, sessionEmail(session));
  const prefs = getPearlOSPreferences(profile?.privateMemory);
  const interfaceCustomization = await normalizeAvailableCustomization(
    prefs.interfaceCustomization,
    session?.user?.id || null,
  );
  return NextResponse.json({
    ok: true,
    interfaceCustomization,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!botAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const userId = cleanString(body.requester_user_id || body.requesterUserId, 160);
  const email = cleanString(body.requester_email || body.requesterEmail, 240);
  if (!userId && !email) {
    return NextResponse.json({ error: 'missing_requester' }, { status: 400 });
  }

  const profile = await profileFor(userId, email);
  const existingPrefs = getPearlOSPreferences(profile?.privateMemory);
  const nextCustomization = await normalizeAvailableCustomization(
    mergeManifest(existingPrefs.interfaceCustomization, body.manifest, body.title),
    userId || profile?.userId || null,
  );
  const nextPearlOS = { ...existingPrefs, interfaceCustomization: nextCustomization };
  const updated = await UserProfileActions.createOrUpdateUserProfile({
    id: profile?._id,
    userId: userId || profile?.userId,
    email: email || profile?.email,
    privateMemory: {
      preferences: {
        [PEARLOS_USER_PREFERENCES_KEY]: nextPearlOS,
      },
    },
  }, false);

  if (!updated) {
    return NextResponse.json({ error: 'profile_update_failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    interfaceCustomization: nextCustomization,
  });
}
